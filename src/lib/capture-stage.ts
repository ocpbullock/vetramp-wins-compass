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
