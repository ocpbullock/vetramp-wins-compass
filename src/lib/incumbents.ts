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
  confidence: "exact" | "parent" | "psc" | "fuzzy" | "frequent" | "none";
  awards: HistoricalAward[];
  topRecipient?: string;
  totalAmount?: number;
  latestEndDate?: string;
  similarity?: number;
  popExpiringSoon?: boolean; // any matched award PoP ends within ±9mo of opp deadline
  diagnostics?: {
    triedKeys: string[];
    matchedKey?: string;
    bucketSize: number;
    candidatesAfterTitle: number;
    note?: string;
    pscMatched?: string;
  };
};

export type IncumbentIndex = {
  byPiid: Map<string, HistoricalAward[]>;
  byParent: Map<string, HistoricalAward[]>;
  byAgencyNaics: Map<string, HistoricalAward[]>;
  byAgencyPsc: Map<string, HistoricalAward[]>;
  titleTokens: WeakMap<HistoricalAward, Set<string>>;
};

const TITLE_JACCARD_FLOOR = 0.30;
const TITLE_MIN_OVERLAP = 2;
const PSC_TITLE_MIN_OVERLAP = 1; // PSC is a strong signal — relax title bar
const POP_PROXIMITY_MS = 1000 * 60 * 60 * 24 * 270; // ±9 months
const BROAD_AGENCY_KEYS = new Set(["defense", "homeland security", "veterans affairs"]);

function opportunityAgencyKeys(fullPath?: string | null): string[] {
  const raw = (fullPath || "")
    .split(".")
    .map((s) => normAgency(s))
    .filter(Boolean)
    .reverse();
  const deduped = [...new Set(raw)];
  const specific = deduped.filter((key) => !BROAD_AGENCY_KEYS.has(key));
  return specific.length > 0 ? specific : deduped;
}

/**
 * Match a SAM opportunity against the historical award set to find the
 * incumbent contractor.
 *
 * Tiers (high → low confidence):
 *  - "exact"    → solicitation # matches award PIID directly
 *  - "parent"   → solicitation # matches an award's Parent Award ID (IDV)
 *  - "psc"      → same sub-agency + same PSC + ≥1 shared title token
 *  - "fuzzy"    → same sub-agency + NAICS + ≥30% title token overlap (≥2 shared)
 *  - "frequent" → same sub-agency + NAICS + a single recipient appears ≥3x
 *                 and holds ≥40% of bucket value (likely re-compete cycle)
 *
 * popExpiringSoon flag is set when any matched award's End Date lands within
 * ±9 months of the opportunity's response deadline — a strong recompete cue.
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
    if (exact.length > 0) return decorate(summarize("exact", exact), opp);

    const parent = sol ? idx.byParent.get(sol) ?? [] : [];
    if (parent.length > 0) return decorate(summarize("parent", parent), opp);
  }

  const path = opportunityAgencyKeys(opp.fullParentPathName);
  const naics = (opp.naicsCode || "").trim();
  const psc = (opp.classificationCode || "").trim().toUpperCase();
  const triedKeys: string[] = [];

  // ---- PSC tier: agency + PSC bucket, light title sanity check ----
  if (psc && path.length > 0) {
    for (const seg of path) {
      const key = `${seg}|PSC:${psc}`;
      triedKeys.push(key);
      const bucket = idx.byAgencyPsc.get(key);
      if (!bucket || bucket.length === 0) continue;
      const oppTokens = tokens(opp.title);
      const scored = bucket
        .map((a) => {
          let at = idx.titleTokens.get(a);
          if (!at) {
            at = tokens(a["Description"]);
            idx.titleTokens.set(a, at);
          }
          return { a, sim: jaccard(oppTokens, at), overlap: intersectionCount(oppTokens, at) };
        })
        .filter((x) => x.overlap >= PSC_TITLE_MIN_OVERLAP)
        .sort((x, y) => y.sim - x.sim);
      // If there's any signal at all, take it. PSC + same agency is rare enough.
      const picks = scored.length > 0 ? scored.slice(0, 5).map((s) => s.a) : bucket.slice(0, 5);
      const m = summarize("psc", picks);
      m.similarity = scored[0]?.sim;
      m.diagnostics = {
        triedKeys, matchedKey: key, bucketSize: bucket.length,
        candidatesAfterTitle: scored.length,
        pscMatched: psc,
        note: scored.length === 0 ? "PSC+agency match (no title overlap)" : undefined,
      };
      return decorate(m, opp);
    }
  }

  // ---- NAICS tier (existing behavior) ----
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
      return decorate(m, opp);
    }

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
      return decorate(m, opp);
    }
  }

  return {
    confidence: "none",
    awards: [],
    diagnostics: { triedKeys, matchedKey, bucketSize: bucket.length, candidatesAfterTitle: 0 },
  };
}

/** Adds the PoP-expiring-soon flag based on opportunity response deadline. */
function decorate(m: IncumbentMatch, opp: SamOpportunity): IncumbentMatch {
  const deadlineStr = opp.responseDeadLine || opp.postedDate;
  if (!deadlineStr || m.awards.length === 0) return m;
  const deadline = new Date(deadlineStr).getTime();
  if (!Number.isFinite(deadline)) return m;
  const expiring = m.awards.some((a) => {
    const end = a["End Date"] ? new Date(a["End Date"]).getTime() : NaN;
    return Number.isFinite(end) && Math.abs(end - deadline) <= POP_PROXIMITY_MS;
  });
  if (expiring) m.popExpiringSoon = true;
  return m;
}

export function buildIndex(awards: HistoricalAward[]): IncumbentIndex {
  const byPiid = new Map<string, HistoricalAward[]>();
  const byParent = new Map<string, HistoricalAward[]>();
  const byAgencyNaics = new Map<string, HistoricalAward[]>();
  const byAgencyPsc = new Map<string, HistoricalAward[]>();
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
    const psc = (a["Product or Service Code"] || "").trim().toUpperCase();
    const buckets = new Set<string>();
    const sub = normAgency(a["Awarding Sub Agency"]);
    if (sub) buckets.add(sub);
    const top = normAgency((a as any)["Awarding Agency"]);
    if (top) buckets.add(top);
    for (const seg of buckets) {
      if (naicsCode) {
        const key = `${seg}|${naicsCode}`;
        const arr = byAgencyNaics.get(key) ?? [];
        arr.push(a);
        byAgencyNaics.set(key, arr);
      }
      if (psc) {
        const key = `${seg}|PSC:${psc}`;
        const arr = byAgencyPsc.get(key) ?? [];
        arr.push(a);
        byAgencyPsc.set(key, arr);
      }
    }
  }
  return { byPiid, byParent, byAgencyNaics, byAgencyPsc, titleTokens };
}

function summarize(
  confidence: "exact" | "parent" | "psc" | "fuzzy" | "frequent",
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
