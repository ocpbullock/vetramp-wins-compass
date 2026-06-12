import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse, pickModel, hashCacheKey, getCachedResponse, setCachedResponse } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, assertProposalAccess, authErrorResponse } from "../_shared/auth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { hasCompanyProfile, missingProfileResponse, renderCompanyProfileBlock, companyIdentity } from "../_shared/company-profile.ts";
import { wrapUntrusted, UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION } from "../_shared/untrusted.ts";

const SCHEMA = {
  type: "object",
  properties: {
    email_subject: { type: "string" },
    email_body: { type: "string", description: "Full professional email body, multi-paragraph plain text." },
    brief_message: { type: "string", description: "Shorter LinkedIn / intro message, under 200 words." },
    fit_rationale: { type: "array", items: { type: "string" }, description: "Short bullets explaining why this partner is a strong fit." },
  },
  required: ["email_subject", "email_body", "brief_message"],
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const {
      opportunity,
      companyProfile,
      partner,
      engagementType,
      proposedRole,
      proposedWorkSharePct,
      proposedScopeAreas,
      teamId,
      proposalId,
      skipCache,
    } = await req.json();

    if (!hasCompanyProfile(companyProfile)) return missingProfileResponse(corsHeaders);
    if (!partner || !partner.company_name) {
      return new Response(JSON.stringify({ error: "partner is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const engagement = engagementType === "sub" ? "sub" : "prime";

    let verifiedTeamId: string | null;
    try {
      verifiedTeamId = await resolveTeamId(ctx, teamId ?? null);
      if (proposalId) await assertProposalAccess(ctx, proposalId);
    } catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const userId = ctx.user.id;

    const cacheKey = await hashCacheKey({
      opp: { id: opportunity?.noticeId || opportunity?.id, title: opportunity?.title, naics: opportunity?.naicsCode, agency: opportunity?.agency, sol: opportunity?.solicitationNumber, deadline: opportunity?.responseDeadLine },
      partnerId: partner.id || partner.uei || partner.company_name,
      engagement,
      role: proposedRole || "",
      share: proposedWorkSharePct ?? "",
      scope: proposedScopeAreas || "",
      companyKey: companyIdentity(companyProfile),
    });

    if (!skipCache) {
      const cached = await getCachedResponse("generate-teaming-outreach", cacheKey, verifiedTeamId);
      if (cached) {
        return new Response(JSON.stringify({ outreach: { ...cached.response_data, _cached: true }, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const system = UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION + "\n\n" + "You are a business development professional specializing in federal government contracting teaming arrangements. Write professional, compelling outreach messages that clearly articulate mutual benefit and complementary capabilities. Be specific, never generic. Reference concrete facts from the company profiles, certifications, NAICS codes, and opportunity details provided. Never fabricate past performance or relationships.";

    const direction = engagement === "sub"
      ? `We (the sender) are pursuing this opportunity as a SUBCONTRACTOR and reaching out to the target company as a potential PRIME we could team UNDER. Frame the value we bring as a sub: relevant past performance, certifications, scope we can self-perform.`
      : `We (the sender) are pursuing this opportunity as the PRIME and reaching out to the target company as a potential SUBCONTRACTOR to join our team. Frame why we want them on the team and what role we're proposing.`;

    const userMsg = `OUR COMPANY (sender):
${renderCompanyProfileBlock(companyProfile)}

OPPORTUNITY:
- Title: ${opportunity?.title ?? "(unknown)"}
- Agency: ${opportunity?.agency ?? opportunity?.fullParentPathName ?? "(unknown)"}
- Solicitation #: ${opportunity?.solicitationNumber ?? "(none)"}
- NAICS: ${opportunity?.naicsCode ?? "(none)"}
- Set-aside: ${opportunity?.typeOfSetAsideDescription ?? opportunity?.setAside ?? "(none)"}
- Response deadline: ${opportunity?.responseDeadLine ?? "(none)"}
- Posted: ${opportunity?.postedDate ?? "(none)"}
- Scope summary: ${(opportunity?.description ?? "").toString().slice(0, 2000)}

TARGET PARTNER (recipient):
- Company: ${partner.company_name}
- Certifications: ${(partner.certifications ?? []).join(", ") || "(unknown)"}
- NAICS: ${(partner.naics_codes ?? []).join(", ") || "(unknown)"}
- Location: ${partner.location || [partner.city, partner.state].filter(Boolean).join(", ") || "(unknown)"}
- UEI: ${partner.uei ?? "(unknown)"}
- Capabilities: ${partner.capabilities_summary ? wrapUntrusted("partner:capabilities", partner.capabilities_summary) : "(none on file)"}
- Past performance: ${partner.past_performance_summary ? wrapUntrusted("partner:past-performance", partner.past_performance_summary) : "(none on file)"}
- POC: ${partner.poc_name ?? "(unknown)"}${partner.poc_email ? ` <${partner.poc_email}>` : ""}

TEAMING PROPOSAL:
- Engagement: ${engagement.toUpperCase()}
- ${direction}
- Proposed role for target partner: ${proposedRole || "(open)"}
- Proposed work share for target partner: ${proposedWorkSharePct != null ? `${proposedWorkSharePct}%` : "(open)"}
- Proposed scope areas: ${proposedScopeAreas || "(open)"}

Write:
1. A professional outreach EMAIL with a compelling subject line. Include: greeting using the POC name if available; brief intro of our company; the opportunity (title, agency, deadline); WHY we're reaching out to THEM specifically (cite overlapping NAICS / complementary certifications / relevant capabilities); the proposed teaming arrangement; a clear call to action (e.g. 30-min intro call, capabilities statement exchange); and a professional sign-off using the sender's company name.
2. A shorter BRIEF version (under 200 words) suitable for a LinkedIn message or quick intro.
3. 2-4 short bullets in fit_rationale summarizing the strongest reasons this teaming makes sense.`;

    let data: any;
    try {
      data = await callAI({
        functionName: "generate-teaming-outreach",
        teamId: verifiedTeamId,
        userId,
        proposalId: proposalId ?? null,
        timeoutMs: 60_000,
        body: {
          model: pickModel("generate-teaming-outreach"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
          tools: [{ type: "function", function: { name: "return_outreach", description: "Return structured outreach messaging.", parameters: SCHEMA } }],
          tool_choice: { type: "function", function: { name: "return_outreach" } },
        },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const outreach = args ? JSON.parse(args) : null;
    if (!outreach) throw new Error("No outreach returned");
    outreach._fetched_at = new Date().toISOString();

    try {
      await setCachedResponse({
        functionName: "generate-teaming-outreach",
        cacheKey,
        teamId: verifiedTeamId,
        responseData: outreach,
        model: pickModel("generate-teaming-outreach"),
        inputTokens: data.__usage?.inputTokens,
        outputTokens: data.__usage?.outputTokens,
        ttlHours: 168,
      });
    } catch (e) { console.error("cache write failed:", e); }

    return new Response(JSON.stringify({ outreach }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-teaming-outreach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
