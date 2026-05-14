import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  searchOpportunities,
  mapOpportunityRow,
  opportunityRowToSamShape,
  checkDailyUsage,
  logUsage,
  TangoError,
} from "../_shared/tango-client.ts";

const CACHE_TTL_HOURS = 24;

function fmtDateForTango(iso: string) {
  // Tango expects ISO YYYY-MM-DD
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(sbUrl, sbKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(sbUrl, sbService);

    const body = await req.json();
    const { naicsCodes = [], postedFrom, postedTo, keyword, setAside, teamId } = body;

    // Resolve team_id (prefer caller-provided; else first membership)
    let team_id: string | null = teamId ?? null;
    if (!team_id) {
      const { data: tm } = await admin
        .from("team_members")
        .select("team_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      team_id = tm?.team_id ?? null;
    }
    if (!team_id) {
      return new Response(JSON.stringify({ error: "no_team", opportunities: [], log: [] }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const log: string[] = [];
    const errors: any[] = [];
    const fromIso = fmtDateForTango(postedFrom);
    const toIso = fmtDateForTango(postedTo);

    // Cache lookup: rows fetched within TTL matching NAICS + window
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    let cacheQuery = admin
      .from("tango_cached_opportunities")
      .select("*")
      .eq("team_id", team_id)
      .gte("fetched_at", cacheCutoff);
    if (naicsCodes.length) cacheQuery = cacheQuery.in("naics_code", naicsCodes);
    if (postedFrom) cacheQuery = cacheQuery.gte("posted_date", new Date(fromIso).toISOString());
    if (postedTo) cacheQuery = cacheQuery.lte("posted_date", new Date(toIso + "T23:59:59Z").toISOString());

    const { data: cachedRows } = await cacheQuery.limit(2000);
    if (cachedRows && cachedRows.length > 0) {
      await logUsage(admin, { team_id, endpoint: "/opportunities/", params: body, cached: true, response_status: 200 });
      const opportunities = cachedRows.map(opportunityRowToSamShape);
      // Optional keyword filter client-side
      const filtered = keyword
        ? opportunities.filter((o: any) =>
            (o.title || "").toLowerCase().includes(String(keyword).toLowerCase()) ||
            (o.description || "").toLowerCase().includes(String(keyword).toLowerCase()),
          )
        : opportunities;
      log.push(`Served ${filtered.length} from cache`);
      return new Response(
        JSON.stringify({ opportunities: filtered, errors, log, _cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Daily quota check
    const usage = await checkDailyUsage(admin, team_id);
    if (!usage.allowed) {
      // Fall back to any cached results regardless of TTL
      const { data: stale } = await admin
        .from("tango_cached_opportunities")
        .select("*")
        .eq("team_id", team_id)
        .in("naics_code", naicsCodes.length ? naicsCodes : ["__none__"])
        .limit(1000);
      const opportunities = (stale ?? []).map(opportunityRowToSamShape);
      return new Response(
        JSON.stringify({
          opportunities,
          errors,
          log: [`Daily Tango API limit approaching (${usage.used}/100). Showing cached results only.`],
          message: "Daily API limit approaching. Showing cached results only.",
          rateLimited: true,
          _cached: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Hit Tango. Try comma-separated NAICS first; fall back to per-code loop on error.
    const all: any[] = [];
    let calls = 0;
    try {
      const params: Record<string, unknown> = {
        page_size: 100,
        posted_date_from: fromIso,
        posted_date_to: toIso,
      };
      if (naicsCodes.length) params.naics = naicsCodes;
      if (keyword) params.keyword = keyword;
      if (setAside) params.set_aside = setAside;
      const resp = await searchOpportunities(params as any);
      calls++;
      await logUsage(admin, { team_id, endpoint: "/opportunities/", params, cached: false, response_status: 200 });
      all.push(...(resp.results ?? []));
    } catch (e) {
      const te = e as TangoError;
      log.push(`combined NAICS query failed (${te.status}): ${te.message}`);
      // Fallback: per-NAICS loop with 500ms delay
      for (let i = 0; i < naicsCodes.length; i++) {
        // Re-check quota each loop
        const u2 = await checkDailyUsage(admin, team_id);
        if (!u2.allowed) {
          log.push("Daily limit hit during per-NAICS loop; stopping.");
          break;
        }
        const code = naicsCodes[i];
        try {
          const params: Record<string, unknown> = {
            page_size: 100,
            naics: code,
            posted_date_from: fromIso,
            posted_date_to: toIso,
          };
          if (keyword) params.keyword = keyword;
          if (setAside) params.set_aside = setAside;
          const resp = await searchOpportunities(params as any);
          calls++;
          await logUsage(admin, { team_id, endpoint: "/opportunities/", params, cached: false, response_status: 200 });
          all.push(...(resp.results ?? []));
          log.push(`NAICS ${code}: ${resp.results?.length ?? 0} results`);
        } catch (err) {
          const ee = err as TangoError;
          errors.push({ naicsCode: code, status: ee.status, error: ee.message });
          await logUsage(admin, { team_id, endpoint: "/opportunities/", params: { naics: code }, cached: false, response_status: ee.status });
        }
        if (i < naicsCodes.length - 1) await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Dedupe
    const seen = new Set<string>();
    const deduped = all.filter((o: any) => {
      const key = String(
        o?.id ?? o?.tango_id ?? o?.noticeId ?? o?.notice_id ?? o?.solicitationNumber ?? o?.solicitation_number ?? JSON.stringify(o).slice(0, 80),
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Upsert cache
    if (deduped.length > 0) {
      const rows = deduped.map((o: any) => mapOpportunityRow(team_id!, o));
      const { error: upErr } = await admin
        .from("tango_cached_opportunities")
        .upsert(rows, { onConflict: "team_id,tango_id" });
      if (upErr) console.error("tango opps upsert error", upErr);
    }

    const opportunities = deduped.map((o: any) => opportunityRowToSamShape(mapOpportunityRow(team_id!, o)));
    log.push(`Tango calls: ${calls}, results: ${opportunities.length}`);

    return new Response(
      JSON.stringify({ opportunities, errors, log, _cached: false, calls }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("search-sam (tango) error:", e);
    return new Response(JSON.stringify({ error: e.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
