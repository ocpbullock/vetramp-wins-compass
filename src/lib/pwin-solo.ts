// Solo-prime pWin helpers for opportunity triage.
// Computes a quick pWin score for an opportunity assuming the user primes
// solo, using their own-company profile + past performance from the
// `companies` table and `past_performance`.
//
// Results are cached per opportunity via React Query and invalidated when
// the company profile or past performance changes (via queryKey prefixes
// `pwin-self` and `pwin-solo`).

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOwnCompany, type Company } from "@/lib/companies";
import {
  calculatePwin,
  type PwinContext,
  type PwinResult,
  type PwinTeamMember,
} from "@/lib/pwin";

export type SoloPwinSelf = {
  ownCompany: Company | null;
  vehicles: string[];
  pastPerf: Array<{
    naics?: string | null;
    agency?: string | null;
    end?: string | null;
    keywords?: string[];
  }>;
};

export type OppForPwin = {
  /** Stable cache key (notice/star/tracked id). */
  id: string;
  naics?: string | null;
  agency?: string | null;
  setAside?: string | null;
  vehicle?: string | null;
  keywords?: string[];
};

export function pwinChipTone(score: number): {
  bg: string;
  text: string;
  label: "green" | "amber" | "red";
} {
  if (score > 55) {
    return {
      bg: "bg-emerald-500/15 border-emerald-500/40",
      text: "text-emerald-700 dark:text-emerald-400",
      label: "green",
    };
  }
  if (score >= 30) {
    return {
      bg: "bg-amber-500/15 border-amber-500/40",
      text: "text-amber-700 dark:text-amber-400",
      label: "amber",
    };
  }
  return {
    bg: "bg-red-500/15 border-red-500/40",
    text: "text-red-700 dark:text-red-400",
    label: "red",
  };
}

/**
 * True when the own-company profile lacks the capability data needed for a
 * meaningful pWin computation. Used to surface the "Set up profile to score"
 * chip instead of a misleading low number.
 */
export function hasUsableCapabilities(self: SoloPwinSelf | null | undefined): boolean {
  if (!self || !self.ownCompany) return false;
  const c = self.ownCompany;
  const hasCerts = (c.certifications?.length ?? 0) > 0
    || (c.set_asides?.length ?? 0) > 0;
  const hasNaics = (c.naics_codes?.length ?? 0) > 0;
  const hasNarrative = !!(c.capabilities_narrative && c.capabilities_narrative.trim());
  return hasCerts || hasNaics || hasNarrative;
}

export function useSoloPwinSelf(teamId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["pwin-self", teamId],
    enabled: !!teamId && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SoloPwinSelf> => {
      const [own, vehRes, ppRes] = await Promise.all([
        getOwnCompany(teamId!).catch(() => null),
        supabase
          .from("contract_vehicles")
          .select("vehicle_name")
          .eq("team_id", teamId!)
          .eq("status", "active"),
        supabase
          .from("past_performance")
          .select("naics_code, agency, period_of_performance_end, relevance_keywords")
          .eq("team_id", teamId!),
      ]);
      return {
        ownCompany: own,
        vehicles: (vehRes.data ?? []).map((v: any) => v.vehicle_name).filter(Boolean),
        pastPerf: (ppRes.data ?? []).map((p: any) => ({
          naics: p.naics_code,
          agency: p.agency,
          end: p.period_of_performance_end,
          keywords: p.relevance_keywords ?? [],
        })),
      };
    },
  });
}

export function buildSelfMember(self: SoloPwinSelf): PwinTeamMember | null {
  const c = self.ownCompany;
  if (!c) return null;
  return {
    id: "self",
    name: c.name || "Your company",
    isSelf: true,
    role: "prime",
    workShare: 100,
    active: true,
    certifications: [
      ...(c.certifications ?? []),
      ...(c.set_asides ?? []),
    ],
    naicsCodes: c.naics_codes ?? [],
    contractVehicles: [
      ...(c.contract_vehicles ?? []),
      ...self.vehicles,
    ],
    pastPerformance: self.pastPerf,
  };
}

export function buildContextForOpp(opp: OppForPwin): PwinContext {
  return {
    engagementType: "prime",
    relationshipModel: "prime_with_subs",
    opportunityNaics: opp.naics ? [opp.naics] : [],
    opportunityAgency: opp.agency ?? null,
    setAside: opp.setAside ?? null,
    requiredVehicles: opp.vehicle ? [opp.vehicle] : [],
    scopeKeywords: opp.keywords ?? [],
    incumbentName: null,
  };
}

export function computeSoloPwin(
  self: SoloPwinSelf,
  opp: OppForPwin,
): PwinResult | null {
  const member = buildSelfMember(self);
  if (!member) return null;
  const ctx = buildContextForOpp(opp);
  return calculatePwin(ctx, [member]);
}

/** Invalidate every pWin cache (self + per-opp results). */
export function invalidatePwinCaches(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["pwin-self"] });
  qc.invalidateQueries({ queryKey: ["pwin-solo"] });
}
