import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeamId } from "@/lib/team";

export type DeadlineKind = "milestone" | "response";

export type DeadlineItem = {
  id: string;
  kind: DeadlineKind;
  title: string;
  context: string; // e.g. proposal title, "Starred", "Tracked"
  dueDate: string; // ISO
  status: string;
  proposalId?: string | null;
  href?: string | null;
};

export function urgencyColor(daysOut: number): "red" | "amber" | "blue" {
  if (daysOut <= 7) return "red";
  if (daysOut <= 14) return "amber";
  return "blue";
}

export function urgencyClass(c: "red" | "amber" | "blue") {
  return c === "red" ? "bg-destructive" : c === "amber" ? "bg-amber-500" : "bg-blue-500";
}

export function daysUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export function useDeadlines() {
  const { user } = useAuth();
  const teamId = useTeamId();
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 90);

      // Milestones (active + overdue) for visible proposals
      const milestonesP = supabase
        .from("proposal_milestones")
        .select("id,proposal_id,title,due_date,status,proposal:proposals(opportunity_title)")
        .in("status", ["upcoming", "overdue"])
        .lte("due_date", horizon.toISOString())
        .order("due_date", { ascending: true });

      // Starred opportunity response deadlines
      let starredQ = supabase
        .from("starred_opportunities")
        .select("id,title,response_deadline,notice_id,team_id")
        .not("response_deadline", "is", null);
      if (teamId) starredQ = starredQ.eq("team_id", teamId);

      // Tracked opportunity deadlines
      let trackedQ = supabase
        .from("tracked_opportunities")
        .select("id,title,response_deadline,status,team_id,user_id")
        .not("response_deadline", "is", null);
      if (teamId) trackedQ = trackedQ.eq("team_id", teamId);
      else trackedQ = trackedQ.eq("user_id", user.id);

      const [m, s, t] = await Promise.all([milestonesP, starredQ, trackedQ]);
      if (cancelled) return;

      const out: DeadlineItem[] = [];
      const now = Date.now();
      for (const r of (m.data as any[]) ?? []) {
        const overdue = new Date(r.due_date).getTime() < now;
        out.push({
          id: `ms-${r.id}`,
          kind: "milestone",
          title: r.title,
          context: r.proposal?.opportunity_title ?? "Proposal",
          dueDate: r.due_date,
          status: overdue && r.status === "upcoming" ? "overdue" : r.status,
          proposalId: r.proposal_id,
          href: `/proposals/${r.proposal_id}`,
        });
      }
      for (const r of (s.data as any[]) ?? []) {
        out.push({
          id: `st-${r.id}`,
          kind: "response",
          title: r.title ?? r.notice_id,
          context: "Starred",
          dueDate: r.response_deadline,
          status: "watching",
          href: null,
        });
      }
      for (const r of (t.data as any[]) ?? []) {
        out.push({
          id: `tr-${r.id}`,
          kind: "response",
          title: r.title,
          context: "Tracked",
          dueDate: r.response_deadline,
          status: r.status ?? "Watching",
          href: null,
        });
      }
      out.sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));
      setItems(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, teamId]);

  return { items, loading };
}
