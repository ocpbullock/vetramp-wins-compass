import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  searchContracts,
  mapContractRow,
  contractRowToUsaspendingShape,
  checkDailyUsage,
  logUsage,
  resolveAwardingAgency,
  TangoError,
} from "../_shared/tango-client.ts";
import { agencyMatchesLoose } from "../_shared/agency-match.ts";
import { authenticate, resolveTeamId, authErrorResponse, jsonError } from "../_shared/auth.ts";

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
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); } catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const admin = ctx.admin;

    const body = await req.json();
    const { naicsCodes = [], startDate, endDate, keyword, agency, vendorName, maxResults = MAX_RESULTS, teamId, forceRefresh = false } = body;

    let team_id: string | null;
    try { team_id = await resolveTeamId(ctx, teamId ?? null); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    if (!team_id) return jsonError(400, "no_team", corsHeaders);

    const fromIso = fmt(startDate);
    const toIso = fmt(endDate);

    const AGENCY_MIN_CACHE_ROWS = 10;

    // Cache check (skipped when forceRefresh)
    if (!forceRefresh) {
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
      let usable = cachedRows ?? [];

      // Agency-aware in-memory filter to catch rows whose sub-agency lives in raw_data
      // (older cached rows may not have sub-agency in the top-level `agency` column).
      if (agency && usable.length) {
        const needle = agency.toLowerCase();
        usable = usable.filter((row: any) => {
          const top = String(row.agency ?? "").toLowerCase();
          const raw = row.raw_data ?? {};
          const candidates = [
            top,
            String(raw?.["Awarding Sub Agency"] ?? "").toLowerCase(),
            String(raw?.awarding_sub_agency ?? "").toLowerCase(),
            String(raw?.awarding_sub_tier_agency_name ?? "").toLowerCase(),
            String(raw?.awarding_office?.agency_name ?? "").toLowerCase(),
            String(raw?.awarding_office?.department_name ?? "").toLowerCase(),
          ];
          return candidates.some((c) => c && c.includes(needle));
        });
      }

      // Only serve the cache when it has meaningful coverage for the query.
      const enoughCoverage = agency ? usable.length >= AGENCY_MIN_CACHE_ROWS : usable.length > 0;
      if (enoughCoverage) {
        await logUsage(admin, { team_id, endpoint: "/contracts/", params: body, cached: true, response_status: 200 });
        const results = usable.map(contractRowToUsaspendingShape);
        return new Response(JSON.stringify({
          results,
          page_metadata: { total: results.length, fetched: results.length, hasNext: false, truncated: false },
          _cached: true,
          _debug: { agencyParam: agency ?? null, fetched: results.length, source: "cache" },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
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

    // ---- Resolve the agency string to a value Tango's awarding_agency
    // filter reliably matches (canonical sub-tier name, code, or acronym).
    let agencyResolved: string | null = null;
    let agencyResolverSource: string | null = null;
    if (agency) {
      try {
        const r = await resolveAwardingAgency(agency);
        agencyResolved = r.resolved || null;
        agencyResolverSource = r.canonical ? `resolver:${r.canonical.code ?? r.canonical.key}` : "raw";
      } catch (e) {
        console.warn("agency resolver failed", e);
        agencyResolved = agency;
        agencyResolverSource = "raw";
      }
    }

    // Hit Tango with pagination (scoped by agencyResolved when present).
    const runFetch = async (opts: { withAgency: boolean; maxPages: number; startingPage?: number }) => {
      const collected: any[] = [];
      let page = opts.startingPage ?? 1;
      let cursor: string | null = null;
      let calls = 0;
      let hasNext = true;
      while (hasNext && collected.length < maxResults && page <= (opts.startingPage ?? 1) + opts.maxPages - 1) {
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
        if (opts.withAgency && agencyResolved) params.awarding_agency = agencyResolved;
        if (vendorName) params.recipient = vendorName;
        try {
          const resp = await searchContracts(params as any);
          calls++;
          await logUsage(admin, { team_id, endpoint: "/contracts/", params, cached: false, response_status: 200 });
          const batch = resp.results ?? [];
          collected.push(...batch);
          cursor = resp.next ? new URL(resp.next).searchParams.get("cursor") : null;
          hasNext = !!resp.next && batch.length === PAGE_SIZE;
          page++;
        } catch (e) {
          const te = e as TangoError;
          await logUsage(admin, { team_id, endpoint: "/contracts/", params, cached: false, response_status: te.status });
          console.error("tango contracts error", te);
          break;
        }
        if (hasNext) await new Promise((r) => setTimeout(r, 500));
      }
      return { collected, calls };
    };

    // Primary pass: agency-scoped when we have one.
    const primary = await runFetch({ withAgency: !!agencyResolved, maxPages: 5 });
    let all = primary.collected;
    let calls = primary.calls;
    let fallbackUsed = false;
    let fallbackSampled = 0;

    // Fallback: agency-scoped returned zero → sample NAICS-wide and loose-match.
    if (agency && all.length === 0) {
      fallbackUsed = true;
      const fb = await runFetch({ withAgency: false, maxPages: 3 });
      calls += fb.calls;
      fallbackSampled = fb.collected.length;
      const matcher = (row: any) => {
        const combined = [
          row?.awarding_agency, row?.["Awarding Agency"],
          row?.awarding_sub_agency, row?.["Awarding Sub Agency"],
          row?.awarding_sub_tier_agency_name,
          row?.awarding_office?.agency_name,
          row?.awarding_office?.department_name,
        ].filter(Boolean).join(" | ");
        return agencyMatchesLoose(combined, agency);
      };
      all = fb.collected.filter(matcher);
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
      _debug: {
        agencyParam: agency ?? null,
        agencyParamUsed: agencyResolved,
        agencyResolverSource,
        scopedCount: primary.collected.length,
        fallbackUsed,
        fallbackSampled,
        fallbackMatched: fallbackUsed ? results.length : 0,
        fetched: results.length,
        source: fallbackUsed ? "live+fallback" : "live",
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("search-usaspending (tango) error:", e);
    return new Response(JSON.stringify({ error: e.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
