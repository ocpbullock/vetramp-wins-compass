import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, Trophy, Building2, Calendar } from "lucide-react";
import { type SamOpportunity, type HistoricalAward, getCompetitiveIntel, type CompetitiveIntel } from "@/lib/api";
import { shortAgency } from "@/lib/contracts";
import { matchIncumbent } from "@/lib/incumbents";
import { BidScorecard } from "./BidScorecard";

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
  opp, awards, onClose, onVendor,
}: {
  opp: SamOpportunity | null;
  awards: HistoricalAward[];
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

  useEffect(() => {
    if (!opp) { setData(null); setError(null); return; }
    setLoading(true); setError(null); setData(null);
    getCompetitiveIntel({
      solicitationNumber: opp.solicitationNumber,
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

        {/* Section A — Incumbent */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Trophy className="w-4 h-4" />Likely Incumbent</h3>
          {loading ? <Skeleton className="h-24" /> : !data ? null : data.incumbent.top ? (
            <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15">LIKELY INCUMBENT</Badge>
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
          {loading ? <Skeleton className="h-48" /> : data ? <BidScorecard data={data} /> : null}
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
