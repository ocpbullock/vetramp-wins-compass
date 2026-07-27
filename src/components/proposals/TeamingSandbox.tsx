import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Save, Trash2, Plus, X, ArrowRight, ThumbsUp, ThumbsDown, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "sonner";
import { listCompanies, type Company } from "@/lib/companies";
import {
  calculatePwin, colorFor, deriveInsights,
  RELATIONSHIP_MODELS, engagementForModel,
  type PwinTeamMember, type PwinContext, type PwinRole, type PwinResult,
  type RelationshipModel,
} from "@/lib/pwin";
import { PwinDial } from "@/components/PwinDial";

export type SandboxOpportunityContext = {
  title: string;
  naicsCodes: string[];
  agency?: string | null;
  setAside?: string | null;
  requiredVehicles?: string[];
  incumbentName?: string | null;
  scopeKeywords?: string[];
};

export type SandboxParent =
  | { kind: "proposal"; proposalId: string; teamId: string }
  | { kind: "tracked"; trackedOpportunityId: string; teamId: string }
  | { kind: "preview"; teamId: string };

const ROLES: { value: PwinRole; label: string }[] = [
  { value: "prime", label: "Prime" },
  { value: "sub", label: "Sub" },
  { value: "mentor", label: "Mentor" },
  { value: "protege", label: "Protégé" },
  { value: "jv_partner", label: "JV Partner" },
];

import { buildPartnerPwinMember, buildSelfPwinMember } from "@/lib/pwin-members";

type SandboxMember = PwinTeamMember & { companyId: string };

function memberFromCompany(c: Company, opts: { isSelf: boolean; role: PwinRole; share: number }): SandboxMember {
  const base = opts.isSelf
    ? buildSelfPwinMember({
        self: {
          company_name: c.name,
          certifications: c.certifications ?? [],
          naics_codes: c.naics_codes ?? [],
          vehicles: c.contract_vehicles ?? [],
          pastPerf: (c.past_performance ?? []).map((pp: any) => ({
            naics: pp?.naics ?? null,
            agency: pp?.customer ?? pp?.agency ?? null,
            end: pp?.end ?? null,
            keywords: pp?.keywords ?? [],
          })),
        },
        isSelfPrime: opts.role === "prime",
        workShare: opts.share,
      })
    : buildPartnerPwinMember(
        { ...(c as any), name: c.name },
        { role: opts.role, workShare: opts.share, isPrime: opts.role === "prime" },
      );
  return { ...base, id: c.id, role: opts.role, companyId: c.id };
}

export type SandboxSeedMember = {
  companyId: string;
  role: PwinRole;
  workShare: number;
  isSelf: boolean;
};

export type SandboxSuggestion = {
  companyId: string;
  name: string;
  reason?: string;
};

export function TeamingSandbox({
  open, onOpenChange, parent, opportunity, addCompanyIdOnOpen,
  seedFromProposed, suggestions,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  parent: SandboxParent;
  opportunity: SandboxOpportunityContext;
  /** If set, this company id is added to the sandbox team when companies finish loading. */
  addCompanyIdOnOpen?: string | null;
  /** Team of record: sandbox re-seeds from this each time it opens. */
  seedFromProposed?: SandboxSeedMember[];
  /** Top suggested partners for one-click add. */
  suggestions?: SandboxSuggestion[];
}) {
  const qc = useQueryClient();
  const teamId = parent.teamId;

  const { data: companies } = useQuery({
    queryKey: ["sandbox-companies", teamId],
    enabled: open && !!teamId,
    queryFn: () => listCompanies(teamId),
  });

  const ownCompany = useMemo(() => companies?.find((c) => c.is_own_company), [companies]);

  // ----- builder state
  const [members, setMembers] = useState<SandboxMember[]>([]);
  const [perspectiveId, setPerspectiveId] = useState<string | null>(null);
  const [relationshipModel, setRelationshipModel] = useState<RelationshipModel>("prime_with_subs");
  const [scopeAreas, setScopeAreas] = useState<string>((opportunity.scopeKeywords ?? []).join(", "));
  const [pickerQuery, setPickerQuery] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [previewScenarios, setPreviewScenarios] = useState<any[]>([]);


  // Re-seed from the current Proposed Team every time the sandbox is opened.
  // Falls back to a lone self-prime seed when no seed is provided.
  const reseedFromProposed = () => {
    if (!companies || companies.length === 0) return;
    const seed: SandboxMember[] = [];
    if (seedFromProposed && seedFromProposed.length > 0) {
      for (const s of seedFromProposed) {
        const c = companies.find((cc) => cc.id === s.companyId);
        if (!c) continue;
        seed.push(memberFromCompany(c, { isSelf: s.isSelf, role: s.role, share: s.workShare }));
      }
      const self = seed.find((m) => m.isSelf) ?? seed[0];
      if (self) setPerspectiveId(self.companyId);
    }
    if (seed.length === 0) {
      const initial = ownCompany ?? companies[0];
      setPerspectiveId(initial.id);
      seed.push(memberFromCompany(initial, { isSelf: true, role: "prime", share: 100 }));
      if (addCompanyIdOnOpen && addCompanyIdOnOpen !== initial.id) {
        const extra = companies.find((c) => c.id === addCompanyIdOnOpen);
        if (extra) seed.push(memberFromCompany(extra, { isSelf: false, role: "sub", share: 20 }));
      }
    }
    setMembers(seed);
  };

  // Seed on open + whenever companies finish loading for an already-open dialog.
  useEffect(() => {
    if (!open || !companies) return;
    reseedFromProposed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companies]);

  // Reset when dialog closes
  useEffect(() => {
    if (open) return;
    setMembers([]);
    setPerspectiveId(null);
    setScenarioName("");
    setPickerQuery("");
    setPreviewScenarios([]);
  }, [open]);

  const addCompany = (c: Company) => {
    if (members.some((m) => m.companyId === c.id)) return;
    const isFirst = members.length === 0;
    setMembers((prev) => [
      ...prev,
      memberFromCompany(c, {
        isSelf: isFirst,
        role: prev.some((m) => m.role === "prime") ? "sub" : "prime",
        share: isFirst ? 100 : 20,
      }),
    ]);
    if (isFirst) setPerspectiveId(c.id);
  };

  const removeMember = (companyId: string) => {
    setMembers((prev) => {
      const next = prev.filter((m) => m.companyId !== companyId);
      if (perspectiveId === companyId && next.length > 0) {
        setPerspectiveId(next[0].companyId);
        return next.map((m, i) => ({ ...m, isSelf: i === 0 }));
      }
      return next;
    });
  };

  const updateMember = (companyId: string, patch: Partial<SandboxMember>) => {
    setMembers((prev) => prev.map((m) => (m.companyId === companyId ? { ...m, ...patch } : m)));
  };

  const setPerspective = (companyId: string) => {
    setPerspectiveId(companyId);
    setMembers((prev) => prev.map((m) => ({ ...m, isSelf: m.companyId === companyId })));
  };

  const ctx: PwinContext = useMemo(() => ({
    engagementType: engagementForModel(relationshipModel),
    relationshipModel,
    opportunityNaics: opportunity.naicsCodes,
    opportunityAgency: opportunity.agency ?? null,
    setAside: opportunity.setAside ?? null,
    requiredVehicles: opportunity.requiredVehicles ?? [],
    scopeKeywords: scopeAreas.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
    incumbentName: opportunity.incumbentName ?? null,
  }), [
    relationshipModel, opportunity.naicsCodes, opportunity.agency,
    opportunity.setAside, opportunity.requiredVehicles, opportunity.incumbentName, scopeAreas,
  ]);

  const result: PwinResult = useMemo(() => calculatePwin(ctx, members), [ctx, members]);
  const insights = useMemo(() => deriveInsights(result, relationshipModel), [result, relationshipModel]);

  // ----- saved scenarios (only when there's a parent id)
  const canPersist = parent.kind !== "preview";
  const { data: savedScenarios = [], refetch: refetchScenarios } = useQuery({
    queryKey: ["sandbox-scenarios", parent],
    enabled: open && canPersist,
    queryFn: async () => {
      const q = supabase.from("pwin_scenarios").select("*").order("created_at");
      const final = parent.kind === "proposal"
        ? q.eq("proposal_id", parent.proposalId)
        : (q as any).eq("tracked_opportunity_id", (parent as any).trackedOpportunityId);
      const { data, error } = await final;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    const q = pickerQuery.trim().toLowerCase();
    const inTeam = new Set(members.map((m) => m.companyId));
    return companies
      .filter((c) => !inTeam.has(c.id))
      .filter((c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.naics_codes.some((n) => n.includes(q)) ||
        c.certifications.some((x) => x.toLowerCase().includes(q)),
      );
  }, [companies, pickerQuery, members]);

  const saveScenario = async () => {
    const name = scenarioName.trim() || `Scenario ${(savedScenarios?.length ?? 0) + previewScenarios.length + 1}`;
    const perspective = members.find((m) => m.isSelf);
    const payload = {
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
      opportunity_context: opportunity as any,
      scope_label: scopeAreas || null,
      perspective_company_id: perspective?.companyId ?? null,
    };

    if (!canPersist) {
      setPreviewScenarios((prev) => [...prev, { id: `local-${prev.length + 1}`, ...payload, local: true }]);
      toast.success(`Saved "${name}" (preview only — link to a tracked opportunity to persist).`);
      setScenarioName("");
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) { toast.error("You must be signed in to save."); return; }

    const insert: any = {
      ...payload,
      created_by: uid,
      proposal_id: parent.kind === "proposal" ? parent.proposalId : null,
      tracked_opportunity_id: parent.kind === "tracked" ? parent.trackedOpportunityId : null,
    };
    const { error } = await supabase.from("pwin_scenarios").insert(insert);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved "${name}"`);
    setScenarioName("");
    refetchScenarios();
    qc.invalidateQueries({ queryKey: ["sandbox-scenarios"] });
  };

  const deleteScenario = async (id: string) => {
    if (id.startsWith("local-")) {
      setPreviewScenarios((prev) => prev.filter((s) => s.id !== id));
      return;
    }
    const { error } = await supabase.from("pwin_scenarios").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refetchScenarios();
  };

  const allScenarios = canPersist ? savedScenarios : previewScenarios;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Teaming Sandbox
          </DialogTitle>
          <DialogDescription className="text-xs">
            {opportunity.title} — assemble a candidate team from your company library, pick the perspective company, and compare scenarios.
            {!canPersist && (
              <span className="text-warning ml-1">Preview mode: scenarios won't persist. Promote to a tracked opportunity to save.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-3 text-[11px] text-muted-foreground bg-muted/40 border-b py-2">
          <strong className="text-foreground">What-if modeling.</strong> Your Proposed Team above is the team of record — use the sandbox to test alternative lineups without changing it. Changes here are never saved to the pursuit.
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
        <Tabs defaultValue="builder" className="px-6 pt-3">
          <TabsList>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="compare">Compare ({allScenarios.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="builder" className="mt-0">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
              <div>
                <Label className="text-xs">Relationship model</Label>
                <Select value={relationshipModel} onValueChange={(v) => setRelationshipModel(v as RelationshipModel)}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_MODELS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Targeted scope areas</Label>
                <Input
                  value={scopeAreas}
                  onChange={(e) => setScopeAreas(e.target.value)}
                  placeholder="e.g. zero trust, cloud migration"
                  className="text-sm mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4 pb-6">
              {/* LEFT: Company picker */}
              <div className="lg:col-span-1">
                <Label className="text-xs">Add from company library</Label>
                <Input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search companies, NAICS, certs…"
                  className="h-8 text-sm mt-1"
                />
                <ScrollArea className="h-[52vh] mt-2 border rounded-md">
                  <div className="p-2 space-y-1">
                    {filteredCompanies.length === 0 && (
                      <div className="text-xs text-muted-foreground py-4 text-center">No more matching companies.</div>
                    )}
                    {filteredCompanies.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => addCompany(c)}
                        className="w-full text-left p-2 rounded hover:bg-muted border border-transparent hover:border-border"
                      >
                        <div className="flex items-center gap-1 text-sm font-medium">
                          {c.is_own_company && <Building2 className="w-3 h-3 text-primary" />}
                          <span className="truncate">{c.name}</span>
                          <Plus className="w-3 h-3 ml-auto text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.certifications.slice(0, 3).map((x) => (
                            <Badge key={x} variant="outline" className="text-[10px]">{x}</Badge>
                          ))}
                          {c.naics_codes.slice(0, 3).map((n) => (
                            <Badge key={n} variant="secondary" className="text-[10px] font-mono">{n}</Badge>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* MIDDLE: Candidate team */}
              <div className="lg:col-span-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Candidate team ({members.length})</Label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] px-2"
                    onClick={reseedFromProposed}
                    title="Reset the sandbox to the current Proposed Team"
                  >
                    Re-seed from proposed team
                  </Button>
                </div>
                <div className="mt-1 pr-1 max-h-[52vh] overflow-y-auto">
                  <RadioGroup value={perspectiveId ?? ""} onValueChange={setPerspective} className="space-y-2">
                    {members.length === 0 && (
                      <div className="text-xs text-muted-foreground border border-dashed rounded p-4 text-center">
                        Add a company from the picker to start.
                      </div>
                    )}
                    {members.map((m) => (
                      <div key={m.companyId} className={`border rounded-md p-2.5 ${m.isSelf ? "border-primary/60 bg-primary/5" : ""}`}>
                        <div className="flex items-start gap-2">
                          <RadioGroupItem value={m.companyId} id={`p-${m.companyId}`} className="mt-1" />
                          <div className="flex-1 min-w-0">
                            <label htmlFor={`p-${m.companyId}`} className="font-medium text-sm cursor-pointer block truncate">
                              {m.name} {m.isSelf && <Badge className="ml-1 text-[10px]">Perspective</Badge>}
                            </label>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <Select value={m.role} onValueChange={(v) => updateMember(m.companyId, { role: v as PwinRole })}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <div>
                                <div className="text-[10px] text-muted-foreground">Work share {m.workShare}%</div>
                                <Slider
                                  value={[m.workShare]} min={0} max={100} step={5}
                                  onValueChange={([v]) => updateMember(m.companyId, { workShare: v })}
                                />
                              </div>
                            </div>
                            {!m.isSelf && (
                              <div className="mt-2">
                                <div className="text-[10px] text-muted-foreground">
                                  Relationship strength {m.primeRelationshipStrength ?? 0}
                                </div>
                                <Slider
                                  value={[m.primeRelationshipStrength ?? 0]} min={0} max={100} step={5}
                                  onValueChange={([v]) => updateMember(m.companyId, { primeRelationshipStrength: v })}
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-[11px]">
                              <label className="flex items-center gap-1">
                                <Switch
                                  checked={!!m.isIncumbent}
                                  onCheckedChange={(v) => updateMember(m.companyId, { isIncumbent: v })}
                                />
                                <span>Incumbent</span>
                              </label>
                              <label className="flex items-center gap-1">
                                <Switch
                                  checked={!!m.workedWithIncumbent}
                                  onCheckedChange={(v) => updateMember(m.companyId, { workedWithIncumbent: v })}
                                />
                                <span>Worked w/ incumbent</span>
                              </label>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeMember(m.companyId)} aria-label="Remove">
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                {suggestions && suggestions.length > 0 && (
                  <div className="mt-3 border-t pt-2">
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">
                      Add from suggestions (sandbox only)
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {suggestions
                        .filter((s) => !members.some((m) => m.companyId === s.companyId))
                        .slice(0, 8)
                        .map((s) => (
                          <button
                            key={s.companyId}
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 text-primary text-[11px] px-2 py-0.5 hover:bg-primary/10"
                            onClick={() => {
                              const c = companies?.find((cc) => cc.id === s.companyId);
                              if (c) addCompany(c);
                            }}
                            title={s.reason ?? undefined}
                          >
                            <Plus className="w-3 h-3" />
                            {s.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>


              {/* RIGHT: pWin */}
              <div className="lg:col-span-1">
                <PwinDisplay result={result} />
                <InsightsBox insights={insights} />

                <div className="mt-4 border-t pt-3 space-y-2">
                  <Label className="text-xs">Save scenario</Label>
                  <div className="flex gap-2">
                    <Input
                      value={scenarioName}
                      onChange={(e) => setScenarioName(e.target.value)}
                      placeholder="e.g. Scenario A: we prime"
                      className="h-8 text-sm"
                    />
                    <Button size="sm" onClick={saveScenario} disabled={members.length === 0}>
                      <Save className="w-3.5 h-3.5 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compare" className="mt-0">
            <ScrollArea className="h-[68vh] pt-4 pb-6 pr-3">
              {allScenarios.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center">
                  Save a scenario from the builder to start comparing.
                </div>
              ) : (
                <CompareGrid scenarios={allScenarios} onDelete={deleteScenario} currentScore={result.pwin} />
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PwinDisplay({ result }: { result: PwinResult }) {
  return (
    <div>
      <div className="flex flex-col items-center py-3 border rounded-md">
        <PwinDial value={result.pwin} size="md" label="Team Strength" />
        <div className="text-[11px] text-muted-foreground mt-1">
          Partners {result.totalPartnerShare}% · perspective {result.selfShare}%
        </div>
        {result.overAllocated && (
          <div className="text-[10px] text-destructive flex items-center justify-center gap-1 mt-1">
            <AlertTriangle className="w-3 h-3" /> over-allocated
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {result.factors.map((f) => {
          const col = colorFor(f.score);
          const bar =
            col === "green" ? "bg-success"
            : col === "amber" ? "bg-warning"
            : "bg-destructive";
          return (
            <div key={f.key} className="border rounded p-2">
              <div className="flex justify-between text-[11px]">
                <span className="font-medium truncate">{f.label}</span>
                <span className="tabular-nums">{Math.round(f.weight * 100)}% · {f.score}</span>
              </div>
              <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
                <div className={`h-full ${bar}`} style={{ width: `${f.score}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function InsightsBox({ insights }: { insights: ReturnType<typeof deriveInsights> }) {
  return (
    <div className="mt-4 border rounded p-3 text-xs space-y-2">
      {insights.strengths.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-success flex items-center gap-1">
            <ThumbsUp className="w-3 h-3" /> Strengths
          </div>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {insights.strengths.map((s, i) => <li key={i}>{s.label}</li>)}
          </ul>
        </div>
      )}
      {insights.weaknesses.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-destructive flex items-center gap-1">
            <ThumbsDown className="w-3 h-3" /> Weaknesses
          </div>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {insights.weaknesses.map((s, i) => <li key={i}>{s.label}</li>)}
          </ul>
        </div>
      )}
      <div className="border-t pt-2 flex items-start gap-1">
        <ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />
        <span>{insights.recommendedAction}</span>
      </div>
    </div>
  );
}

function CompareGrid({ scenarios, onDelete, currentScore }: { scenarios: any[]; onDelete: (id: string) => void; currentScore: number }) {
  const allKeys = Array.from(new Set(scenarios.flatMap((s) => (s.factor_scores ?? []).map((f: any) => f.key))));
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Current builder score: <span className="font-semibold">{currentScore}%</span>
      </div>
      <div className={`grid gap-3 ${scenarios.length === 1 ? "grid-cols-1" : scenarios.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {scenarios.map((s) => {
          const c = colorFor(Number(s.pwin_score));
          const head = c === "green" ? "text-success" : c === "amber" ? "text-warning" : "text-destructive";
          const perspectiveName = (s.team_composition ?? []).find((m: any) => m.isSelf)?.name;
          return (
            <div key={s.id} className="border rounded-md p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{s.scenario_name}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {RELATIONSHIP_MODELS.find((r) => r.value === s.relationship_model)?.label ?? s.engagement_type}
                  </div>
                  {perspectiveName && (
                    <div className="text-[10px] text-muted-foreground">Perspective: {perspectiveName}</div>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => onDelete(s.id)} aria-label="Delete">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className={`text-4xl font-bold tabular-nums my-2 ${head}`}>{Number(s.pwin_score)}%</div>
              <div className="space-y-1">
                {allKeys.map((k) => {
                  const f = (s.factor_scores ?? []).find((x: any) => x.key === k);
                  if (!f) return null;
                  const col = colorFor(f.score);
                  const bar = col === "green" ? "bg-success" : col === "amber" ? "bg-warning" : "bg-destructive";
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
