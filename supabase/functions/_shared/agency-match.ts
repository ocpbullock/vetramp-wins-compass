// Deno mirror of src/lib/agency-match.ts (edge functions can't import from src/).

export function normalizeAgency(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
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
  const at = new Set(a.split(" ").filter((t) => t.length >= 3));
  const bt = b.split(" ").filter((t) => t.length >= 3);
  let overlap = 0;
  for (const t of bt) if (at.has(t)) overlap++;
  return overlap >= 2;
}
