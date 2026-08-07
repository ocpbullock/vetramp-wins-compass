import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse, pickModel } from "../_shared/ai-client.ts";
import { authenticate, resolveTeamId, assertProposalAccess, authErrorResponse } from "../_shared/auth.ts";
import { wrapUntrusted, UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION } from "../_shared/untrusted.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const INTEL_TYPES = [
  "incumbent_interview",
  "partner_conversation",
  "customer_meeting",
  "candidate_interview",
  "candidate_profile",
  "conference_note",
  "capture_note",
  "other",
] as const;


const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          intel_type: { type: "string", enum: [...INTEL_TYPES] },
          title: { type: "string" },
          source_name: { type: ["string", "null"] },
          occurred_on: { type: ["string", "null"], description: "ISO date (YYYY-MM-DD) if the transcript mentions one, else null." },
          body: { type: "string", description: "Structured summary: key facts, pain points, staffing/scope/incumbent signals, short attributed quotes where valuable." },
          confidence_notes: { type: ["string", "null"] },
        },
        required: ["intel_type", "title", "source_name", "occurred_on", "body", "confidence_notes"],
      },
    },
  },
  required: ["items"],
};

const MAX_TRANSCRIPT = 100_000;

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { proposalId, transcriptText, context } = await req.json();
    if (!proposalId || typeof transcriptText !== "string" || !transcriptText.trim()) {
      return new Response(JSON.stringify({ error: "proposalId and transcriptText required" }), {
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

    const { data: proposal } = await ctx.userClient
      .from("proposals")
      .select("opportunity_title, agency, solicitation_number, naics_code")
      .eq("id", proposalId)
      .maybeSingle();

    const truncated = transcriptText.length > MAX_TRANSCRIPT;
    const transcript = truncated ? transcriptText.slice(0, MAX_TRANSCRIPT) : transcriptText;

    const system = UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION + "\n\n" +
      `You are a senior federal capture analyst. Extract capture-relevant intelligence from raw transcripts (interviews, partner/customer calls, conference notes). Rules:
- Return 1 to 3 draft intel items, grouped by topic (do not force multiple items when the transcript covers one topic).
- Extract only what the transcript supports; do NOT fabricate names, dates, companies, or facts.
- Choose intel_type based on who is speaking and the context hint provided. Allowed values: incumbent_interview (Incumbent interview), partner_conversation (Partner conversation), customer_meeting (Customer meeting), candidate_interview (Candidate interview), candidate_profile (Candidate profile — staffing / key-personnel candidate write-ups), conference_note (Conference / event note), capture_note (Capture note), other (Other).
- title: short and specific (what this note is actually about).
- source_name: person or org if clearly identifiable in the transcript, else null.
- occurred_on: ISO date (YYYY-MM-DD) only if the transcript states one, else null.
- body: structured summary with key facts, pain points, staffing/scope/incumbent signals; include short attributed direct quotes ("...") where they add real value.
- confidence_notes: flag anything uncertain, ambiguous, or needing verification, else null.
The user will review and edit before saving — err toward completeness of signal but never invent detail.`;

    const oppBlock = proposal
      ? wrapUntrusted("opportunity", JSON.stringify(proposal, null, 2))
      : "";

    const contextLine = typeof context === "string" && context.trim()
      ? `USER CONTEXT HINT: ${context.trim().slice(0, 500)}\n\n`
      : "";

    const user = `${contextLine}${oppBlock ? `OPPORTUNITY:\n${oppBlock}\n\n` : ""}TRANSCRIPT${truncated ? " (truncated to first 100k chars)" : ""}:
${wrapUntrusted("transcript", transcript)}

Extract the draft intel items.`;

    let data: any;
    try {
      data = await callAI({
        functionName: "extract-intel",
        teamId: verifiedTeamId,
        userId,
        proposalId,
        timeoutMs: 60_000,
        body: {
          model: pickModel("extract-intel"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          tools: [{ type: "function", function: { name: "return_intel_drafts", description: "Return draft intel items.", parameters: SCHEMA } }],
          tool_choice: { type: "function", function: { name: "return_intel_drafts" } },
        },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? JSON.parse(args) : null;
    if (!parsed?.items) throw new Error("No intel drafts returned");

    const items = (parsed.items as any[]).slice(0, 3).map((it) => ({
      intel_type: INTEL_TYPES.includes(it.intel_type) ? it.intel_type : "capture_note",
      title: String(it.title ?? "").slice(0, 200),
      source_name: it.source_name ? String(it.source_name).slice(0, 200) : null,
      occurred_on: it.occurred_on && /^\d{4}-\d{2}-\d{2}$/.test(String(it.occurred_on)) ? it.occurred_on : null,
      body: String(it.body ?? ""),
      confidence_notes: it.confidence_notes ? String(it.confidence_notes) : null,
    }));

    return new Response(JSON.stringify({ items, truncated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-intel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
