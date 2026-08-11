import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { X, Plus, Compass } from "lucide-react";
import { NaicsCombobox } from "@/components/NaicsCombobox";
import { VehiclePicker } from "@/components/proposals/VehiclePicker";
import { EcosystemCard } from "@/components/proposals/EcosystemCard";
import {
  readEcosystemConfig,
  saveEcosystemConfig,
  type EcosystemConfig,
} from "@/lib/ecosystem-build";

const SET_ASIDE_OPTIONS = [
  { value: "__none", label: "None / Full & Open" },
  { value: "SDVOSB", label: "SDVOSB" },
  { value: "VOSB", label: "VOSB" },
  { value: "8(a)", label: "8(a)" },
  { value: "WOSB", label: "WOSB" },
  { value: "EDWOSB", label: "EDWOSB" },
  { value: "HUBZone", label: "HUBZone" },
  { value: "Total_Small_Business", label: "Total Small Business" },
];

function splitKeywords(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ChipInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const parts = splitKeywords(draft);
    if (parts.length === 0) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      next.push(p);
    }
    setDraft("");
    if (next.length !== values.length) onChange(next);
  };

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 opacity-70">· {hint}</span>}
      </div>
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-xs"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
          onBlur={add}
        />
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={add} aria-label={`Add ${label}`}>
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="text-[11px] gap-1 pr-1">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="opacity-60 hover:opacity-100"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function EcosystemPanel({
  proposal,
  proposalId,
  onPatch,
  onProposalPatch,
  onChanged,
}: {
  proposal: any;
  proposalId: string;
  /** Persisting patch helper (optimistic + revert) from the hub. */
  onPatch: (patch: any) => void | Promise<void>;
  /** Local-only state patch (used for writes issued here directly). */
  onProposalPatch: (patch: any) => void;
  onChanged?: () => void;
}) {
  const [incumbent, setIncumbent] = useState<string>(proposal?.known_incumbent ?? "");
  const [value, setValue] = useState<string>(
    proposal?.estimated_value != null ? String(proposal.estimated_value) : "",
  );
  const [config, setConfig] = useState<EcosystemConfig>(() => readEcosystemConfig(proposal));

  useEffect(() => { setIncumbent(proposal?.known_incumbent ?? ""); }, [proposal?.known_incumbent]);
  useEffect(() => {
    setValue(proposal?.estimated_value != null ? String(proposal.estimated_value) : "");
  }, [proposal?.estimated_value]);

  const keywords = useMemo(() => splitKeywords(proposal?.targeted_scope_areas), [proposal?.targeted_scope_areas]);
  const competitors = config.userIntel?.knownCompetitors ?? [];
  const teammates = config.userIntel?.knownTeammates ?? [];

  const persistConfig = async (next: EcosystemConfig) => {
    setConfig(next);
    onProposalPatch({ ecosystem_config: next });
    try {
      await saveEcosystemConfig(proposalId, next);
    } catch {
      toast.error("Couldn't save your ecosystem intel");
    }
  };

  const saveVehicle = async (patch: { vehicle_status: string; vehicle_registry_id: string | null; contract_vehicle: string | null }) => {
    const { contract_vehicle, ...cols } = patch;
    const nextOppData = { ...((proposal?.opportunity_data as any) ?? {}), contract_vehicle };
    onProposalPatch({ ...cols, opportunity_data: nextOppData });
    const { error } = await supabase
      .from("proposals")
      .update({ ...cols, opportunity_data: nextOppData } as any)
      .eq("id", proposalId);
    if (error) { toast.error(error.message); return; }
    onChanged?.();
  };

  const neverGenerated = !proposal?.ecosystem_at;

  return (
    <div className="space-y-4">
      <Card className="border-[color:var(--brand-brass)]/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Compass className="w-4 h-4 text-[color:var(--brand-brass)]" /> What defines this opportunity
          </CardTitle>
          <CardDescription className="text-xs">
            These fields drive the ranking. Confirm them before you generate — everything saves as you edit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5 min-w-0">
              <div className="text-xs text-muted-foreground">Primary NAICS</div>
              <NaicsCombobox
                value={proposal?.naics_code ?? null}
                onChange={(code) => void onPatch({ naics_code: code })}
                allowClear
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="text-xs text-muted-foreground">Set-aside</div>
              <Select
                value={proposal?.set_aside || "__none"}
                onValueChange={(v) => void onPatch({ set_aside: v === "__none" ? null : v })}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SET_ASIDE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="text-xs text-muted-foreground">Estimated value (USD)</div>
              <Input
                inputMode="numeric"
                className="h-9 text-sm"
                placeholder="e.g. 25000000"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => {
                  const n = Number(String(value).replace(/[^0-9.]/g, ""));
                  const next = Number.isFinite(n) && value.trim() !== "" ? n : null;
                  if (next !== (proposal?.estimated_value ?? null)) void onPatch({ estimated_value: next });
                }}
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="text-xs text-muted-foreground">Known incumbent</div>
              <Input
                className="h-9 text-sm"
                placeholder="Incumbent prime"
                value={incumbent}
                onChange={(e) => setIncumbent(e.target.value)}
                onBlur={() => {
                  const next = incumbent.trim() || null;
                  if (next !== (proposal?.known_incumbent ?? null)) void onPatch({ known_incumbent: next });
                }}
              />
            </div>

            <div className="md:col-span-2 xl:col-span-2 rounded-md border p-3">
              <VehiclePicker
                teamId={proposal?.team_id ?? null}
                status={(proposal?.vehicle_status as string) ?? "unknown"}
                vehicleId={(proposal?.vehicle_registry_id as string) ?? null}
                onChange={saveVehicle}
                compact
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <ChipInput
              label="Scope keywords"
              hint="what the work actually is"
              placeholder="cyber operations, ATO support…"
              values={keywords}
              onChange={(next) => void onPatch({ targeted_scope_areas: next.length ? next.join(", ") : null })}
            />
            <ChipInput
              label="Known competitors"
              hint="who you expect to bid"
              placeholder="Add a company"
              values={competitors}
              onChange={(next) => void persistConfig({
                ...config,
                userIntel: { ...(config.userIntel ?? {}), knownCompetitors: next },
              })}
            />
            <ChipInput
              label="Known teammates"
              hint="who you'd recruit"
              placeholder="Add a company"
              values={teammates}
              onChange={(next) => void persistConfig({
                ...config,
                userIntel: { ...(config.userIntel ?? {}), knownTeammates: next },
              })}
            />
          </div>
        </CardContent>
      </Card>

      {neverGenerated && (
        <div className="rounded-md border border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_10%,transparent)] p-3 text-sm">
          <span className="font-semibold">Step 1:</span> confirm what matters above, then generate your competitive
          ecosystem — the primes you'll face and the partners you'll recruit.
        </div>
      )}

      <EcosystemCard proposal={proposal} proposalId={proposalId} onChanged={onChanged} />
    </div>
  );
}
