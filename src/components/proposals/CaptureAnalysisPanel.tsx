import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowRight, Lightbulb, Loader2, RefreshCw, Sparkles, Users } from "lucide-react";
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
  colorFor,
  type PwinContext,
  type PwinTeamMember,
  type PwinRole,
} from "@/lib/pwin";
import { listPartnerCompanies, getOwnCompanyProfileData } from "@/lib/companies";
import { addActivityFromAnalysis } from "./ActivitiesPanel";
import { Plus } from "lucide-react";
import { SimilarPastPursuitsCard } from "./SimilarPastPursuitsCard";

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
  _fetched_at?: string;
};

const REC_LABEL: Record<CaptureAnalysis["bid_no_bid"]["recommendation"], { text: string; color: string }> = {
  bid: { text: "Bid", color: "bg-green-600 text-white" },
  lean_bid: { text: "Lean Bid", color: "bg-emerald-500 text-white" },
  lean_no_bid: { text: "Lean No-Bid", color: "bg-amber-500 text-white" },
  no_bid: { text: "No-Bid", color: "bg-destructive text-destructive-foreground" },
};

const PRIORITY_VARIANT: Record<"high" | "medium" | "low", "destructive" | "default" | "secondary"> = {
  high: "destructive", medium: "default", low: "secondary",
};

export function CaptureAnalysisPanel({ proposal, proposalId }: { proposal: any; proposalId: string }) {
  const qc = useQueryClient();
  const analysis: CaptureAnalysis | null = (proposal?.capture_analysis as CaptureAnalysis | null) ?? null;
  const generatedAt: string | null = proposal?.capture_analysis_at ?? null;
  const [running, setRunning] = useState(false);

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
      const { error } = await supabase.functions.invoke("capture-analysis", {
        body: { proposalId, skipCache: true },
      });
      if (error) throw error;
      toast.success("Capture analysis updated");
      await qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to run analysis");
    } finally {
      setRunning(false);
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
          <Button onClick={rerun} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Run capture analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Capture Analysis</CardTitle>
            <CardDescription>
              Last generated {generatedAt ? new Date(generatedAt).toLocaleString() : "—"}
              {inputsChangedSince && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                  <AlertTriangle className="w-3 h-3" /> inputs changed since last run
                </span>
              )}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={rerun} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Re-run analysis
          </Button>
        </CardHeader>
      </Card>

      {/* Bid/No-Bid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bid / No-Bid recommendation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-md text-sm font-semibold ${REC_LABEL[analysis.bid_no_bid.recommendation].color}`}>
              {REC_LABEL[analysis.bid_no_bid.recommendation].text}
            </span>
            <Badge variant="outline" className="capitalize">{analysis.bid_no_bid.confidence} confidence</Badge>
          </div>
          <p className="text-sm whitespace-pre-wrap">{analysis.bid_no_bid.rationale}</p>
          {analysis.bid_no_bid.key_factors?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Key factors</div>
              <ul className="list-disc pl-5 text-sm space-y-0.5">
                {analysis.bid_no_bid.key_factors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Win Themes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Win Themes</CardTitle>
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

      {/* Competitor Assessment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Competitor Assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{analysis.competitor_assessment || "—"}</p>
        </CardContent>
      </Card>

      {/* Teaming Recommendation (computed locally) */}
      <TeamingRecommendationCard proposal={proposal} proposalId={proposalId} />

      {/* Staffing Concerns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staffing Concerns</CardTitle>
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

      {/* Next Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next Actions</CardTitle>
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

      <SimilarPastPursuitsCard
        proposalId={proposalId}
        teamId={proposal?.team_id ?? null}
        naicsCode={proposal?.naics_code ?? null}
        agency={proposal?.agency ?? null}
      />
    </div>
  );
}

// ----- Teaming Recommendation: deterministic, reuses existing engines -----

function TeamingRecommendationCard({ proposal, proposalId }: { proposal: any; proposalId: string }) {
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
        .select("company_id, role, work_share_pct")
        .eq("proposal_id", proposalId);
      return (data ?? []) as { company_id: string; role: PwinRole; work_share_pct: number }[];
    },
  });

  if (!teamId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teaming Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">Save the proposal to a team to compute teaming recommendations.</div>
        </CardContent>
      </Card>
    );
  }

  if (loadingPartners || !self) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teaming Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
    );
  }

  // ---- rankPartnerSuggestions ----
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
  const suggestPartners: SuggestPartner[] = partners.map((p) => ({
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

  // ---- calculatePwin from current roster ----
  const isSelfPrime = proposal.engagement_type !== "sub";
  const selfMember: PwinTeamMember = {
    id: "self",
    name: self.company_name,
    isSelf: true,
    role: isSelfPrime ? "prime" : "sub",
    workShare: isSelfPrime
      ? Math.max(0, 100 - entries.reduce((s, e) => s + (Number(e.work_share_pct) || 0), 0))
      : (entries.find((e) => e.role !== "prime")?.work_share_pct ?? 0),
    active: true,
    certifications: self.certifications,
    naicsCodes: self.naics_codes,
    contractVehicles: self.vehicles,
    pastPerformance: self.pastPerf,
    isIncumbent: !!incumbentName && self.company_name.toLowerCase().includes(incumbentName.toLowerCase()),
  };
  const entryMap = new Map(entries.map((e) => [e.company_id, e]));
  const partnerMembers: PwinTeamMember[] = partners.map((p) => {
    const e = entryMap.get(p.id);
    return {
      id: p.id,
      name: p.company_name,
      isSelf: false,
      role: (e?.role ?? "sub") as PwinRole,
      workShare: e?.work_share_pct ?? 0,
      active: !!e,
      certifications: p.certifications ?? [],
      naicsCodes: p.naics_codes ?? [],
      contractVehicles: p.contract_vehicles ?? [],
      pastPerformance: [],
      isIncumbent: !!incumbentName && p.company_name.toLowerCase().includes(incumbentName.toLowerCase()),
    };
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
  const pwinResult = calculatePwin(pwinCtx, [selfMember, ...partnerMembers]);
  const pwinColor = colorFor(pwinResult.pwin);
  const pwinTextColor =
    pwinColor === "green" ? "text-green-600"
    : pwinColor === "amber" ? "text-amber-600"
    : "text-destructive";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teaming Recommendation
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
        <div className="flex items-baseline gap-3">
          <div className={`text-3xl font-bold tabular-nums ${pwinTextColor}`}>{pwinResult.pwin}</div>
          <div className="text-sm text-muted-foreground">current PWIN</div>
          {pwinResult.overAllocated && (
            <Badge variant="destructive" className="ml-auto">Over-allocated</Badge>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <Lightbulb className="w-3 h-3" /> Top suggested partners
          </div>
          {suggestions.length === 0 ? (
            <div className="text-xs text-muted-foreground">No additional partners on file ranked well for this opp.</div>
          ) : (
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li key={s.partnerId} className="flex items-center gap-2 text-sm">
                  <span className={`text-base font-bold tabular-nums w-8 ${
                    s.fitScore >= 70 ? "text-green-600" : s.fitScore >= 40 ? "text-amber-600" : "text-destructive"
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
