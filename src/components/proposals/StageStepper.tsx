import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CaptureStageSelect } from "./CaptureStageSelect";
import { OutcomeDialog, isTerminalOutcome } from "./OutcomeDialog";
import {
  STEPPER_STAGES,
  STEPPER_STAGE_LABEL,
  captureStageToStepper,
  isCaptureStage,
  isStageSatisfied,
  nextCaptureStage,
  stageHint,
  type CaptureStage,
  type StageSignals,
  type StepperStage,
} from "@/lib/capture-stage";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Outcome = "won" | "lost" | "no_bid";

export function StageStepper({
  proposalId,
  value,
  signals,
  onChanged,
}: {
  proposalId: string;
  value: string | null | undefined;
  signals: StageSignals;
  onChanged?: () => void;
}) {
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState<Outcome | null>(null);

  const current: CaptureStage = isCaptureStage(value) ? value : "intake";
  const currentStep: StepperStage = captureStageToStepper(current);
  const currentIdx = STEPPER_STAGES.indexOf(currentStep);
  const nextStage = nextCaptureStage(current);
  const hint = stageHint(current);
  const ready = isStageSatisfied(current, signals);

  async function apply(next: CaptureStage) {
    if (next === current) return;
    if (next === "submitted") {
      if (!window.confirm("Mark this opportunity as Submitted?")) return;
    }
    setBusy(true);
    const { error } = await supabase.from("proposals").update({ capture_stage: next }).eq("id", proposalId);
    setBusy(false);
    if (error) { toast.error(error.message || "Could not update stage"); return; }
    onChanged?.();
    if (isTerminalOutcome(next) && !isTerminalOutcome(current)) setOutcomeOpen(next);
  }

  const jumpToStep = (step: StepperStage) => {
    if (step === "closed") return; // handled by Close out menu
    apply(step as CaptureStage);
  };

  if (isMobile) {
    return (
      <div className="space-y-1">
        <CaptureStageSelect proposalId={proposalId} value={value} size="default" onChanged={onChanged} />
        {hint && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>{hint}</span>
            {ready && nextStage && (
              <Button size="sm" variant="outline" onClick={() => apply(nextStage)} disabled={busy}
                className="h-6 text-xs gap-1 border-[color:var(--brand-brass)]/50 text-[color:var(--brand-brass)]">
                <Sparkles className="w-3 h-3" /> Advance to {STEPPER_STAGE_LABEL[captureStageToStepper(nextStage)]}
              </Button>
            )}
          </div>
        )}
        {outcomeOpen && (
          <OutcomeDialog open={!!outcomeOpen} onOpenChange={(v) => !v && setOutcomeOpen(null)}
            proposalId={proposalId} outcome={outcomeOpen} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-0.5 flex-wrap">
        {STEPPER_STAGES.map((step, i) => {
          const isCurrent = step === currentStep;
          const isPast = i < currentIdx;
          const isClosed = step === "closed";
          const clickable = !isCurrent && !isClosed && !busy;
          return (
            <div key={step} className="flex items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => jumpToStep(step)}
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  isCurrent
                    ? "bg-[color:color-mix(in_oklab,var(--brand-brass)_20%,transparent)] text-[color:var(--brand-brass)] border border-[color:var(--brand-brass)]/50"
                    : isPast
                    ? "text-foreground hover:bg-muted"
                    : "text-muted-foreground hover:bg-muted disabled:opacity-60",
                  isClosed && !isCurrent ? "opacity-60" : "",
                ].join(" ")}
                title={clickable ? `Move to ${STEPPER_STAGE_LABEL[step]}` : STEPPER_STAGE_LABEL[step]}
              >
                {isPast ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] ${
                    isCurrent ? "bg-[color:var(--brand-brass)] text-[color:var(--brand-brass-foreground)]" : "bg-muted"
                  }`}>{i + 1}</span>
                )}
                <span>{STEPPER_STAGE_LABEL[step]}</span>
              </button>
              {i < STEPPER_STAGES.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5" />}
            </div>
          );
        })}

        {/* Close out menu: only surface at the final step */}
        {(currentStep === "submitted" || currentStep === "closed") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="ml-2 h-7 text-xs">Close out…</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => apply("won")}>Mark Won</DropdownMenuItem>
              <DropdownMenuItem onClick={() => apply("lost")}>Mark Lost</DropdownMenuItem>
              <DropdownMenuItem onClick={() => apply("no_bid")}>Mark No-bid</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {hint && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground pl-1">
          <span>{hint}</span>
          {ready && nextStage && (
            <Button size="sm" variant="outline" onClick={() => apply(nextStage)} disabled={busy}
              className="h-6 text-xs gap-1 border-[color:var(--brand-brass)]/50 text-[color:var(--brand-brass)] bg-[color:color-mix(in_oklab,var(--brand-brass)_10%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--brand-brass)_20%,transparent)]">
              <Sparkles className="w-3 h-3" /> Ready to advance → {STEPPER_STAGE_LABEL[captureStageToStepper(nextStage)]}
            </Button>
          )}
        </div>
      )}

      {outcomeOpen && (
        <OutcomeDialog open={!!outcomeOpen} onOpenChange={(v) => !v && setOutcomeOpen(null)}
          proposalId={proposalId} outcome={outcomeOpen} />
      )}
    </div>
  );
}
