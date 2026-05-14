import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, Trophy, Building2, Calendar } from "lucide-react";
import { type SamOpportunity, type HistoricalAward, getCompetitiveIntel, type CompetitiveIntel } from "@/lib/api";
import { shortAgency } from "@/lib/contracts";
import { matchIncumbent } from "@/lib/incumbents";
import { supabase } from "@/integrations/supabase/client";
import { useTeamId } from "@/lib/team";
import { BidScorecard } from "./BidScorecard";

const KNOWN_VEHICLES = [
  "OASIS+", "STARS III", "Alliant 2", "SEWP V", "SEWP VI", "CIO-SP3", "CIO-SP4",
  "POLARIS", "GSA MAS", "GSA Schedule", "VETS 2", "8(a) STARS",
];
function detectVehicle(opp: SamOpportunity | null): string | null {
  if (!opp) return null;
  const hay = `${opp.title || ""} ${opp.description || ""} ${opp.fullParentPathName || ""}`.toLowerCase();
  for (const v of KNOWN_VEHICLES) if (hay.includes(v.toLowerCase())) return v;
  return null;
}

function fmtUsd(n?: number | null) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function daysUntil(iso?: string) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function CompetitiveIntelModal({
  opp, awards, userNaics, onClose, onVendor,
}: {
  opp: SamOpportunity | null;
  awards: HistoricalAward[];
  userNaics: string[];
  onClose: () => void;
  onVendor: (recipientId: string, name: string) => void;
}) {
  const [data, setData] = useState<CompetitiveIntel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authoritative match against the cached historical award set —
  // same logic that powers the "Top incumbent" tooltip on the Opportunities tab.
  const localMatch = useMemo(
    () => (opp ? matchIncumbent(opp, awards) : null),
    [opp, awards],
  );

  const teamId = useTeamId();
  const oppVehicle = useMemo(() => detectVehicle(opp), [opp]);

  const { data: heldVehicles = [] } = useQuery({
    queryKey: ["contract-vehicles", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_vehicles")
        .select("vehicle_name,status")
        .eq("team_id", teamId!);
      if (error) throw new Error(error.message);
      return (data ?? []).filter((r) => r.status === "active").map((r) => r.vehicle_name);
    },
  });

  const { data: partnerVehicles = [] } = useQuery({
    queryKey: ["partner-vehicles", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaming_partners")
        .select("contract_vehicles")
        .eq("team_id", teamId!);
      if (error) throw new Error(error.message);
      return (data ?? []).flatMap((r) => r.contract_vehicles ?? []);
    },
  });

  // How many awards in the user's cached history are at this opportunity's
  // sub-agency (any path segment match). Drives the Agency Experience score.
  const userAgencyAwardCount = useMemo(() => {
    if (!opp) return 0;
    const segs = (opp.fullParentPathName || "")
      .split(".")
      .map((s) =>
        s.toLowerCase()
          .replace(/[.,]/g, " ")
          .replace(/\b(department|dept|of|the|us|u\.s\.)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    if (segs.length === 0) return 0;
    return awards.filter((a) => {
      const sub = (a["Awarding Sub Agency"] || "").toLowerCase();
      const top = ((a as any)["Awarding Agency"] || "").toLowerCase();
      return segs.some((seg) => seg && (sub.includes(seg) || top.includes(seg)));
    }).length;
  }, [opp, awards]);

  useEffect(() => {
    if (!opp) { setData(null); setError(null); return; }
    setLoading(true); setError(null); setData(null);
    getCompetitiveIntel({
      solicitationNumber: opp.solicitationNumber,
      title: opp.title,
      agency: opp.fullParentPathName ?? "",
      naicsCode: opp.naicsCode ?? "",
      setAside: opp.typeOfSetAside || undefined,
      postedDate: opp.postedDate,
      responseDeadLine: opp.responseDeadLine,
    })
      .then(setData)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [opp]);

  const days = daysUntil(opp?.responseDeadLine);
  const deadlineColor = days == null ? "" : days <= 3 ? "text-red-500" : days <= 14 ? "text-amber-500" : "text-muted-foreground";

  return (
    <Dialog open={!!opp} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[1000px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-8">{opp?.title}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-2">
            <span className="font-mono">{opp?.solicitationNumber}</span>
            <span>·</span>
            <span>{shortAgency(opp?.fullParentPathName)}</span>
            <span>·</span>
            <span className="font-mono">NAICS {opp?.naicsCode}</span>
            {opp?.typeOfSetAside && <Badge variant="secondary" className="text-[10px]">{opp.typeOfSetAside}</Badge>}
            {days != null && (
              <span className={`ml-auto inline-flex items-center gap-1 ${deadlineColor}`}>
                <Calendar className="w-3 h-3" />{days >= 0 ? `${days} days remaining` : `Closed ${-days}d ago`}
              </span>
            )}
          </div>
        </DialogHeader>

        {error && <div className="text-sm text-destructive p-3 border border-destructive/30 rounded">{error}</div>}

        {/* Section A — Incumbent (prefers local match against cached historical set) */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Trophy className="w-4 h-4" />Likely Incumbent</h3>
          {localMatch && localMatch.confidence !== "none" ? (() => {
            const simPct = localMatch.similarity ? Math.round(localMatch.similarity * 100) : null;
            const lowConfTitle = localMatch.confidence === "fuzzy" && simPct != null && simPct < 70;
            const confLabel =
              localMatch.confidence === "exact" ? "EXACT PIID MATCH" :
              localMatch.confidence === "parent" ? "PARENT IDV MATCH" :
              localMatch.confidence === "psc" ? `PSC MATCH${localMatch.diagnostics?.pscMatched ? ` (${localMatch.diagnostics.pscMatched})` : ""}` :
              localMatch.confidence === "frequent" ? "FREQUENT VENDOR" :
              `TITLE MATCH${simPct != null ? ` (${simPct}%)` : ""}`;
            const headlineLabel = lowConfTitle ? "POSSIBLE INCUMBENT — LOW CONFIDENCE" : "LIKELY INCUMBENT";
            const top = localMatch.awards[0];
            const others = [...new Set(localMatch.awards.slice(1, 6).map(a => a["Recipient Name"]).filter(Boolean))] as string[];
            return (
              <div className={`p-4 rounded-lg border ${lowConfTitle ? "border-border bg-muted/30" : "border-amber-500/30 bg-amber-500/5"}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge className={lowConfTitle ? "bg-muted text-muted-foreground hover:bg-muted" : "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"}>{headlineLabel}</Badge>
                  <Badge variant="outline" className="text-[10px]">{confLabel}</Badge>
                  {localMatch.popExpiringSoon && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">⏰ PoP EXPIRING ±9mo</Badge>}
                  <span className="text-[11px] text-muted-foreground">{localMatch.awards.length} prior award{localMatch.awards.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="text-base font-semibold">{localMatch.topRecipient}</div>
                <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                  <div><span className="opacity-60">Top PIID:</span> <span className="font-mono">{top?.["Award ID"]}</span></div>
                  <div><span className="opacity-60">Total value:</span> <span className="font-mono">{fmtUsd(localMatch.totalAmount)}</span></div>
                  <div><span className="opacity-60">PoP end:</span> {top?.["End Date"]?.slice(0, 10) ?? localMatch.latestEndDate?.slice(0, 10)}</div>
                  <div><span className="opacity-60">Sub-agency:</span> {top?.["Awarding Sub Agency"] ?? "—"}</div>
                </div>
                {others.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-1">
                    <div className="text-[11px] uppercase opacity-60">Other recipients on these awards</div>
                    {others.map((n, i) => <div key={i} className="text-xs">{n}</div>)}
                  </div>
                )}
                {localMatch.diagnostics && (
                  <div className="mt-3 pt-2 border-t border-border/40 text-[10px] font-mono opacity-50">
                    bucket: {localMatch.diagnostics.matchedKey ?? "—"} · {localMatch.diagnostics.bucketSize} awards · {localMatch.diagnostics.candidatesAfterTitle} title-matched{localMatch.diagnostics.note ? ` · ${localMatch.diagnostics.note}` : ""}
                  </div>
                )}
              </div>
            );
          })() : loading ? <Skeleton className="h-24" /> : !data ? null : data.incumbent.top ? (
            <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15">CANDIDATE</Badge>
                <Badge variant="outline" className="text-[10px]">USASPENDING HEURISTIC</Badge>
                <span className="text-[11px] text-muted-foreground">Not in your cached historical set — lower confidence</span>
              </div>
              <div className="text-[11px] text-muted-foreground mb-2">
                This match is based on spending patterns, not contract-level data. The actual incumbent may differ.
              </div>
              <button
                className="text-base font-semibold hover:underline text-left"
                onClick={() => data.incumbent.top?.recipientId && onVendor(data.incumbent.top.recipientId, data.incumbent.top.vendor)}
              >
                {data.incumbent.top.vendor}
              </button>
              <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                <div><span className="opacity-60">PIID:</span> <span className="font-mono">{data.incumbent.top.piid}</span></div>
                <div><span className="opacity-60">Value:</span> <span className="font-mono">{fmtUsd(data.incumbent.top.value)}</span></div>
                <div><span className="opacity-60">PoP:</span> {data.incumbent.top.popStart?.slice(0,10)} → {data.incumbent.top.popEnd?.slice(0,10)}</div>
                <div><span className="opacity-60">NAICS:</span> <span className="font-mono">{data.incumbent.top.naics}</span></div>
              </div>
              {data.incumbent.alternates.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/60 space-y-1">
                  <div className="text-[11px] uppercase opacity-60">Other candidates</div>
                  {data.incumbent.alternates.map((a, i) => (
                    <button
                      key={i}
                      className="block text-xs hover:underline text-left"
                      onClick={() => a.recipientId && onVendor(a.recipientId, a.vendor)}
                    >
                      {a.vendor} <span className="font-mono opacity-60">{a.piid}</span> · {fmtUsd(a.value)} · ends {a.popEnd?.slice(0,10)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-lg border border-border bg-muted/30 flex items-center gap-3">
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">OPEN FIELD</Badge>
              <span className="text-sm text-muted-foreground">No predecessor contract identified — this may be a new requirement.</span>
            </div>
          )}
        </section>

        {/* Section B — Agency Award History */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            How {data?.agencyHistory.agencyName || shortAgency(opp?.fullParentPathName)} awards NAICS {opp?.naicsCode}
          </h3>
          {loading ? <Skeleton className="h-40" /> : !data ? null : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="grid grid-cols-4 gap-2 p-3 bg-muted/40 text-xs">
                <Stat label="Contracts" v={String(data.agencyHistory.totalContracts)} />
                <Stat label="Total value" v={fmtUsd(data.agencyHistory.totalValue)} />
                <Stat label="Avg value" v={fmtUsd(data.agencyHistory.avgValue)} />
                <Stat label="Unique vendors" v={String(data.agencyHistory.vendors.length)} />
              </div>
              {data.agencyHistory.vendors.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No prior awards found at this agency for this NAICS.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table text-xs w-full">
                    <thead><tr><th>#</th><th>Vendor</th><th className="text-right">Awards</th><th className="text-right">Total</th><th className="text-right">Avg</th><th>Most recent</th><th>Set-aside</th></tr></thead>
                    <tbody>
                      {data.agencyHistory.vendors.slice(0, 15).map((v, i) => (
                        <tr key={v.recipientId ?? v.name + i}>
                          <td className="opacity-60">{i + 1}</td>
                          <td>
                            <button
                              className="hover:underline text-left"
                              onClick={() => v.recipientId && onVendor(v.recipientId, v.name)}
                            >{v.name}</button>
                          </td>
                          <td className="text-right">{v.awards}</td>
                          <td className="text-right font-mono">{fmtUsd(v.totalValue)}</td>
                          <td className="text-right font-mono">{fmtUsd(v.avgValue)}</td>
                          <td>{v.mostRecent?.slice(0, 10)}</td>
                          <td className="text-[10px] opacity-70">{v.setAside}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section E — Bid/No-Bid Scorecard */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Bid / No-Bid Scorecard</h3>
          {loading ? <Skeleton className="h-48" /> : data ? (
            <BidScorecard
              data={data}
              userNaics={userNaics}
              userAgencyAwardCount={userAgencyAwardCount}
              oppNaics={opp?.naicsCode ?? ""}
              oppSetAside={opp?.typeOfSetAside || undefined}
              responseDeadLine={opp?.responseDeadLine}
              oppVehicle={oppVehicle}
              heldVehicles={heldVehicles}
              partnerVehicles={partnerVehicles}
            />
          ) : null}
        </section>

        <div className="flex justify-between items-center text-[11px] text-muted-foreground">
          <span>{data ? (data.fromCache ? `Cached ${new Date(data.cachedAt).toLocaleString()}` : "Fresh data") : ""}</span>
          {opp?.uiLink && (
            <Button asChild variant="outline" size="sm">
              <a href={opp.uiLink} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 mr-1" />Open on SAM.gov</a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase opacity-60">{label}</div>
      <div className="font-mono font-semibold text-sm">{v}</div>
    </div>
  );
}
