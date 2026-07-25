import { buildCorsHeaders } from "../_shared/cors.ts";
import { authenticate, authErrorResponse } from "../_shared/auth.ts";
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
    .replace(/[.,]/g, "")
    .replace(/\b(INC|LLC|LTD|CORP|CORPORATION|COMPANY|CO|LP|LLP|PLLC|LLLP|PC)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ResolvedIdentity = {
  uei: string;
  legal_name: string | null;
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
    city: e?.city || e?.address?.city || e?.physical_address?.city || null,
    state: e?.state || e?.address?.state || e?.physical_address?.state || null,
    cage_code: e?.cage_code || e?.cageCode || null,
    business_types: normalizedTypes,
    naics_codes: e?.naics_codes || e?.naicsCodes || (e?.primary_naics ? [e.primary_naics] : []),
  };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    try { await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const input = await req.json();
    // Back-compat: earlier callers passed `recipientId`. Some passed a UEI
    // (Tango-driven paths), some passed a USAspending recipient hash. Accept
    // both plus explicit `uei`/`vendorName`.
    const rawUei: string | null = (input.uei ?? null) as string | null;
    const rawRecipientId: string | null = (input.recipientId ?? null) as string | null;
    const rawName: string | null = (input.vendorName ?? input.recipientName ?? null) as string | null;

    let uei: string | null = rawUei && UEI_RE.test(rawUei) ? rawUei.toUpperCase() : null;
    if (!uei && rawRecipientId && UEI_RE.test(rawRecipientId)) uei = rawRecipientId.toUpperCase();
    if (!uei && !rawName) throw new Error("Provide { uei } or { vendorName } (or a UEI as recipientId)");

    // ---------- 1) Identity resolution ----------
    let identity: ResolvedIdentity | null = null;

    if (uei) {
      try {
        const ent = await searchEntities({ uei, page_size: 5 });
        const exact = ent?.results?.find((e: any) => (e?.uei || e?.UEI || "").toUpperCase() === uei);
        identity = pickEntityIdentity(exact ?? ent?.results?.[0]);
      } catch { /* profile is optional; continue with UEI */ }
      if (!identity) identity = { uei, legal_name: rawName ?? null, city: null, state: null, cage_code: null, business_types: [], naics_codes: [] };
    } else if (rawName) {
      // Name-only path: MUST resolve to a UEI before aggregating anything.
      let candidates: any[] = [];
      try {
        const ent = await searchEntities({ name: rawName, page_size: 25 });
        candidates = (ent?.results ?? []).filter((e: any) => e?.uei || e?.UEI);
      } catch (e: any) {
        return new Response(JSON.stringify({
          error: `Entity lookup failed: ${e?.message ?? "unknown"}`,
          resolved: null,
        }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const targetNorm = normalizeName(rawName);
      const exact = candidates.filter((e: any) => normalizeName(e?.legal_name || e?.legalBusinessName || e?.name) === targetNorm);

      if (exact.length === 1) {
        identity = pickEntityIdentity(exact[0]);
      } else if (exact.length > 1) {
        // Multiple exact matches on the normalized name: let the UI disambiguate.
        return new Response(JSON.stringify({
          multipleMatches: true,
          query: rawName,
          candidates: exact.map(pickEntityIdentity).filter(Boolean),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else if (candidates.length === 0) {
        return new Response(JSON.stringify({
          resolved: null,
          error: `No SAM entity found for "${rawName}". Provide a UEI to aggregate contracts.`,
        }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        // No exact match — return top candidates for disambiguation rather than guessing.
        return new Response(JSON.stringify({
          multipleMatches: true,
          query: rawName,
          candidates: candidates.slice(0, 8).map(pickEntityIdentity).filter(Boolean),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!identity) throw new Error("Could not resolve vendor identity");
    const targetUei = identity.uei;
    const targetNameNorm = normalizeName(identity.legal_name ?? rawName);

    // ---------- 2) Contract fetch, by UEI only ----------
    const today = new Date().toISOString().slice(0, 10);
    const fiveYrs = new Date(); fiveYrs.setFullYear(fiveYrs.getFullYear() - 5);
    let rawResults: any[] = [];
    try {
      const res = await searchContracts({
        recipient_uei: targetUei,
        award_date_gte: fiveYrs.toISOString().slice(0, 10),
        award_date_lte: today,
        page_size: 100,
      });
      rawResults = res?.results ?? [];
    } catch (e: any) {
      return new Response(JSON.stringify({
        resolved: identity,
        summary: { totalContracts: 0, obligatedTotal: 0, activeCount: 0, warningFlag: null },
        naicsBreakdown: [], agencyBreakdown: [], contracts: [],
        error: `Contract fetch failed: ${e?.message ?? "unknown"}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- 3) Defensive filter: enforce identity on every row ----------
    const mapped = rawResults.map((r) => mapContractRow("", r));
    const kept = mapped.filter((row) => {
      const rowUei = (row.vendor_uei ?? "").toString().toUpperCase();
      if (rowUei) return rowUei === targetUei;
      // Fallback only when the record has no UEI: strict normalized-name match.
      const rowName = normalizeName(row.vendor_name);
      return targetNameNorm.length > 0 && rowName === targetNameNorm;
    });

    // Convert to the USAspending-shaped rows the UI already expects.
    const contracts = kept.map((row) => contractRowToUsaspendingShape(row));

    // ---------- 4) Aggregations on OBLIGATED amount ----------
    const naicsMap = new Map<string, { code: string; awards: number; obligatedTotal: number }>();
    const agencyMap = new Map<string, { name: string; awards: number; obligatedTotal: number }>();
    let obligatedTotal = 0;
    let activeCount = 0;
    const now = Date.now();
    for (const c of contracts) {
      const v = Number(c["Award Amount"]) || 0; // this is obligated_amount from mapContractRow
      obligatedTotal += v;
      if (c["End Date"] && new Date(c["End Date"]).getTime() > now) activeCount++;
      const n = c.NAICS || "—";
      const ne = naicsMap.get(n) ?? { code: n, awards: 0, obligatedTotal: 0 };
      ne.awards++; ne.obligatedTotal += v; naicsMap.set(n, ne);
      const a = c["Awarding Sub Agency"] || c["Awarding Agency"] || "—";
      const ae = agencyMap.get(a) ?? { name: a, awards: 0, obligatedTotal: 0 };
      ae.awards++; ae.obligatedTotal += v; agencyMap.set(a, ae);
    }

    // Legacy field names for backward compatibility with the UI.
    const naicsBreakdown = [...naicsMap.values()]
      .map((n) => ({ ...n, totalValue: n.obligatedTotal }))
      .sort((a, b) => b.obligatedTotal - a.obligatedTotal);
    const agencyBreakdown = [...agencyMap.values()]
      .map((a) => ({ ...a, totalValue: a.obligatedTotal }))
      .sort((a, b) => b.obligatedTotal - a.obligatedTotal);

    // Sanity guard: >$50B obligated to one vendor is almost always a matcher bug.
    const warningFlag = obligatedTotal > 50_000_000_000
      ? "unusually_large_total"
      : null;

    return new Response(JSON.stringify({
      resolved: identity,
      // Keep a `profile` field populated from resolved identity so older UI code
      // that reads `data.profile.uei` etc. keeps working.
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
        totalValue: obligatedTotal, // legacy alias
        activeCount,
        warningFlag,
        droppedCount: mapped.length - kept.length,
      },
      naicsBreakdown,
      agencyBreakdown,
      contracts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
