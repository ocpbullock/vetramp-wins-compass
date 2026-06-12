import { buildCorsHeaders } from "../_shared/cors.ts";
import { authenticate, authErrorResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    try { await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { generatedInternalId } = await req.json();
    const res = await fetch(
      `https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(generatedInternalId)}/`,
    );
    const json = await res.json();
    return new Response(JSON.stringify(json), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
