import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { callAI, aiErrorResponse, pickModel } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, assertProposalAccess, authErrorResponse } from "../_shared/auth.ts";
import {
  companyIdentity,
  hasCompanyProfile,
  missingProfileResponse,
  renderCompanyProfileBlock,
} from "../_shared/company-profile.ts";

const SECTION_KB_CATEGORIES: Record<string, string[]> = {
  past_performance: ["past_performance"],
  staffing_plan: ["personnel"],
  cover_letter: ["capability", "win_theme"],
  executive_summary: ["capability", "win_theme"],
  technical_approach: ["capability", "boilerplate"],
  compliance_matrix: ["boilerplate"],
};

async function fetchKnowledgeContext(
  sectionId: string,
  admin: ReturnType<typeof createClient>,
  teamId: string | null,
): Promise<string> {
  try {
    if (!teamId) return "";

    // Include parent org team for opportunity-team proposals so opp teams can
    // pull from the parent organization's knowledge base (mirrors RLS).
    const { data: teamRow } = await admin
      .from("teams")
      .select("id, team_type, parent_team_id")
      .eq("id", teamId)
      .maybeSingle();
    const teamIds = new Set<string>([teamId]);
    if (teamRow?.parent_team_id) teamIds.add(teamRow.parent_team_id);

    const categories = SECTION_KB_CATEGORIES[sectionId] ?? ["boilerplate"];
    const parts: string[] = [];
    for (const cat of categories) {
      const { data, error } = await admin
        .from("knowledge_base")
        .select("title,content,category")
        .in("team_id", Array.from(teamIds))
        .eq("category", cat)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) { console.error("kb fetch error:", cat, error.message); continue; }
      for (const row of data ?? []) {
        parts.push(`--- ${row.title} (${row.category}) ---\n${row.content}`);
      }
    }
    if (!parts.length) return "";
    return parts.join("\n\n").slice(0, 15_000);
  } catch (e) {
    console.error("fetchKnowledgeContext failed:", e);
    return "";
  }
}


// Generates ONE proposal section using the AI Gateway, streaming SSE back to client.
// Inputs: { sectionId, sectionTitle, opportunity, companyProfile, customerIntel?, complianceMatrix?, solutionDesign?, attachmentsText? }

const SECTION_INSTRUCTIONS: Record<string, string> = {
  cover_letter: `Write a one-page COVER LETTER addressed to the Contracting Officer at the named contracting office.
- Reference the END-USER unit by name (parse from the agency hierarchy).
- Acknowledge the operating environment in 2-3 specific sentences.
- Connect the offeror's experience (from the COMPANY PROFILE) to the unit's mission. No generic boilerplate.`,
  executive_summary: `Write the EXECUTIVE SUMMARY.
- Open with the end-user unit's mission and how this contract supports it (use customer intel if present).
- Demonstrate Understanding of the Requirement: name the facility, reference standards/frameworks, mention customer base. Zero generic language.
- 3-4 paragraphs covering technical / management / staffing at high level.
- Include a 5-row markdown TABLE of discriminators: | Discriminator | How It Benefits the Customer | (draw discriminators from the COMPANY PROFILE's Differentiators when available).
- Operational capability commitment with a realistic timeline.
- Close by tying the offeror's workforce strengths (from the COMPANY PROFILE) to the customer mission.`,
  technical_approach: `Write the TECHNICAL APPROACH.
- Mirror the SOW section numbering (3.1, 3.2, ...). Every "shall" must have a response.
- Subsections: 1.1 Understanding of the Requirement, 1.2 Service/Solution Delivery Model, 1.3 Technology & Security Framework (cite only frameworks relevant to the SOW, e.g. NIST 800-171, CMMC, DISA STIGs, ServiceNow, SIEM, DevSecOps when applicable), 1.4 Support Coverage Areas, 1.5 SLOs, 1.6 Transition Plan.
- Include an SLO TABLE: | Priority | Response Time | Resolution Target | Escalation Path | with Critical/High/Medium/Low rows and an uptime target.
- Include a transition timeline TABLE with week-by-week milestones.`,
  management_approach: `Write the MANAGEMENT APPROACH.
- 2.1 Org Structure TABLE: | Role | Reports To | Key Responsibility |.
- 2.2 Governance TABLE: | Deliverable | Frequency | Contents | Recipient | (weekly/monthly/quarterly).
- 2.3 QA TABLE: | Metric | Target | Measurement Method | Reporting Frequency | with measurable audit and satisfaction targets and a continuous-improvement method.
- 2.4 Risk Register TABLE of 5 risks: | Risk | Likelihood | Impact | Mitigation | Responsible | — include CONTRACT-SPECIFIC risks derived from the SOW, not just boilerplate.`,
  past_performance: `Write PAST PERFORMANCE.
- 3.1 Relevant Contracts TABLE: | Contract Name | Agency | Value | Period | Scope | CPARS |. Use ONLY entries provided in the PAST PERFORMANCE LIBRARY block (selected by the capture team) plus the company profile past_performance array if no library is supplied. Do not fabricate contracts, values, periods, POCs, or CPARS ratings.
- 3.2 For each entry, write a 1-2 paragraph narrative anchored on the entry's description, drawing out scope relevance to the current SOW. Reference the actual contract number, task order number, and POC when present.
- 3.3 Relevance Matrix: map each past performance entry to specific current SOW tasks/PWS sections.
- 3.4 References paragraph listing client POCs (name, title, phone, email) verbatim from the supplied entries.
- If a teaming partner brings additional past performance, cite it after the offeror's own.`,
  staffing_plan: `Write the STAFFING PLAN.
- 4.1 Team Composition TABLE: | Role | FTE | Clearance | Required Certs | Location |. If solutionDesign.staffing is present, use those rows verbatim.
- 4.2 Key Personnel: bios with required qualifications. If a candidate name is missing, use "[KEY PERSONNEL — TO BE NAMED]" with the required qualifications listed.
- 4.3 Recruiting pipeline — describe the offeror's recruiting channels in general terms; only name specific partners, programs, or universities if they appear in the COMPANY PROFILE.
- 4.4 Mobilization timeline TABLE (4 phases).`,
  compliance_matrix: `Write the COMPLIANCE CROSS-REFERENCE MATRIX as the proposal's final appendix.
- One markdown TABLE: | Req # | SOW Reference | Requirement (verbatim quote) | Proposal Section | Page # |.
- If complianceMatrix is provided, render those rows. Otherwise, derive a best-effort matrix from the SOW text or attachments.`,

  // ----- Sub-to-prime inputs (engagement_type = "sub") -----
  // These sections produce drop-in content for the PRIME's proposal volumes,
  // written in the prime's voice / third person and addressed to the
  // government evaluator. The one exception is sub_teaming_pitch, which is a
  // secondary 1-page artifact addressed to the prime's capture lead.
  sub_technical_input: `Write the TECHNICAL VOLUME — OUR INPUTS section.
- Prefix with: "> Insert into: Prime's Technical Volume"
- Written in the prime's voice and third person ("[Offeror], a teammate to [Prime], will…") so the prime can paste it in with minimal editing. Address the GOVERNMENT EVALUATOR, not the prime.
- Cover only the TARGETED SCOPE AREAS — the portion of work the offeror performs under the prime. Mirror SOW numbering where applicable.
- Include relevant tables (approach, SLOs, transition) only for the offeror's portion. Make clear how the offeror's work integrates into the prime's overall solution.
- Do NOT pitch the offeror; assume the offeror is already on the team.`,
  sub_management_input: `Write the MANAGEMENT VOLUME — OUR INPUTS section.
- Prefix with: "> Insert into: Prime's Management Volume"
- Written in the prime's voice, third person, evaluator-facing.
- Cover: governance interface between the offeror and the prime's PMO; the offeror's internal QA on its work-share; escalation paths INTO the prime's PMO; subcontract-management posture; risk management for the offeror's scope.
- Org-chart annotations: position the offeror as a subcontractor on the prime's team. Do not write a standalone management plan.`,
  sub_past_performance_input: `Write PAST PERFORMANCE — OUR ENTRIES for insertion into the prime's PP volume.
- Prefix with: "> Insert into: Prime's Past Performance Volume"
- One markdown TABLE: | Contract | Customer | Period | Value | Scope Relevance to This Effort | Role (prime/sub) | CPARS |. Use ONLY entries from the PAST PERFORMANCE LIBRARY or company profile past_performance.
- For each entry, add a 1-paragraph relevance write-up in the third person, mapping the entry to the offeror's targeted scope on the current effort. The prime should be able to drop these paragraphs directly into their PP narrative.
- Never fabricate contracts, values, periods, POCs, or CPARS ratings.`,
  sub_key_personnel_input: `Write KEY PERSONNEL — OUR BIOS for insertion into the prime's KP section.
- Prefix with: "> Insert into: Prime's Key Personnel Section"
- TABLE | Name | Role | Years | Clearance | Relevance to Scope |, followed by 1-paragraph bios in the third person, evaluator-facing.
- Use "[TO BE NAMED]" when unknown — never invent identities. Clearance/cert details strictly from the COMPANY PROFILE.`,
  sub_corporate_overview: `Write a CORPORATE OVERVIEW BLURB for the prime's "Team & Subcontractors" appendix or org-chart annotations.
- Prefix with: "> Insert into: Prime's Team Appendix"
- 1-2 short paragraphs, third person, evaluator-facing.
- Cover: legal name, certifications (UEI/CAGE only if in profile), core competencies narrowed to the targeted scope, geographic reach, and a one-line tie-in to why the offeror is on this team.`,
  sub_teaming_pitch: `Write a 1-page TEAMING PITCH addressed to the prime's capture / BD lead. This is a SECONDARY ARTIFACT — not for the prime's volume.
- Prefix with: "[SECONDARY ARTIFACT — Teaming Pitch, not for the prime's volume]"
- Audience: the prime's capture lead, not the government evaluator.
- 3 short paragraphs + a bullet list of 5 differentiators with proof points.
- Reference the prime by name. Close with a specific work-share ask (scope boundaries, contract vehicle posture, percentage if relevant).
- Keep to ~1 page.`,
};




Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const body = await req.json();
    const {
      sectionId,
      sectionTitle,
      opportunity,
      companyProfile,
      customerIntel,
      complianceMatrix,
      solutionDesign,
      attachmentsText,
      teaming,
      pastPerformance,
      teamId,
      userId: _ignoredUserId,
      proposalId,
      engagementType,
      primeContractorName,
      targetedScopeAreas,
      template,
    } = body;
    const engagement = engagementType === "sub" ? "sub" : "prime";

    const templateBlock = (template && typeof template === "object" && (template.filename || template.boilerplate))
      ? `\nPROPOSAL TEMPLATE (offeror-supplied — MATCH this structure, heading hierarchy, ordering, and tone):
Template file: ${template.filename || "(unnamed)"}
${Array.isArray(template.structure) && template.structure.length
  ? `Top-level outline from the template:\n${template.structure.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}\n`
  : ""}${template.boilerplate ? `Template body (truncated — mirror its voice, formatting conventions, and boilerplate phrasing):\n${String(template.boilerplate).slice(0, 25000)}\n` : ""}
RULE: Treat this template as authoritative for STRUCTURE (heading order, depth, naming) and TONE. Substitute opportunity-specific content into its sections; do not invent extra top-level sections that are not in the template outline.
`
      : "";

    if (!hasCompanyProfile(companyProfile)) return missingProfileResponse(corsHeaders);

    let verifiedTeamId: string | null;
    try {
      verifiedTeamId = await resolveTeamId(ctx, teamId ?? null);
      if (proposalId) await assertProposalAccess(ctx, proposalId);
    } catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const userId = ctx.user.id;

    const hasTemplate = !!templateBlock;
    const sectionInstr = hasTemplate
      ? `Write the section titled "${sectionTitle}". FOLLOW THE OFFEROR-SUPPLIED PROPOSAL TEMPLATE (see PROPOSAL TEMPLATE block) for structure, sub-heading hierarchy, ordering, and tone. Pull opportunity-specific details from the OPPORTUNITY, COMPLIANCE MATRIX, CUSTOMER INTELLIGENCE, and SOLICITATION ATTACHMENT TEXT to fill in the template. Preserve the template's heading wording when it applies to this section; mirror its formatting conventions (tables, bullets, numbering). Do not invent sub-sections that the template does not include.`
      : (SECTION_INSTRUCTIONS[sectionId] ||
        `Write the section titled "${sectionTitle}". Be specific to this customer; avoid boilerplate.`);

    const knowledgeContext = await fetchKnowledgeContext(sectionId, ctx.admin, verifiedTeamId);

    const identity = companyIdentity(companyProfile);
    const profileBlock = renderCompanyProfileBlock(companyProfile);

    const engagementBlock = engagement === "sub"
      ? `ENGAGEMENT MODE: SUBCONTRACTOR. The offeror is pursuing this opportunity as a SUB under the prime contractor named below — NOT as the prime. Write content appropriate for a capabilities statement / teaming submission directed at the prime, focused on the targeted scope area. Do NOT produce full Section L/M proposal volumes. Reference the prime by name, explain fit for the prime, and emphasize relevant past performance, key personnel, certifications/clearances, and differentiators for the targeted scope.
PRIME CONTRACTOR: ${primeContractorName || "(unspecified)"}
TARGETED SCOPE AREAS: ${targetedScopeAreas || "(unspecified)"}
`
      : `ENGAGEMENT MODE: PRIME. The offeror is pursuing this opportunity as the PRIME contractor. Address Section L instructions and Section M evaluation criteria in full.
`;

    const systemPrompt = `You are a senior federal capture manager writing ONE section of a proposal for ${identity}.
Output MARKDOWN only — no preamble, no closing remarks.
Every "shall" requirement in the SOW must be addressed if this section covers it. Use the unit's terminology, not generic federal-speak.
Use markdown tables for structured data. Quote SOW requirements verbatim when referencing them.
The COMPANY PROFILE below is the sole source of truth for who the offeror is — do not invent identity, certifications, locations, past performance, or recruiting pipelines that are not listed.

${engagementBlock}
COMPANY PROFILE:
${profileBlock}

${knowledgeContext ? `KNOWLEDGE BASE (authoritative offeror-provided content — prefer this over general knowledge when writing):\n${knowledgeContext}\n` : ""}
OPPORTUNITY:
Title: ${opportunity?.title || "N/A"}
Solicitation #: ${opportunity?.solicitationNumber || "N/A"}
Agency: ${opportunity?.fullParentPathName || opportunity?.agency || "N/A"}
NAICS: ${opportunity?.naicsCode || "N/A"}
Notice Type: ${opportunity?.type || "N/A"}
Response Deadline: ${opportunity?.responseDeadLine || "N/A"}
Set-Aside: ${opportunity?.setAside || opportunity?.typeOfSetAside || "N/A"}
Place of Performance: ${JSON.stringify(opportunity?.placeOfPerformance || {})}
Description: ${opportunity?.description || "(infer from title/agency)"}

${customerIntel ? `CUSTOMER INTELLIGENCE (verified by capture team):\n${JSON.stringify(customerIntel, null, 2)}\n` : ""}
${complianceMatrix ? `COMPLIANCE MATRIX rows mapped to this section:\n${JSON.stringify(complianceMatrix, null, 2)}\n` : ""}
${solutionDesign ? `SOLUTION DESIGN inputs:\n${JSON.stringify(solutionDesign, null, 2)}\n` : ""}
${teaming && teaming.length ? `TEAMING ARRANGEMENT (reference these partners by name in management approach, staffing plan, and past performance — cite their certifications, NAICS coverage, and past performance where relevant):\n${JSON.stringify(teaming, null, 2)}\n` : ""}
${pastPerformance && pastPerformance.length ? `PAST PERFORMANCE LIBRARY (selected by capture team — use these as the source of truth for the Past Performance section; do NOT invent contracts, values, periods, or POCs not listed here):\n${JSON.stringify(pastPerformance, null, 2)}\n` : ""}
${attachmentsText ? `SOLICITATION ATTACHMENT TEXT (truncated):\n${String(attachmentsText).slice(0, 30000)}\n` : ""}
${templateBlock}
CRITICAL: Before writing, briefly research the end-user unit from context (mission, facility, terminology) and weave at least 3 unit-specific details into the section. If you cannot identify the unit, say so explicitly with [TO BE VERIFIED].`;


    const userPrompt = `Write the proposal section: "${sectionTitle}" (id: ${sectionId}).

INSTRUCTIONS:
${sectionInstr}

Output the markdown for this section now. Do NOT include other sections.`;

    let res: Response;
    try {
      res = await callAI({
        functionName: "generate-proposal-section",
        teamId: verifiedTeamId,
        userId,
        proposalId: proposalId ?? null,
        timeoutMs: 90_000,
        stream: true,
        body: {
          model: pickModel("generate-proposal-section", sectionId),
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
