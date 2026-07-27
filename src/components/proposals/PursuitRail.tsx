import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Bell, CalendarClock, Radar, Sparkles, Target } from "lucide-react";
import { PwinDial } from "@/components/PwinDial";
import { applyCaptureStage } from "@/lib/stage-mutations";
import {
  STEPPER_STAGES, STEPPER_STAGE_LABEL,
  captureStageToStepper, isCaptureStage, isStageSatisfied, nextCaptureStage,
  type CaptureStage, type StageSignals,
} from "@/lib/capture-stage";
import type { PwinProbabilityResult } from "@/lib/pwin-probability";

type NextAction = { action: string; why: string; priority: "high" | "medium" | "low" };

/**
 * Sticky right-column rail on the Opportunity Hub (xl and up).
 * Reads the SAME cached values as the Team scoreboard — no new heavy queries.
 */
export function PursuitRail({
  proposal,
  proposalId,
  signals,
  teamStrength,
  pwinProbability,
  onNavigateTab,
  onRefreshProposal,
}: {
  proposal: any;
  proposalId: string;
  signals: StageSignals;
  teamStrength: number | null;
  pwinProbability: PwinProbabilityResult | null;
  onNavigateTab?: (tab: string) => void;
  onRefreshProposal?: () => void;
}) {
  const current: CaptureStage = isCaptureStage(proposal?.capture_stage) ? proposal.capture_stage : "intake";
  const currentStep = captureStageToStepper(current);
  const currentIdx = STEPPER_STAGES.indexOf(currentStep);
  const nextStage = nextCaptureStage(current);
  const ready = isStageSatisfied(current, signals);

  // Deadline
  const dl = proposal?.response_deadline ? new Date(proposal.response_deadline) : null;
  const daysLeft = dl
    ? Math.ceil((dl.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const dlTone = daysLeft == null
    ? "text-muted-foreground"
    : daysLeft < 0
      ? "text-destructive"
      : daysLeft < 14
        ? "text-warning"
        : "text-foreground";

  // Top next action from capture_analysis.next_actions
  const topAction: NextAction | null = useMemo(() => {
    const list: NextAction[] = Array.isArray(proposal?.capture_analysis?.next_actions)
      ? proposal.capture_analysis.next_actions
      : [];
    if (!list.length) return null;
    const rank: Record<NextAction["priority"], number> = { high: 0, medium: 1, low: 2 };
    return [...list].sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3))[0] ?? null;
  }, [proposal?.capture_analysis]);

  // Unreviewed SAM watch events (cheap count)
  const { data: unreviewedWatch = 0 } = useQuery({
    queryKey: ["pursuit-rail:watch-unreviewed", proposalId],
    queryFn: async () => {
      const { count } = await supabase
        .from("opportunity_watch_events")
        .select("id", { count: "exact", head: true })
        .eq("proposal_id", proposalId)
        .is("reviewed_at", null);
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const advance = async () => {
    if (!nextStage) return;
    await applyCaptureStage(proposalId, nextStage);
    onRefreshProposal?.();
  };

  const goto = (tab: string) => {
    onNavigateTab?.(tab);
  };

  return (
    <aside
      aria-label="Pursuit rail"
      className="hidden xl:block sticky top-20 self-start w-[280px] shrink-0 space-y-3"
    >
      {/* Stage */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="briefing-label flex items-center justify-between">
            <span>Stage</span>
            <span className="text-[10px] font-normal text-muted-foreground normal-case">
              {STEPPER_STAGE_LABEL[currentStep]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {STEPPER_STAGES.map((s, i) => {
              const past = i < currentIdx;
              const cur = i === currentIdx;
              return (
                <span
                  key={s}
                  title={STEPPER_STAGE_LABEL[s]}
                  className={`h-1.5 flex-1 rounded-full ${
                    cur
                      ? "bg-[color:var(--brand-brass)]"
                      : past
                        ? "bg-primary/60"
                        : "bg-muted"
                  }`}
                />
              );
            })}
          </div>
          {ready && nextStage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={advance}
              className="w-full h-7 text-xs gap-1 border-[color:var(--brand-brass)]/50 text-[color:var(--brand-brass)] bg-[color:color-mix(in_oklab,var(--brand-brass)_10%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--brand-brass)_20%,transparent)]"
            >
              <Sparkles className="w-3 h-3" /> Advance to {STEPPER_STAGE_LABEL[captureStageToStepper(nextStage)]}
            </Button>
          ) : (
            <div className="text-[11px] text-muted-foreground truncate">
              {nextStage ? `Next: ${STEPPER_STAGE_LABEL[captureStageToStepper(nextStage)]}` : "Closed out"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deadline */}
      <Card>
        <CardContent className="p-3">
          <div className="briefing-label flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3" /> Response deadline
          </div>
          <div className={`text-lg font-bold tabular-nums mt-0.5 ${dlTone}`}>
            {daysLeft == null
              ? "—"
              : daysLeft < 0
                ? "PAST DUE"
                : `${daysLeft}d left`}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {dl ? dl.toLocaleDateString() : "No deadline set"}
          </div>
        </CardContent>
      </Card>

      {/* PWIN + Team Strength — reuse cached upstream values */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="briefing-label flex items-center gap-1.5">
                <Target className="w-3 h-3" /> PWIN
              </div>
              <div className="text-xl font-bold tabular-nums mt-0.5">
                {pwinProbability ? `${pwinProbability.likelyPct}%` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {pwinProbability
                  ? pwinProbability.gateFailed
                    ? `Gate: ${pwinProbability.gateFailed}`
                    : `Range ${pwinProbability.lowPct}–${pwinProbability.highPct}%`
                  : "Computing…"}
              </div>
            </div>
            <div className="shrink-0 text-center">
              <div className="briefing-label">Strength</div>
              <PwinDial value={teamStrength} size="sm" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => goto("team")}
            className="w-full text-left text-[11px] text-primary hover:underline inline-flex items-center gap-1"
          >
            Open Team tab <ArrowRight className="w-3 h-3" />
          </button>
        </CardContent>
      </Card>

      {/* Top action */}
      {topAction && (
        <Card>
          <CardContent className="p-3">
            <div className="briefing-label flex items-center justify-between">
              <span>Top next action</span>
              <Badge
                variant={topAction.priority === "high" ? "destructive" : topAction.priority === "medium" ? "default" : "secondary"}
                className="text-[10px] capitalize"
              >
                {topAction.priority}
              </Badge>
            </div>
            <div className="text-sm font-medium mt-1 line-clamp-2">{topAction.action}</div>
            {topAction.why && (
              <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{topAction.why}</div>
            )}
            <button
              type="button"
              onClick={() => goto("activities")}
              className="mt-2 text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              Open Activities <ArrowRight className="w-3 h-3" />
            </button>
          </CardContent>
        </Card>
      )}

      {/* Unreviewed SAM activity */}
      {unreviewedWatch > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-3">
            <div className="briefing-label flex items-center gap-1.5 text-warning">
              <Radar className="w-3 h-3" /> SAM activity
            </div>
            <div className="text-sm font-medium mt-1 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-warning" />
              {unreviewedWatch} unreviewed event{unreviewedWatch === 1 ? "" : "s"}
            </div>
            <button
              type="button"
              onClick={() => goto("overview")}
              className="mt-2 text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              Open feed <ArrowRight className="w-3 h-3" />
            </button>
          </CardContent>
        </Card>
      )}

      {!ready && nextStage && (
        <div className="text-[11px] text-muted-foreground px-1 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Complete stage requirements to advance.</span>
        </div>
      )}
    </aside>
  );
}
