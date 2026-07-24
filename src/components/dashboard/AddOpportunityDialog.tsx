import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Upload, X, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { toast } from "sonner";
import { VehiclePicker } from "@/components/proposals/VehiclePicker";
import { classifyFilename } from "@/lib/attachment-classify";
import { NaicsCombobox } from "@/components/NaicsCombobox";

export function AddOpportunityDialog({
  open,
  onOpenChange,
  agencySuggestions = [],
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agencySuggestions?: string[];
  onCreated: (proposalId: string, opts?: { hasDocs?: boolean }) => void;
}) {
  const { user } = useAuth();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id ?? null;
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState("");
  const [subAgency, setSubAgency] = useState("");
  const [vehicleStatus, setVehicleStatus] = useState<string>("unknown");
  const [vehicleRegistryId, setVehicleRegistryId] = useState<string | null>(null);
  const [contractVehicleName, setContractVehicleName] = useState<string | null>(null);
  const [naicsCode, setNaicsCode] = useState<string>("");
  const [estValue, setEstValue] = useState<string>("");
  const [deadline, setDeadline] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [incumbent, setIncumbent] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(""); setAgency(""); setSubAgency("");
    setVehicleStatus("unknown"); setVehicleRegistryId(null); setContractVehicleName(null);
    setNaicsCode(""); setEstValue(""); setDeadline("");
    setSourceUrl(""); setIncumbent(""); setDescription(""); setFiles([]);
  }, [open]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    setFiles((prev) => [...prev, ...arr]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!user) return;
    if (!title.trim() || !agency.trim()) {
      toast.error("Title and Agency are required");
      return;
    }
    setSaving(true);
    const fullAgency = subAgency.trim() ? `${agency.trim()} — ${subAgency.trim()}` : agency.trim();
    const solNum = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: user.id,
      team_id: teamId,
      solicitation_number: solNum,
      opportunity_title: title.trim(),
      agency: fullAgency,
      naics_code: naicsCode || null,
      estimated_value: estValue ? Number(estValue) : null,
      response_deadline: deadline ? new Date(`${deadline}T23:59:59Z`).toISOString() : null,
      known_incumbent: incumbent.trim() || null,
      capture_notes: description.trim() || null,
      opportunity_source: "manual",
      capture_stage: "intake",
      status: "intake",
      contract_vehicle: contractVehicleName,
      vehicle_status: vehicleStatus,
      vehicle_registry_id: vehicleRegistryId,
      opportunity_data: {
        sub_agency: subAgency.trim() || null,
        contract_vehicle: contractVehicleName,
        source_url: sourceUrl.trim() || null,
      },
    };
    const { data, error } = await supabase
      .from("proposals")
      .insert(payload as any)
      .select("id")
      .single();
    if (error || !data) {
      setSaving(false);
      toast.error(error?.message ?? "Failed to create opportunity");
      return;
    }
    const proposalId = data.id;

    // Upload attachments if any
    let uploaded = 0;
    let failed = 0;
    for (const file of files) {
      const ft = classifyFilename(file.name);
      const path = `proposals/${proposalId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("proposal-attachments").upload(path, file);
      if (upErr) { failed++; continue; }
      const { error: insErr } = await supabase.from("proposal_attachments").insert({
        proposal_id: proposalId,
        filename: file.name,
        file_type: ft,
        storage_path: path,
        source: "manual",
        size_bytes: file.size,
      });
      if (insErr) { failed++; continue; }
      uploaded++;
    }
    setSaving(false);
    if (failed > 0) toast.warning(`Uploaded ${uploaded} of ${files.length} document${files.length === 1 ? "" : "s"}`);
    else toast.success(uploaded > 0 ? `Opportunity created with ${uploaded} document${uploaded === 1 ? "" : "s"}` : "Opportunity created");
    onOpenChange(false);
    onCreated(proposalId, { hasDocs: uploaded > 0 });
  };

  // Removed unused naicsLabel lookup; NaicsCombobox handles labels.
  const dedupedAgencies = Array.from(new Set(agencySuggestions.filter(Boolean))).slice(0, 200);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add Opportunity</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 overflow-y-auto flex-1">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Agency *</Label>
              <Input
                list="add-opp-agency-list"
                value={agency}
                onChange={(e) => setAgency(e.target.value)}
                placeholder="e.g. Department of Defense"
                className="mt-1"
              />
              <datalist id="add-opp-agency-list">
                {dedupedAgencies.map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>
            <div>
              <Label className="text-xs">Sub-Agency</Label>
              <Input value={subAgency} onChange={(e) => setSubAgency(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="rounded-md border p-3">
            <VehiclePicker
              teamId={teamId}
              status={vehicleStatus}
              vehicleId={vehicleRegistryId}
              onChange={(patch) => {
                setVehicleStatus(patch.vehicle_status);
                setVehicleRegistryId(patch.vehicle_registry_id);
                setContractVehicleName(patch.contract_vehicle);
              }}
            />
          </div>

          <div>
            <Label className="text-xs">NAICS Code</Label>
            <div className="mt-1">
              <NaicsCombobox
                value={naicsCode || null}
                onChange={(c) => setNaicsCode(c ?? "")}
                placeholder="Not sure yet — I'll add documents"
              />
            </div>
          </div>



          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Estimated Value (USD)</Label>
              <Input
                type="number"
                value={estValue}
                onChange={(e) => setEstValue(e.target.value)}
                placeholder="e.g. 2500000"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Response Deadline</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Source URL</Label>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">Known Incumbent</Label>
            <Input value={incumbent} onChange={(e) => setIncumbent(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label className="text-xs">Description / SOW Summary</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">Opportunity documents</Label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-1 rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <Upload className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-xs text-muted-foreground">
                Drop SOW/PWS, Section L/M, amendments, or attachments here — or click to browse.
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                We'll parse them after creation to auto-fill NAICS, value, deadline and more.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
            </div>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Create Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
