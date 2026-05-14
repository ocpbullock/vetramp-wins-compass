import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { callAI, aiErrorResponse, pickModel } from "../_shared/ai-client.ts";

const SECTION_KB_CATEGORIES: Record<string, string[]> = {
  past_performance: ["past_performance"],
  staffing_plan: ["personnel"],
  cover_letter: ["capability", "win_theme"],
  executive_summary: ["capability", "win_theme"],
  technical_approach: ["capability", "boilerplate"],
  compliance_matrix: ["boilerplate"],
};

async function fetchKnowledgeContext(sectionId: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return "";
    const admin = createClient(supabaseUrl, serviceKey);

    const categories = SECTION_KB_CATEGORIES[sectionId] ?? ["boilerplate"];
    const parts: string[] = [];
    for (const cat of categories) {
      const { data, error } = await admin
        .from("knowledge_base")
        .select("title,content,category")
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
- 3.1 Relevant Contracts TABLE: | Contract Name | Agency | Value | Period | Scope | CPARS |. Use ONLY entries provided in the PAST PERFORMANCE LIBRARY block (selected by the capture team) plus the company profile past_performance array if no library is supplied. Do not fabricate contracts, values, periods, POCs, or CPARS ratings.
- 3.2 For each entry, write a 1-2 paragraph narrative anchored on the entry's description, drawing out scope relevance to the current SOW. Reference the actual contract number, task order number, and POC when present.
- 3.3 Relevance Matrix: map each past performance entry to specific current SOW tasks/PWS sections.
- 3.4 References paragraph listing client POCs (name, title, phone, email) verbatim from the supplied entries.
- If a teaming partner brings additional past performance, cite it after VetRamp's own.`,
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
      userId,
      proposalId,
    } = body;

    const sectionInstr = SECTION_INSTRUCTIONS[sectionId] ||
      `Write the section titled "${sectionTitle}". Be specific to this customer; avoid boilerplate.`;

    const knowledgeContext = await fetchKnowledgeContext(sectionId);

    const systemPrompt = `You are a senior federal capture manager writing for LGE Consulting, LLC dba VetRamp (SBA-certified SDVOSB).
You are writing ONE section of a proposal at a time. Output MARKDOWN only — no preamble, no closing remarks.
Every "shall" requirement in the SOW must be addressed if this section covers it. Use the unit's terminology, not generic federal-speak.
Use markdown tables for structured data. Quote SOW requirements verbatim when referencing them.

COMPANY PROFILE:
${JSON.stringify(companyProfile, null, 2)}

${knowledgeContext ? `KNOWLEDGE BASE (authoritative VetRamp content — prefer this over general knowledge when writing):\n${knowledgeContext}\n` : ""}
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

CRITICAL: Before writing, briefly research the end-user unit from context (mission, facility, terminology) and weave at least 3 unit-specific details into the section. If you cannot identify the unit, say so explicitly with [TO BE VERIFIED].`;

    const userPrompt = `Write the proposal section: "${sectionTitle}" (id: ${sectionId}).

INSTRUCTIONS:
${sectionInstr}

Output the markdown for this section now. Do NOT include other sections.`;

    let res: Response;
    try {
      res = await callAI({
        functionName: "generate-proposal-section",
        teamId: teamId ?? null,
        userId: userId ?? null,
        proposalId: proposalId ?? null,
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
