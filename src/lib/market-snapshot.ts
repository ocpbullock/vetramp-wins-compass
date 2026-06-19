import { supabase } from "@/integrations/supabase/client";
import {
  searchUsaspending,
  getCompetitiveIntel,
  type HistoricalAward,
  type SamOpportunity,
  type CompetitiveIntel,
  type CompeteVendor,
} from "./api";
import { matchIncumbent, type IncumbentMatch } from "./incumbents";
import { deriveTeamingTargets, type TeamingTarget } from "./teaming-targets";
import { userContextFromProposal } from "./user-context";

export type MarketSnapshot = {
  version: 1;
  generatedAt: string;
  inputs: {
    naicsCodes: string[];
    agency: string | null;
    keyword: string | null;
    startDate: string;
    endDate: string;
  };
  historical: {
    totalAwards: number;
    totalValue: number;
    fetched: number;
    truncated: boolean;
    topVendors: { name: string; value: number; awards: number }[];
    byYear: { year: string; value: number; awards: number }[];
  };
  incumbent: IncumbentMatch | null;
  priorPrimes: TeamingTarget[];
  candidatePartners: TeamingTarget[];
  competitors: CompeteVendor[];
  competitiveIntelError?: string;
};

function samOppFromProposal(p: any): SamOpportunity {
  return {
    title: p.opportunity_title ?? undefined,
    solicitationNumber: p.solicitation_number ?? undefined,
    noticeId: p.notice_id ?? undefined,
    fullParentPathName: p.agency ?? undefined,
    naicsCode: p.naics_code ?? undefined,
    classificationCode: p.opportunity_data?.classificationCode ?? undefined,
    setAside: p.set_aside ?? undefined,
    typeOfSetAside: p.set_aside ?? undefined,
    postedDate: p.opportunity_data?.postedDate ?? undefined,
    responseDeadLine: p.response_deadline ?? undefined,
  };
}

function summarizeHistorical(results: HistoricalAward[]) {
  let totalValue = 0;
  const byVendor = new Map<string, { name: string; value: number; awards: number }>();
  const byYear = new Map<string, { year: string; value: number; awards: number }>();
  for (const a of results) {
    const v = Number(a["Award Amount"]) || 0;
    totalValue += v;
    const name = a["Recipient Name"] || "(unknown)";
    const cur = byVendor.get(name) ?? { name, value: 0, awards: 0 };
    cur.value += v; cur.awards += 1;
    byVendor.set(name, cur);
    const y = (a["Start Date"] || "").slice(0, 4);
    if (y) {
      const cy = byYear.get(y) ?? { year: y, value: 0, awards: 0 };
      cy.value += v; cy.awards += 1;
      byYear.set(y, cy);
    }
  }
  return {
    totalValue,
    topVendors: [...byVendor.values()].sort((a, b) => b.value - a.value).slice(0, 8),
    byYear: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)),
  };
}

/**
 * Run all market data pulls for an opportunity and assemble a snapshot.
 * Saves to proposals.market_snapshot + market_snapshot_at.
 */
export async function generateMarketSnapshot(proposal: any): Promise<MarketSnapshot> {
  const naicsCodes = proposal.naics_code ? [String(proposal.naics_code)] : [];
  const agency = proposal.agency ?? null;
  const keyword = proposal.opportunity_title ?? null;

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // 1) historical awards
  let results: HistoricalAward[] = [];
  let pageMeta: any = { total: 0, fetched: 0, hasNext: false, truncated: false };
  if (naicsCodes.length > 0) {
    try {
      const r = await searchUsaspending({
        naicsCodes,
        startDate,
        endDate,
        keyword: keyword ?? undefined,
        maxResults: 1000,
      });
      results = r.results ?? [];
      pageMeta = r.page_metadata ?? pageMeta;
    } catch (e) {
      // continue with empty awards
    }
  }

  const historicalSummary = summarizeHistorical(results);

  // 2) incumbent (run only if we have something to match against)
  let incumbent: IncumbentMatch | null = null;
  if (results.length > 0) {
    try {
      incumbent = matchIncumbent(samOppFromProposal(proposal), results);
    } catch { /* swallow */ }
  }

  // 3) prior primes & candidate partners
  const teamingTargets = deriveTeamingTargets(results, { agency, limit: 40 });
  const priorPrimes = teamingTargets.filter((t) => t.classification === "prime").slice(0, 15);
  const candidatePartners = teamingTargets.filter((t) => t.classification === "partner").slice(0, 25);

  // 4) competitive intel
  let competitors: CompeteVendor[] = [];
  let competitiveIntelError: string | undefined;
  if (proposal.team_id && proposal.naics_code && agency) {
    try {
      const ci: CompetitiveIntel = await getCompetitiveIntel({
        solicitationNumber: proposal.solicitation_number ?? undefined,
        title: proposal.opportunity_title ?? undefined,
        agency,
        naicsCode: String(proposal.naics_code),
        setAside: proposal.set_aside ?? undefined,
        postedDate: proposal.opportunity_data?.postedDate ?? undefined,
        responseDeadLine: proposal.response_deadline ?? undefined,
        teamId: proposal.team_id,
        userContext: userContextFromProposal(proposal),
      });
      competitors = (ci.marketLandscape?.vendors ?? []).slice(0, 15);
    } catch (e: any) {
      competitiveIntelError = e?.message ?? "Competitive intel unavailable";
    }
  }

  const snapshot: MarketSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    inputs: { naicsCodes, agency, keyword, startDate, endDate },
    historical: {
      totalAwards: pageMeta.total ?? results.length,
      totalValue: historicalSummary.totalValue,
      fetched: pageMeta.fetched ?? results.length,
      truncated: !!pageMeta.truncated,
      topVendors: historicalSummary.topVendors,
      byYear: historicalSummary.byYear,
    },
    incumbent,
    priorPrimes,
    candidatePartners,
    competitors,
    competitiveIntelError,
  };

  await supabase
    .from("proposals")
    .update({
      market_snapshot: snapshot as any,
      market_snapshot_at: snapshot.generatedAt,
    })
    .eq("id", proposal.id);

  return snapshot;
}

/** Fire-and-forget background generation (used after creating a proposal). */
export function kickOffMarketSnapshot(proposal: any): void {
  if (!proposal?.id || !proposal?.naics_code || !proposal?.agency) return;
  void generateMarketSnapshot(proposal).catch(() => {
    // best-effort; UI can regenerate manually
  });
}
