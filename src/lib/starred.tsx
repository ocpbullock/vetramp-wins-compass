import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { toast } from "sonner";
import type { SamOpportunity } from "@/lib/api";

export type StarredRow = {
  id: string;
  team_id: string;
  user_id: string;
  notice_id: string;
  title: string | null;
  naics_code: string | null;
  response_deadline: string | null;
  posted_date: string | null;
  set_aside_description: string | null;
  source_data: any;
  created_at: string;
};

type Ctx = {
  starredIds: Set<string>;
  count: number;
  loading: boolean;
  isStarred: (noticeId: string) => boolean;
  toggle: (input: StarToggleInput) => Promise<void>;
  reload: () => Promise<void>;
  list: () => Promise<StarredRow[]>;
};

export type StarToggleInput = {
  noticeId: string;
  title?: string | null;
  naicsCode?: string | null;
  responseDeadline?: string | null;
  postedDate?: string | null;
  setAsideDescription?: string | null;
  sourceData?: unknown;
};

const StarredContext = createContext<Ctx | null>(null);

export function StarredProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const teamId = useTeamId();
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!user || !teamId) {
      setStarredIds(new Set());
      setCount(0);
      return;
    }
    const myReq = ++reqRef.current;
    setLoading(true);
    const { data, error } = await supabase
      .from("starred_opportunities")
      .select("notice_id")
      .eq("team_id", teamId);
    if (myReq !== reqRef.current) return;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const ids = new Set<string>((data ?? []).map((r: any) => r.notice_id));
    setStarredIds(ids);
    setCount(ids.size);
  }, [user, teamId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const list = useCallback(async (): Promise<StarredRow[]> => {
    if (!user || !teamId) return [];
    const { data, error } = await supabase
      .from("starred_opportunities")
      .select("*")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return [];
    }
    return (data ?? []) as StarredRow[];
  }, [user, teamId]);

  const isStarred = useCallback((noticeId: string) => starredIds.has(noticeId), [starredIds]);

  const toggle = useCallback(
    async (input: StarToggleInput) => {
      if (!user) {
        toast.error("Sign in to star opportunities");
        return;
      }
      if (!teamId) {
        toast.error("No team selected");
        return;
      }
      const wasStarred = starredIds.has(input.noticeId);
      // Optimistic
      const next = new Set(starredIds);
      if (wasStarred) next.delete(input.noticeId);
      else next.add(input.noticeId);
      setStarredIds(next);
      setCount(next.size);

      if (wasStarred) {
        const { data: deleted, error } = await supabase
          .from("starred_opportunities")
          .delete()
          .eq("team_id", teamId)
          .eq("notice_id", input.noticeId)
          .select("id");
        if (error || !deleted || deleted.length === 0) {
          // Roll back
          setStarredIds(starredIds);
          setCount(starredIds.size);
          toast.error(error?.message ?? "You don't have permission to unstar this opportunity — ask a team owner/admin");
        }
      } else {
        const { error } = await supabase.from("starred_opportunities").insert({
          team_id: teamId,
          user_id: user.id,
          notice_id: input.noticeId,
          title: input.title ?? null,
          naics_code: input.naicsCode ?? null,
          response_deadline: input.responseDeadline ?? null,
          posted_date: input.postedDate ?? null,
          set_aside_description: input.setAsideDescription ?? null,
          source_data: (input.sourceData ?? null) as any,
        });
        if (error) {
          setStarredIds(starredIds);
          setCount(starredIds.size);
          toast.error(error.message);
        }
      }
    },
    [user, teamId, starredIds],
  );

  const value = useMemo<Ctx>(
    () => ({ starredIds, count, loading, isStarred, toggle, reload, list }),
    [starredIds, count, loading, isStarred, toggle, reload, list],
  );

  return <StarredContext.Provider value={value}>{children}</StarredContext.Provider>;
}

export function useStarred() {
  const ctx = useContext(StarredContext);
  if (!ctx) throw new Error("useStarred must be used within <StarredProvider>");
  return ctx;
}

/** Convenience: build the toggle input from a SAM opportunity. */
export function starInputFromSam(o: SamOpportunity): StarToggleInput {
  const noticeId = (o.solicitationNumber || o.noticeId || "") as string;
  return {
    noticeId,
    title: o.title ?? null,
    naicsCode: o.naicsCode ?? null,
    responseDeadline: o.responseDeadLine ?? null,
    postedDate: o.postedDate ?? null,
    setAsideDescription: o.setAside ?? o.typeOfSetAside ?? null,
    sourceData: o,
  };
}
