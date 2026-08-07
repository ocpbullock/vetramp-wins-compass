import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { generateMarketSnapshot, isMarketSnapshotInProgress, type MarketSnapshot } from "@/lib/market-snapshot";
import { companyFromTeamingTarget } from "@/lib/teaming-targets";
import { upsertCompany, type CompanyDraft } from "@/lib/companies";
import { VendorDetailDrawer } from "@/components/dashboard/VendorDetailDrawer";
import type { TeamingTarget } from "@/lib/teaming-targets";
import { nextCaptureStage, CAPTURE_STAGE_LABEL } from "@/lib/capture-stage";
import { applyCaptureStage } from "@/lib/stage-mutations";
import { getEffectiveIncumbent, incumbentSourceBadge } from "@/lib/incumbent-source";

type VehicleAwardee = {
  id: string;
  company_name: string;
  uei: string | null;
  small_business: boolean | null;
  socioeconomic: string[] | null;
};

function fmtUsd(n: number) {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function MarketIntelPanel({
  proposal,
  proposalId,
  customerIntelSlot,
}: {
  proposal: any;
  proposalId: string;
  customerIntelSlot?: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(
    (proposal?.market_snapshot as MarketSnapshot | null) ?? null,
  );
  const [generatedAt, setGeneratedAt] = useState<string | null>(proposal?.market_snapshot_at ?? null);
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [bgActive, setBgActive] = useState<boolean>(() => isMarketSnapshotInProgress(proposalId));
  const [vendor, setVendor] = useState<{ recipientId: string | null; name: string | null } | null>(null);
  const [savingPartner, setSavingPartner] = useState<string | null>(null);

  const vehicleId: string | null = proposal?.vehicle_registry_id ?? null;

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle-registry-row", vehicleId],
    enabled: !!vehicleId,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_registry")
        .select("id, vehicle_name")
        .eq("id", vehicleId!)
        .maybeSingle();
      return data;
    },
  });

  // RLS returns global (team_id IS NULL) + this team's rows.
  const { data: awardees = [], isLoading: awardeesLoading } = useQuery({
    queryKey: ["market-intel-vehicle-awardees", vehicleId],
    enabled: !!vehicleId,
    staleTime: 15 * 60 * 1000,
    queryFn: async (): Promise<VehicleAwardee[]> => {
      const { data, error } = await supabase
        .from("vehicle_awardees")
        .select("id, company_name, uei, small_business, socioeconomic")
        .eq("vehicle_id", vehicleId!)
        .order("company_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as VehicleAwardee[];
    },
  });

  const addAwardee = async (a: VehicleAwardee) => {
    if (!proposal.team_id) { toast.error("No team on this opportunity"); return; }
    setSavingPartner(a.uei || a.company_name);
    try {
      const draft: CompanyDraft = {
        team_id: proposal.team_id,
        name: a.company_name,
        uei: a.uei,
        certifications: a.socioeconomic ?? [],
        contract_vehicles: vehicle?.vehicle_name ? [vehicle.vehicle_name] : [],
        source: "vehicle_awardees",
        is_existing_partner: false,
        relationship_status: "prospective",
        notes: vehicle?.vehicle_name ? `Added from ${vehicle.vehicle_name} awardee pool` : undefined,
      };
      await upsertCompany(draft);
      toast.success(`Added ${a.company_name} to roster`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add");
    } finally {
      setSavingPartner(null);
    }
  };


  // Low-frequency poll while a background generation is genuinely in flight
  // (sessionStorage key set by kickOffMarketSnapshot, younger than 3 min).
  useEffect(() => {
    if (snapshot) return;
    if (!isMarketSnapshotInProgress(proposalId)) { setBgActive(false); return; }
    setBgActive(true);
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (!isMarketSnapshotInProgress(proposalId)) { setBgActive(false); return; }
      const { data } = await supabase
        .from("proposals")
        .select("market_snapshot, market_snapshot_at")
        .eq("id", proposalId)
        .maybeSingle();
      if ((data as any)?.market_snapshot) {
        setSnapshot((data as any).market_snapshot as MarketSnapshot);
        setGeneratedAt((data as any).market_snapshot_at ?? null);
        setBgActive(false);
        return;
      }
      if (!stopped) setTimeout(tick, 5000);
    };
    const t = setTimeout(tick, 5000);
    return () => { stopped = true; clearTimeout(t); };
  }, [proposalId, snapshot]);

  const generate = async () => {
    setLoading(true);
    setProgressStep("Starting…");
    try {
      const snap = await generateMarketSnapshot(proposal, { onProgress: (s) => setProgressStep(s) });
      setSnapshot(snap);
      setGeneratedAt(snap.generatedAt);
      if (snap.awardsError) {
        toast.warning(`Market snapshot generated, but award data was unavailable: ${snap.awardsError}`);
      } else {
        const next = nextCaptureStage(proposal?.capture_stage);
        toast.success("Market snapshot generated", next ? {
          action: {
            label: `Move to ${CAPTURE_STAGE_LABEL[next]}`,
            onClick: () => { void applyCaptureStage(proposalId, next); },
          },
        } : undefined);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate snapshot");
    } finally {
      setLoading(false);
      setProgressStep(null);
    }
  };

  const addPartner = async (t: TeamingTarget) => {
    if (!proposal.team_id) { toast.error("No team on this proposal"); return; }
    setSavingPartner(t.uei || t.name);
    try {
      const draft = companyFromTeamingTarget(t, proposal.team_id, {
        naicsCodes: proposal.naics_code ? [String(proposal.naics_code)] : [],
        agency: proposal.agency ?? null,
      });
      await upsertCompany(draft);
      toast.success(`Added ${t.name} to roster`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add");
    } finally {
      setSavingPartner(null);
    }
  };

  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Market Intel</CardTitle>
          <CardDescription>
            Pulls historical awards, incumbent, prior primes/subs, candidate partners, and competitive landscape into one snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={generate} disabled={loading || !proposal?.naics_code || !proposal?.agency}>
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {progressStep ?? "Generating…"}</>
              : <><Sparkles className="w-4 h-4 mr-2" /> Generate market snapshot</>}
          </Button>
          {!loading && bgActive && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating snapshot in background…
            </div>
          )}
          {(!proposal?.naics_code || !proposal?.agency) && (
            <p className="text-xs text-muted-foreground">
              {!proposal?.naics_code
                ? "No NAICS yet — parse your documents or set it in Opportunity details."
                : "Agency is required — set it in Opportunity details."}
            </p>
          )}
          {(loading || bgActive) && <Skeleton className="h-24 w-full" />}
        </CardContent>

      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Market Intel</CardTitle>
            <CardDescription>
              Last generated {generatedAt ? new Date(generatedAt).toLocaleString() : "—"}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Regenerate
          </Button>
        </CardHeader>
      </Card>

      {/* Historical spending */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historical spending</CardTitle>
          <CardDescription>
            NAICS {snapshot.inputs.naicsCodes.join(", ") || "—"} · {snapshot.inputs.startDate} → {snapshot.inputs.endDate}
            {" · "}
            {snapshot.inputs.scope === "naics_only"
              ? (snapshot.inputs.agency
                  ? "NAICS-wide (no agency-scoped awards found)"
                  : "NAICS-wide (no agency set)")
              : "agency-scoped"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(snapshot.awardsError || snapshot.historical.fetched === 0) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {snapshot.awardsError
                ? `No award data returned — ${snapshot.awardsError}. Check NAICS or daily API quota.`
                : "No award data returned — check NAICS or daily API quota."}
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            <div><span className="text-muted-foreground">Total awards:</span> <span className="font-mono">{snapshot.historical.totalAwards.toLocaleString()}</span></div>
            <div><span className="text-muted-foreground">Total value:</span> <span className="font-mono">{fmtUsd(snapshot.historical.totalValue)}</span></div>
            <div><span className="text-muted-foreground">Fetched:</span> <span className="font-mono">{snapshot.historical.fetched.toLocaleString()}{snapshot.historical.truncated ? " (truncated)" : ""}</span></div>
          </div>
          {vehicleId && snapshot.historical.onVehicle && (() => {
            const onV = snapshot.historical.onVehicle!;
            const total = snapshot.historical.totalValue;
            const offValue = Math.max(0, total - onV.value);
            const share = total > 0 ? Math.round((onV.value / total) * 100) : 0;
            return (
              <div className="pt-2 space-y-1">
                <div className="text-xs">
                  <span className="text-muted-foreground">On-vehicle vendors:</span>{" "}
                  <span className="font-mono">{fmtUsd(onV.value)} across {onV.awards.toLocaleString()} awards</span>
                  <span className="text-muted-foreground"> · Off-vehicle: </span>
                  <span className="font-mono">{fmtUsd(offValue)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden" role="img" aria-label={`On-vehicle share ${share}%`}>
                  <div className="h-full bg-primary" style={{ width: `${share}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {share}% of fetched award value went to {vehicle?.vehicle_name ?? "the linked vehicle"} awardees
                </div>
              </div>
            );
          })()}

          {snapshot.historical.byYear.length > 0 && (
            <div className="pt-2">
              <div className="text-xs text-muted-foreground mb-1">By year</div>
              <div className="flex flex-wrap gap-2">
                {snapshot.historical.byYear.map((y) => (
                  <Badge key={y.year} variant="secondary" className="font-mono text-[11px]">
                    {y.year}: {fmtUsd(y.value)} ({y.awards})
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {snapshot.historical.topVendors.length > 0 && (
            <div className="pt-2">
              <div className="text-xs text-muted-foreground mb-1">Top vendors in this NAICS/agency window</div>
              <ul className="space-y-1">
                {snapshot.historical.topVendors.map((v) => (
                  <li key={v.name} className="flex justify-between text-xs">
                    <span className="truncate pr-2">{v.name}</span>
                    <span className="font-mono">{fmtUsd(v.value)} · {v.awards}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Incumbent */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Likely incumbent</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {snapshot.incumbent && snapshot.incumbent.confidence !== "none" ? (
            <>
              <div className="flex items-center gap-2">
                <Badge>{snapshot.incumbent.confidence}</Badge>
                <Badge variant="outline" className="text-[10px]">data-derived</Badge>
                {snapshot.incumbent.popExpiringSoon && <Badge variant="destructive">PoP expiring soon</Badge>}
              </div>
              <div className="font-medium">{snapshot.incumbent.topRecipient ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {snapshot.incumbent.awards.length} matched award(s)
                {typeof snapshot.incumbent.totalAmount === "number" && ` · ${fmtUsd(snapshot.incumbent.totalAmount)}`}
                {snapshot.incumbent.latestEndDate && ` · ends ${snapshot.incumbent.latestEndDate.slice(0, 10)}`}
              </div>
            </>
          ) : (() => {
            const eff = getEffectiveIncumbent(proposal);
            if (eff.name && eff.source === "user_input") {
              return (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{incumbentSourceBadge(eff.source)}</Badge>
                  </div>
                  <div className="font-medium">{eff.name}</div>
                  <div className="text-xs text-muted-foreground">Declared on the Overview tab — no matching award in the snapshot.</div>
                </>
              );
            }
            return <div className="text-muted-foreground text-xs">No clear incumbent match.</div>;
          })()}

        </CardContent>
      </Card>

      {/* Vendors at this client */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendors at this client</CardTitle>
          <CardDescription>Same or adjacent NAICS, any vehicle.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.priorPrimes.length === 0 ? (
            <div className="text-xs text-muted-foreground">None detected.</div>
          ) : (
            <ul className="divide-y">
              {snapshot.priorPrimes.map((t) => (
                <li key={(t.uei || t.name) + "-prime"} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      className="text-sm font-medium hover:underline text-left truncate"
                      onClick={() => setVendor({ recipientId: t.uei, name: t.name })}
                    >
                      {t.name}
                    </button>
                    <div className="text-xs text-muted-foreground font-mono">
                      {fmtUsd(t.totalValue)} · {t.awardCount} awards
                      {t.isSmallBusiness && " · SB"}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => addPartner(t)} disabled={savingPartner === (t.uei || t.name)}>
                    {savingPartner === (t.uei || t.name) ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Contract vehicle vendors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract vehicle vendors</CardTitle>
          <CardDescription>
            {vehicle?.vehicle_name
              ? `Awardee pool on ${vehicle.vehicle_name}.`
              : "Vendors holding the linked contract vehicle."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!vehicleId ? (
            <div className="text-xs text-muted-foreground">
              Link a contract vehicle to see its vendor pool.
            </div>
          ) : awardeesLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : awardees.length === 0 ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>No awardees recorded for this vehicle yet.</div>
              <Link to="/settings" hash="vehicles" className="text-primary hover:underline">
                Import a list or run AI awardee research in the vehicle registry →
              </Link>
            </div>
          ) : (
            <ul className="divide-y">
              {awardees.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      className="text-sm font-medium hover:underline text-left truncate"
                      onClick={() => setVendor({ recipientId: a.uei, name: a.company_name })}
                    >
                      {a.company_name}
                    </button>
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      {a.uei && <Badge variant="outline" className="font-mono text-[10px]">{a.uei}</Badge>}
                      {a.small_business && <Badge variant="secondary" className="text-[10px]">SB</Badge>}
                      {(a.socioeconomic ?? []).map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addAwardee(a)}
                    disabled={savingPartner === (a.uei || a.company_name)}
                  >
                    {savingPartner === (a.uei || a.company_name)
                      ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      : <UserPlus className="w-3 h-3 mr-1" />}
                    Add to roster
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {customerIntelSlot && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer intelligence (AI research)</CardTitle>
            <CardDescription>Research the buying organization, mission drivers, and incumbent posture.</CardDescription>
          </CardHeader>
          <CardContent>{customerIntelSlot}</CardContent>
        </Card>
      )}

      <VendorDetailDrawer
        recipientId={vendor?.recipientId ?? null}
        vendorName={vendor?.name ?? null}
        searchedNaics={snapshot.inputs.naicsCodes}
        onClose={() => setVendor(null)}
      />
    </div>
  );
}

