import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalIcon, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { daysUntil } from "@/lib/milestones";

type Row = {
  id: string;
  proposal_id: string;
  title: string;
  due_date: string;
  status: string;
  assignee_id: string | null;
  proposal: { opportunity_title: string | null; solicitation_number: string | null } | null;
};

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function DeadlinesWidget() {
  const { user } = useAuth();
  const { teamMembers } = useTeam();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      // Compute overdue at read-time instead of mutating the database from a
      // render path. A scheduled job (pg_cron) can persist the status if needed.
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 14);
      const { data, error } = await supabase
        .from("proposal_milestones")
        .select("id,proposal_id,title,due_date,status,assignee_id,proposal:proposals(opportunity_title,solicitation_number)")
        .in("status", ["upcoming", "overdue"])
        .lte("due_date", horizon.toISOString())
        .order("due_date", { ascending: true })
        .limit(20);
      if (!error) {
        const now = Date.now();
        const rows = ((data as any as Row[]) || []).map((r) =>
          r.status === "upcoming" && new Date(r.due_date).getTime() < now
            ? { ...r, status: "overdue" }
            : r,
        );
        setRows(rows);
      }
      setLoading(false);
    })();
  }, [user]);

  const memberById = new Map(teamMembers.map((m) => [m.user_id, m]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><CalIcon className="w-4 h-4" />Upcoming deadlines</CardTitle>
        <CardDescription className="text-xs">Milestones across all active proposals — next 14 days.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">No upcoming milestones in the next 14 days.</div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const d = daysUntil(r.due_date);
              const member = r.assignee_id ? memberById.get(r.assignee_id) : null;
              const dColor = d < 0 ? "text-destructive" : d <= 3 ? "text-amber-600" : "text-muted-foreground";
              const dLabel = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "today" : `${d}d`;
              return (
                <button
                  key={r.id}
                  onClick={() => navigate({ to: "/proposals/$proposalId", params: { proposalId: r.proposal_id } })}
                  className="w-full text-left flex items-center gap-3 py-2 hover:bg-accent/40 px-2 rounded"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {r.proposal?.opportunity_title || "Untitled proposal"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground font-mono">{format(new Date(r.due_date), "MMM d")}</span>
                    <Badge variant="outline" className={`text-[10px] ${dColor}`}>{dLabel}</Badge>
                    {member && (
                      <Avatar className="w-5 h-5"><AvatarFallback className="text-[9px]">{initials(member.display_name || member.email)}</AvatarFallback></Avatar>
                    )}
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
