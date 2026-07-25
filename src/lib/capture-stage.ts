export const CAPTURE_STAGES = [
  "intake",
  "researching",
  "analyzing",
  "pursuing",
  "proposal",
  "submitted",
  "won",
  "lost",
  "no_bid",
] as const;

export type CaptureStage = (typeof CAPTURE_STAGES)[number];

export const CAPTURE_STAGE_LABEL: Record<CaptureStage, string> = {
  intake: "Intake",
  researching: "Researching",
  analyzing: "Analyzing",
  pursuing: "Pursuing",
  proposal: "Proposal",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  no_bid: "No-bid",
};

// -- Legacy 5-bucket board (still used by pwin-solo / a couple of legacy views) --
export type BoardStage = "Watching" | "Capturing" | "Proposal" | "Submitted" | "Won/Lost";

export const BOARD_STAGES: BoardStage[] = [
  "Watching",
  "Capturing",
  "Proposal",
  "Submitted",
  "Won/Lost",
];

export function captureStageToBoard(s: CaptureStage | string | null | undefined): BoardStage {
  switch (s) {
    case "intake":
    case "researching":
      return "Watching";
    case "analyzing":
    case "pursuing":
      return "Capturing";
    case "proposal":
      return "Proposal";
    case "submitted":
      return "Submitted";
    case "won":
    case "lost":
    case "no_bid":
      return "Won/Lost";
    default:
      return "Watching";
  }
}

export function isCaptureStage(s: unknown): s is CaptureStage {
  return typeof s === "string" && (CAPTURE_STAGES as readonly string[]).includes(s);
}

// -- Unified 7-stage taxonomy used across the pipeline UI --
export type StepperStage =
  | "intake"
  | "researching"
  | "analyzing"
  | "pursuing"
  | "proposal"
  | "submitted"
  | "closed";

export const STEPPER_STAGES: StepperStage[] = [
  "intake",
  "researching",
  "analyzing",
  "pursuing",
  "proposal",
  "submitted",
  "closed",
];

export const STEPPER_STAGE_LABEL: Record<StepperStage, string> = {
  intake: "Intake",
  researching: "Researching",
  analyzing: "Analyzing",
  pursuing: "Pursuing",
  proposal: "Proposal",
  submitted: "Submitted",
  closed: "Closed",
};

export const STEPPER_STAGE_TONE: Record<StepperStage, string> = {
  intake: "bg-muted text-muted-foreground border-border",
  researching: "bg-primary/10 text-primary border-primary/30",
  analyzing: "bg-primary/15 text-primary border-primary/40",
  pursuing:
    "border-[color:var(--brand-brass)]/40 bg-[color:color-mix(in_oklab,var(--brand-brass)_14%,transparent)] text-[color:var(--brand-brass)]",
  proposal:
    "border-[color:var(--brand-brass)]/50 bg-[color:color-mix(in_oklab,var(--brand-brass)_22%,transparent)] text-[color:var(--brand-brass)]",
  submitted: "bg-warning/15 text-warning border-warning/30",
  closed: "bg-success/15 text-success border-success/30",
};

export const STEPPER_STAGE_COUNT_TONE: Record<StepperStage, string> = {
  intake: "bg-muted text-muted-foreground",
  researching: "bg-primary/70 text-primary-foreground",
  analyzing: "bg-primary text-primary-foreground",
  pursuing:
    "bg-[color:color-mix(in_oklab,var(--brand-brass)_70%,transparent)] text-[color:var(--brand-brass-foreground)]",
  proposal:
    "bg-[color:var(--brand-brass)] text-[color:var(--brand-brass-foreground)]",
  submitted: "bg-warning text-warning-foreground",
  closed: "bg-success text-success-foreground",
};

/** Map a persisted capture_stage value to its collapsed stepper bucket. */
export function captureStageToStepper(s: CaptureStage | string | null | undefined): StepperStage {
  switch (s) {
    case "intake":
    case "researching":
    case "analyzing":
    case "pursuing":
    case "proposal":
    case "submitted":
      return s;
    case "won":
    case "lost":
    case "no_bid":
      return "closed";
    default:
      return "intake";
  }
}

/** Map a legacy tracked_opportunities.status to the stepper bucket. */
export function trackedStatusToStepper(status: string | null | undefined): StepperStage {
  switch (status) {
    case "Watching":
      return "intake";
    case "Preparing":
      return "pursuing";
    case "Submitted":
      return "submitted";
    case "Won":
    case "Lost":
    case "No-Bid":
      return "closed";
    default:
      return "intake";
  }
}

/** The next capture_stage the user typically advances to (linear). Returns null when there is no linear next. */
export function nextCaptureStage(current: CaptureStage | string | null | undefined): CaptureStage | null {
  switch (current) {
    case "intake":
      return "researching";
    case "researching":
      return "analyzing";
    case "analyzing":
      return "pursuing";
    case "pursuing":
      return "proposal";
    case "proposal":
      return "submitted";
    case "submitted":
    case "won":
    case "lost":
    case "no_bid":
    default:
      return null;
  }
}

export type StageSignals = {
  hasNaicsAgency: boolean;
  hasSnapshot: boolean;
  hasAnalysis: boolean;
  teamingCount: number;
  sectionsCount: number;
};

export function isStageSatisfied(stage: CaptureStage | string | null | undefined, s: StageSignals): boolean {
  switch (stage) {
    case "intake":
      return s.hasNaicsAgency;
    case "researching":
      return s.hasSnapshot;
    case "analyzing":
      return s.hasAnalysis;
    case "pursuing":
      return s.teamingCount >= 1;
    case "proposal":
      return s.sectionsCount >= 1;
    default:
      return false;
  }
}

export function stageHint(stage: CaptureStage | string | null | undefined): string | null {
  switch (stage) {
    case "intake":
      return "Add & parse documents or set NAICS/agency";
    case "researching":
      return "Generate the market snapshot";
    case "analyzing":
      return "Run capture analysis";
    case "pursuing":
      return "Build the team";
    case "proposal":
      return "Generate proposal sections";
    default:
      return null;
  }
}
