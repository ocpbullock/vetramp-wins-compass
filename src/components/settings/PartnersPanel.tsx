import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTeam } from "@/lib/team";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2, Building2, Star } from "lucide-react";
import { toast } from "sonner";
import {
  type Company,
  type CompanyDraft,
  type PastPerfEntry,
  listCompanies,
  upsertCompany,
  deleteCompany,
} from "@/lib/companies";

// Back-compat: existing code imports `Partner` (legacy teaming_partners row shape) from this module.
export type Partner = {
  id: string;
  team_id: string;
  company_name: string;
  uei: string | null;
  cage_code: string | null;
  poc_name: string | null;
  poc_email: string | null;
  poc_phone: string | null;
  certifications: string[];
  naics_codes: string[];
  capabilities_summary: string | null;
  past_performance_summary: string | null;
  contract_vehicles: string[];
  relationship_status: "active" | "prospective" | "inactive";
  notes: string | null;
};

const STATUS_VARIANT: Record<Company["relationship_status"], "default" | "secondary" | "outline"> = {
  active: "default",
  prospective: "secondary",
  inactive: "outline",
};

type Filter = "all" | "own" | "partner" | "other";

export function PartnersPanel({ initialDraft }: { initialDraft?: CompanyDraft } = {}) {
  const { currentTeam, userRole } = useTeam();
  // In opportunity-team context, surface the parent org's companies in
  // read-only mode (consistent with knowledge base / past performance for
  // opp-team viewers). The active opp team has no companies of its own.
  const isOpp = currentTeam?.team_type === "opportunity";
  const effectiveTeamId = isOpp
    ? currentTeam?.parent_team_id ?? null
    : currentTeam?.id ?? null;
  const readOnly = isOpp;
  const canEdit = !readOnly && (userRole === "owner" || userRole === "admin" || userRole === "member");
  const canDelete = !readOnly && (userRole === "owner" || userRole === "admin");
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Company | null>(null);
  const [seedDraft, setSeedDraft] = useState<CompanyDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  // Open prefilled dialog when an initialDraft is provided from a parent (e.g. vendor lookup).
  useEffect(() => {
    if (initialDraft && !readOnly) {
      setSeedDraft(initialDraft);
      setEditing(null);
      setOpen(true);
    }
  }, [initialDraft, readOnly]);

  const { data, isLoading } = useQuery({
    queryKey: ["companies", effectiveTeamId],
    enabled: !!effectiveTeamId,
    queryFn: () => listCompanies(effectiveTeamId!),
  });

  // Resolve the parent org's display name so the "Provided by" notice
  // identifies the source. The opp team has `parent_team_id`; we read the
  // team name with the active session (opp-team members typically have
  // visibility into the parent via the team-access RLS helpers).
  const { data: parentTeam } = useQuery({
    queryKey: ["parent-team-name", currentTeam?.parent_team_id],
    enabled: isOpp && !!currentTeam?.parent_team_id,
    queryFn: async () => {
      const { useTeam } = await import("@/lib/team"); // keep tree-shake happy
      void useTeam;
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("teams")
        .select("name")
        .eq("id", currentTeam!.parent_team_id!)
        .maybeSingle();
      return data;
    },
  });
  const orgName = parentTeam?.name ?? "the parent organization";

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "own") return data.filter((c) => c.is_own_company);
    if (filter === "partner") return data.filter((c) => c.is_existing_partner && !c.is_own_company);
    if (filter === "other") return data.filter((c) => !c.is_existing_partner && !c.is_own_company);
    return data;
  }, [data, filter]);

  const deleteMut = useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => {
      toast.success("Company removed");
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["teaming-partners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentTeam) return <Card className="p-6 text-sm text-muted-foreground">Pick a team first.</Card>;
  if (isOpp && !effectiveTeamId) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        This capture room is not linked to an organization yet.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Companies</h2>
          <p className="text-xs text-muted-foreground">Your own company, teaming partners, primes, and competitors — all in one place.</p>
        </div>
        {canEdit && (
          <Button onClick={() => { setSeedDraft(null); setEditing(null); setOpen(true); }} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add company
          </Button>
        )}
      </div>

      {readOnly && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5" />
          <span>Provided by <span className="font-medium text-foreground">{orgName}</span> — read-only in this capture room.</span>
        </div>
      )}


      <div className="flex gap-1">
        {(["all", "own", "partner", "other"] as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "own" ? "Own" : f === "partner" ? "Partners" : "Other"}
          </Button>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Relationship</TableHead>
              <TableHead>Certifications</TableHead>
              <TableHead>NAICS</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground py-6 text-center">Loading…</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground py-6 text-center">No companies yet.</TableCell></TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.id} className={c.is_own_company ? "bg-muted/30" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {c.is_own_company && <Building2 className="w-4 h-4 text-primary" aria-label="Your company" />}
                    <div>
                      <div className="font-medium">{c.name}</div>
                      {c.uei && <div className="text-[11px] text-muted-foreground font-mono">UEI {c.uei}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {c.is_own_company ? (
                    <Badge>Own</Badge>
                  ) : c.is_existing_partner ? (
                    <Badge variant="secondary">Partner</Badge>
                  ) : (
                    <Badge variant="outline">Other</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.relationship_status]}>{c.relationship_status}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {c.is_own_company ? "—" : (
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      <span className="font-mono">{c.relationship_strength ?? 0}</span>
                      {c.worked_together_before && <span className="text-muted-foreground">· prior</span>}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.certifications.length === 0 ? <span className="text-xs text-muted-foreground">—</span> :
                      c.certifications.slice(0, 3).map((x) => <Badge key={x} variant="outline" className="text-[10px]">{x}</Badge>)}
                    {c.certifications.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.certifications.length - 3}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[180px]">
                    {c.naics_codes.length === 0 ? <span className="text-xs text-muted-foreground">—</span> :
                      c.naics_codes.slice(0, 3).map((n) => <Badge key={n} variant="secondary" className="text-[10px] font-mono">{n}</Badge>)}
                    {c.naics_codes.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.naics_codes.length - 3}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {canEdit && (
                      <Button variant="ghost" size="icon" onClick={() => { setSeedDraft(null); setEditing(c); setOpen(true); }} aria-label="Edit">
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {canDelete && !c.is_own_company && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Delete"><Trash2 className="w-4 h-4" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {c.name}?</AlertDialogTitle>
                            <AlertDialogDescription>This also removes them from any proposals they are teamed on.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMut.mutate(c.id)}>Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CompanyDialog
        open={open}
        onOpenChange={setOpen}
        teamId={currentTeam.id}
        initial={editing}
        seed={seedDraft}
        onSaved={() => {
          setOpen(false);
          qc.invalidateQueries({ queryKey: ["companies"] });
          qc.invalidateQueries({ queryKey: ["teaming-partners"] });
        }}
      />
    </div>
  );
}

function csvSplit(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function CompanyDialog({
  open, onOpenChange, teamId, initial, seed, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teamId: string;
  initial: Company | null;
  seed: CompanyDraft | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => initialForm(initial, seed));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initialForm(initial, seed));
  }, [open, initial, seed]);

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name.trim()) { toast.error("Company name is required"); return; }
    setSaving(true);
    try {
      await upsertCompany({
        id: initial?.id,
        team_id: teamId,
        name: form.name.trim(),
        uei: form.uei.trim() || null,
        cage_code: form.cage_code.trim() || null,
        duns: form.duns.trim() || null,
        website: form.website.trim() || null,
        poc_name: form.poc_name.trim() || null,
        poc_email: form.poc_email.trim() || null,
        poc_phone: form.poc_phone.trim() || null,
        certifications: csvSplit(form.certifications),
        set_asides: csvSplit(form.set_asides),
        naics_codes: csvSplit(form.naics_codes),
        contract_vehicles: csvSplit(form.contract_vehicles),
        capabilities_narrative: form.capabilities_narrative.trim() || null,
        past_performance: form.past_performance.filter((e) => e.title || e.summary),
        is_own_company: form.is_own_company,
        is_existing_partner: form.is_existing_partner,
        worked_together_before: form.worked_together_before,
        relationship_strength: form.relationship_strength,
        relationship_status: form.relationship_status,
        has_nda: form.has_nda,
        has_teaming_agreement: form.has_teaming_agreement,
        prior_contract_together: form.prior_contract_together,
        source: form.source,
        external_ref: form.external_ref ?? null,
        notes: form.notes.trim() || null,
      });
      toast.success(initial ? "Company updated" : "Company added");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Add company"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Company name *" value={form.name} onChange={(v) => update({ name: v })} />
            <div>
              <Label>Relationship status</Label>
              <Select value={form.relationship_status} onValueChange={(v) => update({ relationship_status: v as Company["relationship_status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="prospective">Prospective</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field label="UEI" value={form.uei} onChange={(v) => update({ uei: v })} />
            <Field label="CAGE code" value={form.cage_code} onChange={(v) => update({ cage_code: v })} />
            <Field label="DUNS" value={form.duns} onChange={(v) => update({ duns: v })} />
            <Field label="Website" value={form.website} onChange={(v) => update({ website: v })} />
            <Field label="POC name" value={form.poc_name} onChange={(v) => update({ poc_name: v })} />
            <Field label="POC email" value={form.poc_email} onChange={(v) => update({ poc_email: v })} />
            <Field label="POC phone" value={form.poc_phone} onChange={(v) => update({ poc_phone: v })} />
          </div>
          <Field label="Certifications (comma-separated)" value={form.certifications} onChange={(v) => update({ certifications: v })} />
          <Field label="Set-asides (comma-separated)" value={form.set_asides} onChange={(v) => update({ set_asides: v })} />
          <Field label="NAICS codes (comma-separated)" value={form.naics_codes} onChange={(v) => update({ naics_codes: v })} />
          <Field label="Contract vehicles (comma-separated)" value={form.contract_vehicles} onChange={(v) => update({ contract_vehicles: v })} />

          <div>
            <Label>Capabilities narrative</Label>
            <Textarea rows={3} value={form.capabilities_narrative} onChange={(e) => update({ capabilities_narrative: e.target.value })} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Past performance entries</Label>
              <Button variant="outline" size="sm" onClick={() => update({ past_performance: [...form.past_performance, {}] })}>
                <Plus className="w-3 h-3 mr-1" /> Add entry
              </Button>
            </div>
            {form.past_performance.map((e, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 border rounded">
                <Input placeholder="Title" value={e.title ?? ""} onChange={(ev) => updateEntry(i, { title: ev.target.value })} />
                <Input placeholder="Customer" value={e.customer ?? ""} onChange={(ev) => updateEntry(i, { customer: ev.target.value })} />
                <Input placeholder="Value (e.g. $4.2M)" value={String(e.value ?? "")} onChange={(ev) => updateEntry(i, { value: ev.target.value })} />
                <Input placeholder="Period" value={e.period ?? ""} onChange={(ev) => updateEntry(i, { period: ev.target.value })} />
                <Input placeholder="Role (prime/sub)" value={e.role ?? ""} onChange={(ev) => updateEntry(i, { role: ev.target.value })} />
                <Button variant="ghost" size="sm" onClick={() => update({ past_performance: form.past_performance.filter((_, j) => j !== i) })}>
                  <Trash2 className="w-3 h-3 mr-1" /> Remove
                </Button>
                <Textarea
                  placeholder="Summary"
                  className="md:col-span-2"
                  rows={2}
                  value={e.summary ?? ""}
                  onChange={(ev) => updateEntry(i, { summary: ev.target.value })}
                />
              </div>
            ))}
            {form.past_performance.length === 0 && <p className="text-xs text-muted-foreground">No entries yet.</p>}
          </div>

          {!form.is_own_company && (
            <div className="space-y-3 p-3 border rounded bg-muted/30">
              <h3 className="text-sm font-medium">Relationship</h3>
              <div className="flex items-center justify-between">
                <Label htmlFor="existing-partner">Existing partner</Label>
                <Switch
                  id="existing-partner"
                  checked={form.is_existing_partner}
                  onCheckedChange={(v) => update({ is_existing_partner: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="worked-before">Worked together before</Label>
                <Switch
                  id="worked-before"
                  checked={form.worked_together_before}
                  onCheckedChange={(v) => update({ worked_together_before: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="prior-contract">Prior contract together</Label>
                <Switch
                  id="prior-contract"
                  checked={form.prior_contract_together}
                  onCheckedChange={(v) => update({ prior_contract_together: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="has-nda">NDA on file</Label>
                <Switch
                  id="has-nda"
                  checked={form.has_nda}
                  onCheckedChange={(v) => update({ has_nda: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="has-ta">Teaming agreement on file</Label>
                <Switch
                  id="has-ta"
                  checked={form.has_teaming_agreement}
                  onCheckedChange={(v) => update({ has_teaming_agreement: v })}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                These partnership signals feed an explicit bonus in the pWin Partner Fit factor.
              </p>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <Label>Relationship strength</Label>
                  <span className="font-mono">{form.relationship_strength ?? 0}</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[form.relationship_strength ?? 0]}
                  onValueChange={(v) => update({ relationship_strength: v[0] })}
                />
              </div>
            </div>
          )}

          <div>
            <Label>Internal notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {initial ? "Save changes" : "Add company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  function updateEntry(i: number, patch: Partial<PastPerfEntry>) {
    const next = form.past_performance.slice();
    next[i] = { ...next[i], ...patch };
    update({ past_performance: next });
  }
}

function initialForm(c: Company | null, seed: CompanyDraft | null) {
  const base: any = c ?? seed ?? {};
  return {
    name: (c?.name ?? seed?.name ?? "") as string,
    uei: (c?.uei ?? seed?.uei ?? "") as string,
    cage_code: (c?.cage_code ?? seed?.cage_code ?? "") as string,
    duns: (c?.duns ?? seed?.duns ?? "") as string,
    website: (c?.website ?? seed?.website ?? "") as string,
    poc_name: (c?.poc_name ?? seed?.poc_name ?? "") as string,
    poc_email: (c?.poc_email ?? seed?.poc_email ?? "") as string,
    poc_phone: (c?.poc_phone ?? seed?.poc_phone ?? "") as string,
    certifications: ((c?.certifications ?? seed?.certifications ?? []) as string[]).join(", "),
    set_asides: ((c?.set_asides ?? seed?.set_asides ?? []) as string[]).join(", "),
    naics_codes: ((c?.naics_codes ?? seed?.naics_codes ?? []) as string[]).join(", "),
    contract_vehicles: ((c?.contract_vehicles ?? seed?.contract_vehicles ?? []) as string[]).join(", "),
    capabilities_narrative: (c?.capabilities_narrative ?? seed?.capabilities_narrative ?? "") as string,
    past_performance: (c?.past_performance ?? seed?.past_performance ?? []) as PastPerfEntry[],
    is_own_company: !!(c?.is_own_company ?? seed?.is_own_company),
    is_existing_partner: !!(c?.is_existing_partner ?? seed?.is_existing_partner),
    worked_together_before: !!(c?.worked_together_before ?? seed?.worked_together_before),
    relationship_strength: (c?.relationship_strength ?? seed?.relationship_strength ?? 0) as number,
    relationship_status: (c?.relationship_status ?? seed?.relationship_status ?? "prospective") as Company["relationship_status"],
    has_nda: !!((c as any)?.has_nda ?? (seed as any)?.has_nda),
    has_teaming_agreement: !!((c as any)?.has_teaming_agreement ?? (seed as any)?.has_teaming_agreement),
    prior_contract_together: !!((c as any)?.prior_contract_together ?? (seed as any)?.prior_contract_together),
    source: (c?.source ?? seed?.source ?? "manual") as string,
    external_ref: c?.external_ref ?? seed?.external_ref ?? null,
    notes: (c?.notes ?? seed?.notes ?? "") as string,
  };
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
