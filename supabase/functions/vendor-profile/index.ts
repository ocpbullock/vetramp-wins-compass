import { buildCorsHeaders } from "../_shared/cors.ts";
import { authenticate, authErrorResponse, resolveTeamId } from "../_shared/auth.ts";
import {
  searchContracts,
  searchEntities,
  mapContractRow,
  contractRowToUsaspendingShape,
} from "../_shared/tango-client.ts";

// UEIs are 12-char alphanumeric, no dashes.
const UEI_RE = /^[A-Z0-9]{12}$/i;

function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[.,'"`]/g, "")
    .replace(/\b(INC|INCORPORATED|LLC|L\.L\.C|LTD|CORP|CORPORATION|COMPANY|CO|LP|LLP|PLLC|LLLP|PC)\b/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ResolvedIdentity = {
  uei: string;
  legal_name: string | null;
  dba_name: string | null;
  city: string | null;
  state: string | null;
  cage_code: string | null;
  business_types: string[];
  naics_codes: string[];
};

function pickEntityIdentity(e: any): ResolvedIdentity | null {
  const uei = e?.uei || e?.UEI;
  if (!uei) return null;
  const bizTypes = e?.small_business_types || e?.businessTypes || e?.business_types || [];
  const normalizedTypes = Array.isArray(bizTypes)
    ? bizTypes.map((t: any) => (typeof t === "string" ? t : (t?.description || t?.code || ""))).filter(Boolean)
    : [];
  return {
    uei: String(uei).toUpperCase(),
    legal_name: e?.legal_name || e?.legalBusinessName || e?.legal_business_name || e?.name || null,
    dba_name: e?.dba_name || e?.dbaName || null,
    city: e?.city || e?.address?.city || e?.physical_address?.city || null,
    state: e?.state || e?.address?.state || e?.physical_address?.state || null,
    cage_code: e?.cage_code || e?.cageCode || null,
    business_types: normalizedTypes,
    naics_codes: e?.naics_codes || e?.naicsCodes || (e?.primary_naics ? [e.primary_naics] : []),
  };
}

// Tolerant attribution: keep rows whose UEI matches, OR whose recipient name
// (normalized) matches the target legal name or DBA. Rows with no UEI on the
// record must at least name-match. This is the fix for zero-yield "defensive"
// filters that dropped legitimate awards whose UEI came in under a different
// key or wasn't populated at all in the Tango response.
function attributionKeep(row: ReturnType<typeof mapContractRow>, targetUei: string, targetNames: string[]) {
  const rowUei = (row.vendor_uei ?? "").toString().toUpperCase();
  if (rowUei && rowUei === targetUei) return true;
  const rowName = normalizeName(row.vendor_name);
  if (!rowName) return false;
  return targetNames.some((n) => n && (rowName === n || rowName.includes(n) || n.includes(rowName)));
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }
    const admin = ctx.admin;

    const input = await req.json();
    const rawUei: string | null = (input.uei ?? null) as string | null;
    const rawRecipientId: string | null = (input.recipientId ?? null) as string | null;
    const rawName: string | null = (input.vendorName ?? input.recipientName ?? null) as string | null;
    const teamIdArg: string | null = (input.teamId ?? null) as string | null;

    let uei: string | null = rawUei && UEI_RE.test(rawUei) ? rawUei.toUpperCase() : null;
    if (!uei && rawRecipientId && UEI_RE.test(rawRecipientId)) uei = rawRecipientId.toUpperCase();
    if (!uei && !rawName) throw new Error("Provide { uei } or { vendorName }");

    // Team is optional; only used to merge in previously-cached contracts.
    let teamId: string | null = null;
    try { teamId = await resolveTeamId(ctx, teamIdArg); } catch { teamId = null; }

    // ---------- 1) Identity resolution ----------
    let identity: ResolvedIdentity | null = null;

    if (uei) {
      try {
        const ent = await searchEntities({ uei, page_size: 5 });
        const exact = ent?.results?.find((e: any) => (e?.uei || e?.UEI || "").toUpperCase() === uei);
        identity = pickEntityIdentity(exact ?? ent?.results?.[0]);
      } catch { /* profile is optional; continue with UEI */ }
      if (!identity) identity = { uei, legal_name: rawName ?? null, dba_name: null, city: null, state: null, cage_code: null, business_types: [], naics_codes: [] };
    } else if (rawName) {
      let candidates: any[] = [];
      try {
        const ent = await searchEntities({ name: rawName, page_size: 25 });
        candidates = (ent?.results ?? []).filter((e: any) => e?.uei || e?.UEI);
      } catch (e: any) {
        return new Response(JSON.stringify({
          error: `Entity lookup failed: ${e?.message ?? "unknown"}`, resolved: null,
        }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const targetNorm = normalizeName(rawName);
      const exact = candidates.filter((e: any) => normalizeName(e?.legal_name || e?.legalBusinessName || e?.name) === targetNorm);
      if (exact.length === 1) identity = pickEntityIdentity(exact[0]);
      else if (exact.length > 1 || candidates.length > 1) {
        return new Response(JSON.stringify({
          multipleMatches: true, query: rawName,
          candidates: (exact.length > 1 ? exact : candidates.slice(0, 8)).map(pickEntityIdentity).filter(Boolean),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else if (candidates.length === 0) {
        return new Response(JSON.stringify({
          resolved: null,
          error: `No SAM entity found for "${rawName}". Provide a UEI to aggregate contracts.`,
        }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else identity = pickEntityIdentity(candidates[0]);
    }

    if (!identity) throw new Error("Could not resolve vendor identity");
    const targetUei = identity.uei;
    const targetNames = [normalizeName(identity.legal_name), normalizeName(identity.dba_name), normalizeName(rawName)]
      .filter((n) => n && n.length >= 3);

    // ---------- 2) Contract fetch — probe multiple recipient params ----------
    // Empirically the Tango /api/contracts/ endpoint honors different filters
    // than /api/opportunities/ (parallel to the awarding_agency issue we hit
    // earlier). We try UEI-style params first, then a name query, and record
    // which probe returned attributable rows so future callers/logs can see it.
    const today = new Date().toISOString().slice(0, 10);
    const fiveYrs = new Date(); fiveYrs.setFullYear(fiveYrs.getFullYear() - 5);
    const since = fiveYrs.toISOString().slice(0, 10);

    const probes: Array<{ label: string; params: Record<string, unknown> }> = [
      { label: "recipient_uei", params: { recipient_uei: targetUei } },
      { label: "recipient=UEI", params: { recipient: targetUei } },
    ];
    if (identity.legal_name) {
      probes.push({ label: "recipient_name", params: { recipient_name: identity.legal_name } });
      probes.push({ label: "recipient=name", params: { recipient: identity.legal_name } });
      probes.push({ label: "search=name", params: { search: identity.legal_name } });
    }

    const probeResults: Array<{ label: string; raw: number; kept: number; ok: boolean; error?: string }> = [];
    const merged = new Map<string, ReturnType<typeof mapContractRow>>();
    let winningProbe: string | null = null;

    for (const p of probes) {
      try {
        const res = await searchContracts({
          ...(p.params as any),
          award_date_gte: since,
          award_date_lte: today,
          page_size: 100,
        });
        const raw = res?.results ?? [];
        const mapped = raw.map((r: any) => mapContractRow("", r));
        const kept = mapped.filter((row) => attributionKeep(row, targetUei, targetNames));
        probeResults.push({ label: p.label, raw: raw.length, kept: kept.length, ok: true });
        for (const row of kept) {
          const key = row.tango_id || row.piid || `${row.vendor_uei ?? ""}|${row.award_date ?? ""}|${row.obligated_amount ?? ""}`;
          if (!merged.has(key)) merged.set(key, row);
        }
        if (!winningProbe && kept.length > 0) winningProbe = p.label;
        // If UEI probe already found rows, don't burn quota on the noisier name probes.
        if (winningProbe && (p.label === "recipient_uei" || p.label === "recipient=UEI") && kept.length > 0) break;
      } catch (e: any) {
        probeResults.push({ label: p.label, raw: 0, kept: 0, ok: false, error: String(e?.message ?? e).slice(0, 200) });
      }
    }

    // ---------- 3) Supplemental: previously-cached contracts for this team ----------
    let cacheMerged = 0;
    if (teamId) {
      try {
        const filters = [`vendor_uei.eq.${targetUei}`];
        if (identity.legal_name) filters.push(`vendor_name.ilike.%${identity.legal_name.replace(/[%_]/g, "")}%`);
        const { data: cachedRows } = await admin
          .from("tango_cached_contracts")
          .select("*")
          .eq("team_id", teamId)
          .or(filters.join(","))
          .limit(200);
        for (const row of cachedRows ?? []) {
          if (!attributionKeep(row as any, targetUei, targetNames)) continue;
          const key = row.tango_id || row.piid || `${row.vendor_uei ?? ""}|${row.award_date ?? ""}|${row.obligated_amount ?? ""}`;
          if (!merged.has(key)) { merged.set(key, row as any); cacheMerged++; }
        }
      } catch (e) {
        console.warn("vendor-profile cache merge failed", e);
      }
    }

    const kept = [...merged.values()];
    const contracts = kept.map((row) => contractRowToUsaspendingShape(row));

    // ---------- 4) Aggregations on OBLIGATED amount ----------
    const naicsMap = new Map<string, { code: string; awards: number; obligatedTotal: number }>();
    const agencyMap = new Map<string, { name: string; awards: number; obligatedTotal: number }>();
    let obligatedTotal = 0;
    let activeCount = 0;
    const now = Date.now();
    for (const c of contracts) {
      const v = Number(c["Award Amount"]) || 0;
      obligatedTotal += v;
      if (c["End Date"] && new Date(c["End Date"]).getTime() > now) activeCount++;
      const n = c.NAICS || "—";
      const ne = naicsMap.get(n) ?? { code: n, awards: 0, obligatedTotal: 0 };
      ne.awards++; ne.obligatedTotal += v; naicsMap.set(n, ne);
      const a = c["Awarding Sub Agency"] || c["Awarding Agency"] || "—";
      const ae = agencyMap.get(a) ?? { name: a, awards: 0, obligatedTotal: 0 };
      ae.awards++; ae.obligatedTotal += v; agencyMap.set(a, ae);
    }

    const naicsBreakdown = [...naicsMap.values()]
      .map((n) => ({ ...n, totalValue: n.obligatedTotal }))
      .sort((a, b) => b.obligatedTotal - a.obligatedTotal);
    const agencyBreakdown = [...agencyMap.values()]
      .map((a) => ({ ...a, totalValue: a.obligatedTotal }))
      .sort((a, b) => b.obligatedTotal - a.obligatedTotal);

    const warningFlag = obligatedTotal > 50_000_000_000 ? "unusually_large_total" : null;

    // droppedCount is the sum of raw rows minus what we actually attributed,
    // reported ONLY when > 0 AFTER the tolerant pass. It surfaces the noise
    // from live probes; cache merges add rows so they don't count as dropped.
    const totalRaw = probeResults.reduce((s, p) => s + p.raw, 0);
    const droppedCount = Math.max(0, totalRaw - (kept.length - cacheMerged));

    console.log(`[vendor-profile] uei=${targetUei} probes=${JSON.stringify(probeResults)} winning=${winningProbe} cacheMerged=${cacheMerged} kept=${kept.length}`);

    return new Response(JSON.stringify({
      resolved: identity,
      profile: {
        uei: identity.uei,
        recipient_name: identity.legal_name,
        legal_business_name: identity.legal_name,
        location: { city_name: identity.city, state_code: identity.state },
        business_types: identity.business_types,
      },
      summary: {
        totalContracts: contracts.length,
        obligatedTotal,
        totalValue: obligatedTotal,
        activeCount,
        warningFlag,
        droppedCount,
        cacheMerged,
        noAwards: contracts.length === 0,
      },
      naicsBreakdown,
      agencyBreakdown,
      contracts,
      _debug: { winningProbe, probeResults },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
