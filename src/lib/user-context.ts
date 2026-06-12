/**
 * Client mirror of the edge-function "What we know" capture-knowledge block.
 *
 * Pull this from the proposals row before calling any analysis edge function
 * (competitive-intel, customer-intel, generate-proposal) so the offeror's
 * own facts override model assumptions and the result cards can label
 * exactly which user facts were applied.
 */

export type UserContext = {
  knownIncumbent?: string | null;
  incumbentNotes?: string | null;
  customerNotes?: string | null;
  competitiveNotes?: string | null;
  captureNotes?: string | null;
};

export const USER_CONTEXT_LABELS: Record<keyof UserContext, string> = {
  knownIncumbent: "Known incumbent",
  incumbentNotes: "Incumbent notes",
  customerNotes: "Customer notes",
  competitiveNotes: "Competitive notes",
  captureNotes: "Capture notes",
};

/** Build the request payload field from a proposal row. Returns null when empty. */
export function userContextFromProposal(p: Record<string, any> | null | undefined): UserContext | null {
  if (!p) return null;
  const out: UserContext = {};
  const pick = (k: keyof UserContext, col: string) => {
    const v = p[col];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  };
  pick("knownIncumbent", "known_incumbent");
  pick("incumbentNotes", "incumbent_notes");
  pick("customerNotes", "customer_notes");
  pick("competitiveNotes", "competitive_notes");
  pick("captureNotes", "capture_notes");
  return Object.keys(out).length === 0 ? null : out;
}

export function appliedUserFacts(ctx: UserContext | null): (keyof UserContext)[] {
  if (!ctx) return [];
  return (Object.keys(ctx) as (keyof UserContext)[]).filter((k) => !!ctx[k]);
}
