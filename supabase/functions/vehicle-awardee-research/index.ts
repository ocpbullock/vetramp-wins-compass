// User-triggered AI research to draft an awardee list for a federal contract vehicle.
// Never auto-runs; results are ALWAYS surfaced as a review list — nothing is written
// to vehicle_awardees without explicit user selection in the UI.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse, pickModel } from "../_shared/ai-client.ts";
import { authenticate, authErrorResponse } from "../_shared/auth.ts";
import { wrapUntrusted, UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION } from "../_shared/untrusted.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "1–3 sentence summary of the vehicle awardee landscape. Note uncertainty AND state explicitly whether you had live web search available on this call (you do NOT — the Lovable AI gateway used here does not expose a web_search / google_search tool, so results are drawn from model knowledge only)." },
    source_urls: {
      type: "array",
      items: { type: "string" },
      description: "Official or well-known sources you can cite (agency page, GSA eLibrary, press releases). May be empty.",
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          uei: { type: ["string", "null"] },
          small_business: { type: ["boolean", "null"] },
          socioeconomic: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: ["string", "null"] },
          announcement_url: { type: ["string", "null"], description: "Direct URL to a public award announcement (press release, agency page, news article) supporting this candidate. Only include when you specifically know a real URL; otherwise null. Never fabricate URLs." },
        },
        required: ["company_name", "uei", "small_business", "socioeconomic", "confidence", "note", "announcement_url"],
      },
      description: "List ONLY companies you have specific basis to believe hold this vehicle. Never pad. Grade confidence honestly.",
    },
  },
  required: ["summary", "source_urls", "candidates"],
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const body = await req.json().catch(() => ({}));
    const vehicleName: string | undefined = body?.vehicleName?.toString().trim();
    const managingAgency: string | undefined = body?.managingAgency?.toString().trim();
    const vehicleType: string | undefined = body?.vehicleType?.toString().trim();

    if (!vehicleName) {
      return new Response(JSON.stringify({ error: "vehicleName required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION + "\n\n" +
      `You are a senior federal contracts analyst helping to draft an awardee list for a specific contract vehicle.

IMPORTANT — Tooling: You do NOT have live web search / browsing on this call. The Lovable AI gateway used here does not expose a web_search or google_search tool for this model. Work strictly from your training knowledge of public award announcements, agency vehicle pages, GSA eLibrary listings, and press releases. Say this explicitly in your summary so the human reviewer knows to verify.

Rules:
- List ONLY companies you have specific basis to believe hold this vehicle (typically because you recall a public award announcement such as "<company> awarded seat on <vehicleName>", agency contractor listings, or GSA eLibrary entries). If you are unsure, do NOT include them.
- Never pad or invent. It is better to return 3 confident candidates than 30 speculative ones.
- Grade confidence honestly per candidate.
- Include UEI only if you specifically know it. Otherwise return null. Same for small_business flag.
- announcement_url: include the URL of the specific award announcement / press release / agency page that supports the candidate ONLY when you specifically know a real URL. Never fabricate URLs — return null when unsure.
- Cite official sources in source_urls where possible (agency vehicle page, GSA eLibrary, press releases).
- The USER MUST verify every candidate against official sources before saving. Say this in your summary.`;

    const user = `CONTRACT VEHICLE:
${wrapUntrusted("vehicle", JSON.stringify({
        vehicleName,
        managingAgency: managingAgency ?? null,
        vehicleType: vehicleType ?? null,
      }, null, 2))}

Produce the draft awardee list.`;

    let data: any;
    try {
      data = await callAI({
        functionName: "vehicle-awardee-research",
        teamId: null,
        userId: ctx.user.id,
        timeoutMs: 60_000,
        body: {
          model: pickModel("vehicle-awardee-research"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          tools: [{ type: "function", function: { name: "return_vehicle_awardees", description: "Return a draft awardee list for the vehicle.", parameters: SCHEMA } }],
          tool_choice: { type: "function", function: { name: "return_vehicle_awardees" } },
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
    console.error("vehicle-awardee-research error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
