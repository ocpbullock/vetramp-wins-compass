import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, ChevronDown, ChevronRight, Loader2, Network, RefreshCw, Target, Users, UserPlus, Grid3x3,
} from "lucide-react";
import { useTeam } from "@/lib/team";
import { upsertCompany } from "@/lib/companies";
import { VendorDetailDrawer } from "@/components/dashboard/VendorDetailDrawer";
import {
  generateEcosystem,
  readEcosystem,
  readEcosystemConfig,
  saveEcosystemConfig,
  type EcosystemConfig,
  type EcosystemExpansion,
} from "@/lib/ecosystem-build";
import {
  BASE_WEIGHTS,
  type BuildEcosystemResult,
  type EcosystemCompany,
  type EcosystemRole,
  type EligibilityTier,
  type FactorKey,
} from "@/lib/ecosystem-rank";

const ROLE_ORDER: EcosystemRole[] = [
  "known_competitor",
  "incumbent",
  "likely_prime_competitor",
  "prime_teaming_partner",
  "coalition_partner",
  "dark_horse",
];

const ROLE_LABEL: Record<EcosystemRole, string> = {
  known_competitor: "Known competitors",
  incumbent: "Incumbent",
  likely_prime_competitor: "Likely prime competitors",
  prime_teaming_partner: "Prime teaming partners",
  coalition_partner: "Coalition partners",
  dark_horse: "Dark horses",
};

const TIER_LABEL: Record<EligibilityTier, string> = {
  validated: "Validated",
  likely: "Likely eligible",
  requires_validation: "Needs validation",
  not_eligible: "Not eligible",
};

const TIER_CLASS: Record<EligibilityTier, string> = {
  validated: "bg-success/15 text-success border-success/30",
  likely: "bg-accent/20 text-accent-foreground border-accent/40",
  requires_validation: "bg-warning/15 text-warning border-warning/30",
  not_eligible: "bg-destructive/10 text-destructive border-destructive/30",
};

const TEAMABLE: EcosystemRole[] = ["coalition_partner", "dark_horse", "prime_teaming_partner"];

const FACTOR_ORDER: FactorKey[] = [
  "customer_experience",
  "naics_experience",
  "contract_size",
  "scope_similarity",
  "agency_experience",
];

const FACTOR_LABEL: Record<FactorKey, string> = {
  customer_experience: "Customer experience",
  naics_experience: "Primary NAICS experience",
  contract_size: "Similar contract size",
  scope_similarity: "Similar scope",
  agency_experience: "Broader agency experience",
};

function when(ts: string | null | undefined): string {
  if (!ts) return "never";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

export function EcosystemCard({
  proposal,
  proposalId,
  onChanged,
}: {
  proposal: any;
  proposalId: string;
  onChanged?: () => void;
}) {
  const { currentTeam } = useTeam();
  const [result, setResult] = useState<BuildEcosystemResult | null>(() => readEcosystem(proposal));
  const [generatedAt, setGeneratedAt] = useState<string | null>(proposal?.ecosystem_at ?? null);
  const [config, setConfig] = useState<EcosystemConfig>(() => readEcosystemConfig(proposal));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [vendor, setVendor] = useState<{ name: string; uei: string | null } | null>(null);
  const [pool, setPool] = useState<{ count: number; latest: string | null; name: string | null } | null>(null);

  const vehicleId: string | null = proposal?.vehicle_registry_id ?? null;

  // Live vehicle-holder count — the ecosystem is only as good as this roster.
  useEffect(() => {
    let cancelled = false;
    if (!vehicleId) { setPool(null); return; }
    void (async () => {
      const [{ data: rows }, { data: veh }] = await Promise.all([
        supabase.from("vehicle_awardees").select("created_at").eq("vehicle_id", vehicleId),
        supabase.from("vehicle_registry").select("vehicle_name").eq("id", vehicleId).maybeSingle(),
      ]);
      if (cancelled) return;
      const created = (rows ?? []).map((r: any) => r.created_at).filter(Boolean).sort();
      setPool({
        count: rows?.length ?? 0,
        latest: created.length ? created[created.length - 1] : null,
        name: (veh as any)?.vehicle_name ?? (proposal?.contract_vehicle ?? null),
      });
    })();
    return () => { cancelled = true; };
  }, [vehicleId, proposal?.contract_vehicle]);

  const grouped = useMemo(() => {
    const map = new Map<EcosystemRole, EcosystemCompany[]>();
    for (const c of result?.companies ?? []) {
      const list = map.get(c.role) ?? [];
      list.push(c);
      map.set(c.role, list);
    }
    return map;
  }, [result]);

  const onVehicleCount = (result?.companies ?? []).filter((c) => c.onVehicle).length;
  const vehicleDropout = !!result && !!pool && pool.count > 0 && onVehicleCount === 0;
  const rosterStale =
    !!result && !!pool?.latest && !!generatedAt && new Date(pool.latest) > new Date(generatedAt);


  const run = async (expand?: EcosystemExpansion) => {
    setBusy(true);
    setStep("Starting…");
    try {
      const r = await generateEcosystem({ ...proposal, ecosystem_config: config }, expand ? { expand } : undefined, setStep);
      setResult(r);
      setGeneratedAt(new Date().toISOString());
      toast.success(`Ecosystem built — ${r.companies.length} companies`);
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't build the ecosystem");
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  const persistConfig = async (next: EcosystemConfig) => {
    setConfig(next);
    try {
      await saveEcosystemConfig(proposalId, next);
    } catch {
      toast.error("Couldn't save ecosystem settings");
    }
  };

  const setTier = async (company: EcosystemCompany, tier: EligibilityTier) => {
    const next: EcosystemConfig = {
      ...config,
      validatedOverrides: { ...(config.validatedOverrides ?? {}), [company.name]: tier },
    };
    await persistConfig(next);
    // Reflect immediately in the rendered ecosystem + persisted snapshot.
    setResult((prev) => {
      if (!prev) return prev;
      const companies = prev.companies.map((c) =>
        c.name === company.name ? { ...c, eligibility: tier } : c,
      );
      const updated = { ...prev, companies };
      void supabase.from("proposals").update({ ecosystem: updated as any } as any).eq("id", proposalId);
      return updated;
    });
    toast.success(`${company.name} → ${TIER_LABEL[tier]}`);
  };

  const addToMatrix = async (c: EcosystemCompany) => {
    const m = (proposal?.positioning_matrix ?? {}) as any;
    const rows: any[] = Array.isArray(m.rows) ? m.rows : [];
    if (rows.some((r) => String(r?.company ?? "").toLowerCase() === c.name.toLowerCase())) {
      toast.info("Already on the positioning matrix");
      return;
    }
    const dims: string[] = Array.isArray(m.dimensions) ? m.dimensions : [];
    const ratings: Record<string, string> = {};
    for (const d of dims) ratings[d] = "unknown";
    const payload = {
      ...m,
      dimensions: dims,
      rows: [...rows, {
        company: c.name,
        isUs: false,
        threat: c.role === "likely_prime_competitor" ? "high" : "medium",
        ratings,
        coverage: c.inclusionReason,
      }],
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from("proposals").update({ positioning_matrix: payload as any }).eq("id", proposalId);
    if (error) { toast.error("Couldn't update the matrix"); return; }
    toast.success(`${c.name} added to the positioning matrix`);
    onChanged?.();
  };

  const addToRoster = async (c: EcosystemCompany) => {
    if (!currentTeam) { toast.error("No active team"); return null; }
    try {
      const company = await upsertCompany({
        team_id: currentTeam.id,
        name: c.name,
        uei: c.uei,
        relationship_status: "prospective",
        source: "ecosystem",
        notes: c.inclusionReason,
      });
      toast.success(`${c.name} added to the partner roster`);
      return company;
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add to roster");
      return null;
    }
  };

  const addToTeam = async (c: EcosystemCompany) => {
    const company = await addToRoster(c);
    if (!company) return;
    const { error } = await supabase.from("proposal_teaming").insert({
      proposal_id: proposalId,
      company_id: company.id,
      role: "sub",
      work_share_pct: 15,
      notes: `From competitive ecosystem — ${c.inclusionReason}`,
    } as any);
    if (error) { toast.error("Couldn't add to the proposed team"); return; }
    toast.success(`${c.name} added to the proposed team at 15%`);
    onChanged?.();
  };

  const seedPwinField = async () => {
    const n = result?.summary.primeCompetitorCount ?? 0;
    const min = Math.max(2, Math.min(30, n));
    const max = Math.max(min, Math.min(30, n + 4));
    const cfg = { ...((proposal?.pwin_config as any) ?? {}) };
    cfg.field = { min, max };
    cfg.fieldNote = `seeded from ecosystem: ${n} likely primes`;
    const { error } = await supabase.from("proposals").update({ pwin_config: cfg as any }).eq("id", proposalId);
    if (error) { toast.error("Couldn't seed the PWIN field"); return; }
    toast.success(`PWIN field seeded: ${min}–${max} credible bidders`);
    onChanged?.();
  };

  const weights = config.weights ?? {};
  const summary = result?.summary;
  const counts = {
    primes: (grouped.get("likely_prime_competitor") ?? []).length,
    coalition: (grouped.get("coalition_partner") ?? []).length,
    dark: (grouped.get("dark_horse") ?? []).length,
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" /> Competitive Ecosystem
            </CardTitle>
            <CardDescription className="text-xs">
              Last generated: {when(generatedAt)}
              {busy && step ? ` · ${step}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {result && (
              <Button size="sm" variant="outline" onClick={seedPwinField} disabled={busy}>
                <Target className="w-3.5 h-3.5 mr-1" /> Seed PWIN field
              </Button>
            )}
            <Button size="sm" onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              {result ? "Regenerate" : "Generate competitive ecosystem"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {summary && (
            <>
              <Badge variant="secondary" className="text-xs">{result!.companies.length} companies</Badge>
              <Badge variant="secondary" className="text-xs">{counts.primes} likely primes</Badge>
              <Badge variant="secondary" className="text-xs">{counts.coalition} coalition</Badge>
              <Badge variant="secondary" className="text-xs">{counts.dark} dark horses</Badge>
            </>
          )}
          {vehicleId && pool && (
            pool.count > 0 ? (
              <Badge variant="outline" className="text-xs">
                {pool.name ?? "Vehicle pool"} — {pool.count} holders loaded
              </Badge>
            ) : (
              <Link to="/settings" hash="vehicles" className="no-underline">
                <Badge variant="outline" className="text-xs bg-warning/15 text-warning border-warning/30">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  0 holders loaded — import or research the holder list
                </Badge>
              </Link>
            )
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!result && (
          <p className="text-sm text-muted-foreground">
            No ecosystem built yet. Generate one to map who can credibly bid this opportunity — the primes
            you'll face and the partners you'll recruit.
          </p>
        )}

        {vehicleDropout && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
              None of the {pool!.count} vehicle holders made it into the ecosystem — likely a data problem,
              not a market reality. Regenerate after this update.
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
              Regenerate
            </Button>
          </div>
        )}

        {rosterStale && !vehicleDropout && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span>
              Inputs changed — vehicle holders were imported after this ecosystem was generated
              ({when(pool!.latest)}).
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
              Regenerate
            </Button>
          </div>
        )}

        {result?.needsExpansion && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span>
              Fewer than 10 credible companies — expand to{" "}
              {result.needsExpansion === "adjacent_naics" ? "adjacent NAICS at this customer" : "the parent agency"}.
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(result.needsExpansion!)}>
              Expand &amp; rerun
            </Button>
          </div>
        )}

        {ROLE_ORDER.map((role) => {
          const allRows = grouped.get(role) ?? [];
          if (allRows.length === 0) return null;
          // A long tail of unvalidated vehicle holders shouldn't bury the ranked
          // companies — fold it away until the human works through it.
          const pending = allRows.filter((c) => c.onVehicle && c.eligibility === "requires_validation");
          const foldPending = pending.length > 10;
          const rows = foldPending ? allRows.filter((c) => !pending.includes(c)) : allRows;
          const renderRow = (c: EcosystemCompany) => {
                const open = openRow === c.name;
                return (
                  <div key={c.name} className="rounded-md border">
                    <div className="flex flex-wrap items-center gap-2 p-2">
                      <button
                        type="button"
                        className="p-0.5 text-muted-foreground"
                        aria-label={open ? "Collapse" : "Expand"}
                        onClick={() => setOpenRow(open ? null : c.name)}
                      >
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-left hover:underline"
                        onClick={() => setVendor({ name: c.name, uei: c.uei })}
                      >
                        {c.name}
                      </button>
                      {c.onVehicle && <Badge variant="outline" className="text-[10px]">On vehicle</Badge>}
                      <Badge variant="outline" className={`text-[10px] ${TIER_CLASS[c.eligibility]}`}>
                        {TIER_LABEL[c.eligibility]}
                      </Badge>
                      {c.score != null && (
                        <span className="text-xs text-muted-foreground">score {c.score}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground uppercase">{c.confidence} confidence</span>

                const open = openRow === c.name;
                return (
                  <div key={c.name} className="rounded-md border">
                    <div className="flex flex-wrap items-center gap-2 p-2">
                      <button
                        type="button"
                        className="p-0.5 text-muted-foreground"
                        aria-label={open ? "Collapse" : "Expand"}
                        onClick={() => setOpenRow(open ? null : c.name)}
                      >
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-left hover:underline"
                        onClick={() => setVendor({ name: c.name, uei: c.uei })}
                      >
                        {c.name}
                      </button>
                      {c.onVehicle && <Badge variant="outline" className="text-[10px]">On vehicle</Badge>}
                      <Badge variant="outline" className={`text-[10px] ${TIER_CLASS[c.eligibility]}`}>
                        {TIER_LABEL[c.eligibility]}
                      </Badge>
                      {c.score != null && (
                        <span className="text-xs text-muted-foreground">score {c.score}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground uppercase">{c.confidence} confidence</span>

                      <div className="ml-auto flex flex-wrap items-center gap-1.5">
                        <Select value={c.eligibility} onValueChange={(v) => void setTier(c, v as EligibilityTier)}>
                          <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(TIER_LABEL) as EligibilityTier[]).map((t) => (
                              <SelectItem key={t} value={t} className="text-xs">{TIER_LABEL[t]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void addToMatrix(c)}>
                          <Grid3x3 className="w-3 h-3 mr-1" /> Matrix
                        </Button>
                        {TEAMABLE.includes(c.role) && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void addToTeam(c)}>
                            <Users className="w-3 h-3 mr-1" /> Team
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void addToRoster(c)}>
                          <UserPlus className="w-3 h-3 mr-1" /> Roster
                        </Button>
                      </div>
                    </div>

                    {open && (
                      <div className="border-t p-3 space-y-3 text-xs bg-muted/30">
                        {c.factorBreakdown.length > 0 && (
                          <table className="w-full">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="font-medium py-1">Factor</th>
                                <th className="font-medium py-1 w-16">Weight</th>
                                <th className="font-medium py-1 w-16">Score</th>
                                <th className="font-medium py-1">Evidence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.factorBreakdown.map((f) => (
                                <tr key={f.key} className="border-t">
                                  <td className="py-1 pr-2">{f.label}</td>
                                  <td className="py-1">{f.weight}</td>
                                  <td className="py-1">{Math.round(f.score * 100)}</td>
                                  <td className="py-1 text-muted-foreground">{f.evidence}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {c.evidence.customerAwards + c.evidence.naicsAwards + c.evidence.agencyAwards === 0 ? (
                          <div className="text-muted-foreground">
                            No relevant awards found in the pulled window
                            {c.onVehicle ? " — included because they hold the required vehicle." : "."}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">
                            {c.evidence.customerAwards} customer award(s) · {c.evidence.naicsAwards} in NAICS ·{" "}
                            {c.evidence.agencyAwards} at the department · latest{" "}
                            {c.evidence.latestRelevantDate?.slice(0, 10) ?? "—"} · avg award{" "}
                            {c.evidence.avgAwardSize ? `$${c.evidence.avgAwardSize.toLocaleString()}` : "—"}
                          </div>
                        )}
                        {c.eligibilityReasons.length > 0 && (
                          <div>
                            <div className="font-medium">Eligibility</div>
                            <ul className="list-disc pl-4 text-muted-foreground">
                              {c.eligibilityReasons.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                          </div>
                        )}
                        {c.eligibilityQuestions.length > 0 && (
                          <div>
                            <div className="font-medium">Open questions</div>
                            <ul className="list-disc pl-4 text-muted-foreground">
                              {c.eligibilityQuestions.map((q, i) => <li key={i}>{q}</li>)}
                            </ul>
                          </div>
                        )}
                        <div className="text-muted-foreground italic">{c.inclusionReason}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Weights editor */}
        <div className="border-t pt-3">
          <button
            type="button"
            className="text-xs font-medium flex items-center gap-1 text-muted-foreground"
            onClick={() => setShowWeights((v) => !v)}
          >
            {showWeights ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} Adjust weights
          </button>
          {showWeights && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 pt-3">
              {FACTOR_ORDER.map((k) => (
                <label key={k} className="text-xs space-y-1">
                  <span className="text-muted-foreground">{FACTOR_LABEL[k]}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 text-xs"
                    value={weights[k] ?? BASE_WEIGHTS[k]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      void persistConfig({
                        ...config,
                        weights: { ...weights, [k]: Number.isFinite(v) ? v : BASE_WEIGHTS[k] },
                      });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground border-t pt-3">
          Deterministic ranking from award data + vehicle rosters + your intel. Eligibility tiers require human
          validation — holding awards or a vehicle does not mean a company is bidding.
        </p>
      </CardContent>

      {vendor && (
        <VendorDetailDrawer
          recipientId={null}
          vendorName={vendor.name}
          searchedNaics={[proposal?.naics_code].filter(Boolean) as string[]}
          onClose={() => setVendor(null)}
        />
      )}
    </Card>
  );
}
