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
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id ?? null;
  const isOppTeam = currentTeam?.team_type === "opportunity";
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);
  const inFlight = useRef<Set<string>>(new Set());

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
      if (isOppTeam) {
        toast.error("Starring isn't available in this team context — switch to your organization team");
        return;
      }
      if (inFlight.current.has(input.noticeId)) return;
      inFlight.current.add(input.noticeId);
      const wasStarred = starredIds.has(input.noticeId);
      try {
        if (wasStarred) {
          const { data: deleted, error } = await supabase
            .from("starred_opportunities")
            .delete()
            .eq("team_id", teamId)
            .eq("notice_id", input.noticeId)
            .select("id");
          if (error || !deleted || deleted.length === 0) {
            toast.error(error?.message ?? "You don't have permission to unstar this opportunity — ask a team owner/admin");
            return;
          }
          setStarredIds((cur) => {
            const next = new Set(cur);
            next.delete(input.noticeId);
            setCount(next.size);
            return next;
          });
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
            toast.error(error.message);
            return;
          }
          setStarredIds((cur) => {
            const next = new Set(cur);
            next.add(input.noticeId);
            setCount(next.size);
            return next;
          });
        }
      } finally {
        inFlight.current.delete(input.noticeId);
      }
    },
    [user, teamId, isOppTeam, starredIds],
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
