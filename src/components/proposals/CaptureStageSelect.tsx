import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CAPTURE_STAGES,
  CAPTURE_STAGE_LABEL,
  isCaptureStage,
  type CaptureStage,
} from "@/lib/capture-stage";

type Props = {
  proposalId: string;
  value: string | null | undefined;
  onChanged?: (next: CaptureStage) => void;
  className?: string;
  size?: "sm" | "default";
};

export function CaptureStageSelect({ proposalId, value, onChanged, className, size = "sm" }: Props) {
  const current: CaptureStage = isCaptureStage(value) ? value : "researching";
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<CaptureStage>(current);

  // Keep in sync if parent changes value
  if (current !== stage && !busy) {
    // best-effort sync without effect
    queueMicrotask(() => setStage(current));
  }

  async function handle(next: string) {
    if (!isCaptureStage(next) || next === stage) return;
    const prev = stage;
    setStage(next);
    setBusy(true);
    const { error } = await supabase
      .from("proposals")
      .update({ capture_stage: next })
      .eq("id", proposalId);
    setBusy(false);
    if (error) {
      setStage(prev);
      toast.error(error.message || "Could not update stage");
      return;
    }
    onChanged?.(next);
  }

  return (
    <Select value={stage} onValueChange={handle} disabled={busy}>
      <SelectTrigger
        className={
          (size === "sm" ? "h-7 text-xs px-2 " : "") + (className ?? "")
        }
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CAPTURE_STAGES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {CAPTURE_STAGE_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
