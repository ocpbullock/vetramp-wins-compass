import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Users } from "lucide-react";
import { searchUsaspending, type HistoricalAward, type SamOpportunity } from "@/lib/api";
import { matchIncumbent } from "@/lib/incumbents";
import { format, subYears, parseISO } from "date-fns";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";
import { DataProvenance } from "./DataSourceBadge";
import { CachedItemControls } from "./RefreshButton";
import { TeamingTargetsView } from "./TeamingTargetsView";

const fmtMoney = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1e9).toFixed(2)}B`
  : n >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M`
  : n >= 1_000 ? `$${(n / 1e3).toFixed(0)}K`
  : `$${n.toFixed(0)}`;

export function TrackedAnalyzePanel({
  open,
  onClose,
  naicsCode,
  agency,
  title,
  solicitationNumber,
  onRunSearch,
  teamId,
  onAddToSandbox,
}: {
  open: boolean;
  onClose: () => void;
  naicsCode: string | null;
  agency: string | null;
  title: string | null;
  solicitationNumber?: string | null;
  onRunSearch?: (naics: string) => void;
  teamId?: string | null;
  onAddToSandbox?: (companyId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [awards, setAwards] = useState<HistoricalAward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !naicsCode) return;
    let cancelled = false;
    setLoading(true); setError(null); setAwards([]);
    const startDate = format(subYears(new Date(), 10), "yyyy-MM-dd");
    const endDate = format(new Date(), "yyyy-MM-dd");
    searchUsaspending({ naicsCodes: [naicsCode], startDate, endDate, maxResults: 2000 })
      .then((res) => { if (!cancelled) { setAwards(res.results ?? []); setFetchedAt(new Date().toISOString()); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, naicsCode, reloadKey]);

  // Filter by agency name (case-insensitive substring) since edge fn doesn't filter by agency.
  const agencyAwards = useMemo(() => {
    if (!agency) return awards;
    const a = agency.toLowerCase();
    return awards.filter((w) =>
      (w["Awarding Agency"] || "").toLowerCase().includes(a) ||
      (w["Awarding Sub Agency"] || "").toLowerCase().includes(a),
    );
  }, [awards, agency]);

  const stats = useMemo(() => {
    const total = agencyAwards.reduce((s, a) => s + (Number(a["Award Amount"]) || 0), 0);
    const avg = agencyAwards.length ? total / agencyAwards.length : 0;
    const setAside = agencyAwards.filter((a) => {
      const sa = (a["Type of Set Aside"] || "").toUpperCase();
      return sa.includes("SDVOSB") || sa.includes("8A") || sa.includes("WOSB") ||
             sa.includes("HUBZONE") || sa.includes("SBA") || sa.includes("SMALL");
    }).length;

    const byVendor = new Map<string, { name: string; total: number; count: number }>();
    for (const a of agencyAwards) {
      const name = a["Recipient Name"] || "Unknown";
      const cur = byVendor.get(name) ?? { name, total: 0, count: 0 };
      cur.total += Number(a["Award Amount"]) || 0;
      cur.count += 1;
      byVendor.set(name, cur);
    }
    const topVendors = Array.from(byVendor.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const byYear = new Map<string, number>();
    for (const a of agencyAwards) {
      const d = a["Start Date"];
      if (!d) continue;
      try {
        const y = format(parseISO(d), "yyyy");
        byYear.set(y, (byYear.get(y) ?? 0) + (Number(a["Award Amount"]) || 0));
      } catch {}
    }
    const trend = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, value]) => ({ year, value }));

    return { total, avg, setAside, topVendors, trend, count: agencyAwards.length };
  }, [agencyAwards]);

  // Run the same incumbent matcher used on the Opportunities tab against the
  // cached Tango/USAspending awards so the analyst sees a likely incumbent
  // before they decide whether to bid this tracked opportunity.
  const incumbent = useMemo(() => {
    if (!naicsCode || !title) return null;
    const opp = {
      noticeId: `tracked:${title}`,
      solicitationNumber: solicitationNumber || "",
      title,
      fullParentPathName: agency || "",
      naicsCode,
    } as unknown as SamOpportunity;
    return matchIncumbent(opp, awards);
  }, [naicsCode, title, agency, solicitationNumber, awards]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">USAspending Analysis</SheetTitle>
          <div className="text-sm text-muted-foreground space-y-0.5">
            {title && <div className="font-medium text-foreground">{title}</div>}
            <div>NAICS <span className="font-mono">{naicsCode}</span> · Agency: {agency || "—"}</div>
            <div className="text-xs">10-year lookback</div>
            {(() => {
              const latest = agencyAwards.map((a) => a["Start Date"]).filter(Boolean).sort().slice(-1)[0];
              return (
                <div className="text-[11px] text-amber-600 dark:text-amber-400">
                  ⏱ USAspending data may be 30-90 days behind actual awards.{latest && <> Most recent award in this dataset: <span className="font-mono">{latest.slice(0, 10)}</span></>}
                </div>
              );
            })()}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {error && <div className="text-sm text-destructive">Error: {error}</div>}
          {!loading && !error && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Total spend" value={fmtMoney(stats.total)} sub={`${stats.count} awards`} />
                <Stat label="Average award" value={fmtMoney(stats.avg)} />
                <Stat label="Top vendors" value={String(stats.topVendors.length)} sub="potential incumbents" />
                <Stat
                  label="Small biz / set-aside"
                  value={`${stats.setAside}`}
                  sub={stats.count ? `${Math.round((stats.setAside / stats.count) * 100)}% of awards` : ""}
                />
              </div>

              {/* Incumbent analysis (above trend per spec) */}
              <section>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Trophy className="w-4 h-4" /> Incumbent Analysis
                </h3>
                {agencyAwards.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    No cached award data for NAICS {naicsCode}{agency ? ` at ${agency}` : ""}.
                    {onRunSearch && naicsCode && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 h-7"
                        onClick={() => { onRunSearch(naicsCode); onClose(); }}
                      >
                        Run a search for NAICS {naicsCode}
                      </Button>
                    )}
                  </div>
                ) : !incumbent || incumbent.confidence === "none" ? (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    No likely incumbent identified from cached award history. This may be a new requirement or the predecessor isn't in the cached set.
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15">LIKELY INCUMBENT</Badge>
                      <Badge variant="outline" className="text-[10px] uppercase">{incumbent.confidence}</Badge>
                      <span className="text-[11px] text-muted-foreground">{incumbent.awards.length} prior award{incumbent.awards.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="text-sm font-semibold">{incumbent.topRecipient}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Total value: <span className="font-mono">{fmtMoney(incumbent.totalAmount ?? 0)}</span>
                      {incumbent.latestEndDate && <> · Latest PoP end: <span className="font-mono">{incumbent.latestEndDate.slice(0, 10)}</span></>}
                    </div>
                  </div>
                )}
              </section>

              {/* Top competitors — above trend per spec */}
              <section>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Top Competitors
                </h3>
                {stats.topVendors.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No vendors found in cached data.</div>
                ) : (
                  <div className="border rounded-md divide-y">
                    {stats.topVendors.map((v) => (
                      <div key={v.name} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1 truncate">{v.name}</div>
                        <Badge variant="secondary" className="font-mono">{v.count}</Badge>
                        <div className="font-medium tabular-nums w-24 text-right">{fmtMoney(v.total)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <TeamingTargetsView
                awards={awards}
                agency={agency}
                naicsCodes={naicsCode ? [naicsCode] : []}
                teamId={teamId ?? null}
                onAddToSandbox={onAddToSandbox}
              />

              <section>
                <h3 className="text-sm font-semibold mb-2">Award trend</h3>
                {stats.trend.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No award history found.</div>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.trend}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtMoney} />
                        <RTooltip formatter={(v: any) => fmtMoney(Number(v))} />
                        <Bar dataKey="value" fill="#2563eb" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              <div className="border-t border-border pt-3 flex items-center gap-2 flex-wrap">
                <DataProvenance source="USAspending.gov" fetchedAt={fetchedAt} />
                <CachedItemControls
                  fetchedAt={fetchedAt}
                  busy={loading}
                  kind="usaspending"
                  onRefresh={() => setReloadKey((k) => k + 1)}
                />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
