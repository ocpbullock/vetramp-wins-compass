import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse } from "../_shared/ai-client.ts";

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
    const { opportunity, companyProfile, extraNotes, attachmentsText, teamId } = await req.json();

    const system = `You are a senior federal capture manager doing pre-RFP customer intelligence. Use your knowledge of US federal agencies, DoD components, USA Spending, FPDS, SAM.gov, agency strategic plans, and recent press to build a deep profile of the buying customer. Be specific. Cite URLs when you can. If data is unknown, say so explicitly rather than fabricating.`;

    const trimmedAttachments = typeof attachmentsText === "string" && attachmentsText.length > 0
      ? attachmentsText.slice(0, 60000)
      : "";

    const user = `OPPORTUNITY:
${JSON.stringify(opportunity, null, 2)}

OUR COMPANY PROFILE (for win-theme alignment):
${JSON.stringify(companyProfile, null, 2)}

${extraNotes ? `ADDITIONAL CONTEXT FROM USER:\n${extraNotes}\n` : ""}${trimmedAttachments ? `\nREFERENCE DOCUMENTS PROVIDED BY USER (incumbent past performance, agency plans, prior SOWs, org charts, etc.):\n${trimmedAttachments}\n` : ""}
Research this customer and return structured intel. Focus on: who actually uses the result, what they're trying to accomplish, what their recent contracting pattern looks like, who the incumbent is (if any), and what evaluation criteria will likely matter most.`;

    let data: any;
    try {
      data = await callAI({
        functionName: "customer-intel",
        teamId: teamId ?? null,
        body: {
          model: "google/gemini-2.5-pro",
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
    return new Response(JSON.stringify({ intel }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("customer-intel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
