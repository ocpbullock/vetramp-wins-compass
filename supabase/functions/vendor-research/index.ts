// User-triggered AI research on a single vendor. Modeled on capture-analysis:
// same auth + AI-client + untrusted-content wrapping. NEVER auto-run; the UI
// gates behind an explicit button click.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse, pickModel } from "../_shared/ai-client.ts";
import { authenticate, authErrorResponse } from "../_shared/auth.ts";
import { wrapUntrusted, UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION } from "../_shared/untrusted.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "2–4 sentence company overview based ONLY on defensible facts and known contract signal. State uncertainty explicitly." },
    focus_areas: { type: "array", items: { type: "string" }, description: "Short capability/market focus phrases." },
    notable_wins: {
      type: "array",
      items: {
        type: "object",
        properties: {
          what: { type: "string" },
          customer: { type: "string" },
          year: { type: "string" },
          source_url: { type: ["string", "null"] },
        },
        required: ["what", "customer", "year", "source_url"],
      },
      description: "Only wins you can plausibly support from the provided contracts or well-known public reporting. NEVER fabricate.",
    },
    size_posture: { type: "string", description: "Small/mid/large tier + set-aside posture if inferable; otherwise 'unknown'." },
    teaming_angle: { type: "string", description: "How a teaming partner might pitch this vendor as prime/sub." },
    confidence_notes: { type: "string", description: "Explicit statement of what's low-confidence and what a user should independently verify." },
  },
  required: ["overview", "focus_areas", "notable_wins", "size_posture", "teaming_angle", "confidence_notes"],
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const body = await req.json().catch(() => ({}));
    const name: string | undefined = body?.name?.toString().trim();
    const uei: string | undefined = body?.uei?.toString().trim();
    const knownContracts = Array.isArray(body?.knownContracts) ? body.knownContracts.slice(0, 5) : [];

    if (!name && !uei) {
      return new Response(JSON.stringify({ error: "name or uei required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION + "\n\n" +
      `You are a senior federal market analyst preparing a research brief on a single vendor for a competitive teaming decision. Only assert what you can plausibly support from the provided contract signal or widely-known public reporting; cite source URLs where possible. Explicitly flag uncertainty in confidence_notes. NEVER fabricate contract wins, customers, or dollar figures. If you have no defensible signal for a field, say so honestly. Prefer "unknown" to a plausible-sounding guess.`;

    const user = `VENDOR:
${wrapUntrusted("vendor-identity", JSON.stringify({ name: name ?? null, uei: uei ?? null }, null, 2))}

KNOWN FEDERAL CONTRACT SIGNAL (top ${knownContracts.length}, from USAspending — treat as authoritative on award existence but not on interpretation):
${wrapUntrusted("known-contracts", JSON.stringify(knownContracts, null, 2))}

Produce the research brief.`;

    let data: any;
    try {
      data = await callAI({
        functionName: "vendor-research",
        teamId: null,
        userId: ctx.user.id,
        timeoutMs: 45_000,
        body: {
          model: pickModel("vendor-research"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          tools: [{ type: "function", function: { name: "return_vendor_research", description: "Return a structured vendor research brief.", parameters: SCHEMA } }],
          tool_choice: { type: "function", function: { name: "return_vendor_research" } },
        },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const research = args ? JSON.parse(args) : null;
    if (!research) throw new Error("No research returned");
    research._fetched_at = new Date().toISOString();

    return new Response(JSON.stringify({ research }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vendor-research error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
