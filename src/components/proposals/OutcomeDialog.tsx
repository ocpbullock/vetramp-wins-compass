import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Outcome = "won" | "lost" | "no_bid";

const OUTCOME_LABEL: Record<Outcome, string> = {
  won: "Won",
  lost: "Lost",
  no_bid: "No-bid",
};

export function OutcomeDialog({
  open,
  onOpenChange,
  proposalId,
  outcome,
  initialReasons,
  initialLessons,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  proposalId: string;
  outcome: Outcome;
  initialReasons?: string | null;
  initialLessons?: string | null;
  onSaved?: () => void;
}) {
  const [reasons, setReasons] = useState(initialReasons ?? "");
  const [lessons, setLessons] = useState(initialLessons ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReasons(initialReasons ?? "");
      setLessons(initialLessons ?? "");
    }
  }, [open, initialReasons, initialLessons]);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("proposals")
      .update({
        outcome,
        outcome_reasons: reasons.trim() || null,
        lessons_learned: lessons.trim() || null,
        outcome_recorded_at: new Date().toISOString(),
      })
      .eq("id", proposalId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Outcome recorded");
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record outcome — {OUTCOME_LABEL[outcome]}</DialogTitle>
          <DialogDescription>
            Capture why this opportunity ended this way and what we learned, while it&apos;s fresh.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Reasons</Label>
            <Textarea
              value={reasons}
              onChange={(e) => setReasons(e.target.value)}
              placeholder={
                outcome === "won"
                  ? "What drove the win? Price, technical, incumbency, relationships…"
                  : outcome === "lost"
                  ? "What did we lose to? Price, technical, past performance, teaming…"
                  : "Why did we no-bid? Fit, capacity, risk, schedule…"
              }
              rows={4}
            />
          </div>
          <div>
            <Label className="text-xs">Lessons learned</Label>
            <Textarea
              value={lessons}
              onChange={(e) => setLessons(e.target.value)}
              placeholder="What would we do differently next time? What worked?"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Skip for now</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save outcome"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function isTerminalOutcome(s: string | null | undefined): s is Outcome {
  return s === "won" || s === "lost" || s === "no_bid";
}
