/**
 * Human-intel "incorporation" state: has the last Capture Analysis run seen this item?
 * An item is incorporated when it existed before the analysis ran.
 */

export function isIntelIncorporated(
  createdAt: string | null | undefined,
  analysisAt: string | null | undefined,
): boolean {
  if (!analysisAt || !createdAt) return false;
  const a = new Date(analysisAt).getTime();
  const c = new Date(createdAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(c)) return false;
  return c <= a;
}

export type IntelIncorporationSummary = {
  total: number;
  incorporated: number;
  pending: number;
  /** Null when there is nothing to report (no intel items). */
  label: string | null;
};

export function summarizeIntelIncorporation(
  items: { created_at: string | null }[],
  analysisAt: string | null | undefined,
): IntelIncorporationSummary {
  const total = items.length;
  const incorporated = items.filter((i) => isIntelIncorporated(i.created_at, analysisAt)).length;
  const pending = total - incorporated;
  let label: string | null = null;
  if (total > 0) {
    if (!analysisAt) {
      label = `0 of ${total} items incorporated — run Capture Analysis`;
    } else if (pending > 0) {
      label = `${incorporated} of ${total} items incorporated — re-run analysis`;
    } else {
      label = `All ${total} items incorporated`;
    }
  }
  return { total, incorporated, pending, label };
}
