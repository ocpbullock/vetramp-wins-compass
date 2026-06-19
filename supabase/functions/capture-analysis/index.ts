import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse, pickModel, hashCacheKey, getCachedResponse, setCachedResponse } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, assertProposalAccess, authErrorResponse } from "../_shared/auth.ts";
import { normalizeUserContext, appliedFacts, renderUserContextPrompt } from "../_shared/user-context.ts";
import { wrapUntrusted, UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION } from "../_shared/untrusted.ts";
import { loadOpportunityIntelBlock, PROPRIETARY_INTEL_SYSTEM_INSTRUCTION } from "../_shared/opportunity-intel.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SCHEMA = {
  type: "object",
  properties: {
    bid_no_bid: {
      type: "object",
      properties: {
        recommendation: { type: "string", enum: ["bid", "no_bid", "lean_bid", "lean_no_bid"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        rationale: { type: "string" },
        key_factors: { type: "array", items: { type: "string" } },
      },
      required: ["recommendation", "confidence", "rationale", "key_factors"],
    },
    win_themes: { type: "array", items: { type: "string" } },
    competitor_assessment: { type: "string", description: "Synthesized assessment referencing specific competitors from market_snapshot." },
    staffing_concerns: { type: "array", items: { type: "string" }, description: "Clearance, labor category, incumbent-staff retention, and similar risks." },
    next_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          why: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["action", "why", "priority"],
      },
    },
  },
  required: ["bid_no_bid", "win_themes", "competitor_assessment", "staffing_concerns", "next_actions"],
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { proposalId, skipCache, userContext: userContextRaw } = await req.json();
    if (!proposalId) {
      return new Response(JSON.stringify({ error: "proposalId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let proposalAccess;
    try { proposalAccess = await assertProposalAccess(ctx, proposalId); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    let verifiedTeamId: string | null;
    try { verifiedTeamId = await resolveTeamId(ctx, proposalAccess.team_id ?? null); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const userId = ctx.user.id;

    // Load the full proposal row (RLS-scoped).
    const { data: proposal, error: propErr } = await ctx.userClient
      .from("proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    if (propErr || !proposal) {
      return new Response(JSON.stringify({ error: "Proposal not accessible" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Attachments: parsed_content from proposal_attachments.
    const { data: attachmentRows } = await ctx.userClient
      .from("proposal_attachments")
      .select("filename, attachment_type, parsed_content")
      .eq("proposal_id", proposalId)
      .limit(20);

    const attachmentsText = (attachmentRows ?? [])
      .map((a: any) => {
        const txt = typeof a.parsed_content === "string" ? a.parsed_content : "";
        if (!txt) return "";
        return `--- ${a.filename}${a.attachment_type ? ` (${a.attachment_type})` : ""} ---\n${txt}`;
      })
      .filter(Boolean)
      .join("\n\n");

    // Proprietary human intel.
    const { block: proprietaryIntelBlock, count: proprietaryIntelCount } =
      await loadOpportunityIntelBlock(ctx.userClient, proposalId);

    const userContext = normalizeUserContext(userContextRaw);
    const userContextBlock = renderUserContextPrompt(userContext);

    const marketSnapshot = (proposal as any).market_snapshot ?? null;

    const cacheKey = await hashCacheKey({
      proposalId,
      proposalUpdatedAt: proposal.updated_at,
      marketSnapshotAt: (proposal as any).market_snapshot_at ?? null,
      attachmentsHash: attachmentsText ? await hashCacheKey(attachmentsText) : "",
      proprietaryIntelHash: proprietaryIntelBlock ? await hashCacheKey(proprietaryIntelBlock) : "",
      userContext: userContext ?? {},
    });

    if (!skipCache) {
      const cached = await getCachedResponse("capture-analysis", cacheKey, verifiedTeamId);
      if (cached) {
        const analysis = { ...cached.response_data, _cached: true, _cached_at: cached.created_at };
        return new Response(
          JSON.stringify({ analysis, cached: true, cached_at: cached.created_at }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const system = UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION + "\n\n" + PROPRIETARY_INTEL_SYSTEM_INSTRUCTION + "\n\n" +
      `You are a senior federal capture manager producing a Capture Analysis for an opportunity. Produce a sober bid/no-bid recommendation, win themes, a synthesized competitor assessment, staffing concerns (clearance, labor categories, incumbent staff retention), and a short prioritized next-actions list. Be specific. When proprietary human intelligence conflicts with public/market_snapshot signals, defer to the proprietary intel and call out the discrepancy. Never fabricate facts.`;

    const opportunitySummary = {
      title: proposal.opportunity_title,
      solicitation_number: proposal.solicitation_number,
      agency: proposal.agency,
      naics_code: proposal.naics_code,
      set_aside: proposal.set_aside,
      response_deadline: proposal.response_deadline,
      pursuit_type: proposal.pursuit_type,
      capture_stage: proposal.capture_stage,
    };

    const oppBlock = wrapUntrusted("opportunity", JSON.stringify(opportunitySummary, null, 2));
    const marketBlock = marketSnapshot
      ? wrapUntrusted("market-snapshot", JSON.stringify(marketSnapshot).slice(0, 60000))
      : "";
    const attachmentsBlock = attachmentsText
      ? wrapUntrusted("user-attachments", attachmentsText.slice(0, 60000))
      : "";

    const user = `OPPORTUNITY:
${oppBlock}

${marketBlock ? `MARKET SNAPSHOT (historical awards, incumbent, prior primes/subs, candidate partners, competitors):\n${marketBlock}\n` : "MARKET SNAPSHOT: (not generated yet)\n"}
${userContextBlock}${proprietaryIntelBlock}
${attachmentsBlock ? `\nREFERENCE DOCUMENTS (RFP/RFI, SOW, attachments, parsed text):\n${attachmentsBlock}\n` : ""}
Produce the structured Capture Analysis.${proprietaryIntelCount > 0 ? `\n\nThere are ${proprietaryIntelCount} proprietary intel item(s) above — prefer them over public assumptions when they conflict, and cite the intel id (e.g. "(per proprietary-intel:abcd1234)") in rationale or next_actions when an item materially shaped a conclusion.` : ""}`;

    let data: any;
    try {
      data = await callAI({
        functionName: "capture-analysis",
        teamId: verifiedTeamId,
        userId,
        proposalId,
        timeoutMs: 60_000,
        body: {
          model: pickModel("capture-analysis"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          tools: [{ type: "function", function: { name: "return_capture_analysis", description: "Return structured capture analysis.", parameters: SCHEMA } }],
          tool_choice: { type: "function", function: { name: "return_capture_analysis" } },
        },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const analysis = args ? JSON.parse(args) : null;
    if (!analysis) throw new Error("No analysis returned");
    analysis._data_source = "ai";
    analysis._fetched_at = new Date().toISOString();
    analysis._user_context_applied = appliedFacts(userContext);
    analysis._proprietary_intel_count = proprietaryIntelCount;

    // Persist on the proposals row (RLS-scoped via userClient).
    try {
      await ctx.userClient
        .from("proposals")
        .update({
          capture_analysis: analysis,
          capture_analysis_at: analysis._fetched_at,
        })
        .eq("id", proposalId);
    } catch (e) { console.error("capture-analysis persist failed:", e); }

    // Cache (separate from row persistence for replay/debugging).
    try {
      await setCachedResponse({
        functionName: "capture-analysis",
        cacheKey,
        teamId: verifiedTeamId,
        responseData: analysis,
        model: pickModel("capture-analysis"),
        inputTokens: data.__usage?.inputTokens,
        outputTokens: data.__usage?.outputTokens,
        ttlHours: 48,
      });
    } catch (e) { console.error("cache write failed:", e); }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("capture-analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
