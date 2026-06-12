import { corsHeaders } from "../_shared/cors.ts";
import { callAI, aiErrorResponse } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, authErrorResponse } from "../_shared/auth.ts";
import {
  companyIdentity,
  hasCompanyProfile,
  missingProfileResponse,
  renderCompanyProfileBlock,
} from "../_shared/company-profile.ts";
import { normalizeUserContext, renderUserContextPrompt } from "../_shared/user-context.ts";

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

    const { opportunity, teamId, companyProfile, engagementType, pursuitType, primeContractorName, targetedScopeAreas, userContext: userContextRaw, template } = await req.json();
    const engagement = engagementType === "sub" ? "sub" : "prime";
    const pursuit = pursuitType === "rfi_sources_sought" || pursuitType === "capability_statement" ? pursuitType : "rfp_rfq";
    const userContext = normalizeUserContext(userContextRaw);
    const userContextBlock = renderUserContextPrompt(userContext);

    if (!hasCompanyProfile(companyProfile)) return missingProfileResponse(corsHeaders);

    let verifiedTeamId: string | null;
    try { verifiedTeamId = await resolveTeamId(ctx, teamId ?? null); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const templateBlock = (template && typeof template === "object" && (template.filename || template.boilerplate))
      ? `\nPROPOSAL TEMPLATE (offeror-supplied — MATCH this structure, heading hierarchy, ordering, and tone instead of the default section list):
Template file: ${template.filename || "(unnamed)"}
${Array.isArray(template.structure) && template.structure.length
  ? `OUTLINE TO FOLLOW (use exactly these top-level sections, in this order, with these names):\n${template.structure.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}\n`
  : ""}${template.boilerplate ? `Template body (truncated — mirror its voice, formatting conventions, table styles, and boilerplate phrasing):\n${String(template.boilerplate).slice(0, 25000)}\n` : ""}
RULE: Treat this template as authoritative for STRUCTURE (heading order, depth, naming) and TONE. Replace the default outline below with the template's outline. Substitute opportunity-specific content into its sections; do not invent extra top-level sections that are not in the template outline.
`
      : "";

    const rfiSystemPrompt = `You are a senior federal capture manager writing an RFI / SOURCES SOUGHT RESPONSE for ${companyIdentity(companyProfile)}. This is a market-research reply to the contracting officer — NOT a proposal. Do NOT propose a price, do NOT include Section L/M volumes, and do NOT sign anything binding. Tone: concise, factual, third person.

COMPANY PROFILE (sole source of truth):
${renderCompanyProfileBlock(companyProfile)}

Generate the document in markdown with these sections IN ORDER:
1. RESPONSE LETTER — Acknowledge the notice by ID/title. State interest, business size, and applicable socio-economic certifications from the profile. 2-3 paragraphs.
2. COMPANY OVERVIEW — Legal name, UEI/CAGE (only if present), HQ, year founded, NAICS, primary business lines.
3. RELEVANT CAPABILITIES — Bullets + TABLE | Capability | How Demonstrated | Customers Served |. Pull from profile only.
4. PAST PERFORMANCE SUMMARIES — TABLE | Contract | Customer | Period | Value | Scope Relevance | with a 2-3 sentence summary per row. Use only profile past_performance.
5. SUGGESTED ACQUISITION STRATEGY COMMENTS — 4-7 concrete bullets: contract type, PoP structure, vehicle preference, bundling, transition, draft PWS/SOW feedback.
6. SET-ASIDE RECOMMENDATION — Recommend the appropriate set-aside category. ADVOCATE FOR SDVOSB when the profile shows SDVOSB certification AND NAICS allows it — cite the Rule of Two, 38 USC 8127 (VA Vets First) when the agency is VA, and SBA SDVOSB authority. Provide capability evidence the CO needs to justify the set-aside. If not SDVOSB, recommend the strongest set-aside the profile supports. Never invent certifications.

Use markdown tables for structured data. Insert "[TO BE VERIFIED — update in Capture Intel]" rather than inventing details.`;

    const capabilityStatementPrompt = `You are producing a 1-2 page standalone CAPABILITY STATEMENT for ${companyIdentity(companyProfile)} — a marketing-style document, NOT a solicitation response. Pull every fact strictly from the COMPANY PROFILE.

COMPANY PROFILE:
${renderCompanyProfileBlock(companyProfile)}

Generate the document in markdown with these sections IN ORDER:
1. HEADER & CONTACT — Legal name, [LOGO] placeholder, primary contact (use [TO BE NAMED] when missing), website, HQ, bold tagline.
2. COMPANY OVERVIEW — 1 short paragraph + UEI/CAGE/DUNS if present.
3. CORE CAPABILITIES — 6-10 short bullets formatted as a 2-column markdown table.
4. DIFFERENTIATORS — 4-5 bullets with a one-line proof point each.
5. PAST PERFORMANCE HIGHLIGHTS — TABLE of 3-6 entries from profile past_performance only.
6. CERTIFICATIONS & CODES — Two short TABLES: business certifications and NAICS codes from the profile.

Tone: crisp, scannable. No SOW response, no compliance matrix, no fee.`;

    const baseSystemPrompt = pursuit === "rfi_sources_sought"
      ? rfiSystemPrompt
      : pursuit === "capability_statement"
      ? capabilityStatementPrompt
      : engagement === "sub"
      ? `You are a senior federal capture manager producing SUBCONTRACTOR INPUTS for ${companyIdentity(companyProfile)}, who is teamed under the prime named below. The prime is leading the proposal. Your job is NOT to write a teaming pitch addressed to the prime, and NOT to write a standalone Section L/M volume. Instead, produce drop-in content that the prime can paste into THEIR proposal volumes with minimal editing.

VOICE & FRAMING RULES (critical):
- Write in the PRIME'S voice for content destined for the prime's volumes (technical, management, past performance, key personnel). Refer to the offeror in the third person ("${companyIdentity(companyProfile)}, a teammate to ${primeContractorName || "the prime"}, will…") so the prime can lift the text directly.
- Position the offeror as a TEAM MEMBER on the prime's team, not as a competing prime. Do not address the prime as the audience.
- The audience for this content is the GOVERNMENT EVALUATOR reading the prime's proposal — write to evaluation criteria, not to BD/capture readers.
- The ONE exception is the optional "Teaming Pitch" section at the very end, which IS addressed to the prime's capture lead and serves as a secondary recruiting artifact (1 page max). Clearly mark it "[SECONDARY ARTIFACT — Teaming Pitch, not for the prime's volume]".

PRIME CONTRACTOR (lead offeror): ${primeContractorName || "(unspecified)"}
TARGETED SCOPE AREAS (our work-share under the prime): ${targetedScopeAreas || "(unspecified)"}

COMPANY PROFILE — the offeror (sole source of truth — do not invent identity, certifications, locations, past performance):
${renderCompanyProfileBlock(companyProfile)}

Generate the document in markdown with these sections IN ORDER. Each section produces text intended for insertion into the corresponding prime volume — prefix every section with a one-line note: "> Insert into: <Prime Volume Name>".

1. TECHNICAL VOLUME — OUR INPUTS — Subcontractor technical contribution for the targeted scope areas. Mirror SOW numbering when applicable. Written in the prime's voice. Include SLO/approach tables where relevant. Make clear how our contribution slots into the prime's overall solution.
2. MANAGEMENT VOLUME — OUR INPUTS — Subcontractor management contribution: governance interface with the prime PM, our internal QA, escalation path INTO the prime's PMO, subcontract-management posture. Written in the prime's voice.
3. PAST PERFORMANCE — OUR ENTRIES — TABLE of relevant past performance (from the COMPANY PROFILE) formatted for the prime's PP volume: | Contract | Customer | Period | Value | Scope Relevance to This Effort | Role (prime/sub) | CPARS |. Add a 1-paragraph relevance write-up per entry, written in the third person so the prime can drop it into their PP narrative.
4. KEY PERSONNEL — OUR BIOS — Bios for any key personnel the offeror is contributing, formatted for the prime's KP section. Use "[TO BE NAMED]" when unknown.
5. CORPORATE OVERVIEW BLURB — 1-2 paragraph corporate overview suitable for the prime's "Team & Subcontractors" appendix or org-chart annotations. Third person, evaluator-facing.
6. TEAMING PITCH (SECONDARY ARTIFACT, OPTIONAL, 1 PAGE MAX) — Prefix with "[SECONDARY ARTIFACT — Teaming Pitch, not for the prime's volume]". Addressed to the prime's capture/BD lead. Make the case for the offeror's role on the team; reference differentiators, certifications, and past performance; close with a clear work-share ask.

Use markdown tables for structured data. Be specific. If a field is missing from the company profile, insert "[TO BE VERIFIED — update in Capture Intel]" rather than inventing details.`
      : buildSystemPrompt(companyProfile);

    // Sub-mode addendum: when our company is teamed UNDER a prime, every pursuit
    // type (RFP, RFI/Sources Sought, Capability Statement) must be reframed so
    // the PRIME is the submitter and the offeror is positioned as a teammate
    // contributing content for the prime's submission.
    const subAddendum = (engagement === "sub" && (pursuit === "rfi_sources_sought" || pursuit === "capability_statement"))
      ? `

SUB-TO-PRIME REFRAMING (applies to this entire document):
- The SUBMITTER OF RECORD is the prime contractor "${primeContractorName || "(unspecified)"}", not the offeror. ${companyIdentity(companyProfile)} is contributing teammate content for the prime to incorporate into the prime's submission.
- Voice: PRIME'S voice, THIRD PERSON. Address the GOVERNMENT EVALUATOR / contracting officer as the prime would. Refer to the offeror by name as "[Offeror], a teammate to ${primeContractorName || "the prime"}".
- Cover/response letters, set-aside recommendations, and acquisition-strategy comments must be written FROM the prime's perspective (the prime is the responding entity; the offeror is teamed under them).
- Past performance and capability sections should highlight what the offeror brings to the prime's team and how the offeror's work-share strengthens the prime's overall proposition.
- Targeted work-share under the prime: ${targetedScopeAreas || "(unspecified)"}.
- Do NOT produce a standalone offeror-led response; produce drop-in content the prime can paste into THEIR cover letter, capability narrative, and past-performance sections with minimal editing.`
      : "";

    const systemPrompt = templateBlock ? `${baseSystemPrompt}${subAddendum}\n${templateBlock}` : `${baseSystemPrompt}${subAddendum}`;

    const docLabel = pursuit === "rfi_sources_sought"
      ? "an RFI / SOURCES SOUGHT RESPONSE"
      : pursuit === "capability_statement"
      ? "a CAPABILITY STATEMENT"
      : engagement === "sub"
      ? "SUBCONTRACTOR INPUTS for the prime's proposal volumes (plus an optional 1-page teaming pitch at the end)"
      : "a complete proposal";

    const closingInstruction = pursuit === "rfi_sources_sought"
      ? `Generate the FULL RFI / Sources Sought response now following all sections from the system prompt. The Set-Aside Recommendation section must advocate for SDVOSB when the offeror is SDVOSB-certified.`
      : pursuit === "capability_statement"
      ? `Generate the FULL capability statement now following all sections from the system prompt. Keep to 1-2 pages.`
      : engagement === "sub"
      ? `Generate the FULL set of sub-to-prime volume inputs now following all sections from the system prompt. Remember: sections 1-5 are written in the prime's voice for insertion into the prime's volumes; section 6 is the only piece addressed to the prime.`
      : `Generate the FULL proposal now following all sections from the system prompt.`;

    const userPrompt = `Generate ${docLabel} for the following ${pursuit === "capability_statement" ? "company" : "solicitation"}:

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
${userContextBlock}
${closingInstruction}`;


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
