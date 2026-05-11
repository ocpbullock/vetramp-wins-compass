import { corsHeaders } from "../_shared/cors.ts";

// Generates ONE proposal section using the AI Gateway, streaming SSE back to client.
// Inputs: { sectionId, sectionTitle, opportunity, companyProfile, customerIntel?, complianceMatrix?, solutionDesign?, attachmentsText? }

const SECTION_INSTRUCTIONS: Record<string, string> = {
  cover_letter: `Write a one-page COVER LETTER addressed to the Contracting Officer at the named contracting office.
- Reference the END-USER unit by name (parse from the agency hierarchy).
- Acknowledge the operating environment in 2-3 specific sentences.
- Connect VetRamp's experience to the unit's mission. No generic boilerplate.`,
  executive_summary: `Write the EXECUTIVE SUMMARY.
- Open with the end-user unit's mission and how this contract supports it (use customer intel if present).
- Demonstrate Understanding of the Requirement: name the facility, reference standards/frameworks, mention customer base. Zero generic language.
- 3-4 paragraphs covering technical / management / staffing at high level.
- Include a 5-row markdown TABLE of discriminators: | Discriminator | How It Benefits the Customer |.
- 30-day Full Operational Capability commitment.
- Close tying VetRamp's veteran workforce to the military mission.`,
  technical_approach: `Write the TECHNICAL APPROACH.
- Mirror the SOW section numbering (3.1, 3.2, ...). Every "shall" must have a response.
- Subsections: 1.1 Understanding of the Requirement, 1.2 Service Delivery Model (3-tier), 1.3 Technology & Security Framework (NIST 800-171, CMMC, DISA STIGs, ServiceNow, SIEM, DevSecOps), 1.4 Support Coverage Areas, 1.5 SLOs, 1.6 Transition Plan.
- Include an SLO TABLE: | Priority | Response Time | Resolution Target | Escalation Path | with Critical/High/Medium/Low rows and 99.5% uptime.
- Include a transition timeline TABLE with week-by-week milestones.`,
  management_approach: `Write the MANAGEMENT APPROACH.
- 2.1 Org Structure TABLE: | Role | Reports To | Key Responsibility |.
- 2.2 Governance TABLE: | Deliverable | Frequency | Contents | Recipient | (weekly/monthly/quarterly).
- 2.3 QA TABLE: | Metric | Target | Measurement Method | Reporting Frequency | (15% ticket audits, 90%+ satisfaction, Lean/Kaizen).
- 2.4 Risk Register TABLE of 5 risks: | Risk | Likelihood | Impact | Mitigation | Responsible | — include CONTRACT-SPECIFIC risks derived from the SOW, not just boilerplate.`,
  past_performance: `Write PAST PERFORMANCE.
- 3.1 Relevant Contracts TABLE: | Contract Name | Agency | Value | Period | Scope | CPARS |. Use ONLY entries from the company profile past_performance array. Do not fabricate.
- 3.2 Relevance to This Requirement: matrix mapping past performance to current SOW tasks.
- 3.3 References paragraph + Federal experience summary (Army, Air Force, DHA, VA, DHS).
- BAMC remains the primary reference with specific achievements.`,
  staffing_plan: `Write the STAFFING PLAN.
- 4.1 Team Composition TABLE: | Role | FTE | Clearance | Required Certs | Location |. If solutionDesign.staffing is present, use those rows verbatim.
- 4.2 Key Personnel: bios with required qualifications. If a candidate name is missing, use "[KEY PERSONNEL — TO BE NAMED]" with the required qualifications listed.
- 4.3 Recruiting pipeline (VetHUB, military installations, UT Austin / Texas A&M).
- 4.4 Mobilization timeline TABLE (4 phases).`,
  compliance_matrix: `Write the COMPLIANCE CROSS-REFERENCE MATRIX as the proposal's final appendix.
- One markdown TABLE: | Req # | SOW Reference | Requirement (verbatim quote) | Proposal Section | Page # |.
- If complianceMatrix is provided, render those rows. Otherwise, derive a best-effort matrix from the SOW text or attachments.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

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
    } = body;

    const sectionInstr = SECTION_INSTRUCTIONS[sectionId] ||
      `Write the section titled "${sectionTitle}". Be specific to this customer; avoid boilerplate.`;

    const systemPrompt = `You are a senior federal capture manager writing for LGE Consulting, LLC dba VetRamp (SBA-certified SDVOSB).
You are writing ONE section of a proposal at a time. Output MARKDOWN only — no preamble, no closing remarks.
Every "shall" requirement in the SOW must be addressed if this section covers it. Use the unit's terminology, not generic federal-speak.
Use markdown tables for structured data. Quote SOW requirements verbatim when referencing them.

COMPANY PROFILE:
${JSON.stringify(companyProfile, null, 2)}

${customerIntel ? `CUSTOMER INTELLIGENCE (verified by capture team):\n${JSON.stringify(customerIntel, null, 2)}\n` : ""}
${complianceMatrix ? `COMPLIANCE MATRIX rows mapped to this section:\n${JSON.stringify(complianceMatrix, null, 2)}\n` : ""}
${solutionDesign ? `SOLUTION DESIGN inputs:\n${JSON.stringify(solutionDesign, null, 2)}\n` : ""}

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

${attachmentsText ? `SOLICITATION ATTACHMENT TEXT (truncated):\n${String(attachmentsText).slice(0, 30000)}\n` : ""}

CRITICAL: Before writing, briefly research the end-user unit from context (mission, facility, terminology) and weave at least 3 unit-specific details into the section. If you cannot identify the unit, say so explicitly with [TO BE VERIFIED].`;

    const userPrompt = `Write the proposal section: "${sectionTitle}" (id: ${sectionId}).

INSTRUCTIONS:
${sectionInstr}

Output the markdown for this section now. Do NOT include other sections.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!res.ok) {
      if (res.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (res.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Workspace settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await res.text();
      return new Response(JSON.stringify({ error: `AI gateway: ${t}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(res.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
