import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamId, useTeam } from "@/lib/team";
import { countPartnerCompanies, getOwnCompany, getOwnCompanyProfileData, type Company } from "@/lib/companies";


export type SetupItem = {
  key: string;
  label: string;
  done: boolean;
  required: boolean;
  href: string; // settings tab anchor
  hint?: string;
};

export type SetupStatus = {
  items: SetupItem[];
  requiredTotal: number;
  requiredDone: number;
  totalDone: number;
  total: number;
  percent: number;
  coreComplete: boolean; // company profile + past performance
  loading: boolean;
};

export function useSetupStatus(): SetupStatus {
  const teamId = useTeamId();

  const { data, isLoading } = useQuery({
    queryKey: ["setup-status", teamId],
    queryFn: async () => {
      const [
        profileData,
        kbRes,
        ppRes,
        cvRes,
        membersRes,
        partnerCount,
      ] = await Promise.all([
        teamId ? getOwnCompanyProfileData(teamId).catch(() => null) : Promise.resolve(null),
        supabase.from("knowledge_base").select("id", { count: "exact", head: true }),
        supabase.from("past_performance").select("id", { count: "exact", head: true }),
        supabase.from("contract_vehicles").select("id", { count: "exact", head: true }),
        teamId
          ? supabase.from("team_members").select("id", { count: "exact", head: true }).eq("team_id", teamId)
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        teamId ? countPartnerCompanies(teamId) : Promise.resolve(0),

      ]);

      const profile = (profileData ?? {}) as Record<string, unknown>;
      const profileComplete =
        !!(profile.legal_name && String(profile.legal_name).trim()) &&
        !!(profile.uei && String(profile.uei).trim()) &&
        !!(profile.cage && String(profile.cage).trim());

      return {
        profileComplete,
        kbCount: kbRes.count ?? 0,
        ppCount: ppRes.count ?? 0,
        cvCount: cvRes.count ?? 0,
        memberCount: membersRes.count ?? 0,
        partnerCount: partnerCount ?? 0,
      };
    },
    enabled: true,
    staleTime: 30_000,
  });

  const d = data ?? {
    profileComplete: false,
    kbCount: 0,
    ppCount: 0,
    cvCount: 0,
    memberCount: 0,
    partnerCount: 0,
  };

  const items: SetupItem[] = [
    {
      key: "company",
      label: "Company Profile",
      done: d.profileComplete,
      required: true,
      href: "/settings#company",
      hint: "Legal name, UEI, and CAGE",
    },
    {
      key: "knowledge",
      label: "Knowledge Base",
      done: d.kbCount > 0,
      required: true,
      href: "/settings#knowledge",
      hint: "At least one document uploaded",
    },
    {
      key: "past-performance",
      label: "Past Performance",
      done: d.ppCount > 0,
      required: true,
      href: "/settings#past-performance",
      hint: "At least one entry",
    },
    {
      key: "vehicles",
      label: "Contract Vehicles",
      done: d.cvCount > 0,
      required: true,
      href: "/settings#vehicles",
      hint: "At least one vehicle",
    },
    {
      key: "team",
      label: "Team",
      done: d.memberCount > 1,
      required: true,
      href: "/settings#team",
      hint: "Invite at least one teammate",
    },
    {
      key: "partners",
      label: "Teaming Partners",
      done: d.partnerCount > 0,
      required: false,
      href: "/settings#partners",
      hint: "Optional — add partners you team with",
    },
  ];

  const required = items.filter((i) => i.required);
  const requiredDone = required.filter((i) => i.done).length;
  const totalDone = items.filter((i) => i.done).length;
  const percent = required.length === 0 ? 0 : Math.round((requiredDone / required.length) * 100);

  return {
    items,
    requiredTotal: required.length,
    requiredDone,
    totalDone,
    total: items.length,
    percent,
    coreComplete: requiredDone === required.length,
    loading: isLoading,
  };
}

// ---------------------------------------------------------------------------
// Onboarding wizard state
// ---------------------------------------------------------------------------
// The 4-step onboarding screen surfaces a focused subset of the checklist
// (company profile + certs, NAICS, past performance, contract vehicles) and
// derives its done-flags from the unified `companies` own-company row rather
// than the legacy `company_profile` blob. Past performance and contract
// vehicles still come from their dedicated tables.

export type OnboardingStepKey = "company" | "naics" | "past_performance" | "vehicles";

export type OnboardingStep = {
  key: OnboardingStepKey;
  label: string;
  done: boolean;
  required: boolean;
  why: string;
};

export type OnboardingState = {
  loading: boolean;
  ownCompany: Company | null;
  steps: OnboardingStep[];
  /** Steps 1 + 2 done — after this the user may skip ahead. */
  coreDone: boolean;
  /** All 4 steps done. */
  allDone: boolean;
  /** Past performance entry exists; banner hides when true. */
  hasPastPerformance: boolean;
};

export function useOnboardingState(): OnboardingState {
  const teamId = useTeamId();
  const { data, isLoading } = useQuery({
    queryKey: ["onboarding-state", teamId],
    enabled: !!teamId,
    staleTime: 15_000,
    queryFn: async () => {
      const [own, ppRes, cvRes] = await Promise.all([
        getOwnCompany(teamId!).catch(() => null),
        supabase.from("past_performance").select("id", { count: "exact", head: true }).eq("team_id", teamId!),
        supabase.from("contract_vehicles").select("id", { count: "exact", head: true }).eq("team_id", teamId!),
      ]);
      return {
        ownCompany: own,
        ppCount: ppRes.count ?? 0,
        cvCount: cvRes.count ?? 0,
      };
    },
  });

  const own = data?.ownCompany ?? null;
  const hasCompanyName = !!(own?.name && own.name.trim() && own.name !== "Our Company");
  const hasCerts = (own?.certifications?.length ?? 0) > 0 || (own?.set_asides?.length ?? 0) > 0;
  const hasNaics = (own?.naics_codes?.length ?? 0) > 0;
  const ppCount = data?.ppCount ?? 0;
  const cvCount = data?.cvCount ?? 0;

  const steps: OnboardingStep[] = [
    {
      key: "company",
      label: "Company profile & certifications",
      done: hasCompanyName && hasCerts,
      required: true,
      why: "Drives set-aside eligibility scoring in pWin and partner matching.",
    },
    {
      key: "naics",
      label: "NAICS codes",
      done: hasNaics,
      required: true,
      why: "Used to match opportunities and score NAICS coverage in pWin.",
    },
    {
      key: "past_performance",
      label: "Past performance",
      done: ppCount > 0,
      required: false,
      why: "Past performance recency and relevance dominate pWin scoring.",
    },
    {
      key: "vehicles",
      label: "Contract vehicles",
      done: cvCount > 0,
      required: false,
      why: "Lets pWin credit vehicle access when an opportunity requires one.",
    },
  ];

  return {
    loading: isLoading,
    ownCompany: own,
    steps,
    coreDone: steps[0].done && steps[1].done,
    allDone: steps.every((s) => s.done),
    hasPastPerformance: ppCount > 0,
  };
}

/**
 * Gate hook used by the dashboard. Returns whether the onboarding screen
 * should take over the main content. The user may opt out (via the skip
 * button) once core steps 1+2 are complete; that choice persists per team.
 */
const SKIP_KEY = "vetramp:onboarding-skipped";

export function useOnboardingGate(): {
  loading: boolean;
  showOnboarding: boolean;
  state: OnboardingState;
  skip: () => void;
  resume: () => void;
  skipped: boolean;
} {
  const { currentTeam } = useTeam();
  const state = useOnboardingState();
  const [skipped, setSkipped] = useState<boolean>(false);

  useEffect(() => {
    if (!currentTeam) { setSkipped(false); return; }
    try {
      const raw = localStorage.getItem(SKIP_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      setSkipped(!!parsed[currentTeam.id]);
    } catch { setSkipped(false); }
  }, [currentTeam]);

  function writeSkip(value: boolean) {
    if (!currentTeam) return;
    try {
      const raw = localStorage.getItem(SKIP_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      parsed[currentTeam.id] = value;
      localStorage.setItem(SKIP_KEY, JSON.stringify(parsed));
    } catch { /* ignore */ }
    setSkipped(value);
  }

  // Onboarding screen shows when team is org-type and core steps are
  // incomplete OR the user has not yet skipped past optional steps.
  const isOrgTeam = !currentTeam || currentTeam.team_type === "organization";
  const wantsOnboarding = isOrgTeam && !state.loading && (!state.coreDone || (!state.allDone && !skipped));

  return {
    loading: state.loading,
    showOnboarding: wantsOnboarding,
    state,
    skip: () => writeSkip(true),
    resume: () => writeSkip(false),
    skipped,
  };
}
