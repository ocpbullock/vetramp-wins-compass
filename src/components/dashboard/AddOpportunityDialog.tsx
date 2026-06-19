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
import { useTeam } from "@/lib/team";
import { toast } from "sonner";
import { CONTRACT_VEHICLES } from "@/components/dashboard/TrackOpportunityDialog";

const ALL_NAICS_FLAT = NAICS_GROUPS.flatMap((g) => g.codes);

export function AddOpportunityDialog({
  open,
  onOpenChange,
  agencySuggestions = [],
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agencySuggestions?: string[];
  onCreated: (proposalId: string) => void;
}) {
  const { user } = useAuth();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id ?? null;
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
  const [incumbent, setIncumbent] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(""); setAgency(""); setSubAgency(""); setVehicle("GSA Schedule");
    setVehicleOther(""); setNaicsCode("541512"); setEstValue(""); setDeadline("");
    setSourceUrl(""); setIncumbent(""); setDescription("");
  }, [open]);

  const handleSave = async () => {
    if (!user) return;
    if (!title.trim() || !agency.trim() || !naicsCode) {
      toast.error("Title, Agency, and NAICS are required");
      return;
    }
    setSaving(true);
    const resolvedVehicle = vehicle === "Custom/Other" ? (vehicleOther.trim() || "Custom/Other") : vehicle;
    const fullAgency = subAgency.trim() ? `${agency.trim()} — ${subAgency.trim()}` : agency.trim();
    const solNum = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: user.id,
      team_id: teamId,
      solicitation_number: solNum,
      opportunity_title: title.trim(),
      agency: fullAgency,
      naics_code: naicsCode,
      estimated_value: estValue ? Number(estValue) : null,
      response_deadline: deadline ? new Date(`${deadline}T23:59:59Z`).toISOString() : null,
      known_incumbent: incumbent.trim() || null,
      capture_notes: description.trim() || null,
      opportunity_source: "manual",
      capture_stage: "intake",
      status: "intake",
      opportunity_data: {
        sub_agency: subAgency.trim() || null,
        contract_vehicle: resolvedVehicle,
        source_url: sourceUrl.trim() || null,
      },
    };
    const { data, error } = await supabase
      .from("proposals")
      .insert(payload)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) { toast.error(error?.message ?? "Failed to create opportunity"); return; }
    toast.success("Opportunity created");
    onOpenChange(false);
    onCreated(data.id);
  };

  const naicsLabel = ALL_NAICS_FLAT.find((c) => c.code === naicsCode);
  const dedupedAgencies = Array.from(new Set(agencySuggestions.filter(Boolean))).slice(0, 200);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Opportunity</DialogTitle>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Contract Vehicle</Label>
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Create Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
