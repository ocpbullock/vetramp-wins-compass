import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { CaptureStage } from "@/lib/capture-stage";

/**
 * Apply a capture_stage change from anywhere (e.g. success-toast action buttons).
 * Human-decided — never called automatically. Callers that want to prompt an
 * outcome dialog when the target is won/lost/no_bid should handle that in-UI;
 * this helper only performs the DB update.
 */
export async function applyCaptureStage(proposalId: string, next: CaptureStage): Promise<boolean> {
  const { error } = await supabase.from("proposals").update({ capture_stage: next }).eq("id", proposalId);
  if (error) {
    toast.error(error.message || "Could not update stage");
    return false;
  }
  return true;
}
