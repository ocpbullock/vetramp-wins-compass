import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown } from "lucide-react";
import { NAICS_GROUPS } from "@/lib/contracts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeamId } from "@/lib/team";
import { toast } from "sonner";

export const CONTRACT_VEHICLES = [
  "GSA Schedule",
  "OASIS+",
  "8(a) STARS III",
  "Alliant 2",
  "SEWP V",
  "CIO-SP3",
  "POLARIS",
  "Custom/Other",
] as const;

export const TRACKED_STATUSES = ["Watching", "Preparing", "Submitted", "Won", "Lost", "No-Bid"] as const;

export type TrackedOpportunity = {
  id: string;
  user_id: string;
  title: string;
  agency: string;
  sub_agency: string | null;
  contract_vehicle: string;
  contract_vehicle_other: string | null;
  naics_code: string;
  estimated_value: number | null;
  response_deadline: string | null;
  source_url: string | null;
  description: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const ALL_NAICS_FLAT = NAICS_GROUPS.flatMap((g) => g.codes);

export function TrackOpportunityDialog({
  open,
  onOpenChange,
  initial,
  agencySuggestions = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: TrackedOpportunity | null;
  agencySuggestions?: string[];
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState("");
  const [subAgency, setSubAgency] = useState("");
  const [vehicle, setVehicle] = useState<string>("GSA Schedule");
  const [vehicleOther, setVehicleOther] = useState("");
  const [naicsCode, setNaicsCode] = useState("541512");
  const [estValue, setEstValue] = useState<string>("");
  const [deadline, setDeadline] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("Watching");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setAgency(initial.agency);
      setSubAgency(initial.sub_agency ?? "");
      setVehicle(initial.contract_vehicle);
      setVehicleOther(initial.contract_vehicle_other ?? "");
      setNaicsCode(initial.naics_code);
      setEstValue(initial.estimated_value?.toString() ?? "");
      setDeadline(initial.response_deadline ?? "");
      setSourceUrl(initial.source_url ?? "");
      setDescription(initial.description ?? "");
      setStatus(initial.status);
      setNotes(initial.notes ?? "");
    } else {
      setTitle(""); setAgency(""); setSubAgency(""); setVehicle("GSA Schedule");
      setVehicleOther(""); setNaicsCode("541512"); setEstValue(""); setDeadline("");
      setSourceUrl(""); setDescription(""); setStatus("Watching"); setNotes("");
    }
  }, [open, initial]);

  const handleSave = async () => {
    if (!user) return;
    if (!title.trim() || !agency.trim() || !vehicle || !naicsCode) {
      toast.error("Title, Agency, Contract Vehicle, and NAICS are required");
      return;
    }
    setSaving(true);
    const payload = {
      user_id: user.id,
      title: title.trim(),
      agency: agency.trim(),
      sub_agency: subAgency.trim() || null,
      contract_vehicle: vehicle,
      contract_vehicle_other: vehicle === "Custom/Other" ? (vehicleOther.trim() || null) : null,
      naics_code: naicsCode,
      estimated_value: estValue ? Number(estValue) : null,
      response_deadline: deadline || null,
      source_url: sourceUrl.trim() || null,
      description: description.trim() || null,
      status,
      notes: notes.trim() || null,
    };
    const { error } = initial
      ? await supabase.from("tracked_opportunities").update(payload).eq("id", initial.id)
      : await supabase.from("tracked_opportunities").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(initial ? "Opportunity updated" : "Opportunity tracked");
    onSaved();
    onOpenChange(false);
  };

  const naicsLabel = ALL_NAICS_FLAT.find((c) => c.code === naicsCode);
  const dedupedAgencies = Array.from(new Set(agencySuggestions.filter(Boolean))).slice(0, 200);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Tracked Opportunity" : "Track Opportunity"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Agency *</Label>
              <Input
                list="tracked-agency-list"
                value={agency}
                onChange={(e) => setAgency(e.target.value)}
                placeholder="e.g. Department of Defense"
                className="mt-1"
              />
              <datalist id="tracked-agency-list">
                {dedupedAgencies.map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>
            <div>
              <Label className="text-xs">Sub-Agency</Label>
              <Input value={subAgency} onChange={(e) => setSubAgency(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Contract Vehicle *</Label>
              <Select value={vehicle} onValueChange={setVehicle}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_VEHICLES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              {vehicle === "Custom/Other" && (
                <Input
                  value={vehicleOther}
                  onChange={(e) => setVehicleOther(e.target.value)}
                  placeholder="Specify vehicle"
                  className="mt-2"
                />
              )}
            </div>
            <div>
              <Label className="text-xs">NAICS Code *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between mt-1 font-normal">
                    <span className="truncate">
                      <span className="font-mono text-xs mr-2">{naicsCode}</span>
                      <span className="text-muted-foreground text-xs">{naicsLabel?.name}</span>
                    </span>
                    <ChevronDown className="w-4 h-4 ml-2 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[380px] max-h-[360px] overflow-y-auto p-3">
                  {NAICS_GROUPS.map((g) => (
                    <div key={g.label} className="mb-3">
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">{g.label}</div>
                      <div className="space-y-1.5">
                        {g.codes.map((c) => (
                          <label key={c.code} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-1 py-1">
                            <Checkbox
                              checked={naicsCode === c.code}
                              onCheckedChange={() => setNaicsCode(c.code)}
                            />
                            <span className="font-mono text-xs">{c.code}</span>
                            <span className="text-muted-foreground text-xs">{c.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </PopoverContent>
              </Popover>
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
            <Label className="text-xs">Description / SOW Summary</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRACKED_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Internal Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : initial ? "Save changes" : "Track Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
