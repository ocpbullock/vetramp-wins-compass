// Pure ranking module: relevance of teaming candidates to a specific opportunity.
// Does NOT modify teaming-targets.ts — wraps it.

import type { HistoricalAward } from "./api";
import { deriveTeamingTargets, isSmallBusinessSetAside, type TeamingTarget } from "./teaming-targets";

export type PartnerExperienceOpportunity = {
  agency?: string | null;
  set_aside?: string | null;
};

export type PartnerExperienceTarget = TeamingTarget & {
  agencyExperience: boolean;
  recencyMonths: number | null;
  relevanceScore: number;
};

export type RankPartnerExperienceOpts = {
  hardFilterAgency?: boolean;
  limit?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
};

function monthsSince(date: string | null, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0;
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
}

function agencyMatches(award: HistoricalAward, agencyLc: string): boolean {
  return (
    (award["Awarding Agency"] || "").toLowerCase().includes(agencyLc) ||
    (award["Awarding Sub Agency"] || "").toLowerCase().includes(agencyLc)
  );
}

function volumeScore(awardCount: number, totalValue: number): number {
  // saturating: ~30 pts max
  const countPart = Math.min(15, Math.log10(Math.max(1, awardCount)) * 10);
  const valuePart = Math.min(15, Math.log10(Math.max(1, totalValue)) * 2);
  return countPart + valuePart;
}

function recencyScore(months: number | null): number {
  // 30 pts max; linear decay to 0 at 60 months (5 yr).
  if (months == null) return 0;
  if (months <= 0) return 30;
  if (months >= 60) return 0;
  return 30 * (1 - months / 60);
}

function scoreTarget(
  t: TeamingTarget,
  opportunity: PartnerExperienceOpportunity,
  agencyExperience: boolean,
  now: Date,
): PartnerExperienceTarget {
  const oppSetAsideIsSmall = isSmallBusinessSetAside(opportunity.set_aside);
  const recencyMonths = monthsSince(t.latestAwardDate, now);

  let score = 0;
  score += volumeScore(t.awardCount, t.totalValue);          // up to 30
  score += recencyScore(recencyMonths);                       // up to 30
  if (agencyExperience) score += 25;                          // agency boost
  if (oppSetAsideIsSmall && t.isSmallBusiness) score += 10;   // set-aside match
  if (t.classification === "partner") score += 5;             // mild teaming bias

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...t, agencyExperience, recencyMonths, relevanceScore: score };
}

export function rankPartnerExperience(
  awards: HistoricalAward[],
  opportunity: PartnerExperienceOpportunity,
  opts: RankPartnerExperienceOpts = {},
): PartnerExperienceTarget[] {
  const { hardFilterAgency = false, limit = 40, now = new Date() } = opts;
  const agency = opportunity.agency ?? null;
  const agencyLc = agency ? agency.toLowerCase() : null;

  const targets = deriveTeamingTargets(awards, {
    agency: hardFilterAgency ? agency : null,
    limit,
  });

  const ranked = targets.map((t) => {
    let agencyExperience = false;
    if (agencyLc) {
      agencyExperience = awards.some((a) => {
        const key = (a["Recipient UEI"] || a["Recipient Name"] || "").toUpperCase();
        const tKey = (t.uei || t.name).toUpperCase();
        return key === tKey && agencyMatches(a, agencyLc);
      });
    }
    return scoreTarget(t, opportunity, agencyExperience, now);
  });

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked;
}

/**
 * Rank pre-computed teaming targets (e.g. from a saved market_snapshot) without
 * raw awards. Caller indicates whether those targets already represent
 * agency-filtered awards (true => agencyExperience set on every result).
 */
export function rankPartnerExperienceFromTargets(
  targets: TeamingTarget[],
  opportunity: PartnerExperienceOpportunity,
  opts: { agencyExperienceForAll?: boolean; now?: Date } = {},
): PartnerExperienceTarget[] {
  const { agencyExperienceForAll = false, now = new Date() } = opts;
  const ranked = targets.map((t) =>
    scoreTarget(t, opportunity, agencyExperienceForAll, now),
  );
  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked;
}

// =====================================================================
// Dark horses: strong performers in ADJACENT NAICS (same 4-digit prefix)
// or at the same agency in different NAICS. Excludes firms that already
// have direct experience at the opportunity's exact NAICS.
// =====================================================================

export type DarkHorseTarget = PartnerExperienceTarget & {
  darkHorse: true;
  adjacentNaics: string[];
  sameAgencyValue: number;
};

const NAICS_PREFIX_LEN = 4;

export type RankDarkHorsesOpportunity = PartnerExperienceOpportunity & {
  naics_code: string;
};

export function rankDarkHorses(
  awards: HistoricalAward[],
  opportunity: RankDarkHorsesOpportunity,
  opts: RankPartnerExperienceOpts = {},
): DarkHorseTarget[] {
  const { limit = 40, now = new Date() } = opts;
  const oppNaics = (opportunity.naics_code || "").trim();
  if (!oppNaics) return [];
  const oppPrefix = oppNaics.slice(0, NAICS_PREFIX_LEN);
  const agencyLc = opportunity.agency ? opportunity.agency.toLowerCase() : null;

  // Agency-scope hard filter when an agency is provided.
  const scoped = agencyLc
    ? awards.filter((a) => agencyMatches(a, agencyLc))
    : awards;

  type Bucket = {
    name: string;
    uei: string | null;
    awardCount: number;
    totalValue: number;
    sameAgencyValue: number;
    latestAwardDate: string | null;
    latestSetAside: string | null;
    smallBizHits: number;
    descriptions: string[];
    hasExactNaics: boolean;
    adjacentNaics: Set<string>;
  };

  const byVendor = new Map<string, Bucket>();
  for (const a of scoped) {
    const name = a["Recipient Name"];
    if (!name) continue;
    const key = (a["Recipient UEI"] || name).toUpperCase();
    let b = byVendor.get(key);
    if (!b) {
      b = {
        name,
        uei: a["Recipient UEI"] ?? null,
        awardCount: 0,
        totalValue: 0,
        sameAgencyValue: 0,
        latestAwardDate: null,
        latestSetAside: null,
        smallBizHits: 0,
        descriptions: [],
        hasExactNaics: false,
        adjacentNaics: new Set(),
      };
      byVendor.set(key, b);
    }
    const amt = Number(a["Award Amount"]) || 0;
    b.awardCount += 1;
    b.totalValue += amt;
    const isAgency = agencyLc ? agencyMatches(a, agencyLc) : true;
    if (isAgency) b.sameAgencyValue += amt;
    const d = a["Start Date"] || null;
    if (d && (!b.latestAwardDate || d > b.latestAwardDate)) {
      b.latestAwardDate = d;
      b.latestSetAside = a["Type of Set Aside"] || b.latestSetAside;
    }
    if (isSmallBusinessSetAside(a["Type of Set Aside"])) b.smallBizHits += 1;
    if (a.Description && b.descriptions.length < 3) b.descriptions.push(a.Description);
    const n = (a.NAICS || "").trim();
    if (n) {
      if (n === oppNaics) b.hasExactNaics = true;
      else if (n.slice(0, NAICS_PREFIX_LEN) === oppPrefix) b.adjacentNaics.add(n);
    }
  }

  const oppSetAsideIsSmall = isSmallBusinessSetAside(opportunity.set_aside);
  const results: DarkHorseTarget[] = [];
  for (const b of byVendor.values()) {
    if (b.hasExactNaics) continue; // has direct experience — not a dark horse
    if (b.adjacentNaics.size === 0) continue; // no adjacency signal

    const recencyMonths = monthsSince(b.latestAwardDate, now);
    const isSmall = b.smallBizHits > 0;

    let score = 0;
    score += volumeScore(b.awardCount, b.sameAgencyValue); // up to 30
    score += recencyScore(recencyMonths);                    // up to 30
    score += Math.min(40, 15 + b.adjacentNaics.size * 12);   // up to 40
    if (oppSetAsideIsSmall && isSmall) score += 5;
    score = Math.max(0, Math.min(100, Math.round(score)));

    results.push({
      name: b.name,
      uei: b.uei,
      totalValue: b.totalValue,
      awardCount: b.awardCount,
      latestAwardDate: b.latestAwardDate,
      latestSetAside: b.latestSetAside,
      isSmallBusiness: isSmall,
      classification: !isSmall && b.totalValue >= 10_000_000 ? "prime" : "partner",
      sampleDescriptions: b.descriptions,
      agencyExperience: b.sameAgencyValue > 0,

      recencyMonths,
      relevanceScore: score,
      darkHorse: true,
      adjacentNaics: Array.from(b.adjacentNaics),
      sameAgencyValue: b.sameAgencyValue,
    });
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results.slice(0, limit);
}

