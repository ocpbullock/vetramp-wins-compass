import { createFileRoute, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { format, subYears } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useTeamId } from "@/lib/team";
import { Header } from "@/components/dashboard/Header";
import { SearchControls, type SearchInput } from "@/components/dashboard/SearchControls";
import { StatCards } from "@/components/dashboard/StatCards";
import { OpportunitiesTab } from "@/components/dashboard/OpportunitiesTab";
import { HistoricalTab } from "@/components/dashboard/HistoricalTab";
import { AnalyticsTab } from "@/components/dashboard/AnalyticsTab";
import { LogsTab } from "@/components/dashboard/LogsTab";
import { InProgressTab } from "@/components/dashboard/InProgressTab";
import { TrackedOpportunitiesTab } from "@/components/dashboard/TrackedOpportunitiesTab";
import { StarredTab } from "@/components/dashboard/StarredTab";
import { useStarred, type StarredRow } from "@/lib/starred";
import { supabase } from "@/integrations/supabase/client";
import { AwardDetailModal } from "@/components/dashboard/AwardDetailModal";
import { CompetitiveIntelModal } from "@/components/dashboard/CompetitiveIntelModal";
import { VendorDetailDrawer } from "@/components/dashboard/VendorDetailDrawer";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  searchSam, searchUsaspending, makeCacheKey, readCache, writeCache,
  type SamOpportunity, type HistoricalAward,
} from "@/lib/api";
import { useLogStore } from "@/lib/log-store";
import { toast } from "sonner";
import { generateDefaultMilestones } from "@/lib/milestones";
import { DeadlinesWidget } from "@/components/dashboard/DeadlinesWidget";

export const Route = createFileRoute("/")({ component: Dashboard });

const historicalLookbackFrom = () => format(subYears(new Date(), 10), "yyyy-MM-dd");

function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const teamId = useTeamId();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  // Auto-restore last search from localStorage on mount (cache hit = instant).
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (didAutoLoad.current || loading || !user || !lastInput) return;
    didAutoLoad.current = true;
    runSearch(lastInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const [opps, setOpps] = useState<SamOpportunity[]>([]);
  const [awards, setAwards] = useState<HistoricalAward[]>([]);
  const [historicalTotal, setHistoricalTotal] = useState<number | undefined>();
  const [searchedNaics, setSearchedNaics] = useState<string[]>([]);
  // Currently selected NAICS in SearchControls — drives instant client-side filtering.
  const [currentNaics, setCurrentNaics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [tab, setTab] = useState("opportunities");

  // Sync tab with URL hash from header nav links
  useEffect(() => {
    const h = (location.hash || "").replace(/^#/, "");
    const valid = ["opportunities", "historical", "in-progress", "tracked", "starred", "analytics", "logs"];
    if (h && valid.includes(h)) setTab(h);
  }, [location.hash]);
  const { count: starredCount } = useStarred();
  const [inProgressCount, setInProgressCount] = useState<number>(0);

  // Fetch in-progress count on mount so the stat card is populated before
  // the user clicks the tab (Radix Tabs lazy-mount inactive panels, so
  // InProgressTab's own load() doesn't run until activation).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      let q = supabase.from("proposals").select("id", { count: "exact", head: true });
      if (teamId) q = q.eq("team_id", teamId);
      else q = q.eq("user_id", user.id);
      const { count, error } = await q;
      if (!cancelled && !error && typeof count === "number") setInProgressCount(count);
    })();
    return () => { cancelled = true; };
  }, [user, teamId]);

  async function handlePropose(o: SamOpportunity) {
    if (!user) return;
    const { data, error } = await supabase.from("proposals").insert({
      user_id: user.id,
      team_id: teamId,
      solicitation_number: o.solicitationNumber || o.noticeId || "unknown",
      notice_id: o.noticeId,
      opportunity_title: o.title,
      agency: o.fullParentPathName,
      naics_code: o.naicsCode,
      set_aside: o.setAside || o.typeOfSetAside,
      response_deadline: o.responseDeadLine || null,
      opportunity_data: o,
      status: "intake",
    }).select("id").single();
    if (error) { toast.error(error.message); return; }
    if (o.responseDeadLine) {
      await generateDefaultMilestones(data.id, o.responseDeadLine);
    }
    navigate({ to: "/proposals/$proposalId", params: { proposalId: data.id } });
  }

  async function handleStartFromStarred(row: StarredRow) {
    // Promote a starred bookmark into the proposal pipeline. Prefer the
    // captured source_data snapshot (rich SAM payload) when present.
    const sd = (row.source_data as SamOpportunity | null) ?? null;
    const o: SamOpportunity = sd ?? ({
      noticeId: row.notice_id,
      solicitationNumber: row.notice_id,
      title: row.title ?? "",
      naicsCode: row.naics_code ?? undefined,
      responseDeadLine: row.response_deadline ?? undefined,
      postedDate: row.posted_date ?? undefined,
      setAside: row.set_aside_description ?? undefined,
    } as unknown as SamOpportunity);
    await handlePropose(o);
  }
  const [competeOpp, setCompeteOpp] = useState<SamOpportunity | null>(null);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<
    | { kind: "cache"; fetchedAt: string; supersetCount?: number; requestedCount: number }
    | { kind: "fresh"; fetchedAt: string }
    | null
  >(null);
  const [lastInput, setLastInput] = useState<SearchInput | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("dashboard:lastSearch");
      return raw ? (JSON.parse(raw) as SearchInput) : null;
    } catch {
      return null;
    }
  });
  const log = useLogStore((s) => s.log);

  async function runSearch(input: SearchInput) {
    setBusy(true);
    setProgress(0);
    setOpps([]);
    setAwards([]);
    setHistoricalTotal(undefined);
    setSearchedNaics(input.naicsCodes);
    setDataSource(null);
    try {
      // Persist (sans forceRefresh) so the next page load can restore + auto-hit cache
      const { forceRefresh: _fr, ...persisted } = input;
      try { localStorage.setItem("dashboard:lastSearch", JSON.stringify(persisted)); } catch {}
      const historicalFrom = historicalLookbackFrom();
      const cacheInput = { ...input, historicalFrom };
      const cacheKey = makeCacheKey(cacheInput);
      const cached = input.forceRefresh || !teamId ? null : await readCache(cacheKey, teamId, cacheInput);
      if (cached) {
        setOpps((cached.opportunities as any) ?? []);
        const h = cached.historical as any;
        setAwards(h?.results ?? []);
        setHistoricalTotal(h?.page_metadata?.total);
        setProgress(100);
        setProgressText("Loaded from cache");
        const cachedNaics = (cached.naics_codes as string[]) ?? [];
        setDataSource({
          kind: "cache",
          fetchedAt: cached.created_at as string,
          supersetCount: cachedNaics.length > input.naicsCodes.length ? cachedNaics.length : undefined,
          requestedCount: input.naicsCodes.length,
        });
        toast.success("Loaded from shared cache (24h TTL) — use Force refresh to bypass");
        setBusy(false);
        return;
      }
      if (input.forceRefresh) {
        log("info", "Force refresh: bypassing cache");
        toast.info("Bypassing cache — fetching fresh data");
      }

      setProgressText(`Fetching SAM.gov opportunities (${input.naicsCodes.length} NAICS)...`);
      setProgress(10);
      const samRes = await searchSam(input);
      setOpps(samRes.opportunities);
      setProgress(60);

      setProgressText("Fetching USAspending historical awards (10-year lookback, paginating)...");
      const usaRes = await searchUsaspending({
        naicsCodes: input.naicsCodes,
        startDate: historicalFrom,
        endDate: input.postedTo,
        keyword: input.keyword,
        maxResults: 10000,
      });
      setAwards(usaRes.results ?? []);
      setHistoricalTotal(usaRes.page_metadata?.total);
      setProgress(95);

      const totalObligated = (usaRes.results ?? []).reduce((s, a) => s + (Number(a["Award Amount"]) || 0), 0);
      await writeCache({
        cacheKey,
        teamId: teamId ?? "",
        naicsCodes: input.naicsCodes,
        dateFrom: input.postedFrom,
        dateTo: input.postedTo,
        historicalFrom,
        keyword: input.keyword,
        opportunities: samRes.opportunities,
        historical: usaRes,
        summary: { activeOpps: samRes.opportunities.length, totalObligated },
      });

      setProgress(100);
      setProgressText("Done");
      setDataSource({ kind: "fresh", fetchedAt: new Date().toISOString() });
      try {
        localStorage.setItem("vetramp:lastSearchAt", String(Date.now()));
        localStorage.setItem("vetramp:oppCount", String(samRes.opportunities.length));
        window.dispatchEvent(new Event("vetramp:search-updated"));
      } catch {}
    } catch (e: any) {
      log("error", e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(() => {
    const activeOpps = opps.filter((o) => !o.type?.toLowerCase().includes("award")).length;
    const awardNotices = opps.filter((o) => o.type?.toLowerCase().includes("award")).length;
    const totalObligated = awards.reduce((s, a) => s + (Number(a["Award Amount"]) || 0), 0);
    return { activeOpps, awardNotices, historicalCount: awards.length, totalObligated };
  }, [opps, awards]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header placeholder */}
        <div className="border-b">
          <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </div>

        {/* Search controls placeholder */}
        <div className="border-b">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 flex-1 min-w-[240px]" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>

        {/* Stat cards placeholder */}
        <main className="max-w-[1400px] mx-auto px-6 py-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div id="quick-search" className="scroll-mt-24">
        <SearchControls onSearch={runSearch} onNaicsChange={setCurrentNaics} busy={busy} initial={lastInput ?? undefined} />
      </div>
      {(busy || progressText) && (
        <div className="max-w-[1400px] mx-auto px-6 pt-3">
          <Progress value={progress} className="h-1" />
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span>{progressText}</span>
            {dataSource && !busy && <DataSourceBadge source={dataSource} />}
          </div>
        </div>
      )}
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        <StatCards
          activeOpps={stats.activeOpps}
          awardNotices={stats.awardNotices}
          historicalCount={stats.historicalCount}
          historicalTotal={historicalTotal}
          totalObligated={stats.totalObligated}
          inProgressCount={inProgressCount}
          starredCount={starredCount}
          onSelect={setTab}
        />

        <DeadlinesWidget />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="opportunities">Active Opportunities</TabsTrigger>
            <TabsTrigger value="historical">Historical Awards</TabsTrigger>
            <TabsTrigger value="starred">Starred{starredCount ? ` (${starredCount})` : ""}</TabsTrigger>
            <TabsTrigger value="in-progress">In Progress{inProgressCount ? ` (${inProgressCount})` : ""}</TabsTrigger>
            <TabsTrigger value="tracked">Tracked</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          <TabsContent value="opportunities" className="mt-4">
            <OpportunitiesTab opportunities={opps} awards={awards} searchedNaics={searchedNaics} activeFilterNaics={currentNaics} searchKey={searchedNaics.join(",")} onPropose={handlePropose} onCompete={setCompeteOpp} />
          </TabsContent>
          <TabsContent value="historical" className="mt-4">
            <HistoricalTab awards={awards} searchedNaics={searchedNaics} searchKey={searchedNaics.join(",")} onDetails={setDetailId} />
          </TabsContent>
          <TabsContent value="in-progress" className="mt-4">
            <InProgressTab onCountChange={setInProgressCount} />
          </TabsContent>
          <TabsContent value="tracked" className="mt-4">
            <TrackedOpportunitiesTab awards={awards} />
          </TabsContent>
          <TabsContent value="analytics" className="mt-4">
            <AnalyticsTab awards={awards} />
          </TabsContent>
          <TabsContent value="logs" className="mt-4">
            <LogsTab />
          </TabsContent>
        </Tabs>
      </main>

      
      <AwardDetailModal id={detailId} onClose={() => setDetailId(null)} />
      <CompetitiveIntelModal
        opp={competeOpp}
        awards={awards}
        userNaics={searchedNaics}
        onClose={() => setCompeteOpp(null)}
        onVendor={(id, name) => setVendor({ id, name })}
      />
      <VendorDetailDrawer
        recipientId={vendor?.id ?? null}
        vendorName={vendor?.name ?? null}
        searchedNaics={searchedNaics}
        onClose={() => setVendor(null)}
      />
    </div>
  );
}
