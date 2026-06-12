/**
 * Parses a proposal template's extracted text into an ordered list of section
 * headings (the outline the generator should follow) plus a trimmed copy of
 * the raw template body to ship to the AI as a structure/tone reference.
 *
 * Recognised heading patterns:
 *   - Markdown ATX:   "# Title", "## Title"
 *   - Numbered:       "1. Title", "1.1 Title", "3.2.1 Title"
 *   - Lettered:       "A. Title", "B) Title"
 *   - ALL-CAPS lines: short lines (<= 80 chars) in all caps
 */

export type TemplateSection = { id: string; title: string; level: number };

export type ExtractedTemplate = {
  sections: TemplateSection[];
  boilerplate: string;
};

const NUMBERED = /^(\d+(?:\.\d+)*)[.)]?\s+(.{2,120})$/;
const LETTERED = /^([A-Z])[.)]\s+(.{2,120})$/;
const ATX = /^(#{1,6})\s+(.{2,120})$/;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "section";
}

function isAllCapsHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  // require at least 2 letters; mostly uppercase letters/spaces/punctuation
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  if (letters !== letters.toUpperCase()) return false;
  // skip lines that look like sentences (end with period and have many words)
  if (/\.\s*$/.test(trimmed) && trimmed.split(/\s+/).length > 8) return false;
  return true;
}

export function extractTemplateStructure(rawText: string | null | undefined): ExtractedTemplate {
  const text = (rawText || "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return { sections: [], boilerplate: "" };

  const lines = text.split("\n");
  const sections: TemplateSection[] = [];
  const seenIds = new Set<string>();

  function push(title: string, level: number) {
    const cleaned = title.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    let id = slugify(cleaned);
    let n = 2;
    while (seenIds.has(id)) id = `${slugify(cleaned)}_${n++}`;
    seenIds.add(id);
    sections.push({ id, title: cleaned, level });
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let m: RegExpMatchArray | null;
    if ((m = line.match(ATX))) {
      push(m[2], m[1].length);
      continue;
    }
    if ((m = line.match(NUMBERED))) {
      const depth = m[1].split(".").length;
      push(`${m[1]} ${m[2]}`, Math.min(depth, 4));
      continue;
    }
    if ((m = line.match(LETTERED))) {
      push(`${m[1]}. ${m[2]}`, 2);
      continue;
    }
    if (isAllCapsHeading(line)) {
      push(line, 2);
      continue;
    }
  }

  // Keep only TOP-LEVEL sections (level 1 if any exist, otherwise lowest level found)
  // for the outline the generator drives off of. Subsections still inform the AI via boilerplate.
  let topLevel = 1;
  if (!sections.some((s) => s.level === 1)) {
    topLevel = Math.min(...sections.map((s) => s.level));
    if (!isFinite(topLevel)) topLevel = 2;
  }
  const top = sections.filter((s) => s.level === topLevel);

  // Cap to a sensible outline size (avoid 80-section disasters from over-eager parsing)
  const outline = top.slice(0, 20);

  const boilerplate = text.slice(0, 25_000);
  return { sections: outline, boilerplate };
}

/**
 * Returns the first template attachment from a list of proposal attachments,
 * or null. Templates must have parsed_content to be usable.
 */
export function findActiveTemplate(
  attachments: any[] | null | undefined,
): any | null {
  if (!attachments?.length) return null;
  return attachments.find((a) => a?.file_type === "template" && String(a?.parsed_content || "").trim().length > 0) ?? null;
}
