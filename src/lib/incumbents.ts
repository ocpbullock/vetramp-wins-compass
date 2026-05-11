import type { SamOpportunity, HistoricalAward } from "./api";

/** Normalize a PIID for fuzzy comparison: uppercase, strip non-alphanumerics. */
export function normPiid(s?: string | null): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type IncumbentMatch = {
  confidence: "exact" | "parent" | "none";
  awards: HistoricalAward[];
  topRecipient?: string;
  totalAmount?: number;
  latestEndDate?: string;
};

/**
 * Match a SAM opportunity against the historical award set to find the
 * incumbent contractor.
 *
 * Tiers:
 *  - "exact"  → opp.solicitationNumber matches award PIID directly
 *  - "parent" → opp.solicitationNumber matches an award's Parent Award ID (IDV)
 */
export function matchIncumbent(
  opp: SamOpportunity,
  awards: HistoricalAward[],
  index?: { byPiid: Map<string, HistoricalAward[]>; byParent: Map<string, HistoricalAward[]> },
): IncumbentMatch {
  const sol = normPiid(opp.solicitationNumber);
  const awardNum = normPiid((opp as any).award?.number);
  if (!sol && !awardNum) return { confidence: "none", awards: [] };

  const idx = index ?? buildIndex(awards);

  const exact = [
    ...(sol ? idx.byPiid.get(sol) ?? [] : []),
    ...(awardNum ? idx.byPiid.get(awardNum) ?? [] : []),
  ];
  if (exact.length > 0) return summarize("exact", exact);

  const parent = sol ? idx.byParent.get(sol) ?? [] : [];
  if (parent.length > 0) return summarize("parent", parent);

  return { confidence: "none", awards: [] };
}

export function buildIndex(awards: HistoricalAward[]) {
  const byPiid = new Map<string, HistoricalAward[]>();
  const byParent = new Map<string, HistoricalAward[]>();
  for (const a of awards) {
    const p = normPiid(a["Award ID"]);
    if (p) {
      const arr = byPiid.get(p) ?? [];
      arr.push(a);
      byPiid.set(p, arr);
    }
    const pa = normPiid(a["Parent Award ID"]);
    if (pa) {
      const arr = byParent.get(pa) ?? [];
      arr.push(a);
      byParent.set(pa, arr);
    }
  }
  return { byPiid, byParent };
}

function summarize(confidence: "exact" | "parent", awards: HistoricalAward[]): IncumbentMatch {
  // Aggregate by recipient, pick the one with the highest total $.
  const totals = new Map<string, number>();
  for (const a of awards) {
    const r = a["Recipient Name"] || "(unknown)";
    totals.set(r, (totals.get(r) ?? 0) + (Number(a["Award Amount"]) || 0));
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const latestEnd = awards
    .map((a) => a["End Date"])
    .filter(Boolean)
    .sort()
    .at(-1);
  const totalAmount = [...totals.values()].reduce((s, v) => s + v, 0);
  return {
    confidence,
    awards,
    topRecipient: top?.[0],
    totalAmount,
    latestEndDate: latestEnd ?? undefined,
  };
}
