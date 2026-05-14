import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeam } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type PastPerformance = Tables<"past_performance">;

const CPARS_RATINGS = ["Exceptional", "Very Good", "Satisfactory", "Marginal", "Unsatisfactory", "Not Rated"] as const;

export function cparsBadgeVariant(rating?: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (rating === "Exceptional" || rating === "Very Good") return "default";
  if (rating === "Satisfactory") return "secondary";
  if (rating === "Marginal" || rating === "Unsatisfactory") return "destructive";
  return "outline";
}

export function cparsBadgeClass(rating?: string | null): string {
  if (rating === "Exceptional" || rating === "Very Good") return "bg-emerald-600 text-white hover:bg-emerald-600";
  if (rating === "Satisfactory") return "bg-amber-500 text-white hover:bg-amber-500";
  if (rating === "Marginal" || rating === "Unsatisfactory") return "bg-red-600 text-white hover:bg-red-600";
  return "";
}

function fmtMoney(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

export function PastPerformancePanel() {
  const { currentTeam, userRole } = useTeam();
  const canEdit = userRole === "owner" || userRole === "admin" || userRole === "member";
  const canDelete = userRole === "owner" || userRole === "admin";
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PastPerformance | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["past-performance", currentTeam?.id],
    enabled: !!currentTeam,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("past_performance")
        .select("*")
        .eq("team_id", currentTeam!.id)
        .order("period_of_performance_end", { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PastPerformance[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("past_performance").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Past performance removed");
      qc.invalidateQueries({ queryKey: ["past-performance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentTeam) return <Card className="p-6 text-sm text-muted-foreground">Pick a team first.</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Past performance library</h2>
          <p className="text-xs text-muted-foreground">Structured past performance entries reused across proposals.</p>
        </div>
        {canEdit && (
          <Button onClick={() => { setEditing(null); setOpen(true); }} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add past performance
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline animate-spin mr-1" /> Loading…</Card>
      ) : (data?.length ?? 0) === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No past performance entries yet. Add your first one to start matching to opportunities.</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data!.map((pp) => (
            <Card key={pp.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{pp.contract_title}</div>
                  <div className="text-xs text-muted-foreground">{pp.agency}{pp.sub_agency ? ` · ${pp.sub_agency}` : ""}</div>
                </div>
                {pp.cpars_rating && (
                  <Badge className={cparsBadgeClass(pp.cpars_rating)} variant="outline">{pp.cpars_rating}</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><span className="text-foreground">{fmtMoney(pp.total_value)}</span> total</div>
                <div>{pp.contract_type || "—"} · {pp.prime_or_sub || "—"}</div>
                <div>NAICS {pp.naics_code || "—"}</div>
                <div>{pp.period_of_performance_start || "?"} → {pp.period_of_performance_end || "?"}</div>
              </div>
              {pp.relevance_keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pp.relevance_keywords.slice(0, 8).map((k) => (
                    <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => { setEditing(pp); setOpen(true); }}>
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                )}
                {canDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive">
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete past performance?</AlertDialogTitle>
                        <AlertDialogDescription>This removes "{pp.contract_title}" from the library.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMut.mutate(pp.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <PastPerformanceDialog
          open={open}
          onOpenChange={setOpen}
          editing={editing}
          teamId={currentTeam.id}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["past-performance"] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PastPerformanceDialog({
  open, onOpenChange, editing, teamId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PastPerformance | null;
  teamId: string;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [form, setForm] = useState<Partial<PastPerformance>>(editing ?? {
    contract_title: "",
    agency: "",
    relevance_keywords: [],
    cpars_rating: "Not Rated",
    prime_or_sub: "prime",
  });
  const [keywordInput, setKeywordInput] = useState("");

  const set = <K extends keyof PastPerformance>(k: K, v: PastPerformance[K] | null) =>
    setForm((f) => ({ ...f, [k]: v as never }));

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.contract_title?.trim()) throw new Error("Contract title is required");
      if (!form.agency?.trim()) throw new Error("Agency is required");

      const payload: TablesInsert<"past_performance"> = {
        team_id: teamId,
        contract_title: form.contract_title!,
        agency: form.agency!,
        contract_number: form.contract_number || null,
        task_order_number: form.task_order_number || null,
        sub_agency: form.sub_agency || null,
        contract_type: form.contract_type || null,
        contract_vehicle: form.contract_vehicle || null,
        naics_code: form.naics_code || null,
        psc_code: form.psc_code || null,
        period_of_performance_start: form.period_of_performance_start || null,
        period_of_performance_end: form.period_of_performance_end || null,
        total_value: form.total_value ?? null,
        annual_value: form.annual_value ?? null,
        place_of_performance: form.place_of_performance || null,
        prime_or_sub: form.prime_or_sub || null,
        relevance_keywords: form.relevance_keywords ?? [],
        description: form.description || null,
        cpars_rating: form.cpars_rating || null,
        client_poc_name: form.client_poc_name || null,
        client_poc_title: form.client_poc_title || null,
        client_poc_phone: form.client_poc_phone || null,
        client_poc_email: form.client_poc_email || null,
        lessons_learned: form.lessons_learned || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("past_performance").update(payload).eq("id", editing!.id);
        if (error) throw new Error(error.message);
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase.from("past_performance").insert({ ...payload, created_by: u.user?.id });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Past performance updated" : "Past performance added");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addKeyword = () => {
    const k = keywordInput.trim();
    if (!k) return;
    if (form.relevance_keywords?.includes(k)) { setKeywordInput(""); return; }
    set("relevance_keywords", [...(form.relevance_keywords ?? []), k]);
    setKeywordInput("");
  };

  const removeKeyword = (k: string) =>
    set("relevance_keywords", (form.relevance_keywords ?? []).filter((x) => x !== k));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit past performance" : "Add past performance"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Contract title *</Label>
              <Input value={form.contract_title ?? ""} onChange={(e) => set("contract_title", e.target.value)} />
            </div>
            <div>
              <Label>Agency *</Label>
              <Input value={form.agency ?? ""} onChange={(e) => set("agency", e.target.value)} />
            </div>
            <div>
              <Label>Sub-agency</Label>
              <Input value={form.sub_agency ?? ""} onChange={(e) => set("sub_agency", e.target.value)} />
            </div>
            <div>
              <Label>Contract number</Label>
              <Input value={form.contract_number ?? ""} onChange={(e) => set("contract_number", e.target.value)} />
            </div>
            <div>
              <Label>Task order number</Label>
              <Input value={form.task_order_number ?? ""} onChange={(e) => set("task_order_number", e.target.value)} />
            </div>
            <div>
              <Label>Contract type</Label>
              <Select value={form.contract_type ?? ""} onValueChange={(v) => set("contract_type", v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {["FFP", "T&M", "CPFF", "CPIF", "IDIQ", "BPA", "Hybrid"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contract vehicle</Label>
              <Input value={form.contract_vehicle ?? ""} onChange={(e) => set("contract_vehicle", e.target.value)} placeholder="OASIS+, GSA Schedule, standalone…" />
            </div>
            <div>
              <Label>NAICS code</Label>
              <Input value={form.naics_code ?? ""} onChange={(e) => set("naics_code", e.target.value)} />
            </div>
            <div>
              <Label>PSC code</Label>
              <Input value={form.psc_code ?? ""} onChange={(e) => set("psc_code", e.target.value)} />
            </div>
            <div>
              <Label>Prime / sub</Label>
              <Select value={form.prime_or_sub ?? ""} onValueChange={(v) => set("prime_or_sub", v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prime">Prime</SelectItem>
                  <SelectItem value="subcontractor">Subcontractor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CPARS rating</Label>
              <Select value={form.cpars_rating ?? ""} onValueChange={(v) => set("cpars_rating", v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {CPARS_RATINGS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PoP start</Label>
              <Input type="date" value={form.period_of_performance_start ?? ""} onChange={(e) => set("period_of_performance_start", e.target.value)} />
            </div>
            <div>
              <Label>PoP end</Label>
              <Input type="date" value={form.period_of_performance_end ?? ""} onChange={(e) => set("period_of_performance_end", e.target.value)} />
            </div>
            <div>
              <Label>Total value (USD)</Label>
              <Input type="number" value={form.total_value ?? ""} onChange={(e) => set("total_value", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label>Annual value (USD)</Label>
              <Input type="number" value={form.annual_value ?? ""} onChange={(e) => set("annual_value", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div className="col-span-2">
              <Label>Place of performance</Label>
              <Input value={form.place_of_performance ?? ""} onChange={(e) => set("place_of_performance", e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Relevance keywords</Label>
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                placeholder="e.g. cybersecurity, cloud migration"
              />
              <Button type="button" variant="outline" onClick={addKeyword}>Add</Button>
            </div>
            {(form.relevance_keywords?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.relevance_keywords!.map((k) => (
                  <Badge key={k} variant="secondary" className="cursor-pointer" onClick={() => removeKeyword(k)}>
                    {k} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Description / narrative</Label>
            <Textarea rows={5} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)}
              placeholder="What was the scope, who was the customer, what did you deliver, what were the outcomes?" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Client POC name</Label>
              <Input value={form.client_poc_name ?? ""} onChange={(e) => set("client_poc_name", e.target.value)} />
            </div>
            <div>
              <Label>Client POC title</Label>
              <Input value={form.client_poc_title ?? ""} onChange={(e) => set("client_poc_title", e.target.value)} />
            </div>
            <div>
              <Label>Client POC phone</Label>
              <Input value={form.client_poc_phone ?? ""} onChange={(e) => set("client_poc_phone", e.target.value)} />
            </div>
            <div>
              <Label>Client POC email</Label>
              <Input type="email" value={form.client_poc_email ?? ""} onChange={(e) => set("client_poc_email", e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Lessons learned</Label>
            <Textarea rows={3} value={form.lessons_learned ?? ""} onChange={(e) => set("lessons_learned", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
