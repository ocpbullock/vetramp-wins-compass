import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Save, Trash2, AlertTriangle, ThumbsUp, ThumbsDown, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  calculatePwin, colorFor, deriveInsights, engagementForModel, RELATIONSHIP_MODELS,
  type PwinTeamMember, type PwinContext, type PwinRole, type EngagementType, type PwinResult,
  type RelationshipModel, type ScenarioInsights,
} from "@/lib/pwin";
import { listPartnerCompanies, type PartnerView as Partner } from "@/lib/companies";

const ROLES: { value: PwinRole; label: string }[] = [
  { value: "prime", label: "Prime" },
  { value: "sub", label: "Sub" },
  { value: "mentor", label: "Mentor" },
  { value: "protege", label: "Protégé" },
  { value: "jv_partner", label: "JV Partner" },
];

// Stable empty fallbacks so destructured defaults don't allocate fresh arrays
// each render while queries are loading. A fresh `[]` literal in a useQuery
// destructure default (`= []`) gets a new identity every render, which makes
// dependency-array comparisons in effects always-changed and can loop
// setState -> render -> effect -> setState (React error #185).
const EMPTY_PARTNERS: Partner[] = [];
type EntryRow = { partner_id: string; role: PwinRole; work_share_pct: number | null };
const EMPTY_ENTRIES: EntryRow[] = [];
const EMPTY_SCENARIOS: any[] = [];


type ProposalLite = {
  id: string;
  team_id: string | null;
  naics_code: string | null;
  agency: string | null;
  set_aside: string | null;
  contract_type: string | null;
  engagement_type: EngagementType;
  prime_contractor_id: string | null;
  prime_contractor_name: string | null;
  targeted_scope_areas?: string | null;
  customer_intel: any;
  opportunity_data: any;
};

type SelfProfile = {
  company_name: string;
  certifications: string[];
  naics_codes: string[];
};

export function TeamCompositionAnalyzer({
  open, onOpenChange, proposal,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  proposal: ProposalLite;
}) {
  const teamId = proposal.team_id;
  const proposalId = proposal.id;

  // --- load self profile (company_profile + held contract_vehicles + own past performance)
  const { data: self } = useQuery({
    queryKey: ["pwin-self", teamId],
    enabled: !!teamId && open,
    queryFn: async (): Promise<{
      profile: SelfProfile;
      vehicles: string[];
      pastPerf: Array<{ naics?: string|null; agency?: string|null; end?: string|null; keywords?: string[] }>;
    }> => {
      const [profRes, vehRes, ppRes] = await Promise.all([
        supabase.from("company_profile").select("profile_data").eq("team_id", teamId!).maybeSingle(),
        supabase.from("contract_vehicles").select("vehicle_name").eq("team_id", teamId!).eq("status", "active"),
        supabase.from("past_performance")
          .select("naics_code, agency, period_of_performance_end, relevance_keywords")
          .eq("team_id", teamId!),
      ]);
      const pd = (profRes.data?.profile_data ?? {}) as any;
      return {
        profile: {
          company_name: pd.company_name || pd.name || "Your company",
          certifications: pd.certifications || pd.socioeconomic_certifications || [],
          naics_codes: pd.naics_codes || [],
        },
        vehicles: (vehRes.data ?? []).map((v: any) => v.vehicle_name),
        pastPerf: (ppRes.data ?? []).map((p: any) => ({
          naics: p.naics_code, agency: p.agency, end: p.period_of_performance_end,
          keywords: p.relevance_keywords ?? [],
        })),
      };
    },
  });

  // --- load all teaming partners (from unified companies table)
  const { data: partnersData } = useQuery({
    queryKey: ["pwin-partners", teamId],
    enabled: !!teamId && open,
    queryFn: async () => listPartnerCompanies(teamId!),
  });
  const partners: Partner[] = partnersData ?? EMPTY_PARTNERS;

  // --- load existing teaming entries on this proposal (for prefill)
  const { data: entriesData } = useQuery({
    queryKey: ["pwin-entries", proposalId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("proposal_teaming")
        .select("company_id, role, work_share_pct")
        .eq("proposal_id", proposalId);
      return ((data ?? []) as any[]).map((r) => ({
        partner_id: r.company_id, role: r.role, work_share_pct: r.work_share_pct,
      })) as EntryRow[];
    },
  });
  const entries: EntryRow[] = entriesData ?? EMPTY_ENTRIES;

  // --- load saved scenarios
  const { data: scenariosData, refetch: refetchScenarios } = useQuery({
    queryKey: ["pwin-scenarios", proposalId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("pwin_scenarios").select("*")
        .eq("proposal_id", proposalId).order("created_at");
      return data ?? [];
    },
  });
  const scenarios: any[] = scenariosData ?? EMPTY_SCENARIOS;

  // --- build members state
  const [members, setMembers] = useState<PwinTeamMember[]>([]);
  const [scenarioName, setScenarioName] = useState("");
  const [relationshipModel, setRelationshipModel] = useState<RelationshipModel>(
    proposal.engagement_type === "sub" ? "sub_to_prime" : "prime_with_subs",
  );
  const [scopeAreas, setScopeAreas] = useState<string>(proposal.targeted_scope_areas ?? "");

  // Pull out scalar proposal fields the initializer depends on. Depending on
  // the whole `proposal` object would re-run this effect every time the
  // parent re-renders with a fresh object reference, even when nothing
  // relevant changed.
  const engagementType = proposal.engagement_type;
  const primeContractorId = proposal.prime_contractor_id;
  const primeContractorName = proposal.prime_contractor_name;
  const incumbentName: string | null =
    proposal.customer_intel?.predecessor_contract?.incumbent ?? null;

  // Initialization guard: only (re)build `members` when the analyzer opens
  // for a different proposal, when the underlying data identity actually
  // changes (new partners/entries/self payloads land), or when the relevant
  // scalar proposal fields change. We do NOT re-run while the user is
  // editing partners, roles, or work share — those edits flow through
  // updateMember and must not be overwritten.
  const lastInitRef = useRef<{
    proposalId: string;
    self: unknown;
    partners: unknown;
    entries: unknown;
    engagementType: string | null | undefined;
    primeContractorId: string | null | undefined;
    primeContractorName: string | null | undefined;
    incumbentName: string | null;
  } | null>(null);
  useEffect(() => {
    // Reset when dialog closes so re-opening rebuilds fresh.
    if (!open) {
      lastInitRef.current = null;
      return;
    }
    // Wait until every required query has actually resolved. While any of
    // these is still `undefined` we keep the existing members state and
    // bail — this is the key fix for the render loop: we no longer write
    // state on every render that lands between query resolutions, and the
    // deps are stable query-result identities + scalar proposal fields
    // (not the whole proposal object or fresh `[]` defaults).
    if (!self || !partnersData || !entriesData) return;

    // Skip if nothing relevant changed since the last initialization. This
    // prevents reinitializing while the user is toggling partners, changing
    // roles, or adjusting work share — those edits flow through
    // updateMember and must not be overwritten.
    const prev = lastInitRef.current;
    if (
      prev
      && prev.proposalId === proposalId
      && prev.self === self
      && prev.partners === partnersData
      && prev.entries === entriesData
      && prev.engagementType === engagementType
      && prev.primeContractorId === primeContractorId
      && prev.primeContractorName === primeContractorName
      && prev.incumbentName === incumbentName
    ) {
      return;
    }
    lastInitRef.current = {
      proposalId,
      self,
      partners: partnersData,
      entries: entriesData,
      engagementType,
      primeContractorId,
      primeContractorName,
      incumbentName,
    };


    const isSelfPrime = engagementType === "prime";
    const selfMember: PwinTeamMember = {
      id: "self",
      name: self.profile.company_name,
      isSelf: true,
      role: isSelfPrime ? "prime" : "sub",
      workShare: 0,
      active: true,
      certifications: self.profile.certifications,
      naicsCodes: self.profile.naics_codes,
      contractVehicles: self.vehicles,
      pastPerformance: self.pastPerf,
      isIncumbent: !!incumbentName && self.profile.company_name.toLowerCase().includes(incumbentName.toLowerCase()),
    };

    const entryMap = new Map(entriesData.map((e) => [e.partner_id, e]));
    const primeNameLower = (primeContractorName ?? "").toLowerCase();

    const partnerMembers: PwinTeamMember[] = partnersData.map((p) => {
      const e = entryMap.get(p.id);
      const isThePrime = !isSelfPrime
        && (p.id === primeContractorId
          || (primeNameLower && p.company_name.toLowerCase() === primeNameLower));
      const defaultRole: PwinRole = isThePrime ? "prime" : (e?.role ?? "sub");
      return {
        id: p.id,
        name: p.company_name,
        isSelf: false,
        role: defaultRole,
        workShare: e?.work_share_pct ?? 0,
        active: !!e || !!isThePrime,
        certifications: p.certifications ?? [],
        naicsCodes: p.naics_codes ?? [],
        contractVehicles: (p as any).contract_vehicles ?? [],
        pastPerformance: [],
        isIncumbent: !!incumbentName && p.company_name.toLowerCase().includes(incumbentName.toLowerCase()),
        workedWithIncumbent: false,
        primeRelationshipStrength: isThePrime ? 50 : 0,
      };
    });

    setMembers([selfMember, ...partnerMembers]);
  }, [
    open,
    proposalId,
    self,
    partnersData,
    entriesData,
    engagementType,
    primeContractorId,
    primeContractorName,
    incumbentName,
  ]);


  // --- context for calc
  const ctx: PwinContext = useMemo(() => {
    const oppNaics = [proposal.naics_code].filter(Boolean) as string[];
    const reqVehicles: string[] = [];
    const ct = proposal.contract_type;
    if (ct && /OASIS|STARS|GWAC|SEWP|CIO-SP|VETS/i.test(ct)) reqVehicles.push(ct);
    const scopeKeywords = scopeAreas
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      engagementType: engagementForModel(relationshipModel),
      relationshipModel,
      opportunityNaics: oppNaics,
      opportunityAgency: proposal.agency,
      setAside: proposal.set_aside,
      requiredVehicles: reqVehicles,
      scopeKeywords,
      incumbentName: proposal.customer_intel?.predecessor_contract?.incumbent ?? null,
    };
  }, [
    proposal.naics_code, proposal.contract_type, proposal.agency, proposal.set_aside,
    incumbentName, relationshipModel, scopeAreas,
  ]);

  const result: PwinResult = useMemo(() => calculatePwin(ctx, members), [ctx, members]);
  const insights: ScenarioInsights = useMemo(
    () => deriveInsights(result, relationshipModel),
    [result, relationshipModel],
  );

  // --- mutations
  const updateMember = (id: string, patch: Partial<PwinTeamMember>) =>
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const MAX_SCENARIOS = 6;
  const saveScenario = async () => {
    const name = scenarioName.trim() || `Scenario ${scenarios.length + 1}`;
    if (scenarios.length >= MAX_SCENARIOS) {
      toast.error(`Maximum ${MAX_SCENARIOS} scenarios saved. Delete one first.`);
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) { toast.error("You must be signed in to save a scenario."); return; }
    const { error } = await supabase.from("pwin_scenarios").insert({
      proposal_id: proposalId,
      scenario_name: name,
      team_composition: members as any,
      pwin_score: result.pwin,
      factor_scores: result.factors as any,
      engagement_type: ctx.engagementType,
      relationship_model: relationshipModel,
      targeted_scope_areas: scopeAreas || null,
      strengths: insights.strengths as any,
      weaknesses: insights.weaknesses as any,
      recommended_action: insights.recommendedAction,
      created_by: uid,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved "${name}"`);
    setScenarioName("");
    refetchScenarios();
  };


  const deleteScenario = async (id: string) => {
    const { error } = await supabase.from("pwin_scenarios").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refetchScenarios();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Team Composition Analyzer
          </DialogTitle>
          <DialogDescription>
            Toggle partners, set roles and work share to compare scenario estimates of win probability. Scores are heuristic estimates, not guaranteed probabilities.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="builder" className="px-6 pt-3">
          <TabsList>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="compare">Compare ({scenarios.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="builder" className="mt-0">
            {/* Relationship model + targeted scope — drive PWIN weighting */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
              <div>
                <Label className="text-xs">Relationship model</Label>
                <Select
                  value={relationshipModel}
                  onValueChange={(v) => setRelationshipModel(v as RelationshipModel)}
                >
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_MODELS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Reweights factors — e.g. sub mode emphasizes prime relationship and scope fit.
                </div>
              </div>
              <div>
                <Label className="text-xs">Targeted scope areas (comma or newline separated)</Label>
                <Textarea
                  value={scopeAreas}
                  onChange={(e) => setScopeAreas(e.target.value)}
                  placeholder="e.g. cybersecurity engineering, zero trust, cloud migration"
                  className="text-sm mt-1 min-h-[68px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 pb-6">
              {/* LEFT: Team Builder */}
              <ScrollArea className="h-[58vh] pr-3">
                <div className="space-y-3">
                  {members.filter((m) => m.isSelf).map((m) => (
                    <SelfCard key={m.id} member={m} selfShare={result.selfShare} overAllocated={result.overAllocated} />
                  ))}

                  {members.filter((m) => !m.isSelf).length === 0 && (
                    <div className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center">
                      No teaming partners in roster. Add them in Settings → Teaming Partners.
                    </div>
                  )}

                  {members.filter((m) => !m.isSelf).map((m) => (
                    <PartnerCard key={m.id} member={m} onChange={(patch) => updateMember(m.id, patch)} />
                  ))}
                </div>
              </ScrollArea>

              {/* RIGHT: Pwin score & factors */}
              <ScrollArea className="h-[58vh] pr-3">
                <PwinPanel result={result} />
                <InsightsPanel insights={insights} />

                <div className="mt-6 border-t pt-4 space-y-3">
                  <Label className="text-xs">Save this scenario ({scenarios.length}/{MAX_SCENARIOS})</Label>
                  <div className="flex gap-2">
                    <Input
                      value={scenarioName}
                      onChange={(e) => setScenarioName(e.target.value)}
                      placeholder="e.g. Us as prime with TechCorp"
                      className="h-8 text-sm"
                    />
                    <Button size="sm" onClick={saveScenario} disabled={scenarios.length >= MAX_SCENARIOS}>
                      <Save className="w-3.5 h-3.5 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </TabsContent>


          <TabsContent value="compare" className="mt-0">
            <ScrollArea className="h-[62vh] pt-4 pb-6 pr-3">
              {scenarios.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center">
                  Save a scenario from the builder to start comparing.
                </div>
              ) : (
                <CompareView scenarios={scenarios} onDelete={deleteScenario} currentScore={result.pwin} />
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ============ subcomponents ============

function SelfCard({ member, selfShare, overAllocated }: {
  member: PwinTeamMember; selfShare: number; overAllocated: boolean;
}) {
  return (
    <div className="border-2 border-primary/40 rounded-md p-3 bg-primary/5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-primary font-medium">Your Company</div>
          <div className="font-semibold text-sm">{member.name}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Your share</div>
          <div className={`text-xl font-bold ${overAllocated ? "text-destructive" : "text-primary"}`}>
            {selfShare}%
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {member.certifications.length === 0
          ? <span className="text-[10px] text-muted-foreground">No certifications on file</span>
          : member.certifications.map((c) => <Badge key={c} variant="default" className="text-[10px]">{c}</Badge>)}
      </div>
      <div className="flex flex-wrap gap-1 mt-1">
        {member.naicsCodes.slice(0, 8).map((n) => (
          <Badge key={n} variant="outline" className="text-[10px] font-mono">{n}</Badge>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">
        {member.contractVehicles.length} vehicle(s) · {member.pastPerformance.length} past perf
        {member.isIncumbent && <span className="ml-2 text-primary font-medium">· Incumbent</span>}
      </div>
      {overAllocated && (
        <div className="mt-2 flex items-center gap-1 text-destructive text-xs">
          <AlertTriangle className="w-3.5 h-3.5" /> Partners exceed 100% — reduce shares.
        </div>
      )}
    </div>
  );
}

function PartnerCard({ member, onChange }: {
  member: PwinTeamMember; onChange: (patch: Partial<PwinTeamMember>) => void;
}) {
  return (
    <div className={`border rounded-md p-3 transition-opacity ${member.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{member.name}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {member.certifications.slice(0, 4).map((c) =>
              <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
            {member.naicsCodes.slice(0, 3).map((n) =>
              <Badge key={n} variant="secondary" className="text-[10px] font-mono">{n}</Badge>)}
            {member.isIncumbent && <Badge className="text-[10px]">Incumbent</Badge>}
          </div>
        </div>
        <Switch checked={member.active} onCheckedChange={(v) => onChange({ active: v })} />
      </div>

      {member.active && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px]">Role</Label>
            <Select value={member.role} onValueChange={(v) => onChange({ role: v as PwinRole })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Work share: {member.workShare}%</Label>
            <Slider
              value={[member.workShare]} min={0} max={100} step={5}
              onValueChange={([v]) => onChange({ workShare: v })}
              className="mt-2"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PwinPanel({ result }: { result: PwinResult }) {
  const c = colorFor(result.pwin);
  const headColor = c === "green" ? "text-green-600" : c === "amber" ? "text-amber-600" : "text-destructive";
  return (
    <div>
      <div className="text-center py-4 border rounded-md">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Estimated win probability</div>
        <div className={`text-6xl font-bold tabular-nums ${headColor}`}>{result.pwin}%</div>
        <div className="text-[11px] text-muted-foreground mt-1">
          Partners allocated {result.totalPartnerShare}% · your share {result.selfShare}%
        </div>
        <div className="text-[10px] text-muted-foreground mt-1 italic">
          Scenario estimate based on team inputs — not a guaranteed probability.
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {result.factors.map((f) => {
          const col = colorFor(f.score);
          const bar = col === "green" ? "bg-green-500" : col === "amber" ? "bg-amber-500" : "bg-destructive";
          return (
            <div key={f.key} className="border rounded-md p-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="font-medium">{f.label}</div>
                <div className="tabular-nums">
                  <span className="text-muted-foreground">{Math.round(f.weight * 100)}% wt ·</span>{" "}
                  <span className="font-semibold">{f.score}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                <div className={`h-full ${bar}`} style={{ width: `${f.score}%` }} />
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{f.explanation}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompareView({ scenarios, onDelete, currentScore }: {
  scenarios: any[]; onDelete: (id: string) => void; currentScore: number;
}) {
  const allKeys = Array.from(new Set(scenarios.flatMap((s) => (s.factor_scores ?? []).map((f: any) => f.key))));
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">Current builder score: <span className="font-semibold">{currentScore}%</span></div>
      <div className={`grid gap-3 ${scenarios.length === 1 ? "grid-cols-1" : scenarios.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {scenarios.map((s) => {
          const c = colorFor(Number(s.pwin_score));
          const head = c === "green" ? "text-green-600" : c === "amber" ? "text-amber-600" : "text-destructive";
          return (
            <div key={s.id} className="border rounded-md p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{s.scenario_name}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {RELATIONSHIP_MODELS.find((r) => r.value === s.relationship_model)?.label ?? s.engagement_type}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onDelete(s.id)} aria-label="Delete">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className={`text-4xl font-bold tabular-nums my-2 ${head}`}>{Number(s.pwin_score)}%</div>
              {s.targeted_scope_areas && (
                <div className="text-[11px] text-muted-foreground italic mb-2 line-clamp-2">
                  Scope: {s.targeted_scope_areas}
                </div>
              )}
              <div className="space-y-1">
                {allKeys.map((k) => {
                  const f = (s.factor_scores ?? []).find((x: any) => x.key === k);
                  if (!f) return null;
                  const col = colorFor(f.score);
                  const bar = col === "green" ? "bg-green-500" : col === "amber" ? "bg-amber-500" : "bg-destructive";
                  return (
                    <div key={String(k)}>
                      <div className="flex justify-between text-[11px]">
                        <span className="truncate">{f.label}</span>
                        <span className="tabular-nums font-medium">{f.score}</span>
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${bar}`} style={{ width: `${f.score}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(s.strengths) && s.strengths.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase text-green-700 font-semibold flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" /> Strengths
                  </div>
                  <ul className="text-[11px] mt-1 space-y-0.5 list-disc list-inside">
                    {s.strengths.slice(0, 3).map((x: any, i: number) => (
                      <li key={i} className="truncate">{x.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(s.weaknesses) && s.weaknesses.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase text-destructive font-semibold flex items-center gap-1">
                    <ThumbsDown className="w-3 h-3" /> Weaknesses
                  </div>
                  <ul className="text-[11px] mt-1 space-y-0.5 list-disc list-inside">
                    {s.weaknesses.slice(0, 3).map((x: any, i: number) => (
                      <li key={i} className="truncate">{x.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {s.recommended_action && (
                <div className="mt-2 text-[11px] flex items-start gap-1">
                  <ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                  <span>{s.recommended_action}</span>
                </div>
              )}
            </div>

          );
        })}
      </div>
    </div>
  );
}

function InsightsPanel({ insights }: { insights: ScenarioInsights }) {
  return (
    <div className="mt-4 border rounded-md p-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Scenario insights
      </div>
      <div>
        <div className="text-[11px] font-semibold text-green-700 flex items-center gap-1">
          <ThumbsUp className="w-3 h-3" /> Strengths
        </div>
        {insights.strengths.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic mt-1">No standout strengths yet.</div>
        ) : (
          <ul className="mt-1 space-y-1 text-[12px]">
            {insights.strengths.map((s, i) => (
              <li key={i}><span className="font-medium">{s.label}.</span> <span className="text-muted-foreground">{s.detail}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-[11px] font-semibold text-destructive flex items-center gap-1">
          <ThumbsDown className="w-3 h-3" /> Weaknesses
        </div>
        {insights.weaknesses.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic mt-1">No critical gaps detected.</div>
        ) : (
          <ul className="mt-1 space-y-1 text-[12px]">
            {insights.weaknesses.map((s, i) => (
              <li key={i}><span className="font-medium">{s.label}.</span> <span className="text-muted-foreground">{s.detail}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t pt-2">
        <div className="text-[11px] font-semibold text-primary flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> Recommended next action
        </div>
        <div className="text-[12px] mt-1">{insights.recommendedAction}</div>
      </div>
    </div>
  );
}

