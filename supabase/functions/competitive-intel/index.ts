import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authenticate, assertTeamMember, authErrorResponse } from "../_shared/auth.ts";
import { normalizeUserContext, appliedFacts } from "../_shared/user-context.ts";

const USA = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const FIELDS = [
  "Award ID", "Recipient Name", "recipient_id", "Award Amount",
  "Awarding Agency", "Awarding Sub Agency", "Start Date", "End Date",
  "NAICS", "Description", "generated_internal_id", "Type of Set Aside",
  "Contract Award Type",
];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoYearsAgo(n: number) {
  const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10);
}
function normId(s?: string | null) { return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
const STOPWORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "services", "service", "support", "system", "systems", "contract", "program", "notice", "request", "information", "rfi", "sources", "sought"]);
function textTokens(s?: string | null) {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)));
}
function overlapCount(a: Set<string>, b: Set<string>) { let n = 0; for (const t of a) if (b.has(t)) n++; return n; }

const AGENCY_ALIASES: Record<string, string> = {
  "DEPT OF DEFENSE": "Department of Defense",
  "DEPT OF THE AIR FORCE": "Department of the Air Force",
  "AIR FORCE": "Department of the Air Force",
  "DEPT OF THE ARMY": "Department of the Army",
  "US ARMY": "Department of the Army",
  "DEPT OF THE NAVY": "Department of the Navy",
  "NAVY": "Department of the Navy",
  "DEFENSE INFORMATION SYSTEMS AGENCY": "Defense Information Systems Agency",
  "DEFENSE LOGISTICS AGENCY": "Defense Logistics Agency",
  "DEFENSE HEALTH AGENCY": "Defense Health Agency",
  "DEFENSE HUMAN RESOURCES ACTIVITY": "Defense Human Resources Activity",
  "HOUSE OF REPRESENTATIVES, THE": "House of Representatives",
  "HOUSE OF REPRESENTATIVES": "House of Representatives",
};

// Extract the most specific sub-agency name from SAM's fullParentPathName
// e.g. "DEPT OF DEFENSE.DEPT OF THE ARMY.US ARMY CORPS OF ENGINEERS"
function parseAgency(fullPath: string): { sub: string; top: string } {
  const parts = (fullPath || "").split(".").map((s) => s.trim()).filter(Boolean);
  const canonical = parts.map((p) => AGENCY_ALIASES[p.toUpperCase()] ?? p);
  const subtier = canonical.find((p) => /Department of the (Air Force|Army|Navy)|Defense .* Agency|Defense .* Activity/i.test(p));
  return { top: canonical[0] ?? "", sub: subtier ?? canonical[canonical.length - 1] ?? canonical[0] ?? "" };
}

async function usaQuery(body: any) {
  const res = await fetch(USA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`USAspending HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.results || []).map((r: any) => {
    const n = r?.NAICS;
    if (n && typeof n === "object") return { ...r, NAICS: n.code ?? "", NAICS_Description: n.description ?? "" };
    return r;
  });
}

async function fetchAgencyHistory(agencyName: string, naics: string) {
  // Try subtier first
  const base = (tier: "subtier" | "toptier") => ({
    filters: {
      naics_codes: [naics],
      agencies: [{ type: "awarding", tier, name: agencyName }],
      time_period: [{ start_date: isoYearsAgo(3), end_date: todayISO(), date_type: "new_awards_only" }],
      award_type_codes: ["A", "B", "C", "D"],
    },
    fields: FIELDS,
    sort: "Start Date",
    order: "desc",
    limit: 100,
    page: 1,
  });
  let rows: any[] = [];
  try { rows = await usaQuery(base("subtier")); } catch { /* fallthrough */ }
  if (rows.length === 0) {
    try { rows = await usaQuery(base("toptier")); } catch { rows = []; }
  }
  return rows;
}

async function fetchMarketLandscape(naics: string, setAside?: string) {
  const filters: any = {
    naics_codes: [naics],
      time_period: [{ start_date: isoYearsAgo(3), end_date: todayISO(), date_type: "new_awards_only" }],
    award_type_codes: ["A", "B", "C", "D"],
  };
  if (setAside) filters.set_aside_type_codes = [setAside];
  try {
    return await usaQuery({
      filters, fields: FIELDS, sort: "Award Amount", order: "desc", limit: 100, page: 1,
    });
  } catch { return []; }
}

async function fetchByPiid(solicitationNumber: string) {
  if (!solicitationNumber) return [];
  const needle = normId(solicitationNumber);
  try {
    const res = await fetch(USA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: {
          award_type_codes: ["A", "B", "C", "D"],
          piids: [solicitationNumber],
        },
        fields: FIELDS,
        sort: "Start Date",
        order: "desc",
        limit: 25,
        page: 1,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.results || []).filter((r: any) => {
      const awardId = normId(r?.["Award ID"]);
      const generated = normId(r?.generated_internal_id);
      return awardId === needle || generated.includes(needle);
    }).map((r: any) => {
      const n = r?.NAICS;
      if (n && typeof n === "object") return { ...r, NAICS: n.code ?? "", NAICS_Description: n.description ?? "" };
      return r;
    });
  } catch { return []; }
}

function aggregateByVendor(rows: any[]) {
  const map = new Map<string, any>();
  for (const r of rows) {
    const key = r.recipient_id || r["Recipient Name"] || "unknown";
    const cur = map.get(key) ?? {
      recipientId: r.recipient_id ?? null,
      name: r["Recipient Name"] ?? "Unknown",
      awards: 0, totalValue: 0, mostRecent: "", setAside: r["Type of Set Aside"] ?? "",
    };
    cur.awards += 1;
    cur.totalValue += Number(r["Award Amount"]) || 0;
    const sd = r["Start Date"] || "";
    if (sd > cur.mostRecent) cur.mostRecent = sd;
    if (!cur.setAside && r["Type of Set Aside"]) cur.setAside = r["Type of Set Aside"];
    map.set(key, cur);
  }
  return [...map.values()]
    .map((v) => ({ ...v, avgValue: v.awards ? v.totalValue / v.awards : 0 }))
    .sort((a, b) => b.totalValue - a.totalValue);
}

function pickIncumbent(rows: any[], solicitationNumber?: string, postedDate?: string, opportunityTitle?: string) {
  if (rows.length === 0) return { top: null, alternates: [] };
  const fullSolicitation = normId(solicitationNumber);
  const exactRows = fullSolicitation
    ? rows.filter((r) => normId(r["Award ID"]) === fullSolicitation || normId(r.generated_internal_id).includes(fullSolicitation))
    : [];
  const sourceRows = exactRows.length > 0 ? exactRows : rows;
  const piidPrefix = solicitationNumber?.match(/^([A-Z0-9]{6})/i)?.[1]?.toUpperCase();
  const posted = postedDate ? new Date(postedDate).getTime() : Date.now();
  const oppTokens = textTokens(opportunityTitle);
  const scored = sourceRows.map((r) => {
    let score = 0;
    const id = String(r["Award ID"] ?? "").toUpperCase();
    const descTokens = textTokens(`${r.Description ?? ""} ${r["Award ID"] ?? ""}`);
    const overlap = overlapCount(oppTokens, descTokens);
    if (piidPrefix && id.startsWith(piidPrefix)) score += 1000;
    if (overlap >= 2) score += 750 + overlap * 100;
    else if (overlap === 1) score += 150;
    const end = r["End Date"] ? new Date(r["End Date"]).getTime() : 0;
    if (end) {
      const diffMonths = Math.abs(end - posted) / (1000 * 60 * 60 * 24 * 30);
      if (diffMonths <= 18) score += 100 - Math.min(diffMonths * 5, 90);
    }
    score += Math.min((Number(r["Award Amount"]) || 0) / 1e6, 50);
    return { r, score, overlap };
  }).filter((s) => exactRows.length > 0 || s.overlap >= 3);
  if (scored.length === 0) return { top: null, alternates: [] };
  scored.sort((a, b) => b.score - a.score);
  const toCard = (r: any) => ({
    vendor: r["Recipient Name"],
    recipientId: r.recipient_id ?? null,
    piid: r["Award ID"],
    value: Number(r["Award Amount"]) || 0,
    popStart: r["Start Date"] ?? null,
    popEnd: r["End Date"] ?? null,
    naics: r.NAICS ?? null,
    description: r.Description ?? null,
    generatedInternalId: r.generated_internal_id ?? null,
  });
  return { top: toCard(scored[0].r), alternates: scored.slice(1, 3).map((s) => toCard(s.r)) };
}

const BIG_INCUMBENT_THRESHOLD = 5_000_000;
const SMALL_INCUMBENT_THRESHOLD = 2_000_000;

function buildScorecard(opts: {
  naicsCode: string; setAside?: string; responseDeadLine?: string;
  incumbent: any; agencyVendors: any[]; agencyAvg: number;
}) {
  const sa = (opts.setAside || "").toUpperCase();
  const naicsNum = parseInt(opts.naicsCode || "0", 10);

  const naicsMatch = naicsNum >= 541511 && naicsNum <= 541519
    ? "strong" : Math.floor(naicsNum / 100) === 5415 ? "moderate" : "weak";

  const setAsideMatch = ["SDVOSBC", "VSA", "VSB"].includes(sa)
    ? "strong"
    : ["SBA", "WOSB", "EDWOSB", "HZC"].includes(sa)
    ? "moderate"
    : "weak";

  const incumbentRisk = !opts.incumbent
    ? "strong"
    : opts.incumbent.value >= BIG_INCUMBENT_THRESHOLD
    ? "weak"
    : opts.incumbent.value >= SMALL_INCUMBENT_THRESHOLD
    ? "moderate"
    : "strong";

  const contractSize = opts.agencyAvg >= 500_000 && opts.agencyAvg <= 10_000_000
    ? "strong" : opts.agencyAvg > 0 ? "moderate" : "weak";

  const competitionLevel = opts.agencyVendors.length === 0
    ? "weak"
    : opts.agencyVendors.length < 5
    ? "strong"
    : opts.agencyVendors.length <= 15
    ? "moderate"
    : "weak";

  let timeline: "strong" | "moderate" | "weak" = "moderate";
  if (opts.responseDeadLine) {
    const days = Math.floor((new Date(opts.responseDeadLine).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    timeline = days > 14 ? "strong" : days >= 7 ? "moderate" : "weak";
  }

  const scoreVal = (v: string) => v === "strong" ? 2 : v === "moderate" ? 1 : 0;
  const factors = [naicsMatch, setAsideMatch, incumbentRisk, contractSize, competitionLevel, timeline];
  const avg = factors.reduce((s, v) => s + scoreVal(v), 0) / factors.length;
  const overall = avg >= 1.5 ? "strong" : avg >= 0.8 ? "moderate" : "weak";

  return {
    naicsMatch, setAsideMatch, agencyExperience: "weak",
    incumbentRisk, contractSize, competitionLevel, timeline, overall,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const authHeader = ctx.authHeader;

    const { solicitationNumber, agency, naicsCode, setAside, postedDate, responseDeadLine, title, teamId } = await req.json();
    if (!naicsCode) throw new Error("naicsCode required");

    // Verify the caller is a member of the requested team BEFORE any cache R/W.
    try { await assertTeamMember(ctx, teamId); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { sub, top } = parseAgency(agency || "");
    const agencyName = sub || top;
    const cacheKey = `v7|${agencyName}|${naicsCode}|${setAside || "none"}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });



    // Cache check — scoped to team
    const { data: cached } = await supabase
      .from("cached_competitive_intel").select("payload, created_at")
      .eq("team_id", teamId)
      .eq("cache_key", cacheKey).gt("expires_at", new Date().toISOString())
      .maybeSingle();

    let agencyRows: any[]; let marketRows: any[];
    if (cached) {
      const p = cached.payload as any;
      agencyRows = p._raw?.agency || [];
      marketRows = p._raw?.market || [];
    } else {
      [agencyRows, marketRows] = await Promise.all([
        agencyName ? fetchAgencyHistory(agencyName, naicsCode) : Promise.resolve([]),
        fetchMarketLandscape(naicsCode, setAside),
      ]);
    }
    // PIID rows are per-solicitation — always fetch fresh, never cache merged.
    const piidRows = await fetchByPiid(solicitationNumber || "");
    if (piidRows.length) {
      const seen = new Set(agencyRows.map((r) => r.generated_internal_id).filter(Boolean));
      for (const r of piidRows) {
        const id = r.generated_internal_id;
        if (!id || !seen.has(id)) {
          agencyRows = [...agencyRows, r];
          if (id) seen.add(id);
        }
      }
    }
    const piidMatch = piidRows.length > 0;

    const incumbent = pickIncumbent(agencyRows, solicitationNumber, postedDate, title);
    const agencyVendors = aggregateByVendor(agencyRows);
    const marketVendors = aggregateByVendor(marketRows);
    const agencyTotal = agencyVendors.reduce((s, v) => s + v.totalValue, 0);
    const agencyCount = agencyRows.length;
    const agencyAvg = agencyCount ? agencyTotal / agencyCount : 0;
    const marketTotal = marketVendors.reduce((s, v) => s + v.totalValue, 0);
    const marketAvg = marketRows.length ? marketTotal / marketRows.length : 0;

    const scorecard = buildScorecard({
      naicsCode, setAside, responseDeadLine,
      incumbent: incumbent.top, agencyVendors, agencyAvg,
    });

    const payload = {
      incumbent,
      agencyHistory: {
        agencyName,
        totalContracts: agencyCount,
        totalValue: agencyTotal,
        avgValue: agencyAvg,
        vendors: agencyVendors.slice(0, 25),
      },
      marketLandscape: {
        setAside: setAside || null,
        totalVendors: marketVendors.length,
        totalContracts: marketRows.length,
        totalValue: marketTotal,
        avgValue: marketAvg,
        vendors: marketVendors.slice(0, 25),
      },
      scorecard,
      piidMatch,
      cachedAt: cached?.created_at ?? new Date().toISOString(),
      fromCache: !!cached,
    };

    if (!cached) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("cached_competitive_intel").upsert({
        team_id: teamId,
        cache_key: cacheKey,
        agency: agencyName,
        naics_code: naicsCode,
        set_aside: setAside || null,
        payload: { ...payload, _raw: { agency: agencyRows.filter((r) => !piidRows.some((p) => p.generated_internal_id && p.generated_internal_id === r.generated_internal_id)), market: marketRows } },
        expires_at: expiresAt,
      }, { onConflict: "team_id,cache_key" });
    }

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
