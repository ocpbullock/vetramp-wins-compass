import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { generateMarketSnapshot, type MarketSnapshot } from "@/lib/market-snapshot";
import { companyFromTeamingTarget } from "@/lib/teaming-targets";
import { upsertCompany } from "@/lib/companies";
import { VendorDetailDrawer } from "@/components/dashboard/VendorDetailDrawer";
import type { TeamingTarget } from "@/lib/teaming-targets";
import type { CompeteVendor } from "@/lib/api";

function fmtUsd(n: number) {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function MarketIntelPanel({ proposal, proposalId }: { proposal: any; proposalId: string }) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(
    (proposal?.market_snapshot as MarketSnapshot | null) ?? null,
  );
  const [generatedAt, setGeneratedAt] = useState<string | null>(proposal?.market_snapshot_at ?? null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [vendor, setVendor] = useState<{ recipientId: string | null; name: string | null } | null>(null);
  const [savingPartner, setSavingPartner] = useState<string | null>(null);

  // Poll for background-generated snapshot when none exists yet but inputs known.
  useEffect(() => {
    if (snapshot || !proposal?.naics_code || !proposal?.agency) return;
    setPolling(true);
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      if (stopped) return;
      tries += 1;
      const { data } = await supabase
        .from("proposals")
        .select("market_snapshot, market_snapshot_at")
        .eq("id", proposalId)
        .maybeSingle();
      if ((data as any)?.market_snapshot) {
        setSnapshot((data as any).market_snapshot as MarketSnapshot);
        setGeneratedAt((data as any).market_snapshot_at ?? null);
        setPolling(false);
        return;
      }
      if (tries < 30) setTimeout(tick, 4000);
      else setPolling(false);
    };
    const t = setTimeout(tick, 3000);
    return () => { stopped = true; clearTimeout(t); setPolling(false); };
  }, [proposalId, proposal?.naics_code, proposal?.agency, snapshot]);

  const generate = async () => {
    setLoading(true);
    try {
      const snap = await generateMarketSnapshot(proposal);
      setSnapshot(snap);
      setGeneratedAt(snap.generatedAt);
      toast.success("Market snapshot generated");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate snapshot");
    } finally {
      setLoading(false);
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
          {polling || loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {polling ? "Generating snapshot in background…" : "Generating…"}
            </div>
          ) : (
            <Button onClick={generate} disabled={!proposal?.naics_code || !proposal?.agency}>
              <Sparkles className="w-4 h-4 mr-2" /> Generate market snapshot
            </Button>
          )}
          {(!proposal?.naics_code || !proposal?.agency) && (
            <p className="text-xs text-muted-foreground">NAICS and agency are required.</p>
          )}
          {polling && <Skeleton className="h-24 w-full" />}
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
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-4">
            <div><span className="text-muted-foreground">Total awards:</span> <span className="font-mono">{snapshot.historical.totalAwards.toLocaleString()}</span></div>
            <div><span className="text-muted-foreground">Total value:</span> <span className="font-mono">{fmtUsd(snapshot.historical.totalValue)}</span></div>
            <div><span className="text-muted-foreground">Fetched:</span> <span className="font-mono">{snapshot.historical.fetched.toLocaleString()}{snapshot.historical.truncated ? " (truncated)" : ""}</span></div>
          </div>
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
                {snapshot.incumbent.popExpiringSoon && <Badge variant="destructive">PoP expiring soon</Badge>}
              </div>
              <div className="font-medium">{snapshot.incumbent.topRecipient ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {snapshot.incumbent.awards.length} matched award(s)
                {typeof snapshot.incumbent.totalAmount === "number" && ` · ${fmtUsd(snapshot.incumbent.totalAmount)}`}
                {snapshot.incumbent.latestEndDate && ` · ends ${snapshot.incumbent.latestEndDate.slice(0, 10)}`}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground text-xs">No clear incumbent match.</div>
          )}
        </CardContent>
      </Card>

      {/* Prior primes/subs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prior primes & subs</CardTitle>
          <CardDescription>Large vendors holding significant work in this NAICS at this agency.</CardDescription>
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

      {/* Candidate partners */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate partners</CardTitle>
          <CardDescription>Smaller / set-aside vendors with relevant past performance.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.candidatePartners.length === 0 ? (
            <div className="text-xs text-muted-foreground">None detected.</div>
          ) : (
            <ul className="divide-y">
              {snapshot.candidatePartners.map((t) => (
                <li key={(t.uei || t.name) + "-partner"} className="py-2 flex items-center justify-between gap-2">
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
                      {t.latestSetAside && ` · ${t.latestSetAside}`}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => addPartner(t)} disabled={savingPartner === (t.uei || t.name)}>
                    {savingPartner === (t.uei || t.name) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserPlus className="w-3 h-3 mr-1" />}
                    Add to roster
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Likely competitors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Likely competitors</CardTitle>
          <CardDescription>From the competitive market landscape (set-aside scope).</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.competitiveIntelError ? (
            <div className="text-xs text-destructive">{snapshot.competitiveIntelError}</div>
          ) : snapshot.competitors.length === 0 ? (
            <div className="text-xs text-muted-foreground">No competitor data.</div>
          ) : (
            <ul className="divide-y">
              {snapshot.competitors.map((c: CompeteVendor) => (
                <li key={(c.recipientId || c.name) + "-comp"} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      className="text-sm font-medium hover:underline text-left truncate"
                      onClick={() => setVendor({ recipientId: c.recipientId, name: c.name })}
                    >
                      {c.name}
                    </button>
                    <div className="text-xs text-muted-foreground font-mono">
                      {fmtUsd(c.totalValue)} · {c.awards} awards
                      {c.setAside && ` · ${c.setAside}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <VendorDetailDrawer
        recipientId={vendor?.recipientId ?? null}
        vendorName={vendor?.name ?? null}
        searchedNaics={snapshot.inputs.naicsCodes}
        onClose={() => setVendor(null)}
      />
    </div>
  );
}
