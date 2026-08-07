// Server-only helpers backing the Fed-Spend Phase 1 server functions.
// Kept out of *.functions.ts so the thin wrapper stays split-safe.
import {
  searchFedSpend,
  normalizeRecompeteRow,
  looseNameMatch,
  SUBAWARD_SUSPECT_THRESHOLD,
  FedSpendError,
  type RecompeteRow,
  type SubawardRow,
} from "./fedspend.server";
import type { RecompeteResponse, SubawardsResponse } from "./fedspend-types";
export type { RecompeteResponse, SubawardsResponse };

export const RECOMPETE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const SUBAWARD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export function recompeteCacheKey(naics: string[], maxDays: number): string {
  return `recompete:${maxDays}:${[...naics].sort().join(",")}`;
}

export function subawardsCacheKey(companyName: string): string {
  return `subawards:${companyName.trim().toUpperCase()}`;
}

function toNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Fetch expiring contracts for each NAICS code, merge + dedupe by PIID. */
export async function fetchRecompetes(
  naicsCodes: string[],
  maxDays: number,
): Promise<RecompeteRow[]> {
  const byPiid = new Map<string, RecompeteRow>();
  // Sequential on purpose: the shared client paces at 10 req/min.
  for (const naics of naicsCodes.slice(0, 6)) {
    const res = await searchFedSpend("recompete", {
      naicsCode: naics,
      maxResults: 50,
    });
    for (const raw of res.rows) {
      const row = normalizeRecompeteRow(raw as Record<string, unknown>);
      if (!row.piid) continue;
      // Agency filtering is unreliable server-side, so we filter days here.
      if (row.daysUntilExpiration !== null && row.daysUntilExpiration > maxDays) continue;
      if (row.daysUntilExpiration !== null && row.daysUntilExpiration < 0) continue;
      const existing = byPiid.get(row.piid);
      if (!existing || (row.value ?? 0) > (existing.value ?? 0)) byPiid.set(row.piid, row);
    }
  }
  return [...byPiid.values()].sort(
    (a, b) => (a.daysUntilExpiration ?? 99_999) - (b.daysUntilExpiration ?? 99_999),
  );
}

/**
 * Look up subaward relationships for a company. The provider ignores name
 * filters server-side, so we pull a page and filter client-side by loose name
 * match against both the prime and the sub.
 */
export async function fetchSubawards(companyName: string): Promise<{
  asPrime: SubawardRow[];
  asSub: SubawardRow[];
  suspectCount: number;
}> {
  const res = await searchFedSpend("subAwards", {
    recipientName: companyName,
    maxResults: 100,
  });

  const asPrime: SubawardRow[] = [];
  const asSub: SubawardRow[] = [];
  let suspectCount = 0;

  for (const rawUnknown of res.rows) {
    const raw = rawUnknown as Record<string, unknown>;
    const prime = toStr(raw["primeContractor"]) ?? toStr(raw["primeRecipientName"]);
    const sub = toStr(raw["subRecipient"]) ?? toStr(raw["subRecipientName"]);
    if (!prime || !sub) continue;

    const amount = toNum(raw["subAwardAmount"]) ?? toNum(raw["amount"]);
    const suspect = amount !== null && amount > SUBAWARD_SUSPECT_THRESHOLD;
    if (suspect) suspectCount += 1;

    const base = {
      amount,
      date: toStr(raw["subAwardDate"]) ?? toStr(raw["actionDate"]),
      description: toStr(raw["description"]) ?? toStr(raw["subAwardDescription"]),
      agency: toStr(raw["awardingAgency"]) ?? toStr(raw["agency"]),
      primeAwardId: toStr(raw["primeAwardId"]) ?? toStr(raw["piid"]),
      suspect,
    };

    if (looseNameMatch(companyName, prime)) {
      asPrime.push({ partnerName: sub, ...base });
    } else if (looseNameMatch(companyName, sub)) {
      asSub.push({ partnerName: prime, ...base });
    }
  }

  const dedupe = (rows: SubawardRow[]) => {
    const m = new Map<string, SubawardRow>();
    for (const r of rows) {
      const k = r.partnerName.toUpperCase();
      const prev = m.get(k);
      if (!prev || (r.amount ?? 0) > (prev.amount ?? 0)) m.set(k, r);
    }
    return [...m.values()].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 25);
  };

  return { asPrime: dedupe(asPrime), asSub: dedupe(asSub), suspectCount };
}

/** Health probe used by /diagnostics. */
export async function fedspendHealth(): Promise<{
  bootOk: boolean;
  probeOk: boolean;
  message: string;
  rateLimitRemaining: number | null;
}> {
  if (!process.env["FED_SPEND_API_KEY"]) {
    return {
      bootOk: false,
      probeOk: false,
      message: "FED_SPEND_API_KEY is not configured",
      rateLimitRemaining: null,
    };
  }
  try {
    const res = await searchFedSpend("awards", { naicsCode: "541512", maxResults: 1 });
    return {
      bootOk: true,
      probeOk: res.rows.length > 0,
      message:
        res.rows.length > 0
          ? `Reachable — ${res.rows.length} row(s), ${res.rateLimitRemaining ?? "?"}/${res.rateLimitLimit ?? "?"} requests left this minute`
          : "Reachable but returned no rows",
      rateLimitRemaining: res.rateLimitRemaining,
    };
  } catch (e) {
    return {
      bootOk: true,
      probeOk: false,
      message: e instanceof FedSpendError ? e.message : String(e),
      rateLimitRemaining: null,
    };
  }
}
