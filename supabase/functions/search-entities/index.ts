import { corsHeaders } from "../_shared/cors.ts";
import {
  searchEntities,
  mapEntityRow,
  checkDailyUsage,
  logUsage,
  TangoError,
} from "../_shared/tango-client.ts";
import { authenticate, resolveTeamId, authErrorResponse, jsonError } from "../_shared/auth.ts";

const CACHE_TTL_HOURS = 24 * 30; // 30 days

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); } catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const admin = ctx.admin;

    const body = await req.json();
    const { vendor_name, uei, naics_code, small_business_type, teamId } = body;

    let team_id: string | null;
    try { team_id = await resolveTeamId(ctx, teamId ?? null); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    if (!team_id) return jsonError(400, "no_team", corsHeaders);


    // Cache check
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    let q = admin
      .from("tango_cached_entities")
      .select("*")
      .eq("team_id", team_id)
      .gte("fetched_at", cutoff);
    if (uei) q = q.eq("uei", uei);
    if (vendor_name) q = q.ilike("legal_name", `%${vendor_name}%`);
    if (naics_code) q = q.contains("naics_codes", [naics_code]);
    if (small_business_type) q = q.contains("small_business_types", [small_business_type]);

    const { data: cachedRows } = await q.limit(100);
    if (cachedRows && cachedRows.length > 0) {
      await logUsage(admin, { team_id, endpoint: "/entities/", params: body, cached: true, response_status: 200 });
      return new Response(JSON.stringify({ results: cachedRows, _cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const usage = await checkDailyUsage(admin, team_id);
    if (!usage.allowed) {
      return new Response(JSON.stringify({
        results: [],
        message: "Daily API limit approaching. Showing cached results only.",
        _cached: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      const params: Record<string, unknown> = { page_size: 50 };
      if (vendor_name) params.vendor_name = vendor_name;
      if (uei) params.uei = uei;
      if (naics_code) params.naics_code = naics_code;
      if (small_business_type) params.small_business_type = small_business_type;
      const resp = await searchEntities(params as any);
      await logUsage(admin, { team_id, endpoint: "/entities/", params, cached: false, response_status: 200 });

      const rows = (resp.results ?? []).map((e) => mapEntityRow(team_id!, e));
      if (rows.length) {
        const { error: upErr } = await admin
          .from("tango_cached_entities")
          .upsert(rows, { onConflict: "team_id,tango_id" });
        if (upErr) console.error("tango entities upsert error", upErr);
      }
      return new Response(JSON.stringify({ results: rows, _cached: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const te = e as TangoError;
      await logUsage(admin, { team_id, endpoint: "/entities/", params: body, cached: false, response_status: te.status });
      return new Response(JSON.stringify({ error: te.message, status: te.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e: any) {
    console.error("search-entities error", e);
    return new Response(JSON.stringify({ error: e.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
