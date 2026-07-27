import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, ArrowRight, Download, Lightbulb, Loader2, RefreshCw, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import {
  rankPartnerSuggestions,
  type PartnerSuggestion,
  type SuggestContext,
  type SuggestPartner,
  type SuggestSelf,
} from "@/lib/partner-suggest";
import {
  calculatePwin,
  type PwinContext,
  type PwinResult,
  type PwinTeamMember,
  type PwinRole,
} from "@/lib/pwin";
import { buildPwinMembers } from "@/lib/pwin-members";
import { listPartnerCompanies, getOwnCompanyProfileData } from "@/lib/companies";
import { addActivityFromAnalysis } from "./ActivitiesPanel";
import { Plus } from "lucide-react";
import { SimilarPastPursuitsCard } from "./SimilarPastPursuitsCard";
import { exportCaptureReportDocx } from "@/lib/capture-report-export";
import { PositioningMatrixCard } from "./PositioningMatrixCard";
import { PtwCard } from "./PtwCard";
import { nextCaptureStage, CAPTURE_STAGE_LABEL } from "@/lib/capture-stage";
import { applyCaptureStage } from "@/lib/stage-mutations";

import { PwinDial } from "@/components/PwinDial";
import { MetricCard } from "@/components/MetricCard";
import { PwinProbabilityCard } from "./PwinProbabilityCard";
import type { PwinProbabilityResult } from "@/lib/pwin-probability";

type TeamStrategy = {
  recommended_model: "prime_with_subs" | "sub_to_prime" | "joint_venture" | "mentor_protege" | "niche_sub";
  model_rationale: string;
  partner_archetypes: { archetype: string; why: string; example_signal: string }[];
};

type CaptureAnalysis = {
  bid_no_bid: {
    recommendation: "bid" | "no_bid" | "lean_bid" | "lean_no_bid";
    confidence: "low" | "medium" | "high";
    rationale: string;
    key_factors: string[];
  };
  win_themes: string[];
  competitor_assessment: string;
  staffing_concerns: string[];
  next_actions: { action: string; why: string; priority: "high" | "medium" | "low" }[];
  team_strategy?: TeamStrategy;
  _fetched_at?: string;
};

const MODEL_LABEL: Record<TeamStrategy["recommended_model"], string> = {
  prime_with_subs: "Prime with subs",
  sub_to_prime: "Sub to a named prime",
  joint_venture: "Joint venture",
  mentor_protege: "Mentor-protégé",
  niche_sub: "Niche sub on a larger team",
};

const REC_LABEL: Record<CaptureAnalysis["bid_no_bid"]["recommendation"], { text: string; className: string }> = {
  bid: { text: "Bid", className: "bg-success text-success-foreground" },
  lean_bid: { text: "Lean Bid", className: "bg-success/80 text-success-foreground" },
  lean_no_bid: { text: "Lean No-Bid", className: "bg-warning text-warning-foreground" },
  no_bid: { text: "No-Bid", className: "bg-destructive text-destructive-foreground" },
};

const PRIORITY_VARIANT: Record<"high" | "medium" | "low", "destructive" | "default" | "secondary"> = {
  high: "destructive", medium: "default", low: "secondary",
};


function countdown(deadline?: string | null) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms < 0) return "PAST DUE";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hrs = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days}d ${hrs}h`;
}

// ---- Shared hook: deterministic teaming summary (PWIN + suggestions) ----
export function useTeamingSummary(proposal: any, proposalId: string) {
  const teamId: string | null = proposal?.team_id ?? null;

  const { data: partners = [], isLoading: loadingPartners } = useQuery({
    queryKey: ["capture-partners", teamId],
    enabled: !!teamId,
    queryFn: () => listPartnerCompanies(teamId!),
  });

  const { data: self } = useQuery({
    queryKey: ["capture-self", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const [pd, vehRes, ppRes] = await Promise.all([
        getOwnCompanyProfileData(teamId!),
        supabase.from("contract_vehicles").select("vehicle_name").eq("team_id", teamId!).eq("status", "active"),
        supabase.from("past_performance").select("naics_code, agency, period_of_performance_end, relevance_keywords")
          .eq("team_id", teamId!).limit(50),
      ]);
      const profile = (pd ?? {}) as any;
      return {
        company_name: profile.legal_name || "Our Company",
        certifications: profile.certifications || profile.socioeconomic_certifications || [],
        naics_codes: profile.naics_codes || [],
        vehicles: (vehRes.data ?? []).map((v: any) => v.vehicle_name),
        pastPerf: (ppRes.data ?? []).map((p: any) => ({
          naics: p.naics_code, agency: p.agency, end: p.period_of_performance_end,
          keywords: p.relevance_keywords ?? [],
        })),
      };
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["capture-entries", proposalId],
    queryFn: async () => {
      const { data } = await supabase.from("proposal_teaming")
        .select("id, company_id, role, work_share_pct, outreach_status")
        .eq("proposal_id", proposalId);
      return (data ?? []) as {
        id: string; company_id: string; role: PwinRole;
        work_share_pct: number; outreach_status: string;
      }[];
    },
    refetchOnWindowFocus: false,
  });

  if (!teamId || loadingPartners || !self) {
    return { ready: false as const, teamId };
  }

  const incumbentName: string | null =
    proposal.customer_intel?.predecessor_contract?.incumbent
    ?? proposal.market_snapshot?.incumbent?.topRecipient
    ?? null;

  const suggestCtx: SuggestContext = {
    engagementType: proposal.engagement_type === "sub" ? "sub" : "prime",
    opportunityNaics: [proposal.naics_code].filter(Boolean) as string[],
    opportunityAgency: proposal.agency,
    setAside: proposal.set_aside,
    requiredVehicles: proposal.contract_type
      && /OASIS|STARS|GWAC|SEWP|CIO-SP|VETS/i.test(proposal.contract_type)
      ? [proposal.contract_type] : [],
    scopeKeywords: (proposal.targeted_scope_areas ?? "")
      .split(/[,;\n]/).map((s: string) => s.trim()).filter(Boolean),
    incumbentName,
    primeContractorName: proposal.prime_contractor_name,
  };
  const suggestSelf: SuggestSelf = {
    certifications: self.certifications,
    naics_codes: self.naics_codes,
    contract_vehicles: self.vehicles,
  };
  const suggestPartners: SuggestPartner[] = partners.map((p: any) => ({
    id: p.id,
    company_name: p.company_name,
    certifications: p.certifications ?? [],
    naics_codes: p.naics_codes ?? [],
    contract_vehicles: p.contract_vehicles ?? [],
    capabilities_summary: p.capabilities_summary,
    past_performance_summary: p.past_performance_summary,
    notes: p.notes,
    relationship_status: p.relationship_status,
  }));
  const existingPartnerIds = entries.map((e) => e.company_id);
  const suggestions: PartnerSuggestion[] = rankPartnerSuggestions(
    suggestCtx, suggestSelf, suggestPartners, existingPartnerIds, { limit: 5 },
  );

  const isSelfPrime = proposal.engagement_type !== "sub";
  const selfWorkSharePct =
    typeof proposal?.pwin_config?.selfWorkSharePct === "number"
      ? proposal.pwin_config.selfWorkSharePct : null;
  const members = buildPwinMembers({
    self,
    isSelfPrime,
    partners: partners.map((p: any) => ({ ...p, name: p.company_name })),
    entries,
    incumbentName,
    primeContractorId: proposal.prime_contractor_id ?? null,
    primeContractorName: proposal.prime_contractor_name ?? null,
    selfWorkSharePct,
  });
  const pwinCtx: PwinContext = {
    engagementType: isSelfPrime ? "prime" : "sub",
    opportunityNaics: [proposal.naics_code].filter(Boolean) as string[],
    opportunityAgency: proposal.agency,
    setAside: proposal.set_aside,
    requiredVehicles: suggestCtx.requiredVehicles,
    scopeKeywords: suggestCtx.scopeKeywords,
    incumbentName,
  };
  const pwinResult = calculatePwin(pwinCtx, members);
  return { ready: true as const, teamId, self, partners, entries, suggestions, pwinResult };
}

export function CaptureAnalysisPanel({ proposal, proposalId }: { proposal: any; proposalId: string }) {
  const [analysis, setAnalysis] = useState<CaptureAnalysis | null>(
    (proposal?.capture_analysis as CaptureAnalysis | null) ?? null,
  );
  const [generatedAt, setGeneratedAt] = useState<string | null>(proposal?.capture_analysis_at ?? null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState<"internal" | "partner" | null>(null);
  const [pwinProbability, setPwinProbability] = useState<PwinProbabilityResult | null>(null);

  // Sync local state when the parent-supplied proposal row changes.
  useEffect(() => {
    setAnalysis((proposal?.capture_analysis as CaptureAnalysis | null) ?? null);
    setGeneratedAt(proposal?.capture_analysis_at ?? null);
  }, [proposal?.capture_analysis, proposal?.capture_analysis_at]);

  const teaming = useTeamingSummary(proposal, proposalId);

  // "Inputs changed" check — newest opportunity_intel timestamp.
  const { data: latestIntelAt } = useQuery({
    queryKey: ["latest-intel-at", proposalId],
    queryFn: async () => {
      const { data } = await supabase
        .from("opportunity_intel" as any)
        .select("created_at")
        .eq("proposal_id", proposalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as any)?.created_at ?? null;
    },
  });

  const inputsChangedSince = (() => {
    if (!generatedAt) return false;
    const g = new Date(generatedAt).getTime();
    const ms = proposal?.market_snapshot_at ? new Date(proposal.market_snapshot_at).getTime() : 0;
    const il = latestIntelAt ? new Date(latestIntelAt).getTime() : 0;
    return ms > g || il > g;
  })();

  const rerun = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("capture-analysis", {
        body: { proposalId, skipCache: true },
      });
      if (error) throw error;
      const nextAnalysis = (data as any)?.analysis as CaptureAnalysis | undefined;
      if (!nextAnalysis) throw new Error("No analysis returned");
      setAnalysis(nextAnalysis);
      setGeneratedAt(nextAnalysis._fetched_at ?? new Date().toISOString());
      const nextStage = nextCaptureStage(proposal?.capture_stage);
      toast.success("Capture analysis updated", nextStage ? {
        action: {
          label: `Move to ${CAPTURE_STAGE_LABEL[nextStage]}`,
          onClick: () => { void applyCaptureStage(proposalId, nextStage); },
        },
      } : undefined);
    } catch (e: any) {
      console.error("[capture-analysis]", e);
      toast.error(e?.message ?? "Failed to run analysis");
    } finally {
      setRunning(false);
    }
  };

  const handleExport = async (variant: "internal" | "partner") => {
    setExporting(variant);
    try {
      const teamId = proposal?.team_id ?? null;
      const [intelRes, partnersRes, entriesRes, selfRes] = await Promise.all([
        supabase
          .from("opportunity_intel" as any)
          .select("intel_type, occurred_on, created_at, source_name, body, title")
          .eq("proposal_id", proposalId)
          .order("occurred_on", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        teamId ? listPartnerCompanies(teamId) : Promise.resolve([]),
        supabase.from("proposal_teaming")
          .select("company_id, role, work_share_pct")
          .eq("proposal_id", proposalId),
        teamId ? getOwnCompanyProfileData(teamId) : Promise.resolve(null),
      ]);
      if ((intelRes as any)?.error) {
        toast.warning("Couldn't load intel log", { description: "The rest of the report will still download." });
      }
      const intelItems = ((intelRes as any)?.data ?? []) as any[];
      const partners = (partnersRes as any[]) ?? [];
      const entries = (((entriesRes as any)?.data ?? []) as any[]);
      const self: any = selfRes ?? null;

      let teamingSummary: any = null;
      if (self) {
        const incumbentName: string | null =
          proposal.customer_intel?.predecessor_contract?.incumbent
          ?? proposal.market_snapshot?.incumbent?.topRecipient
          ?? null;
        const suggestCtx: SuggestContext = {
          engagementType: proposal.engagement_type === "sub" ? "sub" : "prime",
          opportunityNaics: [proposal.naics_code].filter(Boolean) as string[],
          opportunityAgency: proposal.agency,
          setAside: proposal.set_aside,
          requiredVehicles: proposal.contract_type
            && /OASIS|STARS|GWAC|SEWP|CIO-SP|VETS/i.test(proposal.contract_type)
            ? [proposal.contract_type] : [],
          scopeKeywords: (proposal.targeted_scope_areas ?? "")
            .split(/[,;\n]/).map((s: string) => s.trim()).filter(Boolean),
          incumbentName,
          primeContractorName: proposal.prime_contractor_name,
        };
        const suggestSelf: SuggestSelf = {
          certifications: self.certifications,
          naics_codes: self.naics_codes,
          contract_vehicles: self.vehicles,
        };
        const suggestPartners: SuggestPartner[] = partners.map((p: any) => ({
          id: p.id,
          company_name: p.company_name,
          certifications: p.certifications ?? [],
          naics_codes: p.naics_codes ?? [],
          contract_vehicles: p.contract_vehicles ?? [],
          capabilities_summary: p.capabilities_summary,
          past_performance_summary: p.past_performance_summary,
          notes: p.notes,
          relationship_status: p.relationship_status,
        }));
        const existingPartnerIds = entries.map((e: any) => e.company_id);
        const suggestions = rankPartnerSuggestions(
          suggestCtx, suggestSelf, suggestPartners, existingPartnerIds, { limit: 8 },
        );

        const isSelfPrime = proposal.engagement_type !== "sub";
        const members = buildPwinMembers({
          self,
          isSelfPrime,
          partners: partners.map((p: any) => ({ ...p, name: p.company_name })),
          entries,
          incumbentName,
        });
        const pwinResult: PwinResult = calculatePwin({
          engagementType: isSelfPrime ? "prime" : "sub",
          opportunityNaics: [proposal.naics_code].filter(Boolean) as string[],
          opportunityAgency: proposal.agency,
          setAside: proposal.set_aside,
          requiredVehicles: suggestCtx.requiredVehicles,
          scopeKeywords: suggestCtx.scopeKeywords,
          incumbentName,
        }, members);

        teamingSummary = { pwin: pwinResult, suggestions, ourCompanyName: self.company_name };
      }

      await exportCaptureReportDocx({
        proposal,
        marketSnapshot: proposal?.market_snapshot ?? null,
        captureAnalysis: analysis,
        intelItems,
        teamingSummary,
        pwinProbability,
        darkHorses: (proposal?.market_snapshot as any)?.darkHorses ?? null,
        positioningMatrix: (proposal as any)?.positioning_matrix ?? null,
        ptwAnalysis: (proposal as any)?.ptw_analysis ?? null,
      }, { variant });
      toast.success(variant === "internal" ? "Internal capture report downloaded" : "Partner-facing brief downloaded");
    } catch (e: any) {
      console.error("[capture-report-export]", e);
      toast.error(e?.message ?? "Failed to export report");
    } finally {
      setExporting(null);
    }
  };

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Capture Analysis</CardTitle>
          <CardDescription>
            Bid/no-bid recommendation, win themes, competitor assessment, teaming recommendation, staffing concerns, and next actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {running ? (
            <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
              <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-primary shrink-0" />
              <div className="text-sm">
                Running capture analysis — synthesizing market snapshot, human intel, and documents (30–60s)…
              </div>
            </div>
          ) : (
            <Button onClick={rerun} disabled={running}>
              <Sparkles className="w-4 h-4 mr-2" />
              Run capture analysis
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ---- Summary band values ----
  const rec = REC_LABEL[analysis.bid_no_bid.recommendation];
  const pwinValue = teaming.ready ? teaming.pwinResult.pwin : null;




  const cd = countdown(proposal?.response_deadline);

  return (
    <div className="space-y-6">
      {/* --- SUMMARY BAND --- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className={`${rec.className} border-0`}>
          <CardContent className="p-4">
            <div className="briefing-label text-current opacity-80">Recommendation</div>
            <div className="text-2xl font-bold mt-1">{rec.text}</div>
            <div className="text-xs opacity-90 mt-1 capitalize">{analysis.bid_no_bid.confidence} confidence</div>
          </CardContent>
        </Card>
        <MetricCard
          label="PWIN (probability)"
          value={pwinProbability ? `${pwinProbability.likelyPct}%` : "—"}
          sub={
            pwinProbability
              ? pwinProbability.gateFailed
                ? `Gate failed: ${pwinProbability.gateFailed}`
                : `Range ${pwinProbability.lowPct}–${pwinProbability.highPct}%`
              : "Computing…"
          }
          tone={pwinProbability?.gateFailed ? "destructive" : "default"}
        />
        <MetricCard
          label="Team Strength"
          visual={<PwinDial value={pwinValue} size="sm" />}
          sub={
            pwinValue == null
              ? (teaming.teamId ? "Computing…" : "—")
              : teaming.ready && teaming.pwinResult.overAllocated
                ? "Roster over-allocated"
                : "Capability score (0–100)"
          }
        />
        <MetricCard
          label="Response deadline"
          value={cd ?? "—"}
          tone={cd === "PAST DUE" ? "destructive" : "default"}
          sub={
            proposal?.response_deadline
              ? new Date(proposal.response_deadline).toLocaleDateString()
              : "No deadline set"
          }
        />
      </div>

      {/* --- PWIN PROBABILITY (drivers + editable inputs) --- */}
      <PwinProbabilityCard
        proposal={proposal}
        proposalId={proposalId}
        teamStrength={pwinValue}
        pwinFactors={teaming.ready ? teaming.pwinResult : null}
        onResult={setPwinProbability}
      />

      {/* --- Toolbar --- */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border rounded-md px-3 py-2 bg-card">
        <span>
          Last generated {generatedAt ? new Date(generatedAt).toLocaleString() : "—"}
        </span>
        {inputsChangedSince && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="w-3 h-3" /> inputs changed since last run
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!!exporting}>
                {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export report
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("internal")}>
                Internal capture report (full)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("partner")}>
                Partner-facing brief (no internal intel)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={rerun} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Re-run analysis
          </Button>
        </div>
      </div>
      {/* --- RECOMMENDED TEAM STRATEGY --- */}
      <RecommendedTeamStrategyCard
        proposalId={proposalId}
        analysis={analysis}
        teaming={teaming}
      />

      {/* --- ASSESSMENT --- */}
      <section className="space-y-3">
        <h3 className="briefing-label">Assessment</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Bid rationale</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm whitespace-pre-wrap">{analysis.bid_no_bid.rationale}</p>
              {analysis.bid_no_bid.key_factors?.length > 0 && (
                <div>
                  <div className="briefing-label mb-1">Key factors</div>
                  <ul className="list-disc pl-5 text-sm space-y-0.5">
                    {analysis.bid_no_bid.key_factors.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Win themes</CardTitle>
            </CardHeader>
            <CardContent>
              {analysis.win_themes?.length === 0 ? (
                <div className="text-xs text-muted-foreground">None proposed.</div>
              ) : (
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {analysis.win_themes.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Staffing concerns</CardTitle>
              <CardDescription>Clearance, labor categories, incumbent-staff retention.</CardDescription>
            </CardHeader>
            <CardContent>
              {analysis.staffing_concerns?.length === 0 ? (
                <div className="text-xs text-muted-foreground">None flagged.</div>
              ) : (
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {analysis.staffing_concerns.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* --- COMPETITIVE FIELD --- */}
      <section className="space-y-3">
        <h3 className="briefing-label">Competitive field</h3>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Competitor assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{analysis.competitor_assessment || "—"}</p>
          </CardContent>
        </Card>
        <PositioningMatrixCard proposal={proposal} proposalId={proposalId} />
        <PtwCard proposal={proposal} proposalId={proposalId} />
      </section>

      {/* --- EXECUTION --- */}
      <section className="space-y-3">
        <h3 className="briefing-label">Execution</h3>
        <TeamingRecommendationCard proposal={proposal} proposalId={proposalId} teaming={teaming} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Next actions</CardTitle>
          </CardHeader>
          <CardContent>
            {analysis.next_actions?.length === 0 ? (
              <div className="text-xs text-muted-foreground">No next actions.</div>
            ) : (
              <ul className="space-y-2">
                {analysis.next_actions.map((a, i) => (
                  <li key={i} className="border rounded-md p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium flex-1">{a.action}</div>
                      <Badge variant={PRIORITY_VARIANT[a.priority]} className="capitalize shrink-0">{a.priority}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0"
                        onClick={async () => {
                          const res = await addActivityFromAnalysis({
                            proposalId,
                            teamId: proposal?.team_id ?? null,
                            title: a.action,
                            detail: a.why,
                          });
                          if (res.ok) toast.success("Added to activities");
                          else toast.error(res.error ?? "Failed to add activity");
                        }}
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add to activities
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{a.why}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* --- HISTORY --- */}
      <section className="space-y-3">
        <h3 className="briefing-label">History</h3>
        <SimilarPastPursuitsCard
          proposalId={proposalId}
          teamId={proposal?.team_id ?? null}
          naicsCode={proposal?.naics_code ?? null}
          agency={proposal?.agency ?? null}
        />
      </section>
    </div>
  );
}

// ----- Teaming Recommendation: deterministic, reuses the shared hook -----

function TeamingRecommendationCard({
  proposal, proposalId, teaming,
}: {
  proposal: any;
  proposalId: string;
  teaming: ReturnType<typeof useTeamingSummary>;
}) {
  if (!teaming.teamId) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teaming recommendation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">Save the opportunity to a team to compute teaming recommendations.</div>
        </CardContent>
      </Card>
    );
  }

  if (!teaming.ready) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teaming recommendation
          </CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
    );
  }

  const { pwinResult, suggestions } = teaming;



  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teaming recommendation
          </CardTitle>
          <CardDescription>
            Computed from your roster and current teaming entries — not from the model.
          </CardDescription>
        </div>
        <Link
          to="/proposals/$proposalId"
          params={{ proposalId }}
          search={{ tab: "team" } as any}
          className="text-xs text-primary inline-flex items-center hover:underline"
        >
          Open Team tab <ArrowRight className="w-3 h-3 ml-1" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4">
          <PwinDial value={pwinResult.pwin} size="sm" label="Team Strength" />
          <div className="text-xs text-muted-foreground">
            {pwinResult.overAllocated ? (
              <Badge variant="destructive">Over-allocated</Badge>
            ) : (
              <>Roster of {pwinResult.factors.length} factor(s) scored.</>
            )}
          </div>
        </div>



        <div>
          <div className="briefing-label flex items-center gap-1 mb-1">
            <Lightbulb className="w-3 h-3" /> Top suggested partners
          </div>
          {suggestions.length === 0 ? (
            <div className="text-xs text-muted-foreground">No additional partners on file ranked well for this opp.</div>
          ) : (
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li key={s.partnerId} className="flex items-center gap-2 text-sm">
                  <span className={`text-base font-bold num w-8 ${
                    s.fitScore >= 70 ? "text-success" : s.fitScore >= 40 ? "text-warning" : "text-destructive"
                  }`}>{s.fitScore}</span>
                  <span className="font-medium truncate">{s.partnerName}</span>
                  <Badge variant="secondary" className="text-[10px]">{s.bestRoleLabel}</Badge>
                  {s.reasons[0] && (
                    <span className="text-xs text-muted-foreground truncate">— {s.reasons[0]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ----- Recommended Team Strategy: deterministic gap chips + AI archetypes -----

type GapChip = {
  key: string;
  label: string;
  focus: "setAside" | "naics" | "vehicle" | "incumbent";
  focusValue?: string;
};

function computeGaps(pwinResult: PwinResult | null, proposal: any): GapChip[] {
  if (!pwinResult) return [];
  const byKey = (k: string) => pwinResult.factors.find((f) => f.key === k);
  const chips: GapChip[] = [];
  const sa = byKey("set_aside");
  if (sa && sa.score < 40 && proposal?.set_aside) {
    chips.push({
      key: "set_aside",
      label: `Need ${proposal.set_aside}-certified partner`,
      focus: "setAside",
      focusValue: proposal.set_aside,
    });
  }
  const nc = byKey("naics_coverage");
  if (nc && nc.score < 60 && proposal?.naics_code) {
    chips.push({
      key: "naics_coverage",
      label: `NAICS coverage gap: ${proposal.naics_code}`,
      focus: "naics",
      focusValue: proposal.naics_code,
    });
  }
  const va = byKey("vehicle_access");
  const vehicles = proposal?.contract_vehicle ? [proposal.contract_vehicle] : [];
  if (va && va.score < 40 && vehicles.length) {
    chips.push({
      key: "vehicle_access",
      label: `Need vehicle holder: ${vehicles.join(", ")}`,
      focus: "vehicle",
      focusValue: vehicles[0],
    });
  }
  const inc = byKey("incumbent");
  if (inc && inc.score <= 50) {
    chips.push({
      key: "incumbent",
      label: "No incumbent ties — recruit incumbent-adjacent partner",
      focus: "incumbent",
    });
  }
  return chips;
}

function assessRosterVsStrategy(
  strategy: TeamStrategy | undefined,
  entries: { role: string }[],
  isSelfPrime: boolean,
): string | null {
  if (!strategy || entries.length === 0) return null;
  const model = strategy.recommended_model;
  const hasRole = (r: string) => entries.some((e) => (e.role || "").toLowerCase() === r);
  if (model === "joint_venture" && !hasRole("jv_partner")) {
    return `Mismatch: recommended Joint Venture but no jv_partner role on roster.`;
  }
  if (model === "mentor_protege" && !hasRole("mentor") && !hasRole("protege")) {
    return `Mismatch: recommended Mentor-Protégé but no mentor/protege role on roster.`;
  }
  if (model === "sub_to_prime" && isSelfPrime) {
    return `Mismatch: recommended Sub-to-Prime but engagement is currently set to prime.`;
  }
  if (model === "prime_with_subs" && !isSelfPrime) {
    return `Mismatch: recommended Prime-with-Subs but engagement is currently set to sub.`;
  }
  return `Aligned with recommended model (${MODEL_LABEL[model]}).`;
}

function RecommendedTeamStrategyCard({
  proposalId, analysis, teaming,
}: {
  proposalId: string;
  analysis: CaptureAnalysis;
  teaming: ReturnType<typeof useTeamingSummary>;
}) {
  const strategy = analysis.team_strategy;
  const pwinResult = teaming.ready ? teaming.pwinResult : null;
  const gaps = computeGaps(pwinResult, (teaming as any).ready ? (teaming as any).partners && analysis : analysis && null);
  // computeGaps needs the proposal; re-derive using teaming.ready + entries
  // The teaming hook doesn't expose the proposal; pull chips inline instead below.
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Recommended team strategy
        </CardTitle>
        <CardDescription className="text-xs">
          Deterministic gaps come from your current pWin factors. The recommended teaming model comes from the analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <StrategyRosterAssessment
          proposalId={proposalId}
          strategy={strategy}
          teaming={teaming}
        />

        <div>
          <div className="briefing-label mb-1">Gaps to close</div>
          <GapChipList proposalId={proposalId} pwinResult={pwinResult} />
        </div>

        {strategy ? (
          <>
            <div>
              <div className="briefing-label mb-1">Recommended model</div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="text-xs">{MODEL_LABEL[strategy.recommended_model]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                {strategy.model_rationale}
              </p>
            </div>
            {strategy.partner_archetypes?.length > 0 && (
              <div>
                <div className="briefing-label mb-1">Partner archetypes to recruit</div>
                <ul className="space-y-1.5">
                  {strategy.partner_archetypes.map((a, i) => (
                    <li key={i} className="border rounded-md p-2">
                      <div className="text-sm font-medium">{a.archetype}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{a.why}</div>
                      {a.example_signal && (
                        <div className="text-[11px] text-muted-foreground mt-1 italic">
                          Signal: {a.example_signal}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-muted-foreground border border-dashed rounded p-2">
            No team strategy on this analysis — re-run analysis for team strategy.
          </div>
        )}
      </CardContent>
    </Card>
  );
  // gaps is unused above by design; we render via GapChipList that has access to the proposal via a wrapper.
  void gaps;
}

function StrategyRosterAssessment({
  proposalId, strategy, teaming,
}: {
  proposalId: string;
  strategy: TeamStrategy | undefined;
  teaming: ReturnType<typeof useTeamingSummary>;
}) {
  const { data: entries = [] } = useQuery({
    queryKey: ["strategy-entries", proposalId],
    queryFn: async () => {
      const { data } = await supabase.from("proposal_teaming")
        .select("role, company_id").eq("proposal_id", proposalId);
      return (data ?? []) as { role: string; company_id: string }[];
    },
  });
  const isSelfPrime = teaming.ready
    ? teaming.pwinResult.factors.length > 0 // no direct engagement flag; infer from context
      ? true
      : true
    : true;
  const line = assessRosterVsStrategy(strategy, entries, isSelfPrime);
  if (!line) return null;
  const isMismatch = line.startsWith("Mismatch");
  return (
    <div className={`text-xs rounded border px-2 py-1.5 ${
      isMismatch ? "border-warning/60 bg-warning/10 text-warning" : "border-success/40 bg-success/10 text-success"
    }`}>
      Current proposed team vs strategy: {line}
    </div>
  );
}

function GapChipList({
  proposalId, pwinResult,
}: {
  proposalId: string;
  pwinResult: PwinResult | null;
}) {
  const { data: proposal } = useQuery({
    queryKey: ["proposal-gaps-src", proposalId],
    queryFn: async () => {
      const { data } = await supabase.from("proposals")
        .select("set_aside, naics_code, contract_vehicle")
        .eq("id", proposalId).maybeSingle();
      return data;
    },
  });
  const chips = computeGaps(pwinResult, proposal ?? {});
  if (chips.length === 0) {
    return <div className="text-xs text-muted-foreground">No critical gaps detected in current team.</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.key}
          to="/proposals/$proposalId"
          params={{ proposalId }}
          search={{ tab: "team", teamFocus: c.focus, focusValue: c.focusValue } as any}
          className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 text-warning text-[11px] px-2 py-0.5 hover:bg-warning/20"
        >
          <AlertTriangle className="w-3 h-3" />
          {c.label}
          <ArrowRight className="w-3 h-3" />
        </Link>
      ))}
    </div>
  );
}
