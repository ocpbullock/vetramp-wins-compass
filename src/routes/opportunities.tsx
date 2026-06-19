import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ExternalLink, FileText, Workflow, Sparkles, Loader2 } from "lucide-react";
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
import { BOARD_STAGES, captureStageToBoard, type BoardStage } from "@/lib/capture-stage";
import { CaptureStageSelect } from "@/components/proposals/CaptureStageSelect";

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
};

type Stage = BoardStage;
const STAGES = BOARD_STAGES;

const STAGE_TONE: Record<Stage, string> = {
  Watching: "bg-muted text-muted-foreground border-border",
  Capturing: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  Proposal: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  Submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  "Won/Lost": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};

function trackedStage(status: string): Stage {
  if (status === "Watching" || status === "No-Bid") return "Watching";
  if (status === "Preparing") return "Capturing";
  if (status === "Submitted") return "Submitted";
  if (status === "Won" || status === "Lost") return "Won/Lost";
  return "Watching";
}

type Row = {
  key: string;
  kind: "tracked" | "proposal";
  title: string;
  agency: string | null;
  naics: string | null;
  setAside: string | null;
  deadline: string | null;
  updatedAt: string;
  stage: Stage;
  statusLabel: string;
  captureStage?: string | null;
  trackedId?: string;
  proposalId?: string;
  oppForPwin: OppForPwin;
  enrichable?: { proposalId: string; hasNoticeId: boolean };
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

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
        .select("id,opportunity_title,agency,naics_code,set_aside,status,capture_stage,response_deadline,updated_at,opportunity_source,opportunity_source_id,solicitation_number,notice_id")
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProposalRow[];
    },
  });

  const rows = useMemo<Row[]>(() => {
    const tracked = trackedQ.data ?? [];
    const proposals = proposalsQ.data ?? [];

    // Build map of tracked-id -> proposal (so we can hide tracked rows that
    // were promoted to a proposal, and route their "Open" action through it).
    const proposalByTrackedId = new Map<string, ProposalRow>();
    for (const p of proposals) {
      if (p.opportunity_source === "tracked" && p.opportunity_source_id) {
        proposalByTrackedId.set(p.opportunity_source_id, p);
      }
    }

    const out: Row[] = [];

    for (const t of tracked) {
      if (proposalByTrackedId.has(t.id)) continue; // proposal row will represent it
      out.push({
        key: `t:${t.id}`,
        kind: "tracked",
        title: t.title,
        agency: t.agency,
        naics: t.naics_code,
        setAside: null,
        deadline: t.response_deadline,
        updatedAt: t.updated_at,
        stage: trackedStage(t.status),
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

    for (const p of proposals) {
      out.push({
        key: `p:${p.id}`,
        kind: "proposal",
        title: p.opportunity_title ?? "(Untitled proposal)",
        agency: p.agency,
        naics: p.naics_code,
        setAside: p.set_aside,
        deadline: p.response_deadline,
        updatedAt: p.updated_at,
        stage: captureStageToBoard(p.capture_stage),
        statusLabel: p.capture_stage ?? p.status ?? "intake",
        captureStage: p.capture_stage,
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
      });
    }

    return out;
  }, [trackedQ.data, proposalsQ.data]);

  const grouped = useMemo(() => {
    const m: Record<Stage, Row[]> = {
      Watching: [], Capturing: [], Proposal: [], Submitted: [], "Won/Lost": [],
    };
    for (const r of rows) m[r.stage].push(r);
    return m;
  }, [rows]);

  function openInWorkspace(row: Row) {
    if (row.proposalId) {
      setSelectedOpportunityId(row.proposalId);
    } else {
      // No linked proposal yet — clear context so workspace falls back to
      // global target profile (selecting a tracked-only id can't hydrate).
      setSelectedOpportunityId(null);
    }
    navigate({ to: "/" });
  }

  function goToProposal(row: Row) {
    if (!row.proposalId) return;
    setSelectedOpportunityId(row.proposalId);
    navigate({ to: "/proposals/$proposalId", params: { proposalId: row.proposalId } });
  }
  async function handleCreated(proposalId: string) {
    await qc.invalidateQueries({ queryKey: ["opportunities-page"] });
    navigate({ to: "/proposals/$proposalId", params: { proposalId } });
  }


  const total = rows.length;
  const loading = trackedQ.isLoading || proposalsQ.isLoading;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Workflow className="w-5 h-5 text-primary" />
            Pursuit Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tracked opportunities and in-flight proposals, grouped by stage.{" "}
            {loading ? "Loading…" : `${total} item${total === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Opportunity
        </Button>
      </div>

      <div className="space-y-6">
        {STAGES.map((stage) => {
          const items = grouped[stage];
          return (
            <section key={stage}>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={STAGE_TONE[stage]}>
                  {stage}
                </Badge>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <Card className="p-4 text-xs text-muted-foreground">No opportunities in this stage.</Card>
              ) : (
                <div className="grid gap-2">
                  {items.map((row) => (
                    <Card key={row.key} className="p-3 flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            className="text-sm font-medium truncate text-left hover:underline"
                            onClick={() => openInWorkspace(row)}
                          >
                            {row.title}
                          </button>
                          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                            {row.kind === "proposal" ? "Proposal" : "Tracked"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {row.statusLabel}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {row.agency ?? "—"}
                          {row.naics ? <> · NAICS <span className="font-mono">{row.naics}</span></> : null}
                          {row.setAside ? <> · {row.setAside}</> : null}
                          {row.deadline ? <> · Due {fmtDate(row.deadline)}</> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {row.proposalId && (
                          <CaptureStageSelect
                            proposalId={row.proposalId}
                            value={row.captureStage}
                            onChanged={() => qc.invalidateQueries({ queryKey: ["opportunities-page"] })}
                          />
                        )}
                        <PwinChip opp={row.oppForPwin} />
                        {row.enrichable && (
                          <EnrichButton
                            proposalId={row.enrichable.proposalId}
                            onDone={() => qc.invalidateQueries({ queryKey: ["opportunities-page"] })}
                          />
                        )}
                        <Button size="sm" variant="outline" onClick={() => openInWorkspace(row)} className="gap-1.5">
                          <ExternalLink className="w-3.5 h-3.5" /> Workspace
                        </Button>
                        {row.proposalId && (
                          <Button size="sm" variant="ghost" onClick={() => goToProposal(row)} className="gap-1.5">
                            <FileText className="w-3.5 h-3.5" /> Proposal
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

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

