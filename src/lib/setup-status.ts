import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamId } from "@/lib/team";
import { countPartnerCompanies } from "@/lib/companies";


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
        profileRes,
        kbRes,
        ppRes,
        cvRes,
        membersRes,
        partnersRes,
      ] = await Promise.all([
        supabase.from("company_profile").select("profile_data").limit(1).maybeSingle(),
        supabase.from("knowledge_base").select("id", { count: "exact", head: true }),
        supabase.from("past_performance").select("id", { count: "exact", head: true }),
        supabase.from("contract_vehicles").select("id", { count: "exact", head: true }),
        teamId
          ? supabase.from("team_members").select("id", { count: "exact", head: true }).eq("team_id", teamId)
          : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
        supabase.from("teaming_partners").select("id", { count: "exact", head: true }),
      ]);

      const profile = (profileRes.data?.profile_data ?? {}) as Record<string, unknown>;
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
        partnerCount: partnersRes.count ?? 0,
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
    coreComplete: d.profileComplete && d.ppCount > 0,
    loading: isLoading,
  };
}
