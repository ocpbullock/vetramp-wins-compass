import { corsHeaders } from "../_shared/cors.ts";
import { callAI, aiErrorResponse } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, authErrorResponse } from "../_shared/auth.ts";
import {
  companyIdentity,
  hasCompanyProfile,
  missingProfileResponse,
  renderCompanyProfileBlock,
} from "../_shared/company-profile.ts";

function buildSystemPrompt(companyProfile: Record<string, any>): string {
  const identity = companyIdentity(companyProfile);
  const profileBlock = renderCompanyProfileBlock(companyProfile);

  return `You are a senior federal capture manager writing a proposal for ${identity}.
Write in federal-proposal style: address Section L instructions and Section M evaluation criteria, develop clear win themes, and substantiate every claim with discriminators and proof points drawn from the company profile and any provided past performance.

COMPANY PROFILE (use as the sole source of truth for who the offeror is — do not invent identity, certifications, locations, past performance, or recruiting pipelines that are not listed here):
${profileBlock}

STEP 1 — RESEARCH BEFORE WRITING:
Use the solicitation details to infer the contracting office and end-user unit. Reference the unit's mission, terminology, facility specifics, and any relevant standards (CMMI, AS9100, Agile, DevSecOps) only when they are actually relevant. Weave specifics into every section. Avoid generic boilerplate.

STEP 2 — GENERATE the full proposal in markdown with these sections IN ORDER:

1. COVER LETTER — addressed to the Contracting Officer at the named agency; reference end-user unit by name; connect the offeror's experience to the unit's mission in 2–3 sentences.

2. EXECUTIVE SUMMARY — Organizational Capability; Understanding of the Requirement (specific to end-user unit); proposed support/delivery model; 5 differentiator bullets tied to specific requirements (use the company's Differentiators where applicable); operational capability timeline.

3. TECHNICAL APPROACH
   3.1 Service/Solution Delivery Model — tiers/phases, coverage, SLAs, systems supported.
   3.2 Technology & Security Framework — cite only frameworks relevant to the SOW (e.g. NIST 800-171, CMMC, DFARS, DISA STIGs when applicable).
   3.3 Support Coverage Areas — mapped to unit mission.
   3.4 Service Level Objectives — Markdown TABLE: Priority | Response Time | Resolution Target | Escalation Path; Critical/High/Medium/Low; uptime target.

4. MANAGEMENT PLAN
   4.1 Org Structure — TABLE: Role | Reports To | Key Responsibility.
   4.2 Governance — Weekly/Monthly/Quarterly deliverables.
   4.3 QA — measurable audit and satisfaction targets with continuous-improvement method.
   4.4 Risk Management — TABLE of 5 risks (key staff departure, vendor EOL, facility downtime, security incident, plus contract-specific) with Likelihood | Impact | Mitigation.

5. PAST PERFORMANCE — TABLE (Client | Duration | Value | Scope) using ONLY entries from the company profile's past_performance (or supplied past-performance library); Relevance paragraph mapping to the current SOW; Federal agency experience summary; Certifications TABLE built from the company profile.

6. STAFFING PLAN — Team TABLE (Position | FTE | Experience | Qualifications); clearance and hiring posture consistent with the company profile; Mobilization timeline TABLE.

7. CERTIFICATIONS & COMPLIANCE — Business cert TABLE built strictly from the company profile (include UEI/CAGE only if present); cybersecurity frameworks; personnel security; regulatory compliance.

8. APPENDICES — TABLE listing Appendices A–G with contents.

9. FINAL CERTIFICATION — Statement with signature blocks for the offeror named in the company profile.

10. INTERNAL FINALIZATION CHECKLIST (prefix with "[REMOVE BEFORE SUBMISSION]") — cost proposal benchmarks, founder/key-personnel details to insert (use placeholders when missing from the profile), reference consent, compliance verification, SOW/PWS tailoring once full RFP received, clearance verification with FSO, predecessor contract analysis.

Use markdown tables for all structured data. Use clear section headers. Be specific, not generic. If a field is missing from the company profile, insert "[TO BE VERIFIED — update in Capture Intel]" rather than inventing details.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { opportunity, teamId, companyProfile } = await req.json();

    if (!hasCompanyProfile(companyProfile)) return missingProfileResponse(corsHeaders);

    let verifiedTeamId: string | null;
    try { verifiedTeamId = await resolveTeamId(ctx, teamId ?? null); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const systemPrompt = buildSystemPrompt(companyProfile);

    const userPrompt = `Generate a complete proposal for the following solicitation:

Title: ${opportunity.title || "N/A"}
Solicitation #: ${opportunity.solicitationNumber || "N/A"}
Agency: ${opportunity.fullParentPathName || opportunity.agency || "N/A"}
NAICS: ${opportunity.naicsCode || "N/A"}
Notice Type: ${opportunity.type || "N/A"}
Posted: ${opportunity.postedDate || "N/A"}
Response Deadline: ${opportunity.responseDeadLine || "N/A"}
Set-Aside: ${opportunity.setAside || opportunity.typeOfSetAside || "N/A"}
Place of Performance: ${JSON.stringify(opportunity.placeOfPerformance || {})}

Description:
${opportunity.description || "(No description provided — infer from title and agency)"}

Generate the FULL proposal now following all sections from the system prompt.`;

    let res: Response;
    try {
      res = await callAI({
        functionName: "generate-proposal",
        teamId: verifiedTeamId,
        stream: true,
        body: {
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
        },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    return new Response(res.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
