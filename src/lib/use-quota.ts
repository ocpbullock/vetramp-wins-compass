// Lightweight hooks for the dashboard quota meter and per-item refresh
// disabling. Read-only — presentation layer only. Both hooks tolerate a
// missing team (returns zero usage) and cache via react-query so the
// header meter and item-level refresh buttons share state.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamId } from "@/lib/team";

// Mirrors the limits documented in TangoUsagePanel — keep these in sync.
export const TANGO_DAILY_LIMIT = 100;
export const TANGO_MONTHLY_LIMIT = 3000;
// Treat the quota as "low" when fewer than 10 live calls remain in the day.
export const TANGO_LOW_REMAINING = 10;

export type TangoQuota = {
  loading: boolean;
  todayLive: number;
  dailyLimit: number;
  monthLive: number;
  monthlyLimit: number;
  remainingToday: number;
  percentToday: number;
  isLow: boolean;
  isExhausted: boolean;
};

export function useTangoQuota(overrideTeamId?: string | null): TangoQuota {
  const activeTeamId = useTeamId();
  const teamId = overrideTeamId === undefined ? activeTeamId : overrideTeamId;
  const { data, isLoading } = useQuery({
    queryKey: ["tango-quota", teamId],
    enabled: !!teamId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("tango_api_usage")
        .select("called_at, cached")
        .eq("team_id", teamId!)
        .gte("called_at", monthStart.toISOString())
        .order("called_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as { called_at: string; cached: boolean }[];
    },
  });

  const startOfDay = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const rows = data ?? [];
  const todayLive = rows.filter(
    (r) => !r.cached && new Date(r.called_at).getTime() >= startOfDay,
  ).length;
  const monthLive = rows.filter((r) => !r.cached).length;
  const remainingToday = Math.max(0, TANGO_DAILY_LIMIT - todayLive);
  const percentToday = Math.min(100, (todayLive / TANGO_DAILY_LIMIT) * 100);

  return {
    loading: isLoading,
    todayLive,
    dailyLimit: TANGO_DAILY_LIMIT,
    monthLive,
    monthlyLimit: TANGO_MONTHLY_LIMIT,
    remainingToday,
    percentToday,
    isLow: remainingToday <= TANGO_LOW_REMAINING && remainingToday > 0,
    isExhausted: remainingToday <= 0,
  };
}

export type AIBudget = {
  loading: boolean;
  mtdCost: number;
  budget: number;
  percent: number;
  over: boolean;
};

export function useAIBudget(): AIBudget {
  const { data, isLoading } = useQuery({
    queryKey: ["ai-budget-mtd"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [{ data: usage }, { data: auth }] = await Promise.all([
        supabase
          .from("ai_usage_log")
          .select("estimated_cost_usd, created_at")
          .gte("created_at", monthStart.toISOString())
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase.auth.getUser(),
      ]);
      let budget = 50;
      if (auth?.user) {
        const { data: settings } = await supabase
          .from("user_ai_settings")
          .select("monthly_ai_budget_usd")
          .eq("user_id", auth.user.id)
          .maybeSingle();
        if (settings?.monthly_ai_budget_usd != null) {
          budget = Number(settings.monthly_ai_budget_usd);
        }
      }
      const mtdCost = (usage ?? []).reduce(
        (s, r: any) => s + Number(r.estimated_cost_usd || 0),
        0,
      );
      return { mtdCost, budget };
    },
  });

  const mtdCost = data?.mtdCost ?? 0;
  const budget = data?.budget ?? 0;
  const percent = budget > 0 ? Math.min(100, (mtdCost / budget) * 100) : 0;
  return {
    loading: isLoading,
    mtdCost,
    budget,
    percent,
    over: budget > 0 && mtdCost > budget,
  };
}
