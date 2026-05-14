import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert } from "lucide-react";

export const OCI_QUESTIONS: { key: string; question: string; tag: string }[] = [
  {
    key: "unequal_access",
    tag: "Unequal access to information",
    question: "Has your company (or any teaming partner) performed work for the agency that would give you an unfair advantage on this procurement?",
  },
  {
    key: "biased_ground_rules",
    tag: "Biased ground rules",
    question: "Has your company (or any teaming partner) helped draft, review, or consult on the requirements, SOW, or evaluation criteria for this procurement?",
  },
  {
    key: "impaired_objectivity",
    tag: "Impaired objectivity",
    question: "Would winning this contract put your company in a position to evaluate or assess your own work or products?",
  },
  {
    key: "revolving_door",
    tag: "Revolving door",
    question: "Are any of your employees or teaming partner employees former government employees of this agency within the last 2 years?",
  },
  {
    key: "other",
    tag: "Other",
    question: "Are there any other potential conflicts you're aware of?",
  },
];

export type OciAnswers = Record<string, "yes" | "no" | undefined> & { notes?: string };

export function ociStatus(answers: OciAnswers | null | undefined): "clean" | "flagged" | "incomplete" {
  if (!answers) return "incomplete";
  const allAnswered = OCI_QUESTIONS.every((q) => answers[q.key] === "yes" || answers[q.key] === "no");
  if (!allAnswered) return "incomplete";
  const anyYes = OCI_QUESTIONS.some((q) => answers[q.key] === "yes");
  return anyYes ? "flagged" : "clean";
}

export function OCIScreeningCard({
  value,
  onChange,
}: {
  value: OciAnswers | null | undefined;
  onChange: (v: OciAnswers) => void;
}) {
  const [open, setOpen] = useState(true);
  const answers: OciAnswers = value || {};
  const status = ociStatus(answers);
  const flagged = OCI_QUESTIONS.filter((q) => answers[q.key] === "yes");

  const set = (key: string, v: "yes" | "no") => onChange({ ...answers, [key]: v });

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <CardTitle className="text-base">Conflict of Interest Check</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {status === "clean" && <Badge className="bg-emerald-600 hover:bg-emerald-600"><ShieldCheck className="w-3 h-3 mr-1" />No conflicts identified</Badge>}
            {status === "flagged" && <Badge variant="destructive"><ShieldAlert className="w-3 h-3 mr-1" />Potential OCI detected</Badge>}
            {status === "incomplete" && <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">OCI screening incomplete</Badge>}
            {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
        <CardDescription className="text-xs">Preliminary screening. Not a legal analysis.</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {status === "flagged" && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs space-y-1">
              <div className="font-semibold text-destructive flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" />Potential OCI detected — consult legal counsel before proceeding</div>
              <ul className="list-disc list-inside text-muted-foreground">
                {flagged.map((q) => <li key={q.key}><span className="font-medium text-foreground">{q.tag}:</span> {q.question}</li>)}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {OCI_QUESTIONS.map((q) => {
              const v = answers[q.key];
              const isYes = v === "yes";
              return (
                <div key={q.key} className={`rounded-md border p-3 space-y-2 ${isYes ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">{q.tag}</Badge>
                  </div>
                  <div className="text-sm">{q.question}</div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={v === "no" ? "default" : "outline"}
                      onClick={() => set(q.key, "no")}
                      className="h-7"
                    >
                      No
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={v === "yes" ? "destructive" : "outline"}
                      onClick={() => set(q.key, "yes")}
                      className="h-7"
                    >
                      Yes
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">Notes (optional)</div>
            <Textarea
              rows={2}
              value={answers.notes ?? ""}
              onChange={(e) => onChange({ ...answers, notes: e.target.value })}
              placeholder="Document any context, mitigations, or follow-ups."
            />
          </div>

          <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
            This checklist is a preliminary screening tool and does not constitute legal advice. Consult your contracts attorney for a formal OCI analysis.
          </div>
        </CardContent>
      )}
    </Card>
  );
}
