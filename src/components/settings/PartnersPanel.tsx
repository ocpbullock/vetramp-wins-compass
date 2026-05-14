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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

const STATUS_VARIANT: Record<Partner["relationship_status"], "default" | "secondary" | "outline"> = {
  active: "default",
  prospective: "secondary",
  inactive: "outline",
};

export function PartnersPanel() {
  const { currentTeam, userRole } = useTeam();
  const canEdit = userRole === "owner" || userRole === "admin" || userRole === "member";
  const canDelete = userRole === "owner" || userRole === "admin";
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Partner | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["teaming-partners", currentTeam?.id],
    enabled: !!currentTeam,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaming_partners")
        .select("*")
        .eq("team_id", currentTeam!.id)
        .order("company_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Partner[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teaming_partners").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Partner removed");
      qc.invalidateQueries({ queryKey: ["teaming-partners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentTeam) return <Card className="p-6 text-sm text-muted-foreground">Pick a team first.</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Teaming partners</h2>
          <p className="text-xs text-muted-foreground">Companies you sub to, prime for, or team with on bids.</p>
        </div>
        {canEdit && (
          <Button onClick={() => { setEditing(null); setOpen(true); }} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add partner
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Certifications</TableHead>
              <TableHead>NAICS</TableHead>
              <TableHead>POC</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground py-6 text-center">Loading…</TableCell></TableRow>
            )}
            {!isLoading && (data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground py-6 text-center">No partners yet.</TableCell></TableRow>
            )}
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.company_name}</div>
                  {p.uei && <div className="text-[11px] text-muted-foreground font-mono">UEI {p.uei}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[p.relationship_status]}>{p.relationship_status}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {p.certifications.length === 0 ? <span className="text-xs text-muted-foreground">—</span> :
                      p.certifications.map((c) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[180px]">
                    {p.naics_codes.length === 0 ? <span className="text-xs text-muted-foreground">—</span> :
                      p.naics_codes.slice(0, 4).map((n) => <Badge key={n} variant="secondary" className="text-[10px] font-mono">{n}</Badge>)}
                    {p.naics_codes.length > 4 && <span className="text-[10px] text-muted-foreground">+{p.naics_codes.length - 4}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div>{p.poc_name ?? "—"}</div>
                  {p.poc_email && <div className="text-muted-foreground">{p.poc_email}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {canEdit && (
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }} aria-label="Edit">
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Delete"><Trash2 className="w-4 h-4" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {p.company_name}?</AlertDialogTitle>
                            <AlertDialogDescription>This also removes them from any proposals they are teamed on.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMut.mutate(p.id)}>Remove</AlertDialogAction>
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

      <PartnerDialog
        open={open}
        onOpenChange={setOpen}
        teamId={currentTeam.id}
        initial={editing}
        onSaved={() => {
          setOpen(false);
          qc.invalidateQueries({ queryKey: ["teaming-partners"] });
        }}
      />
    </div>
  );
}

function csvSplit(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function PartnerDialog({
  open, onOpenChange, teamId, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teamId: string;
  initial: Partner | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => initialForm(initial));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initialForm(initial));
  }, [open, initial]);

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.company_name.trim()) { toast.error("Company name is required"); return; }
    setSaving(true);
    const payload = {
      team_id: teamId,
      company_name: form.company_name.trim(),
      uei: form.uei.trim() || null,
      cage_code: form.cage_code.trim() || null,
      poc_name: form.poc_name.trim() || null,
      poc_email: form.poc_email.trim() || null,
      poc_phone: form.poc_phone.trim() || null,
      certifications: csvSplit(form.certifications),
      naics_codes: csvSplit(form.naics_codes),
      capabilities_summary: form.capabilities_summary.trim() || null,
      past_performance_summary: form.past_performance_summary.trim() || null,
      contract_vehicles: csvSplit(form.contract_vehicles),
      relationship_status: form.relationship_status,
      notes: form.notes.trim() || null,
    };
    const { error } = initial
      ? await supabase.from("teaming_partners").update(payload).eq("id", initial.id)
      : await supabase.from("teaming_partners").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(initial ? "Partner updated" : "Partner added");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initial ? "Edit partner" : "Add teaming partner"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Company name *" value={form.company_name} onChange={(v) => update({ company_name: v })} />
            <div>
              <Label>Relationship status</Label>
              <Select value={form.relationship_status} onValueChange={(v) => update({ relationship_status: v as Partner["relationship_status"] })}>
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
            <Field label="POC name" value={form.poc_name} onChange={(v) => update({ poc_name: v })} />
            <Field label="POC email" value={form.poc_email} onChange={(v) => update({ poc_email: v })} />
            <Field label="POC phone" value={form.poc_phone} onChange={(v) => update({ poc_phone: v })} />
          </div>
          <Field label="Certifications (comma-separated, e.g. SDVOSB, 8(a), HUBZone)" value={form.certifications} onChange={(v) => update({ certifications: v })} />
          <Field label="NAICS codes (comma-separated)" value={form.naics_codes} onChange={(v) => update({ naics_codes: v })} />
          <Field label="Contract vehicles (comma-separated, e.g. OASIS+, SEWP V)" value={form.contract_vehicles} onChange={(v) => update({ contract_vehicles: v })} />
          <div>
            <Label>Capabilities summary</Label>
            <Textarea rows={3} value={form.capabilities_summary} onChange={(e) => update({ capabilities_summary: e.target.value })} />
          </div>
          <div>
            <Label>Past performance summary</Label>
            <Textarea rows={3} value={form.past_performance_summary} onChange={(e) => update({ past_performance_summary: e.target.value })} />
          </div>
          <div>
            <Label>Internal notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {initial ? "Save changes" : "Add partner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initialForm(p: Partner | null) {
  return {
    __seedFor: p?.id ?? "new",
    company_name: p?.company_name ?? "",
    uei: p?.uei ?? "",
    cage_code: p?.cage_code ?? "",
    poc_name: p?.poc_name ?? "",
    poc_email: p?.poc_email ?? "",
    poc_phone: p?.poc_phone ?? "",
    certifications: (p?.certifications ?? []).join(", "),
    naics_codes: (p?.naics_codes ?? []).join(", "),
    capabilities_summary: p?.capabilities_summary ?? "",
    past_performance_summary: p?.past_performance_summary ?? "",
    contract_vehicles: (p?.contract_vehicles ?? []).join(", "),
    relationship_status: p?.relationship_status ?? "active",
    notes: p?.notes ?? "",
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
