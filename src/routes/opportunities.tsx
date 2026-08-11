import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, ExternalLink, Workflow, Sparkles, Loader2, Radar, CircleDot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { useOpportunityContext } from "@/lib/opportunity-context";
import { type TrackedOpportunity } from "@/components/dashboard/TrackOpportunityDialog";
import { AddOpportunityDialog } from "@/components/dashboard/AddOpportunityDialog";
import { PwinChip } from "@/components/dashboard/PwinChip";
import type { OppForPwin } from "@/lib/pwin-solo";
import { canEnrichFromSam, enrichProposalFromSam } from "@/lib/sam-enrich";
import { toast } from "sonner";
import {
  STEPPER_STAGES,
  STEPPER_STAGE_LABEL,
  STEPPER_STAGE_TONE,
  STEPPER_STAGE_COUNT_TONE,
  captureStageToStepper,
  trackedStatusToStepper,
  isStageSatisfied,
  type StepperStage,
  type StageSignals,
} from "@/lib/capture-stage";
import { CaptureStageSelect } from "@/components/proposals/CaptureStageSelect";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { kickOffMarketSnapshotById } from "@/lib/market-snapshot";
import { ExpiringMarketsCard } from "@/components/opportunities/ExpiringMarketsCard";

export const Route = createFileRoute("/opportunities")({
  component: OpportunitiesPage,
});

type ProposalRow = {
  id: string;
  opportunity_title: string | null;
  agency: string | null;
  naics_code: string | null;
  set_aside: string | null;
  status: string | null;
  capture_stage: string | null;
  response_deadline: string | null;
  updated_at: string;
  opportunity_source: string | null;
  opportunity_source_id: string | null;
  solicitation_number: string | null;
  notice_id: string | null;
  watch_enabled: boolean | null;
  market_snapshot_at: string | null;
  ecosystem_at: string | null;
  capture_analysis_at: string | null;
  sections: Record<string, { content?: string | null }> | null;
  outcome: string | null;
};

type Row = {
  key: string;
  kind: "tracked" | "proposal";
  title: string;
  agency: string | null;
  naics: string | null;
  setAside: string | null;
  deadline: string | null;
  updatedAt: string;
  stage: StepperStage;
  statusLabel: string;
  captureStage?: string | null;
  outcome?: string | null;
  ready?: boolean;
  trackedId?: string;
  proposalId?: string;
  oppForPwin: OppForPwin;
  enrichable?: { proposalId: string; hasNoticeId: boolean };
  watchEnabled?: boolean;
  unreviewedActivity?: number;
  teamingSummary?: { total: number; contacted: number; nda: number; ta: number };
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const OUTCOME_TONE: Record<string, string> = {
  won: "bg-success/15 text-success border-success/30",
  lost: "bg-destructive/15 text-destructive border-destructive/30",
  no_bid: "bg-muted text-muted-foreground border-border",
};

const OUTCOME_LABEL: Record<string, string> = {
  won: "Won",
  lost: "Lost",
  no_bid: "No-bid",
};

function OpportunitiesPage() {
  const { user } = useAuth();
  const { currentTeam } = useTeam();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setSelectedOpportunityId } = useOpportunityContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  const enabled = !!user;

  const trackedQ = useQuery({
    queryKey: ["opportunities-page", "tracked", currentTeam?.id ?? "none", user?.id ?? "none"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_opportunities")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as TrackedOpportunity[];
    },
  });

  const proposalsQ = useQuery({
    queryKey: ["opportunities-page", "proposals", currentTeam?.id ?? "none", user?.id ?? "none"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("id,opportunity_title,agency,naics_code,set_aside,status,capture_stage,response_deadline,updated_at,opportunity_source,opportunity_source_id,solicitation_number,notice_id,watch_enabled,market_snapshot_at,ecosystem_at,capture_analysis_at,sections,outcome")
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ProposalRow[];
    },
  });

  const activityQ = useQuery({
    queryKey: ["opportunities-page", "watch-activity", currentTeam?.id ?? "none", user?.id ?? "none"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunity_watch_events" as any)
        .select("proposal_id")
        .eq("reviewed", false);
      if (error) throw new Error(error.message);
      const counts: Record<string, number> = {};
      for (const r of ((data ?? []) as unknown) as { proposal_id: string }[]) {
        counts[r.proposal_id] = (counts[r.proposal_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const teamingQ = useQuery({
    queryKey: ["opportunities-page", "teaming-summary", currentTeam?.id ?? "none", user?.id ?? "none"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_teaming")
        .select("proposal_id, outreach_status");
      if (error) throw new Error(error.message);
      const acc: Record<string, { total: number; contacted: number; nda: number; ta: number }> = {};
      for (const r of (data ?? []) as { proposal_id: string; outreach_status: string }[]) {
        const s = acc[r.proposal_id] ?? { total: 0, contacted: 0, nda: 0, ta: 0 };
        s.total += 1;
        if (r.outreach_status === "contacted" || r.outreach_status === "call_held") s.contacted += 1;
        if (r.outreach_status === "nda_signed") s.nda += 1;
        if (r.outreach_status === "ta_signed") s.ta += 1;
        acc[r.proposal_id] = s;
      }
      return acc;
    },
  });

  const rows = useMemo<Row[]>(() => {
    const tracked = trackedQ.data ?? [];
    const proposals = proposalsQ.data ?? [];

    const proposalByTrackedId = new Map<string, ProposalRow>();
    for (const p of proposals) {
      if (p.opportunity_source === "tracked" && p.opportunity_source_id) {
        proposalByTrackedId.set(p.opportunity_source_id, p);
      }
    }

    const out: Row[] = [];

    for (const t of tracked) {
      if (proposalByTrackedId.has(t.id)) continue;
      out.push({
        key: `t:${t.id}`,
        kind: "tracked",
        title: t.title,
        agency: t.agency,
        naics: t.naics_code,
        setAside: null,
        deadline: t.response_deadline,
        updatedAt: t.updated_at,
        stage: trackedStatusToStepper(t.status),
        statusLabel: t.status,
        trackedId: t.id,
        oppForPwin: {
          id: `tracked:${t.id}`,
          naics: t.naics_code,
          agency: t.agency,
          setAside: null,
          vehicle: t.contract_vehicle,
        },
      });
    }

    const activity = activityQ.data ?? {};
    const teaming = teamingQ.data ?? {};
    for (const p of proposals) {
      const teamingCount = teaming[p.id]?.total ?? 0;
      const sectionsCount = p.sections
        ? Object.values(p.sections).filter((s) => s && typeof s === "object" && (s as any).content).length
        : 0;
      const signals: StageSignals = {
        hasNaicsAgency: Boolean(p.naics_code && p.agency),
        hasSnapshot: Boolean(p.market_snapshot_at),
        hasEcosystem: Boolean(p.ecosystem_at),
        hasAnalysis: Boolean(p.capture_analysis_at),
        teamingCount,
        sectionsCount,
      };
      out.push({
        key: `p:${p.id}`,
        kind: "proposal",
        title: p.opportunity_title ?? "(Untitled opportunity)",
        agency: p.agency,
        naics: p.naics_code,
        setAside: p.set_aside,
        deadline: p.response_deadline,
        updatedAt: p.updated_at,
        stage: captureStageToStepper(p.capture_stage),
        statusLabel: p.capture_stage ?? p.status ?? "intake",
        captureStage: p.capture_stage,
        outcome: p.outcome,
        ready: isStageSatisfied(p.capture_stage, signals),
        proposalId: p.id,
        trackedId: p.opportunity_source === "tracked" ? p.opportunity_source_id ?? undefined : undefined,
        oppForPwin: {
          id: `proposal:${p.id}`,
          naics: p.naics_code,
          agency: p.agency,
          setAside: p.set_aside,
          vehicle: null,
        },
        enrichable: canEnrichFromSam({
          solicitation_number: p.solicitation_number,
          notice_id: p.notice_id,
          naics_code: p.naics_code,
        })
          ? { proposalId: p.id, hasNoticeId: !!p.notice_id }
          : undefined,
        watchEnabled: Boolean(p.watch_enabled),
        unreviewedActivity: activity[p.id] ?? 0,
        teamingSummary: teaming[p.id],
      });
    }

    return out;
  }, [trackedQ.data, proposalsQ.data, activityQ.data, teamingQ.data]);

  const grouped = useMemo(() => {
    const m: Record<StepperStage, Row[]> = {
      intake: [], researching: [], analyzing: [], pursuing: [], proposal: [], submitted: [], closed: [],
    };
    for (const r of rows) m[r.stage].push(r);
    return m;
  }, [rows]);

  async function promoteTrackedToProposal(trackedId: string): Promise<string | null> {
    if (!user) return null;
    const { data: t, error: tErr } = await supabase
      .from("tracked_opportunities")
      .select("*")
      .eq("id", trackedId)
      .maybeSingle();
    if (tErr || !t) {
      toast.error(tErr?.message ?? "Could not load tracked opportunity");
      return null;
    }
    const fullAgency = t.sub_agency ? `${t.agency} — ${t.sub_agency}` : t.agency;
    const resolvedVehicle = t.contract_vehicle === "Custom/Other"
      ? (t.contract_vehicle_other || "Custom/Other")
      : t.contract_vehicle;
    const solNum = `TRACKED-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: user.id,
      team_id: currentTeam?.id ?? null,
      solicitation_number: solNum,
      opportunity_title: t.title,
      agency: fullAgency,
      naics_code: t.naics_code,
      estimated_value: t.estimated_value,
      response_deadline: t.response_deadline ? new Date(`${t.response_deadline}T23:59:59Z`).toISOString() : null,
      capture_notes: t.description ?? null,
      opportunity_source: "tracked",
      opportunity_source_id: t.id,
      capture_stage: "intake",
      status: "intake",
      opportunity_data: {
        sub_agency: t.sub_agency ?? null,
        contract_vehicle: resolvedVehicle,
        source_url: t.source_url ?? null,
      },
    };
    const { data: created, error } = await supabase
      .from("proposals")
      .insert(payload)
      .select("id")
      .single();
    if (error || !created) {
      toast.error(error?.message ?? "Failed to promote opportunity");
      return null;
    }
    await qc.invalidateQueries({ queryKey: ["opportunities-page"] });
    return created.id;
  }

  async function openHub(row: Row) {
    let proposalId = row.proposalId;
    if (!proposalId && row.trackedId) {
      const promoted = await promoteTrackedToProposal(row.trackedId);
      if (!promoted) return;
      proposalId = promoted;
    }
    if (!proposalId) return;
    setSelectedOpportunityId(proposalId);
    navigate({ to: "/proposals/$proposalId", params: { proposalId } });
  }

  async function handleCreated(proposalId: string, opts?: { hasDocs?: boolean }) {
    await qc.invalidateQueries({ queryKey: ["opportunities-page"] });
    setSelectedOpportunityId(proposalId);
    void kickOffMarketSnapshotById(proposalId);
    navigate({
      to: "/proposals/$proposalId",
      params: { proposalId },
      search: opts?.hasDocs ? { parseDocs: 1 as const } : {},
    });
  }

  const total = rows.length;
  const hasData = trackedQ.data !== undefined && proposalsQ.data !== undefined;
  const loading = !hasData && (trackedQ.isPending || proposalsQ.isPending);

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
      <PageHeader
        icon={<Workflow className="w-5 h-5" />}
        title="Pursuit Pipeline"
        description={
          <>
            All opportunities grouped by capture stage.{" "}
            {loading ? "Loading…" : `${total} item${total === 1 ? "" : "s"}.`}
          </>
        }
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> Add Opportunity
          </Button>
        }
      />

      <ExpiringMarketsCard
        teamId={currentTeam?.id ?? null}
        onTracked={(proposalId) => void handleCreated(proposalId)}
      />



      {loading ? (
        <div className="space-y-3">
          <div className="h-16 rounded-md bg-muted animate-pulse" />
          <div className="h-16 rounded-md bg-muted animate-pulse" />
          <div className="h-16 rounded-md bg-muted animate-pulse" />
        </div>
      ) : (
      <div className="space-y-6">
        {STEPPER_STAGES.map((stage) => {
          const items = grouped[stage];
          return (
            <section key={stage} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STEPPER_STAGE_TONE[stage]}>
                  {STEPPER_STAGE_LABEL[stage]}
                </Badge>
                <span
                  className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${STEPPER_STAGE_COUNT_TONE[stage]}`}
                >
                  {items.length}
                </span>
              </div>
              {items.length === 0 ? (
                <EmptyState
                  icon={<Workflow className="w-5 h-5" />}
                  title="No opportunities in this stage"
                  hint="Move items in from a neighboring stage or add a new opportunity."
                />
              ) : (
                <div className="grid gap-2">
                  {items.map((row) => {
                    const daysLeft = row.deadline
                      ? Math.ceil((new Date(row.deadline).getTime() - Date.now()) / 86_400_000)
                      : null;
                    const deadlineNear = daysLeft !== null && daysLeft <= 14;
                    return (
                    <Card key={row.key} className="p-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            className="text-sm font-medium truncate text-left hover:underline"
                            onClick={() => openHub(row)}
                          >
                            {row.title}
                          </button>
                          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                            {row.kind === "proposal" ? "Opportunity" : "Tracked"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {row.statusLabel}
                          </Badge>
                          {row.stage === "closed" && row.outcome && OUTCOME_LABEL[row.outcome] && (
                            <Badge variant="outline" className={`text-[10px] ${OUTCOME_TONE[row.outcome] ?? ""}`}>
                              {OUTCOME_LABEL[row.outcome]}
                            </Badge>
                          )}
                          {row.ready && row.stage !== "closed" && row.stage !== "submitted" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide gap-1 border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_18%,transparent)] text-[color:var(--brand-brass)]"
                              title="This stage's completion signal is satisfied — ready to advance"
                            >
                              <CircleDot className="w-3 h-3" />
                              Ready
                            </Badge>
                          )}
                          {row.unreviewedActivity ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide gap-1 border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_18%,transparent)] text-[color:var(--brand-brass)]"
                            >
                              <Radar className="w-3 h-3" />
                              {row.unreviewedActivity} new SAM activity
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          <span className="briefing-label mr-1">Agency</span>
                          {row.agency ?? "—"}
                          {row.naics ? (
                            <>
                              {" · "}
                              <span className="briefing-label mr-1">NAICS</span>
                              <span className="font-mono">{row.naics}</span>
                            </>
                          ) : null}
                          {row.setAside ? (
                            <>
                              {" · "}
                              <span className="briefing-label mr-1">Set-aside</span>
                              {row.setAside}
                            </>
                          ) : null}
                          {row.deadline ? (
                            <>
                              {" · "}
                              <span className="briefing-label mr-1">Due</span>
                              <span
                                className={
                                  deadlineNear
                                    ? "rounded px-1.5 py-0.5 bg-warning/15 text-warning font-medium"
                                    : ""
                                }
                              >
                                {fmtDate(row.deadline)}
                              </span>
                            </>
                          ) : null}
                        </div>
                        {row.teamingSummary && row.teamingSummary.total > 0 && (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            <span className="briefing-label mr-1">Team</span>
                            {row.teamingSummary.total} partner{row.teamingSummary.total === 1 ? "" : "s"}
                            {row.teamingSummary.contacted ? ` · ${row.teamingSummary.contacted} contacted` : ""}
                            {row.teamingSummary.nda ? ` · ${row.teamingSummary.nda} NDA` : ""}
                            {row.teamingSummary.ta ? ` · ${row.teamingSummary.ta} TA` : ""}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {row.proposalId && (
                          <CaptureStageSelect
                            proposalId={row.proposalId}
                            value={row.captureStage}
                            onChanged={() => qc.invalidateQueries({ queryKey: ["opportunities-page"] })}
                          />
                        )}
                        <PwinChip opp={row.oppForPwin} />
                        {row.proposalId && (
                          <WatchToggle
                            proposalId={row.proposalId}
                            enabled={row.watchEnabled ?? false}
                            onChanged={() => qc.invalidateQueries({ queryKey: ["opportunities-page"] })}
                          />
                        )}
                        {row.enrichable && (
                          <EnrichButton
                            proposalId={row.enrichable.proposalId}
                            onDone={() => qc.invalidateQueries({ queryKey: ["opportunities-page"] })}
                          />
                        )}
                        <Button size="sm" variant="outline" onClick={() => openHub(row)} className="gap-1.5">
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </Button>
                      </div>
                    </Card>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      )}

      <AddOpportunityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agencySuggestions={(trackedQ.data ?? []).map((t) => t.agency).filter(Boolean) as string[]}
        onCreated={handleCreated}
      />
    </div>
  );
}

function EnrichButton({ proposalId, onDone }: { proposalId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await enrichProposalFromSam(proposalId);
      const fields = res.updatedFields.length ? ` · updated ${res.updatedFields.join(", ")}` : "";
      const att = res.attachmentsSaved ? ` · ${res.attachmentsSaved} doc${res.attachmentsSaved === 1 ? "" : "s"}` : "";
      toast.success(`Enriched from SAM.gov${fields}${att}`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Enrichment failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy} className="gap-1.5">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
      Enrich from SAM.gov
    </Button>
  );
}

function WatchToggle({
  proposalId,
  enabled,
  onChanged,
}: {
  proposalId: string;
  enabled: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("proposals").update({ watch_enabled: v } as any).eq("id", proposalId);
      if (error) throw new Error(error.message);
      toast.success(v ? "SAM watcher enabled" : "SAM watcher paused");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Watch SAM.gov for activity">
      <Radar className="w-3.5 h-3.5" />
      <Switch checked={enabled} onCheckedChange={toggle} disabled={busy} />
    </label>
  );
}
