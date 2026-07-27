import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown, Target } from "lucide-react";
import {
  computePwinProbability,
  type GateStatus,
  type PwinProbabilityInputs,
  type PwinProbabilityResult,
} from "@/lib/pwin-probability";
import type { PwinResult, FactorKey } from "@/lib/pwin";

type PwinConfig = {
  field: { min: number; max: number };
  incumbent: { present: boolean; weAreIncumbent: boolean; retention: number };
  gateOverrides: { setAsideEligible?: GateStatus; vehicleAccess?: GateStatus; clearance?: GateStatus };
};

const DEFAULT_CONFIG: PwinConfig = {
  field: { min: 6, max: 12 },
  incumbent: { present: false, weAreIncumbent: false, retention: 0.6 },
  gateOverrides: {},
};

function gateFromFactor(pwin: PwinResult | null | undefined, key: FactorKey): GateStatus {
  if (!pwin) return "unknown";
  const f = pwin.factors.find((x) => x.key === key);
  if (!f) return "unknown";
  if (f.score < 30) return "fail";
  if (f.score >= 70) return "pass";
  return "unknown";
}

export function PwinProbabilityCard({
  proposal,
  proposalId,
  teamStrength,
  pwinFactors,
  onResult,
  compact,
}: {
  proposal: any;
  proposalId: string;
  teamStrength: number | null;
  pwinFactors: PwinResult | null;
  onResult?: (r: PwinProbabilityResult | null) => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const saved: Partial<PwinConfig> = (proposal?.pwin_config as any) ?? {};

  // Seed field from positioning matrix if no saved value.
  const matrixSeed = useMemo(() => {
    const m = (proposal as any)?.positioning_matrix;
    if (!m?.rows) return null;
    const threats = new Set(["medium", "high", "elevated"]);
    const n = (m.rows as any[]).filter((r) => !r.isUs && threats.has(String(r.threat ?? "").toLowerCase())).length;
    return n >= 2 ? n : null;
  }, [proposal?.positioning_matrix]);

  const incumbentEff = getEffectiveIncumbent(proposal);
  const incumbentSeedName: string | null = incumbentEff.name;


  const [config, setConfig] = useState<PwinConfig>(() => ({
    field: {
      min: saved.field?.min ?? matrixSeed ?? DEFAULT_CONFIG.field.min,
      max: saved.field?.max ?? (matrixSeed ? Math.max(matrixSeed + 4, 8) : DEFAULT_CONFIG.field.max),
    },
    incumbent: {
      present: saved.incumbent?.present ?? !!incumbentSeedName,
      weAreIncumbent: saved.incumbent?.weAreIncumbent ?? false,
      retention: saved.incumbent?.retention ?? DEFAULT_CONFIG.incumbent.retention,
    },
    gateOverrides: saved.gateOverrides ?? {},
  }));

  const vehicleRegistryId: string | null = proposal?.vehicle_registry_id ?? null;
  const { data: vehicleAwardeeCount = 0 } = useQuery({
    queryKey: ["vehicle-awardees-count", vehicleRegistryId],
    enabled: !!vehicleRegistryId,
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("vehicle_awardees")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleRegistryId!);
      if (error) return 0;
      return count ?? 0;
    },
  });

  const seedFromVehiclePool = () => {
    if (!vehicleAwardeeCount) return;
    const max = Math.min(30, vehicleAwardeeCount);
    const min = Math.max(2, Math.min(max, Math.ceil(vehicleAwardeeCount * 0.3)));
    setConfig((c) => ({ ...c, field: { min, max } }));
    toast.success(`Field seeded from ${vehicleAwardeeCount} vehicle awardees`);
  };

  const [open, setOpen] = useState(false);

  const gates = {
    setAsideEligible: config.gateOverrides.setAsideEligible ?? gateFromFactor(pwinFactors, "set_aside"),
    vehicleAccess: config.gateOverrides.vehicleAccess ?? gateFromFactor(pwinFactors, "vehicle_access"),
    clearance: config.gateOverrides.clearance ?? "unknown" as GateStatus,
  };

  const inputs: PwinProbabilityInputs = {
    gates,
    field: { minCredibleBidders: config.field.min, maxCredibleBidders: config.field.max },
    incumbent: config.incumbent,
    teamStrength: teamStrength ?? 0,
  };
  const result = teamStrength == null ? null : computePwinProbability(inputs);

  // Report result upward.
  const lastReportedRef = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(result);
    if (key !== lastReportedRef.current) {
      lastReportedRef.current = key;
      onResult?.(result);
    }
  }, [result, onResult]);

  // Debounced persistence.
  const savedKeyRef = useRef<string>(JSON.stringify(config));
  useEffect(() => {
    const key = JSON.stringify(config);
    if (key === savedKeyRef.current) return;
    const t = setTimeout(async () => {
      savedKeyRef.current = key;
      const { error } = await supabase
        .from("proposals")
        .update({ pwin_config: config as any })
        .eq("id", proposalId);
      if (error) toast.error("Couldn't save PWIN inputs");
      // Local `config` state is the source of truth; parent proposal row will
      // pick up the new pwin_config on its next refetch.

    }, 700);
    return () => clearTimeout(t);
  }, [config, proposalId, qc]);

  const tone = (v: number) => v >= 25 ? "text-success" : v >= 10 ? "text-warning" : "text-destructive";

  return (
    <Card className={compact ? "" : "border-primary/30"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> PWIN (probability)
            </CardTitle>
            <CardDescription className="text-xs">
              Realistic win probability — capability score capped by field size, incumbency, and eligibility gates.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {result == null ? (
          <div className="text-xs text-muted-foreground">Team Strength not yet computed.</div>
        ) : result.gateFailed ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
              <AlertTriangle className="w-4 h-4" /> Gate FAILED: {result.gateFailed}
            </div>
            <div className={`text-3xl font-bold mt-1 ${tone(result.likelyPct)} tabular-nums`}>
              {result.likelyPct}% <span className="text-xs font-normal text-muted-foreground">({result.lowPct}–{result.highPct}%)</span>
            </div>
            <ul className="text-xs mt-2 space-y-0.5 text-muted-foreground list-disc pl-4">
              {result.drivers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <div className={`text-4xl font-bold tabular-nums ${tone(result.likelyPct)}`}>{result.likelyPct}%</div>
              <div className="text-sm text-muted-foreground tabular-nums">
                ({result.lowPct}–{result.highPct}%)
              </div>
            </div>
            <ul className="text-xs space-y-0.5 text-muted-foreground list-disc pl-4">
              {result.drivers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </>
        )}

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <ChevronDown className={`w-3 h-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Hide inputs" : "Edit inputs"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3 border-t mt-2">
            {/* Field */}
            <div>
              <Label className="text-xs">Credible bidder field</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number" min={2} max={30} className="h-8 w-20"
                  value={config.field.min}
                  onChange={(e) => setConfig((c) => ({ ...c, field: { ...c.field, min: Math.max(2, Number(e.target.value) || 2) } }))}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="number" min={2} max={30} className="h-8 w-20"
                  value={config.field.max}
                  onChange={(e) => setConfig((c) => ({ ...c, field: { ...c.field, max: Math.max(c.field.min, Number(e.target.value) || c.field.min) } }))}
                />
                <span className="text-xs text-muted-foreground">credible bidders</span>
              </div>
              {matrixSeed && !saved.field && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Seeded from positioning matrix — {matrixSeed} medium+ threat row(s).
                </div>
              )}
              {vehicleAwardeeCount > 0 && (
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-[11px] mt-1"
                  onClick={seedFromVehiclePool}
                >
                  Seed field from vehicle pool ({vehicleAwardeeCount} awardees)
                </Button>
              )}
            </div>

            {/* Incumbent */}
            <div className="space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Incumbent present{incumbentSeedName ? ` (${incumbentSeedName})` : ""}</Label>
                <Switch
                  checked={config.incumbent.present}
                  onCheckedChange={(v) => setConfig((c) => ({ ...c, incumbent: { ...c.incumbent, present: v } }))}
                />
              </div>
              {config.incumbent.present && (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">We are the incumbent</Label>
                    <Switch
                      checked={config.incumbent.weAreIncumbent}
                      onCheckedChange={(v) => setConfig((c) => ({ ...c, incumbent: { ...c.incumbent, weAreIncumbent: v } }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs flex justify-between">
                      <span>Incumbent retention</span>
                      <span className="tabular-nums">{Math.round(config.incumbent.retention * 100)}%</span>
                    </Label>
                    <Slider
                      value={[Math.round(config.incumbent.retention * 100)]}
                      min={30} max={85} step={5}
                      onValueChange={([v]) => setConfig((c) => ({ ...c, incumbent: { ...c.incumbent, retention: v / 100 } }))}
                    />
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Adjust from human intel — incumbent vulnerability lowers this.
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Gates */}
            <div className="space-y-1.5">
              <Label className="text-xs">Eligibility gates</Label>
              {(["setAsideEligible", "vehicleAccess", "clearance"] as const).map((k) => {
                const labels = { setAsideEligible: "Set-aside", vehicleAccess: "Vehicle access", clearance: "Clearance" };
                const derived = k === "setAsideEligible" ? gateFromFactor(pwinFactors, "set_aside")
                  : k === "vehicleAccess" ? gateFromFactor(pwinFactors, "vehicle_access")
                  : "unknown";
                const val = config.gateOverrides[k] ?? derived;
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="text-xs w-28">{labels[k]}</span>
                    <Select
                      value={val}
                      onValueChange={(v) => setConfig((c) => ({
                        ...c,
                        gateOverrides: { ...c.gateOverrides, [k]: v as GateStatus },
                      }))}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pass">Pass</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                        <SelectItem value="fail">Fail</SelectItem>
                      </SelectContent>
                    </Select>
                    {!config.gateOverrides[k] && (
                      <Badge variant="outline" className="text-[9px]">auto</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
