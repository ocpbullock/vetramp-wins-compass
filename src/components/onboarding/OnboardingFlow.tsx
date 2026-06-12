import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, ArrowRight, ArrowLeft, X, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTeamId } from "@/lib/team";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { upsertOwnCompany } from "@/lib/companies";
import {
  useOnboardingState,
  type OnboardingStep,
  type OnboardingStepKey,
} from "@/lib/setup-status";

const CERT_OPTIONS = [
  "SDVOSB", "VOSB", "8(a)", "WOSB", "EDWOSB", "HUBZone",
  "Small Business", "ANC", "Tribally-Owned",
] as const;

function bumpCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["onboarding-state"] });
  qc.invalidateQueries({ queryKey: ["setup-status"] });
  qc.invalidateQueries({ queryKey: ["pwin-self"] });
  qc.invalidateQueries({ queryKey: ["pwin-solo"] });
  qc.invalidateQueries({ queryKey: ["company-profile"] });
}

export function OnboardingFlow({
  onComplete, onSkip, canSkip,
}: {
  onComplete: () => void;
  /** Render a skip button (only allowed once core steps 1+2 are done). */
  onSkip: () => void;
  canSkip: boolean;
}) {
  const state = useOnboardingState();
  const teamId = useTeamId();

  // Step is the first not-done step; if all done, render the completion card.
  const firstIncomplete = state.steps.findIndex((s) => !s.done);
  const [step, setStep] = useState<number>(Math.max(0, firstIncomplete));

  // Advance automatically when the current step becomes done (after save).
  useEffect(() => {
    const idx = state.steps.findIndex((s) => !s.done);
    if (idx === -1) return;
    if (idx > step) setStep(idx);
  }, [state.steps, step]);

  const current = state.steps[step] ?? state.steps[0];
  const completed = state.steps.filter((s) => s.done).length;
  const pct = Math.round((completed / state.steps.length) * 100);

  if (!teamId) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Pick or create a team to start onboarding.
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Set up your company
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-prose">
            Four quick steps unlock pWin scoring and partner matching. Each step
            below explains why it matters.
          </p>
        </div>
        {canSkip && (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            <X className="w-4 h-4 mr-1" /> Skip to dashboard
          </Button>
        )}
      </div>

      <div>
        <Progress value={pct} className="h-2" />
        <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
          {state.steps.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(i)}
              className={[
                "rounded-md border px-2 py-1.5 text-left transition-colors",
                i === step
                  ? "border-primary bg-primary/10"
                  : s.done
                    ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                    : "border-border hover:bg-accent",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <span className={[
                  "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold",
                  s.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
                ].join(" ")}>
                  {s.done ? <Check className="w-2.5 h-2.5" /> : i + 1}
                </span>
                <span className="truncate font-medium">{s.label}</span>
              </div>
              {!s.required && <Badge variant="secondary" className="text-[10px] mt-1">Skippable</Badge>}
            </button>
          ))}
        </div>
      </div>

      <StepBody
        step={current}
        index={step}
        total={state.steps.length}
        onBack={() => setStep(Math.max(0, step - 1))}
        onAdvance={() => setStep(Math.min(state.steps.length - 1, step + 1))}
        onFinish={onComplete}
        canSkipCurrent={!current.required}
      />
    </Card>
  );
}

function StepBody({
  step, index, total, onBack, onAdvance, onFinish, canSkipCurrent,
}: {
  step: OnboardingStep;
  index: number;
  total: number;
  onBack: () => void;
  onAdvance: () => void;
  onFinish: () => void;
  canSkipCurrent: boolean;
}) {
  return (
    <div className="rounded-md border bg-card/50 p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold">Step {index + 1} of {total}: {step.label}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{step.why}</p>
      </div>
      {step.key === "company" && <CompanyStep onSaved={onAdvance} />}
      {step.key === "naics" && <NaicsStep onSaved={onAdvance} />}
      {step.key === "past_performance" && <PastPerformanceStep onSaved={onAdvance} />}
      {step.key === "vehicles" && <VehiclesStep onSaved={onAdvance} />}

      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={index === 0}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2">
          {canSkipCurrent && (
            <Button variant="outline" size="sm" onClick={onAdvance}>
              Import later
            </Button>
          )}
          {index === total - 1 ? (
            <Button size="sm" onClick={onFinish} disabled={!step.done && step.required}>
              Finish <Check className="w-3.5 h-3.5 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={onAdvance} disabled={!step.done && step.required}>
              Next <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Step 1: company profile + certifications ----------

function CompanyStep({ onSaved }: { onSaved: () => void }) {
  const teamId = useTeamId();
  const qc = useQueryClient();
  const { ownCompany } = useOnboardingState();
  const [name, setName] = useState(ownCompany?.name && ownCompany.name !== "Our Company" ? ownCompany.name : "");
  const [uei, setUei] = useState(ownCompany?.uei ?? "");
  const [cage, setCage] = useState(ownCompany?.cage_code ?? "");
  const [narrative, setNarrative] = useState(ownCompany?.capabilities_narrative ?? "");
  const [certs, setCerts] = useState<Set<string>>(
    new Set([...(ownCompany?.certifications ?? []), ...(ownCompany?.set_asides ?? [])]),
  );

  useEffect(() => {
    if (!ownCompany) return;
    if (!name && ownCompany.name && ownCompany.name !== "Our Company") setName(ownCompany.name);
    if (!uei && ownCompany.uei) setUei(ownCompany.uei);
    if (!cage && ownCompany.cage_code) setCage(ownCompany.cage_code);
    if (!narrative && ownCompany.capabilities_narrative) setNarrative(ownCompany.capabilities_narrative);
    if (certs.size === 0) {
      const merged = [...(ownCompany.certifications ?? []), ...(ownCompany.set_asides ?? [])];
      if (merged.length > 0) setCerts(new Set(merged));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownCompany?.id]);

  const toggle = (c: string) => {
    setCerts((cur) => {
      const next = new Set(cur);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!teamId) throw new Error("No active team");
      if (!name.trim()) throw new Error("Company name is required");
      if (certs.size === 0) throw new Error("Pick at least one certification, or 'Small Business' if none apply");
      await upsertOwnCompany(teamId, {
        name: name.trim(),
        uei: uei.trim() || null,
        cage_code: cage.trim() || null,
        capabilities_narrative: narrative.trim() || null,
        certifications: [...certs],
        set_asides: [...certs],
      });
    },
    onSuccess: () => {
      toast.success("Company profile saved");
      bumpCaches(qc);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Legal company name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Federal LLC" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">UEI</Label>
            <Input value={uei} onChange={(e) => setUei(e.target.value)} placeholder="12-char SAM UEI" />
          </div>
          <div>
            <Label className="text-xs">CAGE</Label>
            <Input value={cage} onChange={(e) => setCage(e.target.value)} placeholder="5-char CAGE" />
          </div>
        </div>
      </div>
      <div>
        <Label className="text-xs">Capabilities (1–2 sentences)</Label>
        <Textarea
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="What does your company do? Used to summarize you to partners and in proposal drafts."
          rows={2}
        />
      </div>
      <div>
        <Label className="text-xs">Set-asides & certifications *</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {CERT_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              className={[
                "px-2 py-1 rounded-md border text-xs transition-colors",
                certs.has(c)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-accent",
              ].join(" ")}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
        {save.isPending ? "Saving…" : "Save & continue"}
      </Button>
    </div>
  );
}

// ---------- Step 2: NAICS codes ----------

function NaicsStep({ onSaved }: { onSaved: () => void }) {
  const teamId = useTeamId();
  const qc = useQueryClient();
  const { ownCompany } = useOnboardingState();
  const [text, setText] = useState((ownCompany?.naics_codes ?? []).join(", "));

  useEffect(() => {
    if (ownCompany && text === "" && (ownCompany.naics_codes?.length ?? 0) > 0) {
      setText(ownCompany.naics_codes.join(", "));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownCompany?.id]);

  const codes = useMemo(
    () => text.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d{2,6}$/.test(s)),
    [text],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!teamId) throw new Error("No active team");
      if (codes.length === 0) throw new Error("Add at least one 6-digit NAICS code");
      await upsertOwnCompany(teamId, { naics_codes: codes });
    },
    onSuccess: () => {
      toast.success(`Saved ${codes.length} NAICS code${codes.length === 1 ? "" : "s"}`);
      bumpCaches(qc);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Label className="text-xs">Primary NAICS codes</Label>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="541512, 541519, 541330"
        rows={2}
      />
      {codes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {codes.map((c) => <Badge key={c} variant="secondary" className="font-mono">{c}</Badge>)}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Comma- or space-separated. Use the same NAICS codes you registered in SAM.gov.
      </p>
      <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
        {save.isPending ? "Saving…" : "Save & continue"}
      </Button>
    </div>
  );
}

// ---------- Step 3: past performance ----------

function PastPerformanceStep({ onSaved }: { onSaved: () => void }) {
  const teamId = useTeamId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState("");
  const [naics, setNaics] = useState("");
  const [value, setValue] = useState("");
  const [end, setEnd] = useState("");
  const [summary, setSummary] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!teamId) throw new Error("No active team");
      if (!title.trim()) throw new Error("Project title is required");
      if (!agency.trim()) throw new Error("Customer / agency is required");
      const { error } = await supabase.from("past_performance").insert({
        team_id: teamId,
        created_by: user?.id ?? null,
        contract_title: title.trim(),
        agency: agency.trim(),
        naics_code: naics.trim() || null,
        total_value: value ? Number(value) : null,
        period_of_performance_end: end || null,
        description: summary.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Past performance added");
      bumpCaches(qc);
      qc.invalidateQueries({ queryKey: ["past-performance"] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Project title *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cybersecurity engineering support" />
        </div>
        <div>
          <Label className="text-xs">Customer / agency</Label>
          <Input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="Department of the Air Force" />
        </div>
        <div>
          <Label className="text-xs">NAICS</Label>
          <Input value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="541512" />
        </div>
        <div>
          <Label className="text-xs">Contract value (USD)</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} type="number" placeholder="2500000" />
        </div>
        <div>
          <Label className="text-xs">Period of performance end</Label>
          <Input value={end} onChange={(e) => setEnd(e.target.value)} type="date" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Scope summary</Label>
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="What did you deliver?" />
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
          {save.isPending ? "Saving…" : "Add & continue"}
        </Button>
        <Button variant="outline" size="sm" onClick={onSaved}>Import later</Button>
      </div>
    </div>
  );
}

// ---------- Step 4: contract vehicles ----------

function VehiclesStep({ onSaved }: { onSaved: () => void }) {
  const teamId = useTeamId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("IDIQ");
  const [number, setNumber] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!teamId) throw new Error("No active team");
      if (!name.trim()) throw new Error("Vehicle name is required");
      const { error } = await supabase.from("contract_vehicles").insert({
        team_id: teamId,
        created_by: user?.id ?? null,
        vehicle_name: name.trim(),
        vehicle_type: type,
        contract_number: number.trim() || null,
        status: "active",
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Vehicle added");
      bumpCaches(qc);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Vehicle name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GSA MAS" />
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["IDIQ", "BPA", "GWAC", "MAS", "Agency-specific", "Other"].map((t) =>
                <SelectItem key={t} value={t}>{t}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Contract number</Label>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="GS-35F-XXXXX" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
          {save.isPending ? "Saving…" : "Add & continue"}
        </Button>
        <Button variant="outline" size="sm" onClick={onSaved}>Import later</Button>
      </div>
    </div>
  );
}

// ---------- Persistent banner shown after skipping ----------

export function PastPerformanceAccuracyBanner() {
  const { hasPastPerformance, loading } = useOnboardingState();
  if (loading || hasPastPerformance) return null;
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 text-xs">
        <span className="font-semibold text-amber-700 dark:text-amber-400">pWin accuracy is limited until past performance is added.</span>{" "}
        <span className="text-amber-700/80 dark:text-amber-400/80">
          NAICS-relevant past performance is the strongest pWin factor — even one entry meaningfully improves scoring.
        </span>
      </div>
      <Button asChild size="sm" variant="outline" className="h-7">
        <a href="/settings#past-performance">Add now</a>
      </Button>
    </div>
  );
}
