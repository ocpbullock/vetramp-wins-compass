import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  searchContracts,
  mapContractRow,
  contractRowToUsaspendingShape,
  checkDailyUsage,
  logUsage,
  TangoError,
} from "../_shared/tango-client.ts";

const CACHE_TTL_HOURS = 24 * 7; // contracts change less frequently
const MAX_RESULTS = 500;
const PAGE_SIZE = 100;

function fmt(iso: string) {
  if (!iso) return iso;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(sbUrl, sbKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(sbUrl, sbService);

    const body = await req.json();
    const { naicsCodes = [], startDate, endDate, keyword, agency, vendorName, maxResults = MAX_RESULTS, teamId } = body;

    let team_id: string | null = teamId ?? null;
    if (!team_id) {
      const { data: tm } = await admin
        .from("team_members").select("team_id").eq("user_id", user.id).limit(1).maybeSingle();
      team_id = tm?.team_id ?? null;
    }
    if (!team_id) {
      return new Response(JSON.stringify({ error: "no_team", results: [] }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromIso = fmt(startDate);
    const toIso = fmt(endDate);

    // Cache check
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    let q = admin
      .from("tango_cached_contracts")
      .select("*")
      .eq("team_id", team_id)
      .gte("fetched_at", cutoff);
    if (naicsCodes.length) q = q.in("naics_code", naicsCodes);
    if (startDate) q = q.gte("award_date", new Date(fromIso).toISOString());
    if (endDate) q = q.lte("award_date", new Date(toIso + "T23:59:59Z").toISOString());
    if (agency) q = q.ilike("agency", `%${agency}%`);
    if (vendorName) q = q.ilike("vendor_name", `%${vendorName}%`);

    const { data: cachedRows } = await q.limit(maxResults);
    if (cachedRows && cachedRows.length > 0) {
      await logUsage(admin, { team_id, endpoint: "/contracts/", params: body, cached: true, response_status: 200 });
      const results = cachedRows.map(contractRowToUsaspendingShape);
      return new Response(JSON.stringify({
        results,
        page_metadata: { total: results.length, fetched: results.length, hasNext: false, truncated: false },
        _cached: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Daily quota
    const usage = await checkDailyUsage(admin, team_id);
    if (!usage.allowed) {
      const { data: stale } = await admin
        .from("tango_cached_contracts")
        .select("*")
        .eq("team_id", team_id)
        .in("naics_code", naicsCodes.length ? naicsCodes : ["__none__"])
        .limit(maxResults);
      const results = (stale ?? []).map(contractRowToUsaspendingShape);
      return new Response(JSON.stringify({
        results,
        page_metadata: { total: results.length, fetched: results.length, hasNext: false, truncated: false },
        partial: true,
        partial_reason: "Daily API limit approaching. Showing cached results only.",
        message: "Daily API limit approaching. Showing cached results only.",
        _cached: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Hit Tango with pagination
    const all: any[] = [];
    let page = 1;
    let cursor: string | null = null;
    let calls = 0;
    let hasNext = true;
    while (hasNext && all.length < maxResults) {
      const u = await checkDailyUsage(admin, team_id);
      if (!u.allowed) break;
      const params: Record<string, unknown> = {
        page,
        page_size: PAGE_SIZE,
        award_date_gte: fromIso,
        award_date_lte: toIso,
      };
      if (cursor) params.cursor = cursor;
      if (naicsCodes.length) params.naics = naicsCodes;
      if (keyword) params.search = keyword;
      if (agency) params.awarding_agency = agency;
      if (vendorName) params.recipient = vendorName;
      try {
        const resp = await searchContracts(params as any);
        calls++;
        await logUsage(admin, { team_id, endpoint: "/contracts/", params, cached: false, response_status: 200 });
        const batch = resp.results ?? [];
        all.push(...batch);
        cursor = resp.next ? new URL(resp.next).searchParams.get("cursor") : null;
        hasNext = !!resp.next && batch.length === PAGE_SIZE;
        page++;
      } catch (e) {
        const te = e as TangoError;
        await logUsage(admin, { team_id, endpoint: "/contracts/", params, cached: false, response_status: te.status });
        console.error("tango contracts error", te);
        break;
      }
      // Pace 500ms between calls
      if (hasNext) await new Promise((r) => setTimeout(r, 500));
    }

    // Dedupe
    const seen = new Set<string>();
    const deduped = all.filter((c) => {
      const k = String(c?.id ?? c?.tango_id ?? c?.generated_internal_id ?? c?.["Award ID"] ?? JSON.stringify(c).slice(0, 80));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, maxResults);

    if (deduped.length) {
      const rows = deduped.map((c) => mapContractRow(team_id!, c));
      const { error: upErr } = await admin
        .from("tango_cached_contracts")
        .upsert(rows, { onConflict: "team_id,tango_id" });
      if (upErr) console.error("tango contracts upsert error", upErr);
    }

    const results = deduped.map((c) => contractRowToUsaspendingShape(mapContractRow(team_id!, c)));

    return new Response(JSON.stringify({
      results,
      page_metadata: { total: results.length, fetched: results.length, hasNext: false, truncated: results.length >= maxResults },
      _cached: false,
      calls,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("search-usaspending (tango) error:", e);
    return new Response(JSON.stringify({ error: e.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
