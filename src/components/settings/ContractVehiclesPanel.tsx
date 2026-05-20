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
import { Loader2, Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type ContractVehicle = Tables<"contract_vehicles">;

export const COMMON_VEHICLES = [
  "OASIS+ SB Pool 1",
  "OASIS+ SB Pool 2",
  "OASIS+ SB Pool 3",
  "OASIS+ SB Pool 4",
  "OASIS+ SDVOSB",
  "OASIS+ 8(a)",
  "OASIS+ HUBZone",
  "OASIS+ WOSB",
  "8(a) STARS III",
  "Alliant 2 SB",
  "SEWP V",
  "CIO-SP3 SB",
  "POLARIS",
  "GSA MAS",
  "Other",
] as const;

const VEHICLE_TYPES = ["GWAC", "IDIQ", "BPA", "GSA Schedule", "Other"] as const;
const STATUSES = ["active", "pending", "expired"] as const;

function statusClass(s: string): string {
  if (s === "active") return "bg-emerald-600 text-white hover:bg-emerald-600";
  if (s === "pending") return "bg-amber-500 text-white hover:bg-amber-500";
  return "bg-red-600 text-white hover:bg-red-600";
}

function fmtMoney(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function countdown(end: string | null) {
  if (!end) return null;
  const days = Math.floor((new Date(end).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `Expired ${-days}d ago`;
  if (days <= 90) return `${days}d remaining`;
  return `${days}d remaining`;
}

export function ContractVehiclesPanel() {
  const { currentTeam, userRole } = useTeam();
  const canEdit = userRole === "owner" || userRole === "admin" || userRole === "member";
  const canDelete = userRole === "owner" || userRole === "admin";
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ContractVehicle | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["contract-vehicles", currentTeam?.id],
    enabled: !!currentTeam,
    staleTime: 30 * 60 * 1000, // Slow-moving reference data
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_vehicles")
        .select("*")
        .eq("team_id", currentTeam!.id)
        .order("vehicle_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as ContractVehicle[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contract_vehicles").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Vehicle removed");
      qc.invalidateQueries({ queryKey: ["contract-vehicles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentTeam) return <Card className="p-6 text-sm text-muted-foreground">Pick a team first.</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Contract vehicles</h2>
          <p className="text-xs text-muted-foreground">GWACs, IDIQs, BPAs, and Schedules your team holds.</p>
        </div>
        {canEdit && (
          <Button onClick={() => { setEditing(null); setOpen(true); }} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add vehicle
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline animate-spin mr-1" /> Loading…</Card>
      ) : (data?.length ?? 0) === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No vehicles yet. Add the GWACs, IDIQs, and Schedules your team holds so we can match opportunities to them.</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data!.map((v) => {
            const cd = countdown(v.period_of_performance_end);
            return (
              <Card key={v.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{v.vehicle_name}</div>
                    <div className="text-xs text-muted-foreground">{v.contract_number || "No contract #"} · {v.awarding_agency || "—"}</div>
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <Badge className={statusClass(v.status)} variant="outline">{v.status}</Badge>
                    {v.vehicle_type && <Badge variant="outline" className="text-[10px]">{v.vehicle_type}</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>Ceiling: <span className="text-foreground">{fmtMoney(v.ceiling_value)}</span></div>
                  <div>{v.period_of_performance_start || "?"} → {v.period_of_performance_end || "?"}</div>
                  {cd && <div className="col-span-2">{cd}</div>}
                </div>
                {v.naics_codes?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.naics_codes.slice(0, 10).map((n) => (
                      <Badge key={n} variant="outline" className="text-[10px] font-mono">{n}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-2 items-center">
                  {v.ordering_guide_url && (
                    <a href={v.ordering_guide_url} target="_blank" rel="noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1">
                      Ordering guide <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <div className="ml-auto flex gap-2">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => { setEditing(v); setOpen(true); }}>
                        <Pencil className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    )}
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove "{v.vehicle_name}"?</AlertDialogTitle>
                            <AlertDialogDescription>This removes the vehicle from your team's library.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMut.mutate(v.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {open && (
        <VehicleDialog
          open={open}
          onOpenChange={setOpen}
          editing={editing}
          teamId={currentTeam.id}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["contract-vehicles"] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function VehicleDialog({
  open, onOpenChange, editing, teamId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ContractVehicle | null;
  teamId: string;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const initialIsCustom = !!editing && !COMMON_VEHICLES.includes(editing.vehicle_name as typeof COMMON_VEHICLES[number]);
  const [usingOther, setUsingOther] = useState(initialIsCustom);
  const [presetName, setPresetName] = useState<string>(initialIsCustom ? "Other" : (editing?.vehicle_name ?? "OASIS+ SB Pool 1"));
  const [form, setForm] = useState<Partial<ContractVehicle>>(editing ?? {
    vehicle_name: "OASIS+ SB Pool 1",
    vehicle_type: "GWAC",
    status: "active",
    naics_codes: [],
  });
  const [naicsInput, setNaicsInput] = useState("");

  const set = <K extends keyof ContractVehicle>(k: K, v: ContractVehicle[K] | null) =>
    setForm((f) => ({ ...f, [k]: v as never }));

  const onPresetChange = (name: string) => {
    setPresetName(name);
    if (name === "Other") {
      setUsingOther(true);
      set("vehicle_name", "");
    } else {
      setUsingOther(false);
      set("vehicle_name", name);
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const finalName = usingOther ? (form.vehicle_name ?? "").trim() : presetName;
      if (!finalName) throw new Error("Vehicle name is required");

      const payload: TablesInsert<"contract_vehicles"> = {
        team_id: teamId,
        vehicle_name: finalName,
        vehicle_type: form.vehicle_type || null,
        contract_number: form.contract_number || null,
        awarding_agency: form.awarding_agency || null,
        period_of_performance_start: form.period_of_performance_start || null,
        period_of_performance_end: form.period_of_performance_end || null,
        ceiling_value: form.ceiling_value ?? null,
        naics_codes: form.naics_codes ?? [],
        status: form.status || "active",
        ordering_guide_url: form.ordering_guide_url || null,
        notes: form.notes || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("contract_vehicles").update(payload).eq("id", editing!.id);
        if (error) throw new Error(error.message);
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase.from("contract_vehicles").insert({ ...payload, created_by: u.user?.id });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Vehicle updated" : "Vehicle added");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNaics = () => {
    const n = naicsInput.trim();
    if (!n) return;
    if (form.naics_codes?.includes(n)) { setNaicsInput(""); return; }
    set("naics_codes", [...(form.naics_codes ?? []), n]);
    setNaicsInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contract vehicle" : "Add contract vehicle"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vehicle *</Label>
              <Select value={presetName} onValueChange={onPresetChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_VEHICLES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              {usingOther && (
                <Input
                  className="mt-2"
                  placeholder="Custom vehicle name"
                  value={form.vehicle_name ?? ""}
                  onChange={(e) => set("vehicle_name", e.target.value)}
                />
              )}
            </div>
            <div>
              <Label>Vehicle type</Label>
              <Select value={form.vehicle_type ?? ""} onValueChange={(v) => set("vehicle_type", v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contract number</Label>
              <Input value={form.contract_number ?? ""} onChange={(e) => set("contract_number", e.target.value)} placeholder="e.g. 47QRAA22D000X" />
            </div>
            <div>
              <Label>Awarding agency</Label>
              <Input value={form.awarding_agency ?? ""} onChange={(e) => set("awarding_agency", e.target.value)} placeholder="GSA, VA, NIH…" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status ?? "active"} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ceiling value (USD)</Label>
              <Input type="number" value={form.ceiling_value ?? ""} onChange={(e) => set("ceiling_value", e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <Label>PoP start</Label>
              <Input type="date" value={form.period_of_performance_start ?? ""} onChange={(e) => set("period_of_performance_start", e.target.value)} />
            </div>
            <div>
              <Label>PoP end</Label>
              <Input type="date" value={form.period_of_performance_end ?? ""} onChange={(e) => set("period_of_performance_end", e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Ordering guide URL</Label>
              <Input value={form.ordering_guide_url ?? ""} onChange={(e) => set("ordering_guide_url", e.target.value)} placeholder="https://…" />
            </div>
          </div>

          <div>
            <Label>NAICS codes covered</Label>
            <div className="flex gap-2">
              <Input
                value={naicsInput}
                onChange={(e) => setNaicsInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNaics(); } }}
                placeholder="e.g. 541512"
              />
              <Button type="button" variant="outline" onClick={addNaics}>Add</Button>
            </div>
            {(form.naics_codes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.naics_codes!.map((n) => (
                  <Badge key={n} variant="secondary" className="cursor-pointer font-mono"
                    onClick={() => set("naics_codes", (form.naics_codes ?? []).filter((x) => x !== n))}>
                    {n} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
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
