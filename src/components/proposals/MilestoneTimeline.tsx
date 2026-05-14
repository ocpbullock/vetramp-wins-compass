import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Calendar as CalIcon, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useTeam, type TeamMember } from "@/lib/team";
import {
  type Milestone, type MilestoneStatus,
  generateDefaultMilestones, reconcileOverdue, dotColor, daysUntil,
} from "@/lib/milestones";

function initials(m?: TeamMember | null) {
  if (!m) return "?";
  const src = m.display_name || m.email || "";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function MilestoneTimeline({
  proposalId,
  responseDeadline,
}: {
  proposalId: string;
  responseDeadline: string | null;
}) {
  const { teamMembers } = useTeam();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");

  async function load() {
    setLoading(true);
    await reconcileOverdue([proposalId]);
    const { data, error } = await supabase
      .from("proposal_milestones")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("due_date", { ascending: true });
    if (error) toast.error(error.message);
    else setMilestones((data as Milestone[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [proposalId]);

  async function seedDefaults() {
    if (!responseDeadline) { toast.error("Set a response deadline first"); return; }
    await generateDefaultMilestones(proposalId, responseDeadline);
    await load();
    toast.success("Default milestones added");
  }

  async function patchMilestone(id: string, patch: Partial<Milestone>) {
    setMilestones((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } as Milestone : m)));
    const { error } = await supabase.from("proposal_milestones").update(patch).eq("id", id);
    if (error) { toast.error(error.message); load(); }
  }

  async function toggleComplete(m: Milestone) {
    const next: MilestoneStatus = m.status === "completed" ? "upcoming" : "completed";
    await patchMilestone(m.id, { status: next });
  }

  async function removeMilestone(id: string) {
    setMilestones((ms) => ms.filter((m) => m.id !== id));
    const { error } = await supabase.from("proposal_milestones").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  async function addMilestone() {
    if (!newTitle.trim() || !newDate) return;
    const { data, error } = await supabase.from("proposal_milestones").insert({
      proposal_id: proposalId,
      title: newTitle.trim(),
      due_date: new Date(newDate).toISOString(),
      status: "upcoming" as const,
      sort_order: milestones.length,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setMilestones((ms) => [...ms, data as Milestone].sort((a, b) => a.due_date.localeCompare(b.due_date)));
    setNewTitle(""); setNewDate(""); setShowAdd(false);
  }

  const memberById = new Map(teamMembers.map((m) => [m.user_id, m]));

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><CalIcon className="w-4 h-4" />Milestones & deadlines</CardTitle>
          <CardDescription className="text-xs">Internal proposal milestones — click a dot to mark complete.</CardDescription>
        </div>
        <div className="flex gap-2">
          {milestones.length === 0 && responseDeadline && (
            <Button size="sm" variant="outline" onClick={seedDefaults}><RotateCcw className="w-3.5 h-3.5 mr-1" />Generate defaults</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}><Plus className="w-3.5 h-3.5 mr-1" />Add milestone</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <div className="flex flex-wrap gap-2 items-center border border-dashed border-border rounded-md p-2">
            <Input placeholder="Milestone title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="h-8 text-xs flex-1 min-w-[200px]" />
            <Input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-8 text-xs w-[200px]" />
            <Button size="sm" onClick={addMilestone}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        )}

        {loading ? (
          <div className="text-xs text-muted-foreground">Loading milestones…</div>
        ) : milestones.length === 0 ? (
          <div className="text-xs text-muted-foreground">No milestones yet. {responseDeadline ? "Click \"Generate defaults\" to seed a standard color-team schedule." : "Set a response deadline in Intake to enable default milestones."}</div>
        ) : (
          <TooltipProvider>
            <ol className="relative border-l-2 border-border ml-2 space-y-3 pl-4">
              {milestones.map((m) => {
                const member = m.assignee_id ? memberById.get(m.assignee_id) : null;
                const d = daysUntil(m.due_date);
                const dLabel = m.status === "completed" ? "done" :
                  d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "today" : `${d}d`;
                return (
                  <li key={m.id} className="relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => toggleComplete(m)}
                          className={`absolute -left-[1.4rem] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-background ${dotColor(m)}`}
                          aria-label="Toggle complete"
                        />
                      </TooltipTrigger>
                      <TooltipContent>{m.status === "completed" ? "Mark as upcoming" : "Mark complete"}</TooltipContent>
                    </Tooltip>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Input
                        value={m.title}
                        onChange={(e) => setMilestones((ms) => ms.map((x) => x.id === m.id ? { ...x, title: e.target.value } : x))}
                        onBlur={(e) => patchMilestone(m.id, { title: e.target.value })}
                        className={`h-7 text-xs flex-1 min-w-[180px] border-transparent hover:border-border focus-visible:border-input ${m.status === "completed" ? "line-through text-muted-foreground" : ""}`}
                      />
                      <Input
                        type="datetime-local"
                        value={format(new Date(m.due_date), "yyyy-MM-dd'T'HH:mm")}
                        onChange={(e) => patchMilestone(m.id, { due_date: new Date(e.target.value).toISOString() })}
                        className="h-7 text-xs w-[180px]"
                      />
                      <span className={`text-[10px] font-mono w-16 text-right ${
                        m.status === "completed" ? "text-emerald-600" :
                        d < 0 ? "text-destructive" :
                        d <= 3 ? "text-amber-600" : "text-muted-foreground"
                      }`}>{dLabel}</span>
                      <Select
                        value={m.assignee_id || "none"}
                        onValueChange={(v) => patchMilestone(m.id, { assignee_id: v === "none" ? null : v })}
                      >
                        <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {teamMembers.map((tm) => <SelectItem key={tm.user_id} value={tm.user_id}>{tm.display_name || tm.email}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {member && (
                        <Avatar className="w-6 h-6"><AvatarFallback className="text-[10px]">{initials(member)}</AvatarFallback></Avatar>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => toggleComplete(m)} className="h-7 w-7 p-0">
                        <CheckCircle2 className={`w-3.5 h-3.5 ${m.status === "completed" ? "text-emerald-500" : "text-muted-foreground"}`} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeMilestone(m.id)} className="h-7 w-7 p-0">
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
