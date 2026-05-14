import { corsHeaders } from "../_shared/cors.ts";
import { callAI, aiErrorResponse } from "../_shared/ai-client.ts";

const SYSTEM_PROMPT = `You are a senior federal proposal writer for LGE Consulting, LLC dba VetRamp, a Service-Disabled Veteran-Owned Small Business (SDVOSB).

COMPANY PROFILE (use verbatim):
- Company: LGE Consulting, LLC dba VetRamp
- UEI: N8HBYAZ9VGQ5 | CAGE: 9PKK3
- Location: Cedar Park, TX 78613
- Primary NAICS: 541512
- Certifications: SBA-certified SDVOSB, Texas VetHUB partner, HIRE Vets Medallion
- Core Services: IT Infrastructure, Cybersecurity, Cloud, Veteran Talent Solutions, Healthcare IT
- Past Performance: Brooke Army Medical Center (multimedia/training, security/onboarding)
- Federal Experience: Army, Air Force, DHA, VA, DHS

STEP 1 — RESEARCH BEFORE WRITING:
Use the solicitation details to infer the contracting office and end-user unit. Reference the unit's mission, terminology, facility specifics, and any relevant standards (CMMI, AS9100, Agile, DevSecOps). Weave specifics into every section. Avoid generic boilerplate.

STEP 2 — GENERATE the full proposal in markdown with these sections IN ORDER:

1. COVER LETTER — addressed to the Contracting Officer at the named agency; reference end-user unit by name; connect VetRamp's experience to the unit's mission in 2–3 sentences.

2. EXECUTIVE SUMMARY — Organizational Capability; Understanding of the Requirement (specific to end-user unit); Three-tier support model (Tier 1 help desk/ITIL, Tier 2/3 technical resolution, Operations Integration); 5 differentiator bullets tied to specific requirements; 30-day full operational capability timeline.

3. TECHNICAL APPROACH
   3.1 Service Delivery Model — three tiers, coverage hours, SLA response, systems supported.
   3.2 Technology & Security Framework — ServiceNow, SIEM, CCB, DevSecOps; NIST 800-171, CMMC, DFARS, DISA STIGs.
   3.3 Support Coverage Areas — mapped to unit mission.
   3.4 Service Level Objectives — Markdown TABLE: Priority | Response Time | Resolution Target | Escalation Path; Critical/High/Medium/Low; 99.5% uptime.

4. MANAGEMENT PLAN
   4.1 Org Structure — TABLE: Role | Reports To | Key Responsibility.
   4.2 Governance — Weekly/Monthly/Quarterly deliverables.
   4.3 QA — 15% ticket audits, 90%+ satisfaction, Lean/Kaizen.
   4.4 Risk Management — TABLE of 5 risks (key staff departure, vendor EOL, facility downtime, security incident, plus contract-specific) with Likelihood | Impact | Mitigation.

5. PAST PERFORMANCE — BAMC TABLE (Client | Duration | Value | Scope) + achievements; Relevance paragraph; Federal agency experience summary; Certifications TABLE.

6. STAFFING PLAN — Team TABLE (Position | FTE | Experience | Qualifications); U.S.-based, TS/SCI eligible, veteran hiring priority, 30-day overlap; Mobilization timeline TABLE.

7. CERTIFICATIONS & COMPLIANCE — Business cert TABLE (SBA SDVOSB w/ UEI/CAGE, HIRE Vets, VetHUB, SAM.gov); cybersecurity frameworks; personnel security; regulatory compliance.

8. APPENDICES — TABLE listing Appendices A–G with contents.

9. FINAL CERTIFICATION — Statement with signature blocks.

10. INTERNAL FINALIZATION CHECKLIST (prefix with "[REMOVE BEFORE SUBMISSION]") — cost proposal benchmarks, founder details to insert (name, branch, rank), reference consent, compliance verification, SOW/PWS tailoring once full RFP received, clearance verification with FSO, predecessor contract analysis.

Use markdown tables for all structured data. Use clear section headers. Be specific, not generic.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { opportunity, teamId } = await req.json();

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
        teamId: teamId ?? null,
        stream: true,
        body: {
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
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
