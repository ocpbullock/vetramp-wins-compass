import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, CheckCircle2, ListTodo, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTeam, type TeamMember } from "@/lib/team";

export type ActivityStatus = "open" | "in_progress" | "done" | "cancelled";

export type Activity = {
  id: string;
  proposal_id: string;
  team_id: string | null;
  title: string;
  detail: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  status: ActivityStatus;
  created_from_analysis: boolean | null;
  created_at: string;
};

const STATUS_LABEL: Record<ActivityStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

function statusDotClass(s: ActivityStatus, overdue: boolean) {
  if (s === "done") return "bg-emerald-500";
  if (s === "cancelled") return "bg-muted-foreground/40";
  if (s === "in_progress") return "bg-blue-500";
  if (overdue) return "bg-destructive";
  return "bg-amber-500";
}

function initials(m?: TeamMember | null) {
  if (!m) return "?";
  const src = m.display_name || m.email || "";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function daysUntil(due: string | null): number | null {
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = parseISO(due);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (24 * 3600 * 1000));
}

export function ActivitiesPanel({
  proposalId,
  teamId,
}: {
  proposalId: string;
  teamId: string | null;
}) {
  const { teamMembers } = useTeam();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newOwner, setNewOwner] = useState<string>("none");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("opportunity_activities" as any)
      .select("*")
      .eq("proposal_id", proposalId)
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems(((data as any[]) || []) as Activity[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [proposalId]);

  async function patchActivity(id: string, patch: Partial<Activity>) {
    setItems((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as Activity) : x)));
    const { error } = await supabase
      .from("opportunity_activities" as any)
      .update(patch)
      .eq("id", id);
    if (error) { toast.error(error.message); load(); }
  }

  async function addActivity() {
    if (!newTitle.trim()) return;
    const payload: any = {
      proposal_id: proposalId,
      team_id: teamId,
      title: newTitle.trim(),
      detail: newDetail.trim() || null,
      owner_user_id: newOwner === "none" ? null : newOwner,
      due_date: newDate || null,
      status: "open",
    };
    const { data, error } = await supabase
      .from("opportunity_activities" as any)
      .insert(payload)
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setItems((xs) => [...xs, data as unknown as Activity]);
    setNewTitle(""); setNewDetail(""); setNewDate(""); setNewOwner("none");
    setShowAdd(false);
  }

  async function removeActivity(id: string) {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    const { data, error } = await supabase
      .from("opportunity_activities" as any)
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      setItems(prev);
      toast.error(error.message);
      return;
    }
    if (!data || (data as any[]).length === 0) {
      setItems(prev);
      toast.error("You don't have permission to delete this activity");
    }
  }

  async function toggleComplete(a: Activity) {
    const next: ActivityStatus = a.status === "done" ? "open" : "done";
    await patchActivity(a.id, { status: next });
  }

  const memberById = new Map(teamMembers.map((m) => [m.user_id, m]));
  const open = items.filter((x) => x.status !== "done" && x.status !== "cancelled");
  const closed = items.filter((x) => x.status === "done" || x.status === "cancelled");

  function renderRow(a: Activity) {
    const member = a.owner_user_id ? memberById.get(a.owner_user_id) : null;
    const d = daysUntil(a.due_date);
    const overdue = a.status !== "done" && a.status !== "cancelled" && d !== null && d < 0;
    const dLabel =
      a.status === "done" ? "done" :
      a.status === "cancelled" ? "" :
      d === null ? "" :
      d < 0 ? `${Math.abs(d)}d overdue` :
      d === 0 ? "today" :
      `${d}d`;

    return (
      <li key={a.id} className="relative">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => toggleComplete(a)}
              className={`absolute -left-[1.4rem] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-background ${statusDotClass(a.status, overdue)}`}
              aria-label="Toggle complete"
            />
          </TooltipTrigger>
          <TooltipContent>{a.status === "done" ? "Reopen" : "Mark done"}</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={a.title}
            onChange={(e) => setItems((xs) => xs.map((x) => x.id === a.id ? { ...x, title: e.target.value } : x))}
            onBlur={(e) => patchActivity(a.id, { title: e.target.value })}
            className={`h-7 text-xs flex-1 min-w-[220px] border-transparent hover:border-border focus-visible:border-input ${a.status === "done" ? "line-through text-muted-foreground" : ""}`}
          />
          <Input
            type="date"
            value={a.due_date ?? ""}
            onChange={(e) => patchActivity(a.id, { due_date: e.target.value || null })}
            className="h-7 text-xs w-[140px]"
          />
          <span className={`text-[10px] font-mono w-16 text-right ${
            a.status === "done" ? "text-emerald-600" :
            overdue ? "text-destructive" :
            d !== null && d <= 3 ? "text-amber-600" : "text-muted-foreground"
          }`}>{dLabel}</span>
          <Select value={a.status} onValueChange={(v) => patchActivity(a.id, { status: v as ActivityStatus })}>
            <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as ActivityStatus[]).map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={a.owner_user_id || "none"}
            onValueChange={(v) => patchActivity(a.id, { owner_user_id: v === "none" ? null : v })}
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
          {a.created_from_analysis && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </TooltipTrigger>
              <TooltipContent>From capture analysis</TooltipContent>
            </Tooltip>
          )}
          <Button size="sm" variant="ghost" onClick={() => toggleComplete(a)} className="h-7 w-7 p-0">
            <CheckCircle2 className={`w-3.5 h-3.5 ${a.status === "done" ? "text-emerald-500" : "text-muted-foreground"}`} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => removeActivity(a.id)} className="h-7 w-7 p-0">
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        </div>
        {a.detail && (
          <div className="text-xs text-muted-foreground mt-1 ml-1 whitespace-pre-wrap">{a.detail}</div>
        )}
      </li>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ListTodo className="w-4 h-4" /> Activities
          </CardTitle>
          <CardDescription className="text-xs">
            Tasks, follow-ups, and action items for this opportunity.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="w-3.5 h-3.5 mr-1" />Add activity
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <div className="space-y-2 border border-dashed border-border rounded-md p-2">
            <div className="flex flex-wrap gap-2 items-center">
              <Input placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="h-8 text-xs flex-1 min-w-[220px]" />
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-8 text-xs w-[150px]" />
              <Select value={newOwner} onValueChange={setNewOwner}>
                <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teamMembers.map((tm) => <SelectItem key={tm.user_id} value={tm.user_id}>{tm.display_name || tm.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Detail (optional)"
              value={newDetail}
              onChange={(e) => setNewDetail(e.target.value)}
              rows={2}
              className="text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setNewTitle(""); setNewDetail(""); setNewDate(""); setNewOwner("none"); }}>Cancel</Button>
              <Button size="sm" onClick={addActivity}>Add</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-xs text-muted-foreground">Loading activities…</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground">No activities yet. Add tasks for follow-ups, calls, document requests, and decisions.</div>
        ) : (
          <TooltipProvider>
            {open.length > 0 && (
              <ol className="relative border-l-2 border-border ml-2 space-y-3 pl-4">
                {open.map(renderRow)}
              </ol>
            )}
            {closed.length > 0 && (
              <div className="pt-3">
                <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">Closed</Badge>
                  <span>{closed.length}</span>
                </div>
                <ol className="relative border-l-2 border-border ml-2 space-y-3 pl-4 opacity-70">
                  {closed.map(renderRow)}
                </ol>
              </div>
            )}
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

/** Helper to add an activity from external callers (e.g. capture analysis next actions). */
export async function addActivityFromAnalysis(args: {
  proposalId: string;
  teamId: string | null;
  title: string;
  detail?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const payload: any = {
    proposal_id: args.proposalId,
    team_id: args.teamId,
    title: args.title.slice(0, 500),
    detail: args.detail ?? null,
    status: "open",
    created_from_analysis: true,
  };
  const { error } = await supabase.from("opportunity_activities" as any).insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// silence unused import warning under some tsconfig
void format;
