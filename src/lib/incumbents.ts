import type { SamOpportunity, HistoricalAward } from "./api";

/** Normalize a PIID for fuzzy comparison: uppercase, strip non-alphanumerics. */
export function normPiid(s?: string | null): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Normalize an agency name for fuzzy bucket matching. */
function normAgency(s?: string | null): string {
  return (s || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(department|dept|of|the|us|u\.s\.)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function intersectionCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export type IncumbentMatch = {
  confidence: "exact" | "parent" | "fuzzy" | "frequent" | "none";
  awards: HistoricalAward[];
  topRecipient?: string;
  totalAmount?: number;
  latestEndDate?: string;
  similarity?: number;
  diagnostics?: {
    triedKeys: string[];
    matchedKey?: string;
    bucketSize: number;
    candidatesAfterTitle: number;
    note?: string;
  };
};

export type IncumbentIndex = {
  byPiid: Map<string, HistoricalAward[]>;
  byParent: Map<string, HistoricalAward[]>;
  byAgencyNaics: Map<string, HistoricalAward[]>;
  titleTokens: WeakMap<HistoricalAward, Set<string>>;
};

const TITLE_JACCARD_FLOOR = 0.30;
const TITLE_MIN_OVERLAP = 2;

/**
 * Match a SAM opportunity against the historical award set to find the
 * incumbent contractor.
 *
 * Tiers (high → low confidence):
 *  - "exact"    → solicitation # matches award PIID directly
 *  - "parent"   → solicitation # matches an award's Parent Award ID (IDV)
 *  - "fuzzy"    → same sub-agency + NAICS + ≥30% title token overlap (≥2 shared tokens)
 *  - "frequent" → same sub-agency + NAICS + a single recipient appears ≥2x
 *                 in the bucket (likely re-compete cycle)
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

  // Try every sub-agency segment, not just the second-to-last.
  // SAM's fullParentPathName: "DEPT OF DEFENSE.DEPT OF THE ARMY.US ARMY CORPS OF ENGINEERS.OFFICE.."
  // USAspending's sub-agency may be the bureau ("DEPT OF THE ARMY") or the command — try all.
  const path = (opp.fullParentPathName || "")
    .split(".")
    .map((s) => normAgency(s))
    .filter(Boolean);
  const naics = (opp.naicsCode || "").trim();
  const triedKeys: string[] = [];
  let bucket: HistoricalAward[] = [];
  let matchedKey: string | undefined;

  if (naics && path.length > 0) {
    for (const seg of path) {
      const key = `${seg}|${naics}`;
      triedKeys.push(key);
      const hit = idx.byAgencyNaics.get(key);
      if (hit && hit.length > 0) {
        bucket = hit;
        matchedKey = key;
        break;
      }
    }
  }

  if (bucket.length > 0) {
    const oppTokens = tokens(opp.title);
    let scored: { a: HistoricalAward; sim: number; overlap: number }[] = [];
    if (oppTokens.size >= 2) {
      scored = bucket
        .map((a) => {
          let at = idx.titleTokens.get(a);
          if (!at) {
            at = tokens(a["Description"]);
            idx.titleTokens.set(a, at);
          }
          return { a, sim: jaccard(oppTokens, at), overlap: intersectionCount(oppTokens, at) };
        })
        .filter((x) => x.sim >= TITLE_JACCARD_FLOOR && x.overlap >= TITLE_MIN_OVERLAP)
        .sort((x, y) => y.sim - x.sim);
    }
    if (scored.length > 0) {
      const top = scored.slice(0, 5);
      const m = summarize("fuzzy", top.map((s) => s.a));
      m.similarity = top[0].sim;
      m.diagnostics = {
        triedKeys, matchedKey, bucketSize: bucket.length,
        candidatesAfterTitle: scored.length,
      };
      return m;
    }

    // Tier 4: frequent-vendor heuristic — only fire when one recipient
    // clearly dominates the agency+NAICS bucket (≥3 awards AND ≥40% of value).
    // Otherwise the bucket just reflects a busy NAICS at a busy agency.
    const bucketTotal = bucket.reduce((s, x) => s + (Number(x["Award Amount"]) || 0), 0);
    const byRecipient = new Map<string, HistoricalAward[]>();
    for (const a of bucket) {
      const r = a["Recipient Name"] || "(unknown)";
      const arr = byRecipient.get(r) ?? [];
      arr.push(a);
      byRecipient.set(r, arr);
    }
    const repeat = [...byRecipient.entries()]
      .map(([name, arr]) => ({
        name, arr,
        total: arr.reduce((s, x) => s + (Number(x["Award Amount"]) || 0), 0),
      }))
      .filter((x) => x.arr.length >= 3 && (bucketTotal === 0 || x.total / bucketTotal >= 0.40))
      .sort((a, b) => b.total - a.total);
    if (repeat.length > 0) {
      const m = summarize("frequent", repeat[0].arr);
      m.diagnostics = {
        triedKeys, matchedKey, bucketSize: bucket.length,
        candidatesAfterTitle: 0,
        note: `dominant vendor (${repeat[0].arr.length} awards, ${Math.round(100 * repeat[0].total / Math.max(bucketTotal, 1))}% of bucket value)`,
      };
      return m;
    }
  }

  return {
    confidence: "none",
    awards: [],
    diagnostics: { triedKeys, matchedKey, bucketSize: bucket.length, candidatesAfterTitle: 0 },
  };
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
    const naics = (a as any)["NAICS"];
    const naicsCode = typeof naics === "string"
      ? naics.split(" ")[0].trim()
      : (naics?.code || "");
    if (!naicsCode) continue;
    // Index by both sub-agency and top-tier (awarding agency) so SAM-side
    // lookups can probe at any level of the hierarchy.
    const buckets = new Set<string>();
    const sub = normAgency(a["Awarding Sub Agency"]);
    if (sub) buckets.add(sub);
    const top = normAgency((a as any)["Awarding Agency"]);
    if (top) buckets.add(top);
    for (const seg of buckets) {
      const key = `${seg}|${naicsCode}`;
      const arr = byAgencyNaics.get(key) ?? [];
      arr.push(a);
      byAgencyNaics.set(key, arr);
    }
  }
  return { byPiid, byParent, byAgencyNaics, titleTokens };
}

function summarize(
  confidence: "exact" | "parent" | "fuzzy" | "frequent",
  awards: HistoricalAward[],
): IncumbentMatch {
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
