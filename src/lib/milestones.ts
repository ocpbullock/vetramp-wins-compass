import { supabase } from "@/integrations/supabase/client";

export type MilestoneStatus = "upcoming" | "completed" | "overdue" | "skipped";

export type Milestone = {
  id: string;
  proposal_id: string;
  title: string;
  due_date: string;
  status: MilestoneStatus;
  assignee_id: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_MILESTONE_TEMPLATE: { title: string; offsetDays: number }[] = [
  { title: "Questions deadline", offsetDays: -14 },
  { title: "Pink team draft due", offsetDays: -10 },
  { title: "Pink team review", offsetDays: -8 },
  { title: "Red team draft due", offsetDays: -5 },
  { title: "Red team review", offsetDays: -3 },
  { title: "Final review & submit", offsetDays: -1 },
  { title: "Submission deadline", offsetDays: 0 },
];

export async function generateDefaultMilestones(proposalId: string, responseDeadline: string | null) {
  if (!responseDeadline) return;
  const deadline = new Date(responseDeadline);
  if (isNaN(deadline.getTime())) return;
  const rows = DEFAULT_MILESTONE_TEMPLATE.map((m, i) => {
    const due = new Date(deadline);
    due.setDate(due.getDate() + m.offsetDays);
    return {
      proposal_id: proposalId,
      title: m.title,
      due_date: due.toISOString(),
      status: "upcoming" as const,
      sort_order: i,
    };
  });
  const { error } = await supabase.from("proposal_milestones").insert(rows);
  if (error) console.error("[milestones] seed failed", error);
}

/**
 * Auto-mark `upcoming` milestones whose due_date is in the past as `overdue`.
 * Filtered by proposal IDs to keep the update narrow under RLS.
 */
export async function reconcileOverdue(proposalIds: string[]) {
  if (proposalIds.length === 0) return;
  await supabase
    .from("proposal_milestones")
    .update({ status: "overdue" })
    .in("proposal_id", proposalIds)
    .eq("status", "upcoming")
    .lt("due_date", new Date().toISOString());
}

export function daysUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function dotColor(m: { status: MilestoneStatus; due_date: string }) {
  if (m.status === "completed") return "bg-emerald-500";
  if (m.status === "skipped") return "bg-muted-foreground/40";
  if (m.status === "overdue") return "bg-destructive";
  const d = daysUntil(m.due_date);
  if (d < 0) return "bg-destructive";
  if (d <= 3) return "bg-amber-500";
  return "bg-muted-foreground/40";
}
