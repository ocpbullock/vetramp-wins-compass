import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse, pickModel, hashCacheKey, getCachedResponse, setCachedResponse } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, assertProposalAccess, authErrorResponse } from "../_shared/auth.ts";
import { normalizeUserContext, appliedFacts, renderUserContextPrompt } from "../_shared/user-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCHEMA = {
  type: "object",
  properties: {
    customer_summary: { type: "string", description: "1-2 paragraph profile of the end-user organization, mission, and operational context." },
    end_user_unit: { type: "string" },
    parent_command: { type: "string" },
    location: { type: "string" },
    mission_priorities: { type: "array", items: { type: "string" } },
    technology_environment: { type: "array", items: { type: "string" }, description: "Known systems, platforms, ATO frameworks, contract vehicles." },
    predecessor_contract: {
      type: "object",
      properties: {
        incumbent: { type: "string" },
        contract_number: { type: "string" },
        period: { type: "string" },
        value: { type: "string" },
        notes: { type: "string" },
      },
    },
    key_personnel: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, role: { type: "string" }, notes: { type: "string" } },
      },
    },
    evaluation_signals: { type: "array", items: { type: "string" }, description: "Hot buttons, hidden requirements, stated priorities likely to drive evaluation." },
    win_themes: { type: "array", items: { type: "string" }, description: "Recommended themes for our proposal given this customer." },
    risks: { type: "array", items: { type: "string" } },
    citations: { type: "array", items: { type: "string" }, description: "Source URLs or document references used." },
  },
  required: ["customer_summary", "mission_priorities", "evaluation_signals", "win_themes"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const {
      opportunity,
      companyProfile,
      extraNotes,
      attachmentsText,
      teamId,
      userId: _ignoredUserId,
      proposalId,
      skipCache,
      engagementType,
      primeContractorName,
      targetedScopeAreas,
      userContext: userContextRaw,
    } = await req.json();
    const engagement = engagementType === "sub" ? "sub" : "prime";
    const userContext = normalizeUserContext(userContextRaw);
    const userContextBlock = renderUserContextPrompt(userContext);

    // Verify team membership (and/or proposal access) BEFORE touching team cache.
    let verifiedTeamId: string | null;
    try {
      verifiedTeamId = await resolveTeamId(ctx, teamId ?? null);
      if (proposalId) await assertProposalAccess(ctx, proposalId);
    } catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const userId = ctx.user.id;

    // Cache key over the inputs that materially affect the result
    const cacheKey = await hashCacheKey({
      opportunity,
      profile: companyProfile,
      extraNotes: extraNotes ?? "",
      attachmentsHash: typeof attachmentsText === "string" && attachmentsText.length > 0 ? await hashCacheKey(attachmentsText) : "",
      engagement,
      primeContractorName: primeContractorName ?? "",
      targetedScopeAreas: targetedScopeAreas ?? "",
      userContext: userContext ?? {},
    });
    if (!skipCache) {
      const cached = await getCachedResponse("customer-intel", cacheKey, verifiedTeamId);
      if (cached) {
        const intel = { ...cached.response_data, _cached: true, _cached_at: cached.created_at };
        return new Response(
          JSON.stringify({ intel, cached: true, cached_at: cached.created_at }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const system = engagement === "sub"
      ? `You are a senior federal capture manager doing pre-RFP intelligence for a SUBCONTRACTOR pursuit. The offeror is teaming UNDER a prime contractor. Profile BOTH (a) the END CUSTOMER (buying agency / end-user unit) and (b) the PRIME CONTRACTOR the offeror is teaming with: what the prime has won before in this domain, their small-business subcontracting history and posture, what scope they typically self-perform vs. sub out, and what they look for in subs. Use your knowledge of US federal agencies, FPDS, USA Spending, SAM.gov, agency strategic plans, recent press, and SubAward data. Be specific. Cite URLs when you can. If data is unknown, say so explicitly rather than fabricating.`
      : `You are a senior federal capture manager doing pre-RFP customer intelligence. Use your knowledge of US federal agencies, DoD components, USA Spending, FPDS, SAM.gov, agency strategic plans, and recent press to build a deep profile of the buying customer. Be specific. Cite URLs when you can. If data is unknown, say so explicitly rather than fabricating.`;

    const trimmedAttachments = typeof attachmentsText === "string" && attachmentsText.length > 0
      ? attachmentsText.slice(0, 60000)
      : "";

    const subContext = engagement === "sub"
      ? `\nENGAGEMENT MODE: SUBCONTRACTOR pursuit.\nPRIME CONTRACTOR being teamed with: ${primeContractorName || "(unspecified — note this gap)"}\nTARGETED SCOPE AREAS (portion of work the offeror wants under the prime): ${targetedScopeAreas || "(unspecified)"}\nIn your output, weave findings about the prime into mission_priorities/evaluation_signals/win_themes (e.g. what makes a good sub for this prime on this opportunity).\n`
      : "";

    const user = `OPPORTUNITY:
${JSON.stringify(opportunity, null, 2)}

OUR COMPANY PROFILE (for win-theme alignment):
${JSON.stringify(companyProfile, null, 2)}
${subContext}${userContextBlock}
${extraNotes ? `ADDITIONAL CONTEXT FROM USER:\n${extraNotes}\n` : ""}${trimmedAttachments ? `\nREFERENCE DOCUMENTS PROVIDED BY USER (incumbent past performance, agency plans, prior SOWs, org charts, etc.):\n${trimmedAttachments}\n` : ""}
Research this customer${engagement === "sub" ? " AND the named prime contractor" : ""} and return structured intel. Focus on: who actually uses the result, what they're trying to accomplish, what their recent contracting pattern looks like, who the incumbent is (if any), and what evaluation criteria will likely matter most.${userContext?.knownIncumbent ? `\n\nNote: the offeror has confirmed the incumbent as "${userContext.knownIncumbent}". Use this as the predecessor_contract.incumbent value and do not propose a different incumbent.` : ""}`;


    let data: any;
    try {
      data = await callAI({
        functionName: "customer-intel",
        teamId: verifiedTeamId,
        userId,
        proposalId: proposalId ?? null,
        timeoutMs: 60_000,
        body: {
          model: pickModel("customer-intel"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          tools: [{ type: "function", function: { name: "return_customer_intel", description: "Return structured customer intelligence.", parameters: SCHEMA } }],
          tool_choice: { type: "function", function: { name: "return_customer_intel" } },
        },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const intel = args ? JSON.parse(args) : null;
    if (!intel) throw new Error("No intel returned");
    intel._data_source = "ai";
    intel._fetched_at = new Date().toISOString();
    try {
      await setCachedResponse({
        functionName: "customer-intel",
        cacheKey,
        teamId: verifiedTeamId,
        responseData: intel,
        model: pickModel("customer-intel"),
        inputTokens: data.__usage?.inputTokens,
        outputTokens: data.__usage?.outputTokens,
        ttlHours: 48,
      });
    } catch (e) { console.error("cache write failed:", e); }
    return new Response(JSON.stringify({ intel }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("customer-intel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
