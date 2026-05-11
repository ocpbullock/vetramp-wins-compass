import type { SamOpportunity, HistoricalAward } from "./api";

/** Normalize a PIID for fuzzy comparison: uppercase, strip non-alphanumerics. */
export function normPiid(s?: string | null): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const STOPWORDS = new Set([
  "the","a","an","of","for","and","or","to","in","on","with","by","at","from",
  "services","service","support","solutions","contract","task","order","idiq",
  "bpa","rfp","rfq","sources","sought","notice","program","system","systems",
  "inc","llc","corp","co","company","government","federal","department","agency",
]);

function tokens(s?: string | null): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export type IncumbentMatch = {
  confidence: "exact" | "parent" | "fuzzy" | "none";
  awards: HistoricalAward[];
  topRecipient?: string;
  totalAmount?: number;
  latestEndDate?: string;
  similarity?: number;
};

export type IncumbentIndex = {
  byPiid: Map<string, HistoricalAward[]>;
  byParent: Map<string, HistoricalAward[]>;
  byAgencyNaics: Map<string, HistoricalAward[]>;
  titleTokens: WeakMap<HistoricalAward, Set<string>>;
};

/**
 * Match a SAM opportunity against the historical award set to find the
 * incumbent contractor.
 *
 * Tiers:
 *  - "exact"  → opp.solicitationNumber matches award PIID directly
 *  - "parent" → opp.solicitationNumber matches an award's Parent Award ID (IDV)
 *  - "fuzzy"  → same sub-agency + NAICS + ≥40% title token overlap (Jaccard)
 */
export function matchIncumbent(
  opp: SamOpportunity,
  awards: HistoricalAward[],
  index?: IncumbentIndex,
): IncumbentMatch {
  const sol = normPiid(opp.solicitationNumber);
  const awardNum = normPiid((opp as any).award?.number);

  const idx = index ?? buildIndex(awards);

  if (sol || awardNum) {
    const exact = [
      ...(sol ? idx.byPiid.get(sol) ?? [] : []),
      ...(awardNum ? idx.byPiid.get(awardNum) ?? [] : []),
    ];
    if (exact.length > 0) return summarize("exact", exact);

    const parent = sol ? idx.byParent.get(sol) ?? [] : [];
    if (parent.length > 0) return summarize("parent", parent);
  }

  // Tier 3: fuzzy match by sub-agency + NAICS + title token overlap
  const subAgency = (opp.subTier || opp.fullParentPathName || "").toLowerCase();
  const naics = (opp.naicsCode || "").trim();
  if (subAgency && naics) {
    const key = `${subAgency}|${naics}`;
    const candidates = idx.byAgencyNaics.get(key) ?? [];
    if (candidates.length > 0) {
      const oppTokens = tokens(opp.title);
      if (oppTokens.size >= 2) {
        const scored = candidates
          .map((a) => {
            let at = idx.titleTokens.get(a);
            if (!at) {
              at = tokens(a["Description"]);
              idx.titleTokens.set(a, at);
            }
            return { a, sim: jaccard(oppTokens, at) };
          })
          .filter((x) => x.sim >= 0.4)
          .sort((x, y) => y.sim - x.sim);
        if (scored.length > 0) {
          const top = scored.slice(0, 5);
          const m = summarize("fuzzy", top.map((s) => s.a));
          m.similarity = top[0].sim;
          return m;
        }
      }
    }
  }

  return { confidence: "none", awards: [] };
}

export function buildIndex(awards: HistoricalAward[]): IncumbentIndex {
  const byPiid = new Map<string, HistoricalAward[]>();
  const byParent = new Map<string, HistoricalAward[]>();
  const byAgencyNaics = new Map<string, HistoricalAward[]>();
  const titleTokens = new WeakMap<HistoricalAward, Set<string>>();
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
    const sub = (a["Awarding Sub Agency"] || "").toLowerCase();
    const naics = (a as any)["NAICS"];
    const naicsCode = typeof naics === "string"
      ? naics.split(" ")[0].trim()
      : (naics?.code || "");
    if (sub && naicsCode) {
      const key = `${sub}|${naicsCode}`;
      const arr = byAgencyNaics.get(key) ?? [];
      arr.push(a);
      byAgencyNaics.set(key, arr);
    }
  }
  return { byPiid, byParent, byAgencyNaics, titleTokens };
}

function summarize(
  confidence: "exact" | "parent" | "fuzzy",
  awards: HistoricalAward[],
): IncumbentMatch {
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
