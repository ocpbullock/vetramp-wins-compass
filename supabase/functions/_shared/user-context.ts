/**
 * "What we know" — offeror-provided capture knowledge that the user enters
 * on the proposal intake step. These facts are AUTHORITATIVE: every analysis
 * function (competitive-intel, customer-intel, generate-proposal) must treat
 * them as overriding model assumptions and heuristics.
 *
 * The intake step persists each field on the `proposals` row. Callers pass a
 * `userContext` block of the same shape into the edge function bodies.
 */

export type UserContext = {
  knownIncumbent?: string | null;
  incumbentNotes?: string | null;
  customerNotes?: string | null;
  competitiveNotes?: string | null;
  captureNotes?: string | null;
};

/** Trim, drop empty, return a normalized copy or null when nothing was provided. */
export function normalizeUserContext(raw: unknown): UserContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: UserContext = {};
  const pick = (k: keyof UserContext) => {
    const v = r[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  };
  pick("knownIncumbent");
  pick("incumbentNotes");
  pick("customerNotes");
  pick("competitiveNotes");
  pick("captureNotes");
  return Object.keys(out).length === 0 ? null : out;
}

/** Which user-supplied facts were non-empty — surfaced on result cards. */
export function appliedFacts(ctx: UserContext | null): (keyof UserContext)[] {
  if (!ctx) return [];
  return (Object.keys(ctx) as (keyof UserContext)[]).filter((k) => !!ctx[k]);
}

/**
 * Render the userContext into a prompt block for the LLM with a hard
 * instruction that these facts OVERRIDE model assumptions when in conflict.
 * Returns "" when no context was provided.
 */
export function renderUserContextPrompt(ctx: UserContext | null): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.knownIncumbent) lines.push(`- Known incumbent (offeror-confirmed): ${ctx.knownIncumbent}`);
  if (ctx.incumbentNotes) lines.push(`- Incumbent notes: ${ctx.incumbentNotes}`);
  if (ctx.customerNotes) lines.push(`- Customer notes: ${ctx.customerNotes}`);
  if (ctx.competitiveNotes) lines.push(`- Competitive notes: ${ctx.competitiveNotes}`);
  if (ctx.captureNotes) lines.push(`- General capture notes: ${ctx.captureNotes}`);
  return `\nOFFEROR-PROVIDED FACTS ("What we know"):
${lines.join("\n")}

AUTHORITY RULE: Treat the offeror-provided facts above as AUTHORITATIVE. When they conflict with what you would otherwise infer from public data or model training, the offeror's facts win. Do not contradict them. Reference them by name (e.g. "per the offeror-confirmed incumbent") so the reader can see which conclusions came from offeror knowledge versus your own inference.\n`;
}
