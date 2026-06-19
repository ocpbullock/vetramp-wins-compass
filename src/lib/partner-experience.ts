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

  const oppSetAsideIsSmall = isSmallBusinessSetAside(opportunity.set_aside);

  const ranked: PartnerExperienceTarget[] = targets.map((t) => {
    // agency experience: any of THIS recipient's awards touched the opp agency
    let agencyExperience = false;
    if (agencyLc) {
      agencyExperience = awards.some((a) => {
        const key = (a["Recipient UEI"] || a["Recipient Name"] || "").toUpperCase();
        const tKey = (t.uei || t.name).toUpperCase();
        return key === tKey && agencyMatches(a, agencyLc);
      });
    }

    const recencyMonths = monthsSince(t.latestAwardDate, now);

    let score = 0;
    score += volumeScore(t.awardCount, t.totalValue);          // up to 30
    score += recencyScore(recencyMonths);                       // up to 30
    if (agencyExperience) score += 25;                          // agency boost
    if (oppSetAsideIsSmall && t.isSmallBusiness) score += 10;   // set-aside match
    if (t.classification === "partner") score += 5;             // mild teaming bias

    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      ...t,
      agencyExperience,
      recencyMonths,
      relevanceScore: score,
    };
  });

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked;
}
