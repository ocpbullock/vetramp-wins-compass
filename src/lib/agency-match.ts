// Fuzzy agency name matching. Tango stores combined strings like
// "DEPT OF DEFENSE / DEFENSE HEALTH AGENCY (DHA)" while users may type
// "Defense Health Agency" or "DHA". Substring includes fails for both.

export function normalizeAgency(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    // strip parenthetical acronyms
    .replace(/\([^)]*\)/g, " ")
    // punctuation → space
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(dept|department|of|the|and|us|u s)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractAcronyms(s: string | null | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  const re = /\(([A-Z0-9]{2,10})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(s))) !== null) out.push(m[1].toUpperCase());
  return out;
}

/**
 * True when award agency and user agency plausibly refer to the same body.
 * Matches on normalized substring in either direction OR on parenthetical acronym.
 */
export function agencyMatchesLoose(
  awardAgency: string | null | undefined,
  userAgency: string | null | undefined,
): boolean {
  const a = normalizeAgency(awardAgency);
  const b = normalizeAgency(userAgency);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const acros = extractAcronyms(awardAgency);
  const userTrim = String(userAgency ?? "").trim().toUpperCase();
  if (acros.includes(userTrim)) return true;
  const userAcros = extractAcronyms(userAgency);
  const awardTrim = String(awardAgency ?? "").trim().toUpperCase();
  if (userAcros.some((x) => awardTrim.includes(x))) return true;
  // token overlap: at least 2 meaningful shared tokens
  const at = new Set(a.split(" ").filter((t) => t.length >= 3));
  const bt = b.split(" ").filter((t) => t.length >= 3);
  let overlap = 0;
  for (const t of bt) if (at.has(t)) overlap++;
  return overlap >= 2;
}
