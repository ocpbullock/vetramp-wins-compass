import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Search, Plus, UserPlus, Loader2, Users, AlertTriangle, Crown, HandshakeIcon,
  CheckCircle2, RefreshCw, Sparkles, Building2,
} from "lucide-react";
import { toast } from "sonner";
import { searchEntities, searchUsaspending, type HistoricalAward } from "@/lib/api";
import {
  listPartnerCompanies, findOrInsertPartnerFromSamEntity, upsertCompany,
  companyToPartnerView, type PartnerView as Partner, type Company,
} from "@/lib/companies";
import {
  rankPartnerExperience, rankPartnerExperienceFromTargets,
  type PartnerExperienceTarget,
} from "@/lib/partner-experience";
import { companyFromTeamingTarget, type TeamingTarget } from "@/lib/teaming-targets";
import { VendorDetailDrawer } from "@/components/dashboard/VendorDetailDrawer";

const SB_TYPES = [
  { value: "SDVOSB", label: "SDVOSB" },
  { value: "8(a)", label: "8(a)" },
  { value: "WOSB", label: "WOSB" },
  { value: "HUBZone", label: "HUBZone" },
];

const fmtMoney = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1e9).toFixed(2)}B`
  : n >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M`
  : n >= 1_000 ? `$${(n / 1e3).toFixed(0)}K`
  : `$${n.toFixed(0)}`;

const todayIso = () => new Date().toISOString().slice(0, 10);
const yearsAgoIso = (years: number) =>
  new Date(Date.now() - years * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

type SortKey = "relevance" | "value" | "recent";
type ClassFilter = "all" | "prime" | "partner";

export function PartnerResearch({
  proposalId, teamId, opportunityNaics,
  opportunityAgency = null, opportunitySetAside = null,
}: {
  proposalId: string;
  teamId: string | null;
  opportunityNaics?: string | null;
  opportunityAgency?: string | null;
  opportunitySetAside?: string | null;
}) {
  const qc = useQueryClient();

  // ---- Roster (used by both modes for "already on roster" badges) ----
  const { data: partners = [] } = useQuery({
    queryKey: ["teaming-partners", teamId],
    enabled: !!teamId,
    queryFn: async () => listPartnerCompanies(teamId!),
  });

  const { data: existingTeaming = [] } = useQuery({
    queryKey: ["proposal-teaming", proposalId],
    enabled: !!proposalId,
    queryFn: async () => {
      const { data } = await supabase
        .from("proposal_teaming").select("company_id").eq("proposal_id", proposalId);
      return (data ?? []).map((r: any) => r.company_id as string);
    },
  });

  const hasProposal = !!proposalId;
  const onProposal = (partnerId: string) => existingTeaming.includes(partnerId);

  const rosterByKey = useMemo(() => {
    const m = new Map<string, Partner>();
    for (const p of partners) {
      if (p.uei) m.set(p.uei.toUpperCase(), p);
      m.set(p.company_name.toUpperCase(), p);
    }
    return m;
  }, [partners]);

  const findRosterMatch = (t: TeamingTarget): Partner | null => {
    if (t.uei && rosterByKey.has(t.uei.toUpperCase())) return rosterByKey.get(t.uei.toUpperCase())!;
    return rosterByKey.get(t.name.toUpperCase()) ?? null;
  };

  const addToProposal = async (partner: Partner) => {
    if (onProposal(partner.id)) {
      toast.message(`${partner.company_name} is already on this proposal`);
      return;
    }
    const overlap = opportunityNaics
      ? partner.naics_codes.filter((n) => n === opportunityNaics)
      : [];
    const { error } = await supabase.from("proposal_teaming").insert({
      proposal_id: proposalId, company_id: partner.id, role: "sub",
      work_share_pct: null, naics_contribution: overlap,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${partner.company_name} to this proposal`);
    qc.invalidateQueries({ queryKey: ["proposal-teaming", proposalId] });
  };

  // ===== EXPERIENCE MODE STATE =====
  const [naicsInput, setNaicsInput] = useState(opportunityNaics ?? "");
  const [agencyInput, setAgencyInput] = useState(opportunityAgency ?? "");
  const [keyword, setKeyword] = useState("");
  const [lookbackYears, setLookbackYears] = useState(5);
  const [agencyOnly, setAgencyOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [searching, setSearching] = useState(false);
  const [awards, setAwards] = useState<HistoricalAward[] | null>(null);
  const [snapshotTargets, setSnapshotTargets] = useState<TeamingTarget[] | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [loadedFromSnapshot, setLoadedFromSnapshot] = useState(false);
  const [drilldown, setDrilldown] = useState<{ uei: string; name: string } | null>(null);

  // Sync inputs when the parent's opportunity context changes.
  useEffect(() => { setNaicsInput(opportunityNaics ?? ""); }, [opportunityNaics]);
  useEffect(() => { setAgencyInput(opportunityAgency ?? ""); }, [opportunityAgency]);

  // ---- Cost optimization: hydrate from saved market_snapshot when available ----
  useEffect(() => {
    let cancelled = false;
    if (!proposalId) return;
    setLoadedFromSnapshot(false);
    setAwards(null);
    setSnapshotTargets(null);
    setSnapshotAt(null);
    (async () => {
      const { data } = await supabase
        .from("proposals")
        .select("market_snapshot, market_snapshot_at")
        .eq("id", proposalId)
        .maybeSingle();
      if (cancelled) return;
      const snap: any = data?.market_snapshot ?? null;
      if (!snap) return;
      const t: TeamingTarget[] = [
        ...(Array.isArray(snap.priorPrimes) ? snap.priorPrimes : []),
        ...(Array.isArray(snap.candidatePartners) ? snap.candidatePartners : []),
      ];
      if (t.length === 0) return;
      setSnapshotTargets(t);
      setSnapshotAt(data?.market_snapshot_at ?? snap.generatedAt ?? null);
      setLoadedFromSnapshot(true);
    })();
    return () => { cancelled = true; };
  }, [proposalId]);

  const runExperienceSearch = async () => {
    if (!naicsInput.trim()) {
      toast.error("Enter a NAICS code to search award history.");
      return;
    }
    setSearching(true);
    try {
      const r = await searchUsaspending({
        naicsCodes: [naicsInput.trim()],
        startDate: yearsAgoIso(lookbackYears),
        endDate: todayIso(),
        keyword: keyword.trim() || undefined,
        maxResults: 1000,
      });
      setAwards(r.results ?? []);
      setSnapshotTargets(null);
      setLoadedFromSnapshot(false);
      toast.success(`Pulled ${r.results?.length ?? 0} awards`);
    } catch (e: any) {
      toast.error(e?.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  // ---- Compute ranked candidates ----
  const ranked: PartnerExperienceTarget[] = useMemo(() => {
    const opp = { agency: agencyInput || null, set_aside: opportunitySetAside };
    if (awards) {
      return rankPartnerExperience(awards, opp, {
        hardFilterAgency: agencyOnly,
        limit: 50,
      });
    }
    if (snapshotTargets) {
      // Snapshot targets in market-snapshot.ts were derived with agency filter
      // applied, so they all have at least one award at this agency.
      let list = rankPartnerExperienceFromTargets(snapshotTargets, opp, {
        agencyExperienceForAll: !!agencyInput,
      });
      if (agencyOnly && agencyInput) {
        // Already agency-filtered upstream; nothing to drop.
        list = list.filter((t) => t.agencyExperience);
      }
      return list;
    }
    return [];
  }, [awards, snapshotTargets, agencyInput, agencyOnly, opportunitySetAside]);

  const filtered = useMemo(() => {
    let list = ranked;
    if (classFilter !== "all") list = list.filter((t) => t.classification === classFilter);
    if (sortKey === "value") list = [...list].sort((a, b) => b.totalValue - a.totalValue);
    else if (sortKey === "recent") {
      list = [...list].sort((a, b) =>
        (b.latestAwardDate ?? "").localeCompare(a.latestAwardDate ?? ""));
    }
    return list;
  }, [ranked, classFilter, sortKey]);

  const primeCount = ranked.filter((t) => t.classification === "prime").length;
  const partnerCount = ranked.length - primeCount;

  // ===== ENTITY MODE STATE (existing SAM.gov entity search, demoted) =====
  const [entityNaics, setEntityNaics] = useState(opportunityNaics ?? "");
  const [sbTypes, setSbTypes] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState("");
  const [entityKeyword, setEntityKeyword] = useState("");
  const [entitySearching, setEntitySearching] = useState(false);
  const [entityResults, setEntityResults] = useState<any[] | null>(null);
  const [entityCached, setEntityCached] = useState(false);

  const toggleSb = (v: string) =>
    setSbTypes((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);

  const runEntitySearch = async () => {
    setEntitySearching(true);
    try {
      const types = sbTypes.length ? sbTypes : [undefined as unknown as string];
      const collected: any[] = [];
      let anyCached = false;
      for (const t of types) {
        const { results, _cached } = await searchEntities({
          vendor_name: entityKeyword || undefined,
          naics_code: entityNaics || undefined,
          small_business_type: t || undefined,
        });
        if (_cached) anyCached = true;
        for (const r of results || []) {
          if (!collected.find((x) => x.tango_id === r.tango_id)) collected.push(r);
        }
      }
      let final = collected;
      if (stateFilter.trim()) {
        const s = stateFilter.trim().toUpperCase();
        final = final.filter((r) => (r.state ?? "").toUpperCase().includes(s));
      }
      setEntityResults(final);
      setEntityCached(anyCached);
      toast.success(`Found ${final.length} entit${final.length === 1 ? "y" : "ies"}${anyCached ? " (from cache)" : ""}`);
    } catch (e: any) {
      toast.error(e.message || "Search failed");
    } finally {
      setEntitySearching(false);
    }
  };

  const addEntityToRoster = async (entity: any): Promise<Partner | null> => {
    if (!teamId) { toast.error("No team selected"); return null; }
    try {
      const partner = await findOrInsertPartnerFromSamEntity(teamId, entity);
      if (partner) {
        toast.success(`Added ${partner.company_name} to roster`);
        qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
        qc.invalidateQueries({ queryKey: ["companies", teamId] });
      }
      return partner;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add to roster");
      return null;
    }
  };

  const addEntityToProposal = async (entity: any) => {
    const partner = await addEntityToRoster(entity);
    if (partner) await addToProposal(partner);
  };

  // ===== Roster suggestions (carried over from previous behavior) =====
  const suggested = useMemo(() => {
    if (!opportunityNaics) return [];
    return partners.filter((p) => p.naics_codes?.includes(opportunityNaics));
  }, [partners, opportunityNaics]);

  // ---- Add a ranked vendor (TeamingTarget) to roster as a partner company ----
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);

  // Build a roster company from a USAspending teaming target — pre-populates
  // past_performance + capabilities narrative via companyFromTeamingTarget.
  const addTargetToRoster = async (t: PartnerExperienceTarget): Promise<Partner | null> => {
    if (!teamId) { toast.error("No team selected"); return null; }
    try {
      // Dedup against existing roster.
      const matchCol = t.uei ? "uei" : "name";
      const matchVal = t.uei ?? t.name;
      const { data: existing } = await supabase
        .from("companies" as any)
        .select("*")
        .eq("team_id", teamId)
        .eq(matchCol, matchVal)
        .limit(1)
        .maybeSingle();
      if (existing) {
        toast.message(`${(existing as any).name} is already in your roster`);
        qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
        return companyToPartnerView(existing as unknown as Company);
      }
      const draft = companyFromTeamingTarget(t, teamId, {
        naicsCodes: opportunityNaics ? [opportunityNaics] : [],
        agency: opportunityAgency ?? null,
      });
      const inserted = await upsertCompany({
        ...draft,
        relationship_status: "prospective",
        is_existing_partner: true,
      });
      toast.success(`Added ${inserted.name} to roster with USAspending past performance`);
      qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
      qc.invalidateQueries({ queryKey: ["companies", teamId] });
      return companyToPartnerView(inserted);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add to roster");
      return null;
    }
  };

  // Optional opt-in enrichment: look the partner up in SAM via Tango entity
  // search and patch the roster row with certifications, UEI/CAGE, address.
  const verifyInSam = async (partner: Partner) => {
    if (!teamId) return;
    setVerifyingKey(partner.id);
    try {
      const { results } = await searchEntities({
        uei: partner.uei || undefined,
        vendor_name: partner.uei ? undefined : partner.company_name,
      });
      const hit = (results || [])[0];
      if (!hit) {
        toast.message(`No SAM.gov match found for ${partner.company_name}`);
        return;
      }
      const certs: string[] = Array.isArray(hit.small_business_types) ? hit.small_business_types : [];
      const naicsExtra: string[] = Array.isArray(hit.naics_codes) ? hit.naics_codes : [];
      const mergedNaics = Array.from(new Set([...(partner.naics_codes ?? []), ...naicsExtra]));
      const mergedCerts = Array.from(new Set([...(partner.certifications ?? []), ...certs]));
      const cityState = [hit.city, hit.state].filter(Boolean).join(", ");
      await upsertCompany({
        id: partner.id,
        team_id: teamId,
        uei: partner.uei ?? hit.uei ?? null,
        cage_code: hit.cage_code ?? null,
        naics_codes: mergedNaics,
        certifications: mergedCerts,
        set_asides: mergedCerts,
        notes: cityState
          ? `SAM-verified · ${cityState}`
          : "SAM-verified",
      } as any);
      toast.success(`Verified ${partner.company_name} in SAM.gov`);
      qc.invalidateQueries({ queryKey: ["teaming-partners", teamId] });
      qc.invalidateQueries({ queryKey: ["companies", teamId] });
    } catch (e: any) {
      toast.error(e?.message ?? "SAM verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" /> Research teaming partners
        </CardTitle>
        <CardDescription>
          Find vendors with proven past performance on similar work — or look up a specific firm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Suggested from roster */}
        {hasProposal && suggested.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-2">
              From your roster
              {opportunityNaics && (
                <span className="text-muted-foreground font-normal"> · NAICS {opportunityNaics}</span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {suggested.map((p) => (
                <div key={p.id} className="border border-border rounded p-2 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{p.company_name}</div>
                    <Button
                      size="sm" variant="outline"
                      disabled={onProposal(p.id)}
                      onClick={() => addToProposal(p)}
                    >
                      <Plus className="w-3 h-3 mr-1" />{onProposal(p.id) ? "Added" : "Add to team"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(p.certifications ?? []).slice(0, 6).map((c) =>
                      <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                    {(p.naics_codes ?? []).slice(0, 8).map((n) => (
                      <Badge
                        key={n}
                        variant={n === opportunityNaics ? "secondary" : "outline"}
                        className="text-[10px] font-mono"
                      >
                        {n}{n === opportunityNaics ? " ✓" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Tabs defaultValue="experience" className="w-full">
          <TabsList>
            <TabsTrigger value="experience">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Partners with relevant experience
            </TabsTrigger>
            <TabsTrigger value="entity">
              <Building2 className="w-3.5 h-3.5 mr-1.5" />
              Look up a specific firm
            </TabsTrigger>
          </TabsList>

          {/* ============== EXPERIENCE MODE (default) ============== */}
          <TabsContent value="experience" className="mt-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div>
                <Label className="text-[11px]">NAICS code</Label>
                <Input
                  className="h-8 text-xs"
                  value={naicsInput}
                  onChange={(e) => setNaicsInput(e.target.value)}
                  placeholder="e.g. 541512"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-[11px]">Agency (boost / hard filter)</Label>
                <Input
                  className="h-8 text-xs"
                  value={agencyInput}
                  onChange={(e) => setAgencyInput(e.target.value)}
                  placeholder="e.g. Department of Veterans Affairs"
                />
              </div>
              <div>
                <Label className="text-[11px]">Lookback (years)</Label>
                <Input
                  className="h-8 text-xs"
                  type="number" min={1} max={15}
                  value={lookbackYears}
                  onChange={(e) =>
                    setLookbackYears(Math.max(1, Math.min(15, Number(e.target.value) || 5)))}
                />
              </div>
              <div>
                <Label className="text-[11px]">Keyword</Label>
                <Input
                  className="h-8 text-xs"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch checked={agencyOnly} onCheckedChange={setAgencyOnly} />
                Agency only (hard filter)
              </label>
              <Button size="sm" onClick={runExperienceSearch} disabled={searching}>
                {searching
                  ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  : (loadedFromSnapshot || awards
                      ? <RefreshCw className="w-3 h-3 mr-1" />
                      : <Search className="w-3 h-3 mr-1" />)}
                {searching
                  ? "Pulling awards…"
                  : (loadedFromSnapshot || awards ? "Refresh" : "Search USAspending")}
              </Button>
              {loadedFromSnapshot && (
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  Reusing saved market snapshot
                  {snapshotAt && <> · {snapshotAt.slice(0, 10)}</>}
                </span>
              )}
            </div>

            {ranked.length === 0 && !searching && (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                {naicsInput
                  ? "No award history yet — click Search to pull from USAspending."
                  : "Set a NAICS code above to find vendors with proven past performance."}
              </div>
            )}

            {ranked.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup
                    type="single" size="sm" variant="outline"
                    value={classFilter}
                    onValueChange={(v) => v && setClassFilter(v as ClassFilter)}
                  >
                    <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
                      All ({ranked.length})
                    </ToggleGroupItem>
                    <ToggleGroupItem value="prime" className="h-7 px-2 text-xs">
                      <Crown className="w-3 h-3 mr-1" />Primes ({primeCount})
                    </ToggleGroupItem>
                    <ToggleGroupItem value="partner" className="h-7 px-2 text-xs">
                      <HandshakeIcon className="w-3 h-3 mr-1" />Partners ({partnerCount})
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <ToggleGroup
                    type="single" size="sm" variant="outline"
                    value={sortKey}
                    onValueChange={(v) => v && setSortKey(v as SortKey)}
                  >
                    <ToggleGroupItem value="relevance" className="h-7 px-2 text-xs">Relevance</ToggleGroupItem>
                    <ToggleGroupItem value="value" className="h-7 px-2 text-xs">Total $</ToggleGroupItem>
                    <ToggleGroupItem value="recent" className="h-7 px-2 text-xs">Most recent</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="border rounded-md divide-y max-h-[28rem] overflow-y-auto">
                  {filtered.map((t) => {
                    const key = t.uei || t.name;
                    const inRoster = findRosterMatch(t);
                    const months = t.recencyMonths == null ? null : Math.round(t.recencyMonths);
                    return (
                      <button
                        key={key}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted/40 focus:bg-muted/40 outline-none"
                        onClick={() => setDrilldown({
                          uei: t.uei || t.name,
                          name: t.name,
                        })}
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-medium truncate">{t.name}</span>
                              {t.classification === "prime" ? (
                                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 text-[10px] px-1.5 py-0 h-5">
                                  <Crown className="w-3 h-3 mr-0.5" />Prime
                                </Badge>
                              ) : (
                                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 text-[10px] px-1.5 py-0 h-5">
                                  <HandshakeIcon className="w-3 h-3 mr-0.5" />Partner
                                </Badge>
                              )}
                              {t.isSmallBusiness && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                                  {t.latestSetAside?.slice(0, 24) ?? "Small business"}
                                </Badge>
                              )}
                              {t.agencyExperience && agencyInput && (
                                <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 hover:bg-sky-500/15 text-[10px] px-1.5 py-0 h-5">
                                  <CheckCircle2 className="w-3 h-3 mr-0.5" />
                                  Worked {agencyInput.length > 24 ? agencyInput.slice(0, 24) + "…" : agencyInput}
                                </Badge>
                              )}
                              {inRoster && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                                  In roster
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                              <span><span className="font-mono">{t.awardCount}</span> award{t.awardCount !== 1 ? "s" : ""}</span>
                              <span className="font-medium text-foreground tabular-nums">{fmtMoney(t.totalValue)}</span>
                              {t.latestAwardDate && (
                                <span>
                                  latest <span className="font-mono">{t.latestAwardDate.slice(0, 10)}</span>
                                  {months !== null && <> · {months}mo</>}
                                </span>
                              )}
                            </div>
                            {t.sampleDescriptions.length > 0 && (
                              <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                                {t.sampleDescriptions.slice(0, 2).join(" · ")}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div
                              className="text-[10px] font-mono tabular-nums px-2 py-0.5 rounded bg-primary/10 text-primary"
                              title="Relevance score"
                            >
                              {t.relevanceScore}
                            </div>
                            {!inRoster ? (
                              <>
                                <Button
                                  size="sm" variant="outline" className="h-7 text-[11px]"
                                  disabled={!teamId}
                                  onClick={(e) => { e.stopPropagation(); addTargetToRoster(t); }}
                                >
                                  <UserPlus className="w-3 h-3 mr-1" />Add to roster
                                </Button>
                                {hasProposal && (
                                  <Button
                                    size="sm" className="h-7 text-[11px]"
                                    disabled={!teamId}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const p = await addTargetToRoster(t);
                                      if (p) await addToProposal(p);
                                    }}
                                  >
                                    <Plus className="w-3 h-3 mr-1" />Add to team
                                  </Button>
                                )}
                              </>
                            ) : (
                              <>
                                {hasProposal && !onProposal(inRoster.id) && (
                                  <Button
                                    size="sm" className="h-7 text-[11px]"
                                    onClick={(e) => { e.stopPropagation(); addToProposal(inRoster); }}
                                  >
                                    <Plus className="w-3 h-3 mr-1" />Add to team
                                  </Button>
                                )}
                                <Button
                                  size="sm" variant="ghost" className="h-7 text-[11px]"
                                  disabled={verifyingKey === inRoster.id}
                                  title="Look up this partner in SAM.gov to attach certifications, UEI/CAGE, and address (uses an entity API call)"
                                  onClick={(e) => { e.stopPropagation(); verifyInSam(inRoster); }}
                                >
                                  {verifyingKey === inRoster.id
                                    ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    : <ShieldCheck className="w-3 h-3 mr-1" />}
                                  Verify in SAM
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  Award history from USAspending. Verify capabilities directly before teaming.
                </div>
              </>
            )}
          </TabsContent>

          {/* ============== ENTITY MODE (secondary) ============== */}
          <TabsContent value="entity" className="mt-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[11px]">NAICS code</Label>
                <Input className="h-8 text-xs" value={entityNaics} onChange={(e) => setEntityNaics(e.target.value)} placeholder="e.g. 541512" />
              </div>
              <div>
                <Label className="text-[11px]">State</Label>
                <Input className="h-8 text-xs" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} placeholder="e.g. VA" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-[11px]">Keyword (matches vendor name)</Label>
                <Input className="h-8 text-xs" value={entityKeyword} onChange={(e) => setEntityKeyword(e.target.value)} placeholder="e.g. cyber, cloud, logistics…" />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <span className="text-[11px] text-muted-foreground">Set-aside:</span>
              {SB_TYPES.map((t) => (
                <label key={t.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={sbTypes.includes(t.value)} onCheckedChange={() => toggleSb(t.value)} />
                  {t.label}
                </label>
              ))}
            </div>
            <Button size="sm" onClick={runEntitySearch} disabled={entitySearching}>
              {entitySearching ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}
              {entitySearching ? "Searching…" : "Search SAM.gov"}
            </Button>
            <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              Entity data from SAM.gov via Tango API. Verify credentials before teaming.
            </div>

            {entityResults === null && (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Enter a NAICS code, state, or keyword above and search SAM.gov to find a specific firm.
              </div>
            )}

            {entityResults !== null && (
              <div className="border border-border rounded overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Legal Name</TableHead>
                      <TableHead>DBA</TableHead>
                      <TableHead>UEI</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Business Types</TableHead>
                      <TableHead>NAICS</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entityResults.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                          No matches found — try a broader NAICS or keyword.
                        </TableCell>
                      </TableRow>
                    )}
                    {entityResults.map((r) => (
                      <TableRow key={r.tango_id || r.uei || `${r.legal_name}-${r.cage_code}`}>
                        <TableCell className="text-xs">{r.legal_name || "—"}</TableCell>
                        <TableCell className="text-xs">{r.dba_name || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{r.uei || "—"}</TableCell>
                        <TableCell className="text-xs">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {(r.small_business_types ?? []).slice(0, 4).map((c: string) =>
                              <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {(r.naics_codes ?? []).slice(0, 4).map((n: string) => (
                              <Badge key={n} variant={n === opportunityNaics ? "secondary" : "outline"} className="text-[10px] font-mono">{n}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col gap-1 items-end">
                            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addEntityToRoster(r)}>
                              <UserPlus className="w-3 h-3 mr-1" />Add to roster
                            </Button>
                            {hasProposal && (
                              <Button size="sm" className="h-7 text-[11px]" onClick={() => addEntityToProposal(r)}>
                                <Plus className="w-3 h-3 mr-1" />Add to this proposal
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {entityCached && <div className="text-[10px] text-muted-foreground p-2">Showing cached results.</div>}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <VendorDetailDrawer
        recipientId={drilldown?.uei ?? null}
        vendorName={drilldown?.name ?? null}
        searchedNaics={naicsInput ? [naicsInput] : []}
        onClose={() => setDrilldown(null)}
      />
    </Card>
  );
}
