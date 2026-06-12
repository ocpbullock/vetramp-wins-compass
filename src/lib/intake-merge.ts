/**
 * Pure helpers used by the proposal IntakeStep autosave/merge logic.
 *
 * The intake form holds local state initialized from the loaded proposal row,
 * autosaves edits back to the row, and may receive server refreshes (e.g.
 * after parsing). We must:
 *   - never clobber the user's in-progress edits with stale server data while
 *     a save is in flight or the form is dirty;
 *   - still adopt server-driven updates for fields the user isn't editing
 *     (e.g. compliance_matrix, parsing_status, opportunity_data).
 */

export const INTAKE_TRACKED_FIELDS = [
  "opportunity_type",
  "estimated_value",
  "contract_type",
  "pop_base_months",
  "pop_option_months",
  "clearance_requirement",
  "user_notes",
  "targeted_scope_areas",
  "prime_contractor_name",
  "known_incumbent",
  "incumbent_notes",
  "customer_notes",
  "competitive_notes",
  "capture_notes",
] as const;

export type IntakeTrackedField = (typeof INTAKE_TRACKED_FIELDS)[number];

/**
 * Compute the next local form state when a fresh server proposal row arrives.
 *
 *  - On first init (no prev), adopt the server row verbatim.
 *  - Across rows (different id), adopt the server row verbatim.
 *  - When the user has pending edits or a save is in flight, preserve the
 *    user-editable fields from `prev` while letting the rest of the row
 *    refresh from the server.
 *  - Otherwise, adopt the server row.
 */
export function mergeServerProposal<T extends Record<string, any>>(
  prev: T | null | undefined,
  server: T,
  opts: { dirty: boolean; inFlight: number },
): T {
  if (!prev) return server;
  if (prev.id !== server.id) return server;
  if (!opts.dirty && opts.inFlight === 0) return server;
  const next: any = { ...server };
  for (const k of INTAKE_TRACKED_FIELDS) {
    if (k in prev) next[k] = prev[k];
  }
  return next as T;
}
