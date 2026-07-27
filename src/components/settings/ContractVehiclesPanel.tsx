import { useEffect, useState } from "react";
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
import { Loader2, Plus, Pencil, Trash2, ExternalLink, Search, Link2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  if (s === "active") return "bg-success text-success-foreground hover:bg-success";
  if (s === "pending") return "bg-warning text-warning-foreground hover:bg-warning";
  return "bg-destructive text-destructive-foreground hover:bg-destructive";
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

      <VehicleRegistrySection teamId={currentTeam.id} canEdit={canEdit} />
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

// ---------------------------------------------------------------------------
// Vehicle registry section — global seed + team-added catalog with awardees.
// ---------------------------------------------------------------------------

type RegistryVehicle = Tables<"vehicle_registry">;
type Awardee = Tables<"vehicle_awardees">;

const REGISTRY_TYPES = [
  { value: "gwac", label: "GWAC" },
  { value: "agency_idiq", label: "Agency IDIQ" },
  { value: "bpa", label: "BPA" },
  { value: "schedule", label: "GSA Schedule" },
  { value: "other", label: "Other" },
] as const;

function VehicleRegistrySection({ teamId, canEdit }: { teamId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [agencyFilter, setAgencyFilter] = useState<string>("__all__");
  const [showExpired, setShowExpired] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "agency" | "recent">("name");
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicle-registry", teamId],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<RegistryVehicle[]> => {
      const { data, error } = await supabase
        .from("vehicle_registry")
        .select("*")
        .order("vehicle_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as RegistryVehicle[];
    },
  });

  // Held vehicles (for "our team holds" indicator).
  const { data: heldNames = new Set<string>() } = useQuery({
    queryKey: ["contract-vehicles-names", teamId],
    enabled: !!teamId,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("contract_vehicles")
        .select("vehicle_name")
        .eq("team_id", teamId);
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((r) => (r.vehicle_name || "").trim().toLowerCase()));
    },
  });

  const agencyOptions = Array.from(
    new Set(vehicles.map((v) => (v.managing_agency ?? "").trim()).filter(Boolean)),
  ).sort();

  const filtered = vehicles
    .filter((v) => {
      if (!showExpired && (v.status ?? "").toLowerCase() === "expired") return false;
      if (typeFilter && v.vehicle_type !== typeFilter) return false;
      if (agencyFilter !== "__all__" && (v.managing_agency ?? "") !== agencyFilter) return false;
      const s = search.trim().toLowerCase();
      if (!s) return true;
      return [v.vehicle_name, v.managing_agency, v.vehicle_type, v.description]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(s));
    })
    .sort((a, b) => {
      if (sortBy === "agency") {
        return (a.managing_agency ?? "").localeCompare(b.managing_agency ?? "")
          || a.vehicle_name.localeCompare(b.vehicle_name);
      }
      if (sortBy === "recent") {
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      }
      return a.vehicle_name.localeCompare(b.vehicle_name);
    });

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-3 pt-6 border-t">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold">Vehicle registry</h2>
          <p className="text-xs text-muted-foreground">Global seed vehicles plus vehicles your team tracks — with awardee pools.</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-1" /> Add vehicle</Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name, agency, description…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs h-9"
        />
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant={typeFilter === null ? "default" : "outline"}
            onClick={() => setTypeFilter(null)}
          >
            All types
          </Button>
          {REGISTRY_TYPES.map((t) => (
            <Button
              key={t.value}
              type="button"
              size="sm"
              variant={typeFilter === t.value ? "default" : "outline"}
              onClick={() => setTypeFilter(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <Select value={agencyFilter} onValueChange={setAgencyFilter}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Any agency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Any managing agency</SelectItem>
            {agencyOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name A–Z</SelectItem>
            <SelectItem value="agency">Sort: Managing agency</SelectItem>
            <SelectItem value="recent">Sort: Recently added</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
          Show expired
        </label>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} vehicle{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline animate-spin mr-1" /> Loading…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No vehicles match.</Card>
      ) : (
        <>
          <div className="space-y-2">
            {visible.map((v) => {
              const predecessor = v.predecessor_id
                ? vehicles.find((x) => x.id === v.predecessor_id) ?? null
                : null;
              const successor = vehicles.find((x) => x.predecessor_id === v.id) ?? null;
              return (
                <RegistryVehicleRow
                  key={v.id}
                  vehicle={v}
                  expanded={expanded === v.id}
                  onToggle={() => setExpanded((cur) => (cur === v.id ? null : v.id))}
                  teamId={teamId}
                  canEditVehicle={canEdit && v.team_id === teamId}
                  canManageAwardees={canEdit}
                  held={heldNames.has(v.vehicle_name.trim().toLowerCase())}
                  predecessorName={predecessor?.vehicle_name ?? null}
                  successorName={successor?.vehicle_name ?? null}
                  onLineageClick={(name) => setSearchInput(name)}
                  onDeleted={() => qc.invalidateQueries({ queryKey: ["vehicle-registry", teamId] })}
                />
              );
            })}

          </div>
          {filtered.length > visible.length && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + 50)}>
                Show more ({filtered.length - visible.length} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {addOpen && (
        <RegistryVehicleDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          teamId={teamId}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["vehicle-registry", teamId] });
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function registryStatusBadgeClass(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active") return "bg-success text-success-foreground";
  if (s === "upcoming") return "bg-accent text-accent-foreground";
  if (s === "expired") return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}

function RegistryVehicleRow({
  vehicle, expanded, onToggle, teamId, canEditVehicle, canManageAwardees, held = false, onDeleted,
}: {
  vehicle: RegistryVehicle;
  expanded: boolean;
  onToggle: () => void;
  teamId: string;
  canEditVehicle: boolean;
  canManageAwardees: boolean;
  held?: boolean;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [addAwardeeOpen, setAddAwardeeOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const { data: awardees = [], isLoading } = useQuery({
    queryKey: ["vehicle-awardees", vehicle.id, teamId],
    enabled: expanded,
    queryFn: async (): Promise<Awardee[]> => {
      const { data, error } = await supabase
        .from("vehicle_awardees")
        .select("*")
        .eq("vehicle_id", vehicle.id)
        .order("company_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Awardee[];
    },
  });

  const invalidateAwardees = () => qc.invalidateQueries({ queryKey: ["vehicle-awardees", vehicle.id, teamId] });

  const deleteVehicle = async () => {
    const { error } = await supabase.from("vehicle_registry").delete().eq("id", vehicle.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Vehicle removed");
    onDeleted();
  };

  const deleteAwardee = async (id: string) => {
    const { error } = await supabase.from("vehicle_awardees").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    invalidateAwardees();
  };

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onToggle} className="flex-1 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{vehicle.vehicle_name}</span>
            {vehicle.team_id === null && <Badge variant="outline" className="text-[10px]">global</Badge>}
            {vehicle.vehicle_type && <Badge variant="secondary" className="text-[10px]">{vehicle.vehicle_type}</Badge>}
            {vehicle.status && <Badge className={`text-[10px] ${registryStatusBadgeClass(vehicle.status)}`} variant="outline">{vehicle.status}</Badge>}
            {held && <Badge className="text-[10px] bg-primary/10 text-primary border-primary/30" variant="outline">Our team holds</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {vehicle.managing_agency ?? "—"}
            {vehicle.url && <> · <a href={vehicle.url} target="_blank" rel="noreferrer" className="text-primary underline" onClick={(e) => e.stopPropagation()}>site</a></>}
          </div>
        </button>
        {canEditVehicle && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteVehicle}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs font-semibold text-muted-foreground">Awardees ({awardees.length})</div>
            {canManageAwardees && (
              <div className="flex gap-1 flex-wrap">
                <AnnouncementSearchMenu vehicleName={vehicle.vehicle_name} />
                <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}>AI research awardees</Button>
                <Button size="sm" variant="outline" onClick={() => setCsvOpen(true)}>Import CSV / Excel</Button>
                <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>Bulk paste</Button>
                <Button size="sm" onClick={() => setAddAwardeeOpen(true)}><Plus className="w-3 h-3 mr-1" /> Add awardee</Button>
              </div>
            )}
          </div>
          {isLoading ? (
            <div className="text-xs text-muted-foreground"><Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Loading…</div>
          ) : awardees.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              No awardees recorded. Use "Add awardee", "Bulk paste", CSV/Excel, or "AI research awardees".
            </div>
          ) : (
            <div className="divide-y">
              {awardees.map((a) => {
                const isOurTeamRow = (a as any).team_id === teamId;
                return (
                  <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate flex items-center gap-1.5">
                        {a.company_name}
                        {(a as any).team_id === null && <Badge variant="outline" className="text-[9px]">global</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 items-center">
                        {a.uei && <span className="font-mono">{a.uei}</span>}
                        {a.small_business && <Badge variant="outline" className="text-[10px]">SB</Badge>}
                        {(a.socioeconomic ?? []).map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </div>
                    {canManageAwardees && isOurTeamRow && (
                      <Button size="sm" variant="ghost" className="text-destructive h-7 w-7 p-0" onClick={() => deleteAwardee(a.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {addAwardeeOpen && (
            <AddAwardeeDialog
              vehicleId={vehicle.id}
              teamId={teamId}
              open={addAwardeeOpen}
              onOpenChange={setAddAwardeeOpen}
              onSaved={() => { invalidateAwardees(); setAddAwardeeOpen(false); }}
            />
          )}
          {bulkOpen && (
            <BulkAwardeesDialog
              vehicleId={vehicle.id}
              teamId={teamId}
              open={bulkOpen}
              onOpenChange={setBulkOpen}
              onSaved={() => { invalidateAwardees(); setBulkOpen(false); }}
            />
          )}
          {csvOpen && (
            <CsvImportAwardeesDialog
              vehicleId={vehicle.id}
              teamId={teamId}
              existing={awardees}
              open={csvOpen}
              onOpenChange={setCsvOpen}
              onSaved={() => { invalidateAwardees(); setCsvOpen(false); }}
            />
          )}
          {aiOpen && (
            <AiResearchAwardeesDialog
              vehicle={vehicle}
              teamId={teamId}
              existing={awardees}
              open={aiOpen}
              onOpenChange={setAiOpen}
              onSaved={() => { invalidateAwardees(); setAiOpen(false); }}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function RegistryVehicleDialog({
  open, onOpenChange, teamId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teamId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("gwac");
  const [agency, setAgency] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    const { error } = await supabase.from("vehicle_registry").insert({
      team_id: teamId,
      vehicle_name: name.trim(),
      vehicle_type: type,
      managing_agency: agency.trim() || null,
      url: url.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Vehicle added");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add vehicle to registry</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NAVSEA SeaPort-NxG" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REGISTRY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Managing agency</Label>
            <Input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="GSA, NAVSEA…" />
          </div>
          <div>
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAwardeeDialog({
  vehicleId, teamId, open, onOpenChange, onSaved,
}: {
  vehicleId: string;
  teamId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [uei, setUei] = useState("");
  const [sb, setSb] = useState(false);
  const [socio, setSocio] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("Company name required"); return; }
    setSaving(true);
    const { error } = await supabase.from("vehicle_awardees").insert({
      vehicle_id: vehicleId,
      team_id: teamId,
      company_name: name.trim(),
      uei: uei.trim() || null,
      small_business: sb,
      socioeconomic: socio.trim() ? socio.split(",").map((s) => s.trim()).filter(Boolean) : null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Awardee added");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add awardee</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Company name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>UEI</Label><Input value={uei} onChange={(e) => setUei(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sb} onChange={(e) => setSb(e.target.checked)} /> Small business</label>
          <div><Label>Socioeconomic certs (comma-separated)</Label><Input value={socio} onChange={(e) => setSocio(e.target.value)} placeholder="SDVOSB, 8(a), HUBZone" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkAwardeesDialog({
  vehicleId, teamId, open, onOpenChange, onSaved,
}: {
  vehicleId: string;
  teamId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const [name, uei] = line.split(",").map((s) => s.trim());
      return { vehicle_id: vehicleId, team_id: teamId, company_name: name, uei: uei || null };
    });
    if (rows.length === 0) { toast.error("Paste at least one company"); return; }
    setSaving(true);
    const { error } = await supabase.from("vehicle_awardees").insert(rows);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${rows.length} awardee${rows.length === 1 ? "" : "s"}`);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk add awardees</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <div className="text-xs text-muted-foreground">One company per line. Optional format: <code>Name, UEI</code>.</div>
          <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Acme Federal Solutions, ABC123DEF456\nBeta Systems Inc"} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------- CSV Import ----------------

type CsvFieldKey = "company_name" | "uei" | "small_business" | "socioeconomic";
const CSV_FIELDS: { key: CsvFieldKey; label: string; required?: boolean }[] = [
  { key: "company_name", label: "Company name", required: true },
  { key: "uei", label: "UEI" },
  { key: "small_business", label: "Small business (yes/no)" },
  { key: "socioeconomic", label: "Socioeconomic certs (delimited)" },
];

const NONE = "__none__";

function guessMapping(headers: string[]): Record<CsvFieldKey, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (...needles: string[]) =>
    headers.find((h) => {
      const n = norm(h);
      return needles.some((needle) => n === needle || n.includes(needle));
    }) ?? NONE;
  return {
    company_name: find("companyname", "company", "vendor", "awardeename", "awardee", "name", "firm"),
    uei: find("uei", "samuei", "ueisam", "duns", "cage"),
    small_business: find("smallbusiness", "smallbiz", "issmall", "sb"),
    socioeconomic: find("socioeconomic", "socio", "certs", "certifications", "setaside", "designations"),
  };
}

function parseBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "x" || s === "1";
}

function parseSocio(v: unknown): string[] | null {
  if (typeof v !== "string") return null;
  const parts = v.split(/[;,|/]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function CsvImportAwardeesDialog({
  vehicleId, teamId, existing, open, onOpenChange, onSaved,
}: {
  vehicleId: string;
  teamId: string;
  existing: Awardee[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<CsvFieldKey, string>>({
    company_name: NONE, uei: NONE, small_business: NONE, socioeconomic: NONE,
  });
  const [fileName, setFileName] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const onFile = async (file: File) => {
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm") || lower.endsWith(".ods");
    if (isExcel) {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        if (!firstSheet) { toast.error("Workbook has no sheets"); return; }
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "", raw: false });
        if (!json.length) { toast.error("Sheet is empty"); return; }
        const hdrs = Object.keys(json[0]).filter(Boolean);
        const stringRows = json.map((r) => {
          const out: Record<string, string> = {};
          for (const k of hdrs) out[k] = String(r[k] ?? "").trim();
          return out;
        });
        setHeaders(hdrs);
        setRows(stringRows);
        setMapping(guessMapping(hdrs));
      } catch (err) {
        toast.error(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    const Papa = (await import("papaparse")).default;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const hdrs = (result.meta.fields ?? []).filter(Boolean);
        setHeaders(hdrs);
        setRows(result.data);
        setMapping(guessMapping(hdrs));
      },
      error: (err) => toast.error(`Parse failed: ${err.message}`),
    });
  };

  const mapped = (rows ?? []).map((r) => ({
    company_name: mapping.company_name !== NONE ? String(r[mapping.company_name] ?? "").trim() : "",
    uei: mapping.uei !== NONE ? String(r[mapping.uei] ?? "").trim() || null : null,
    small_business: mapping.small_business !== NONE ? parseBool(r[mapping.small_business]) : false,
    socioeconomic: mapping.socioeconomic !== NONE ? parseSocio(r[mapping.socioeconomic]) : null,
  }));

  const runImport = async () => {
    if (mapping.company_name === NONE) { toast.error("Map the Company name column"); return; }
    setImporting(true);
    const existingUeis = new Set(existing.map((a) => (a.uei ?? "").trim().toUpperCase()).filter(Boolean));
    const existingNames = new Set(existing.map((a) => a.company_name.trim().toLowerCase()));
    const seenUei = new Set<string>();
    const seenName = new Set<string>();
    let invalid = 0;
    let dup = 0;
    const toInsert: TablesInsert<"vehicle_awardees">[] = [];
    for (const m of mapped) {
      if (!m.company_name) { invalid++; continue; }
      const ueiKey = (m.uei ?? "").trim().toUpperCase();
      const nameKey = m.company_name.trim().toLowerCase();
      if (ueiKey) {
        if (existingUeis.has(ueiKey) || seenUei.has(ueiKey)) { dup++; continue; }
        seenUei.add(ueiKey);
      } else {
        if (existingNames.has(nameKey) || seenName.has(nameKey)) { dup++; continue; }
        seenName.add(nameKey);
      }
      toInsert.push({
        vehicle_id: vehicleId,
        team_id: teamId,
        company_name: m.company_name,
        uei: m.uei,
        small_business: m.small_business,
        socioeconomic: m.socioeconomic,
      });
    }
    let inserted = 0;
    const batchSize = 200;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const { error } = await supabase.from("vehicle_awardees").insert(batch);
      if (error) {
        setImporting(false);
        toast.error(`Import failed after ${inserted} rows: ${error.message}`);
        onSaved();
        return;
      }
      inserted += batch.length;
    }
    setImporting(false);
    toast.success(`Imported ${inserted} · skipped ${dup} duplicate${dup === 1 ? "" : "s"} · ${invalid} invalid`);
    onSaved();
  };

  const preview = mapped.slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Import awardees from CSV or Excel</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {!rows ? (
            <div className="space-y-2">
              <Label>CSV or Excel file</Label>
              <Input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,.xlsm,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              <div className="text-xs text-muted-foreground">
                Expected columns include company name (required), UEI, small business flag, and socioeconomic certs.
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                <span className="briefing-label mr-1">File</span>{fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}
              </div>
              <div className="space-y-2">
                <div className="briefing-label text-xs">Column mapping</div>
                {CSV_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="w-52 text-xs">{f.label}{f.required && " *"}</Label>
                    <Select
                      value={mapping[f.key]}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— none —</SelectItem>
                        {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <div className="briefing-label text-xs">Preview (first {preview.length})</div>
                <div className="border rounded max-h-64 overflow-auto text-xs">
                  <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1">Company</th>
                        <th className="text-left px-2 py-1">UEI</th>
                        <th className="text-left px-2 py-1">SB</th>
                        <th className="text-left px-2 py-1">Certs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((m, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1">{m.company_name || <span className="text-destructive">(missing)</span>}</td>
                          <td className="px-2 py-1 font-mono">{m.uei ?? ""}</td>
                          <td className="px-2 py-1">{m.small_business ? "yes" : ""}</td>
                          <td className="px-2 py-1">{(m.socioeconomic ?? []).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {rows && (
            <Button onClick={runImport} disabled={importing || mapping.company_name === NONE}>
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : `Import ${mapped.length} awardee${mapped.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- AI Research Awardees ----------------

type ResearchCandidate = {
  company_name: string;
  uei: string | null;
  small_business: boolean | null;
  socioeconomic: string[];
  confidence: "high" | "medium" | "low";
  note: string | null;
  announcement_url?: string | null;
};

type ResearchResult = {
  summary: string;
  source_urls: string[];
  candidates: ResearchCandidate[];
};

function confidenceBadge(c: string) {
  if (c === "high") return "bg-success text-success-foreground";
  if (c === "medium") return "bg-warning text-warning-foreground";
  return "bg-muted text-muted-foreground";
}

function AiResearchAwardeesDialog({
  vehicle, teamId, existing, open, onOpenChange, onSaved,
}: {
  vehicle: RegistryVehicle;
  teamId: string;
  existing: Awardee[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult(null);
    setSelected(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("vehicle-awardee-research", {
        body: {
          vehicleName: vehicle.vehicle_name,
          managingAgency: vehicle.managing_agency,
          vehicleType: vehicle.vehicle_type,
        },
      });
      if (error) throw new Error(error.message);
      const r = (data as any)?.research as ResearchResult | undefined;
      if (!r) throw new Error("No research returned");
      setResult(r);
      // Pre-select high-confidence not-already-present.
      const existingUei = new Set(existing.map((a) => (a.uei ?? "").toUpperCase()).filter(Boolean));
      const existingName = new Set(existing.map((a) => a.company_name.trim().toLowerCase()));
      const preselect = new Set<number>();
      r.candidates.forEach((c, i) => {
        const uei = (c.uei ?? "").toUpperCase();
        const name = c.company_name.trim().toLowerCase();
        const dup = (uei && existingUei.has(uei)) || existingName.has(name);
        if (!dup && c.confidence === "high") preselect.add(i);
      });
      setSelected(preselect);
    } catch (e: any) {
      toast.error(e?.message ?? "Research failed");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  };

  const saveSelected = async () => {
    if (!result || selected.size === 0) return;
    setSaving(true);
    try {
      const existingUei = new Set(existing.map((a) => (a.uei ?? "").toUpperCase()).filter(Boolean));
      const existingName = new Set(existing.map((a) => a.company_name.trim().toLowerCase()));
      const rows: TablesInsert<"vehicle_awardees">[] = [];
      let skipped = 0;
      for (const i of selected) {
        const c = result.candidates[i];
        if (!c) continue;
        const uei = (c.uei ?? "").toUpperCase();
        const name = c.company_name.trim().toLowerCase();
        if ((uei && existingUei.has(uei)) || existingName.has(name)) { skipped++; continue; }
        rows.push({
          vehicle_id: vehicle.id,
          team_id: teamId,
          company_name: c.company_name.trim(),
          uei: c.uei ?? null,
          small_business: c.small_business ?? null,
          socioeconomic: c.socioeconomic?.length ? c.socioeconomic : null,
        });
      }
      if (rows.length === 0) {
        toast.info("Nothing new to add");
        setSaving(false);
        return;
      }
      const { error } = await supabase.from("vehicle_awardees").insert(rows);
      if (error) throw new Error(error.message);
      toast.success(`Added ${rows.length} awardee${rows.length === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""}`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI research awardees — {vehicle.vehicle_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            AI-drafted — verify against official sources before relying. Nothing saves until you select candidates and click Add.
          </div>
          {!result && !loading && (
            <div className="text-sm text-muted-foreground">
              Ask the AI to draft an awardee list for this vehicle based on public sources and model knowledge.
              <div className="mt-2">
                <Button onClick={run}>Run research</Button>
              </div>
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Researching…
            </div>
          )}
          {result && (
            <>
              <div>
                <div className="briefing-label text-xs mb-1">Summary</div>
                <div className="text-sm">{result.summary}</div>
              </div>
              {result.source_urls?.length > 0 && (
                <div>
                  <div className="briefing-label text-xs mb-1">Sources</div>
                  <ul className="text-xs space-y-0.5">
                    {result.source_urls.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="briefing-label text-xs mb-1">Candidates ({result.candidates.length}) — {selected.size} selected</div>
                <div className="max-h-96 overflow-y-auto divide-y border rounded">
                  {result.candidates.map((c, i) => {
                    const uei = (c.uei ?? "").toUpperCase();
                    const name = c.company_name.trim().toLowerCase();
                    const dup = existing.some((a) =>
                      (uei && (a.uei ?? "").toUpperCase() === uei) ||
                      a.company_name.trim().toLowerCase() === name,
                    );
                    return (
                      <label key={i} className={`flex items-start gap-2 p-2 text-sm cursor-pointer ${dup ? "opacity-60" : ""}`}>
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                          disabled={dup}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium flex items-center gap-1.5 flex-wrap">
                            {c.company_name}
                            <Badge className={`text-[10px] ${confidenceBadge(c.confidence)}`} variant="outline">
                              {c.confidence}
                            </Badge>
                            {c.announcement_url && (
                              <a
                                href={c.announcement_url}
                                target="_blank"
                                rel="noreferrer"
                                title={`Announcement: ${c.announcement_url}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:text-primary/80 inline-flex items-center"
                              >
                                <Link2 className="w-3 h-3" />
                              </a>
                            )}
                            {dup && <Badge variant="outline" className="text-[10px]">already present</Badge>}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 items-center">
                            {c.uei && <span className="font-mono">{c.uei}</span>}
                            {c.small_business && <Badge variant="outline" className="text-[10px]">SB</Badge>}
                            {(c.socioeconomic ?? []).map((s) => (
                              <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                            ))}
                          </div>
                          {c.note && <div className="text-[11px] text-muted-foreground mt-0.5 italic">{c.note}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {result && (
            <>
              <Button variant="outline" onClick={run} disabled={loading}>Re-run</Button>
              <Button onClick={saveSelected} disabled={saving || selected.size === 0}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : `Add ${selected.size} selected`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Announcement Search Menu ----------------

function AnnouncementSearchMenu({ vehicleName }: { vehicleName: string }) {
  const q = encodeURIComponent(vehicleName);
  const items: { label: string; url: string }[] = [
    {
      label: "Google News — award",
      url: `https://news.google.com/search?q=${encodeURIComponent(`"${vehicleName}" award`)}`,
    },
    {
      label: "Google — awarded (PR wires)",
      url: `https://www.google.com/search?q=${encodeURIComponent(
        `"awarded" "${vehicleName}" (site:prnewswire.com OR site:businesswire.com OR site:globenewswire.com)`,
      )}`,
    },
    {
      label: "Google — awardees / contract holders",
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${vehicleName}" (awardees OR "contract holders" OR "seat on")`)}`,
    },
    {
      label: "SAM.gov search",
      url: `https://sam.gov/search/?keywords=${q}&index=opp`,
    },
    {
      label: "GSA eLibrary search",
      url: `https://www.gsaelibrary.gsa.gov/ElibMain/searchResults.do?searchCriteria=${q}&scheduleNumber=&executeQuery=YES`,
    },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Search className="w-3 h-3 mr-1" /> Search announcements
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">Manual awardee hunt — opens in new tab</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((it) => (
          <DropdownMenuItem key={it.label} asChild>
            <a href={it.url} target="_blank" rel="noreferrer" className="cursor-pointer">
              <ExternalLink className="w-3 h-3 mr-2" /> {it.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
