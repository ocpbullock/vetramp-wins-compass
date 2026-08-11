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

/**
 * SAM.gov and legacy sources sometimes store agency as a dotted/slashed path
 * like "DEPT OF DEFENSE.DEFENSE HEALTH AGENCY.…" or "DoD > DHA". The Tango
 * partner-search combobox uses canonical sub-tier strings ("DEFENSE HEALTH
 * AGENCY (DHA)") — direct string comparison fails.
 *
 * canonicalizeAgencyName splits on path separators, takes the most specific
 * segment, cleans it, and if a suggestion vocabulary is provided fuzzy-matches
 * it to the canonical form so downstream searches hit.
 */
/**
 * Split an agency path into its segments, most general first.
 *
 * A naive split on "." shreds abbreviations: "U.S. SPECIAL OPERATIONS COMMAND"
 * becomes ["U", "S", "SPECIAL …"] and the department pull then queries "U".
 * A dot only ends a segment when the text before it ends in a token of at
 * least 3 characters; segments shorter than 3 characters are never emitted.
 */
export function splitAgencyPath(raw: string | null | undefined): string[] {
  const s = (raw ?? "").toString().trim();
  if (!s) return [];

  const coarse = s.split(/[\/>\|\\]+/).map((p) => p.trim()).filter(Boolean);

  const out: string[] = [];
  for (const chunk of coarse) {
    const dotted = chunk.split(".");
    let cur = "";
    for (let i = 0; i < dotted.length; i++) {
      cur = cur ? `${cur}.${dotted[i]}` : dotted[i];
      const next = dotted[i + 1];
      if (next === undefined) break;
      const lastToken = cur.trim().split(/[\s.]+/).pop() ?? "";
      // Only break when the dot terminates a real word (not "U." or "St.")
      // and something substantive follows.
      if (lastToken.length >= 3 && next.trim().length >= 3) {
        out.push(cur.trim());
        cur = "";
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }

  const kept = out.map((p) => p.trim()).filter((p) => p.length >= 3);
  return kept.length > 0 ? kept : [s];
}

export function canonicalizeAgencyName(
  raw: string | null | undefined,
  suggestions?: readonly string[],
): { canonical: string; display: string; matched: boolean } {
  const s = (raw ?? "").toString().trim();
  if (!s) return { canonical: "", display: "", matched: false };

  const parts = splitAgencyPath(s);
  let seg = parts.length > 0 ? parts[parts.length - 1] : s;


  // Strip trailing bare codes like " - 123" or " (0000)" numeric-only groups,
  // and collapse whitespace.
  seg = seg
    .replace(/\s*[-–—]\s*\d[\d\s-]*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!seg) return { canonical: s, display: s, matched: false };

  if (suggestions && suggestions.length > 0) {
    const exact = suggestions.find((x) => x.toUpperCase() === seg.toUpperCase());
    if (exact) return { canonical: exact, display: exact, matched: true };
    const loose = suggestions.find((x) => agencyMatchesLoose(x, seg));
    if (loose) return { canonical: loose, display: loose, matched: true };
  }

  return { canonical: seg, display: seg, matched: false };
}

