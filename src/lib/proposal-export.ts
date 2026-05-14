import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, PageNumber, TableOfContents, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageBreak, LevelFormat, PageOrientation,
} from "docx";

type SectionData = { content: string; status?: string; word_count?: number };
type SectionDef = { id: string; title: string };

const FONT_BODY = "Times New Roman";
const FONT_HEAD = "Arial";
const WORDS_PER_PAGE = 300;

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function tr(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; font?: string; color?: string } = {}) {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italic,
    size: opts.size ?? 24,
    font: opts.font ?? FONT_BODY,
    color: opts.color,
  });
}

// Parse inline markdown (**bold**, *italic*) into TextRuns
function parseInline(text: string, base: { size?: number; font?: string; bold?: boolean } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(tr(text.slice(last, m.index), base));
    if (m[2] !== undefined) runs.push(tr(m[2], { ...base, bold: true }));
    else if (m[3] !== undefined) runs.push(tr(m[3], { ...base, italic: true }));
    else if (m[4] !== undefined) runs.push(tr(m[4], { ...base, font: "Courier New" }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(tr(text.slice(last), base));
  return runs.length ? runs : [tr(text, base)];
}

function mdTableToDocx(lines: string[]): Table | null {
  if (lines.length < 2) return null;
  const parseRow = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const header = parseRow(lines[0]);
  const bodyRows = lines.slice(2).map(parseRow);
  const colCount = header.length;
  const tableWidth = 9360;
  const colW = Math.floor(tableWidth / colCount);
  const widths = Array(colCount).fill(colW);
  const mkCell = (text: string, bold: boolean, shade?: string) =>
    new TableCell({
      borders: allBorders,
      width: { size: colW, type: WidthType.DXA },
      shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: parseInline(text, { bold }) })],
    });
  const rows = [
    new TableRow({ children: header.map((h) => mkCell(h, true, "E5E7EB")) }),
    ...bodyRows.map((r) => new TableRow({ children: Array.from({ length: colCount }, (_, i) => mkCell(r[i] ?? "", false)) })),
  ];
  return new Table({ width: { size: tableWidth, type: WidthType.DXA }, columnWidths: widths, rows });
}

// Convert markdown body to docx Paragraph/Table children
function mdToBlocks(md: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Table detection
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const tbl: string[] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) { tbl.push(lines[i].trim()); i++; }
      const t = mdTableToDocx(tbl);
      if (t) { out.push(t); out.push(new Paragraph({ children: [tr("")] })); }
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      const m = line.match(/^(#{1,3})\s+(.*)$/)!;
      const level = m[1].length;
      const heading = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      const size = level === 1 ? 28 : level === 2 ? 24 : 22;
      out.push(new Paragraph({ heading, spacing: { before: 200, after: 120 }, children: [tr(m[2], { font: FONT_HEAD, bold: true, size })] }));
    } else if (/^\s*[-*+]\s+/.test(line)) {
      const m = line.match(/^\s*[-*+]\s+(.*)$/)!;
      out.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: parseInline(m[1]) }));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const m = line.match(/^\s*\d+\.\s+(.*)$/)!;
      out.push(new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: parseInline(m[1]) }));
    } else if (line.trim() === "") {
      out.push(new Paragraph({ children: [tr("")] }));
    } else {
      out.push(new Paragraph({ spacing: { after: 120 }, children: parseInline(line) }));
    }
    i++;
  }
  return out;
}

function findPageLimitFor(sectionTitle: string, pageLimits: string[]): string | null {
  if (!pageLimits?.length) return null;
  const t = sectionTitle.toLowerCase();
  const tokens = t.split(/\s+/).filter((w) => w.length > 3);
  for (const pl of pageLimits) {
    const lower = pl.toLowerCase();
    if (tokens.some((tok) => lower.includes(tok))) return pl;
  }
  return null;
}

function extractMaxPages(s: string): number | null {
  const m = s.match(/(\d+)\s*(?:page|pp\.?)/i);
  return m ? parseInt(m[1], 10) : null;
}

function buildCoverPage(opts: {
  title: string; solicitationNumber: string; agency: string; companyName: string;
  uei: string; cage: string; duns?: string; submissionDate: string; pocName: string; pocEmail?: string; pocPhone?: string;
}): Paragraph[] {
  const center = AlignmentType.CENTER;
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [tr("")] }),
    new Paragraph({ alignment: center, children: [tr("PROPOSAL IN RESPONSE TO", { font: FONT_HEAD, bold: true, size: 28, color: "555555" })] }),
    new Paragraph({ alignment: center, spacing: { before: 400 }, children: [tr(opts.title, { font: FONT_HEAD, bold: true, size: 48 })] }),
    new Paragraph({ alignment: center, spacing: { before: 300 }, children: [tr(`Solicitation No. ${opts.solicitationNumber || "TBD"}`, { font: FONT_HEAD, size: 28 })] }),
    new Paragraph({ alignment: center, spacing: { before: 100 }, children: [tr(opts.agency || "", { font: FONT_HEAD, size: 28 })] }),
    new Paragraph({ spacing: { before: 1600 }, children: [tr("")] }),
    new Paragraph({ alignment: center, children: [tr("Submitted by", { font: FONT_HEAD, size: 22, color: "555555" })] }),
    new Paragraph({ alignment: center, spacing: { before: 100 }, children: [tr(opts.companyName, { font: FONT_HEAD, bold: true, size: 32 })] }),
    new Paragraph({ alignment: center, spacing: { before: 200 }, children: [tr(`UEI: ${opts.uei || "—"}    CAGE: ${opts.cage || "—"}${opts.duns ? `    DUNS: ${opts.duns}` : ""}`, { size: 22 })] }),
    new Paragraph({ spacing: { before: 800 }, children: [tr("")] }),
    new Paragraph({ alignment: center, children: [tr("Point of Contact", { font: FONT_HEAD, size: 22, color: "555555" })] }),
    new Paragraph({ alignment: center, children: [tr(opts.pocName || "—", { size: 22 })] }),
    opts.pocEmail ? new Paragraph({ alignment: center, children: [tr(opts.pocEmail, { size: 22 })] }) : new Paragraph({ children: [tr("")] }),
    opts.pocPhone ? new Paragraph({ alignment: center, children: [tr(opts.pocPhone, { size: 22 })] }) : new Paragraph({ children: [tr("")] }),
    new Paragraph({ spacing: { before: 600 }, alignment: center, children: [tr(`Date: ${opts.submissionDate}`, { size: 22 })] }),
    new Paragraph({ spacing: { before: 1200 }, alignment: center, children: [tr("PROPRIETARY — SOURCE SELECTION SENSITIVE", { font: FONT_HEAD, bold: true, size: 20, color: "B91C1C" })] }),
  ];
}

function buildComplianceMatrixTable(matrix: any): (Paragraph | Table)[] {
  const reqs: any[] = Array.isArray(matrix?.requirements) ? matrix.requirements : [];
  if (!reqs.length) return [new Paragraph({ children: [tr("No compliance matrix available.", { italic: true })] })];
  const widths = [900, 1500, 4060, 1900, 1000];
  const total = widths.reduce((a, b) => a + b, 0);
  const headers = ["Req ID", "Source Section", "Requirement", "Proposal Section", "Page Ref"];
  const mkCell = (text: string, w: number, bold: boolean, shade?: string, color?: string) =>
    new TableCell({
      borders: allBorders,
      width: { size: w, type: WidthType.DXA },
      shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({ children: [tr(text, { bold, size: 20, color })] })],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: headers.map((h, i) => mkCell(h, widths[i], true, "1F2937", "FFFFFF")) }),
    ...reqs.map((r) => new TableRow({ children: [
      mkCell(String(r.req_id ?? ""), widths[0], false),
      mkCell(String(r.source_section ?? ""), widths[1], false),
      mkCell(String(r.requirement_text ?? "").slice(0, 280), widths[2], false),
      mkCell(String(r.proposal_section ?? ""), widths[3], false),
      mkCell(String(r.page_reference ?? r.notes ?? ""), widths[4], false),
    ] })),
  ];
  const table = new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows });
  return [table];
}

export async function exportProposalDocx(opts: {
  proposal: any;
  companyProfile: any;
  sectionDefs: SectionDef[];
}) {
  const { proposal, companyProfile, sectionDefs } = opts;
  const sections: Record<string, SectionData> = proposal.sections || {};
  const matrix = proposal.compliance_matrix || {};
  const pageLimits: string[] = Array.isArray(matrix.page_limits) ? matrix.page_limits : [];

  const cp = companyProfile || {};
  // No hardcoded identity fallbacks — surface placeholders so missing data is
  // obvious in the exported document and gets fixed in Settings.
  const companyName = cp.dba || cp.legal_name || "[COMPANY NAME — update in Settings]";
  const uei = cp.uei || "[UEI — update in Settings]";
  const cage = cp.cage || "[CAGE — update in Settings]";
  const duns = cp.duns || "";
  const pocName = cp.founder?.name || cp.poc?.name || "[POC NAME — update in Settings]";
  const pocEmail = cp.poc?.email || cp.contact_email || "";
  const pocPhone = cp.poc?.phone || cp.contact_phone || "";
  const submissionDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const title = proposal.opportunity_title || "Proposal";
  const solNum = proposal.solicitation_number || "";

  // ---- Cover page (Section 1, no header/footer) ----
  const coverChildren = buildCoverPage({
    title, solicitationNumber: solNum, agency: proposal.agency || "",
    companyName, uei, cage, duns, submissionDate, pocName, pocEmail, pocPhone,
  });

  // ---- Body section (Section 2: TOC + sections + matrix; with header/footer) ----
  const bodyChildren: (Paragraph | Table)[] = [];

  // Table of Contents
  bodyChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [tr("Table of Contents", { font: FONT_HEAD, bold: true, size: 28 })] }));
  bodyChildren.push(new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }) as unknown as Paragraph);
  bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // Each section (skip the compliance matrix section here, render at the end)
  const renderable = sectionDefs.filter((s) => s.id !== "compliance_matrix");
  for (const s of renderable) {
    const sec = sections[s.id];
    if (!sec?.content) continue;

    bodyChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [tr(s.title, { font: FONT_HEAD, bold: true, size: 28 })] }));

    const limit = findPageLimitFor(s.title, pageLimits);
    if (limit) {
      const max = extractMaxPages(limit);
      const wc = sec.word_count ?? sec.content.split(/\s+/).filter(Boolean).length;
      const approxPages = Math.max(1, Math.ceil(wc / WORDS_PER_PAGE));
      const over = max != null && approxPages > max;
      bodyChildren.push(new Paragraph({
        spacing: { after: 160 },
        shading: { fill: over ? "FEE2E2" : "FEF3C7", type: ShadingType.CLEAR, color: "auto" },
        children: [
          tr("Page Limit: ", { bold: true, size: 20 }),
          tr(limit, { size: 20 }),
          tr(`  •  Approx ${approxPages} page(s) at ${WORDS_PER_PAGE} wpp${max != null ? ` (limit ${max})` : ""}`, { italic: true, size: 20, color: over ? "B91C1C" : "92400E" }),
          ...(over ? [tr("  ⚠ EXCEEDS LIMIT", { bold: true, size: 20, color: "B91C1C" })] : []),
        ],
      }));
    }

    for (const block of mdToBlocks(sec.content)) bodyChildren.push(block);
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // Compliance Cross-Reference Matrix at end
  bodyChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 160 }, children: [tr("Compliance Cross-Reference Matrix", { font: FONT_HEAD, bold: true, size: 28 })] }));
  for (const block of buildComplianceMatrixTable(matrix)) bodyChildren.push(block);

  const headerPara = new Paragraph({
    tabStops: [{ type: "right" as any, position: 9360 }],
    children: [
      tr(companyName, { size: 18, color: "555555" }),
      new TextRun({ text: "\tPROPRIETARY — SOURCE SELECTION SENSITIVE", size: 18, color: "B91C1C", bold: true, font: FONT_BODY }),
    ],
  });
  const footerPara = new Paragraph({
    tabStops: [{ type: "right" as any, position: 9360 }],
    children: [
      tr(title, { size: 18, color: "555555" }),
      new TextRun({ text: "\tPage ", size: 18, color: "555555" }),
      new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "555555" }),
      new TextRun({ text: " of ", size: 18, color: "555555" }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "555555" }),
    ],
  });

  const doc = new Document({
    creator: companyName,
    title,
    styles: {
      default: { document: { run: { font: FONT_BODY, size: 24 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT_HEAD, bold: true, size: 28 }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT_HEAD, bold: true, size: 24 }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT_HEAD, bold: true, size: 22 }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    features: { updateFields: true },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
          titlePage: false,
        },
        children: coverChildren,
      },
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            pageNumbers: { start: 1 },
          },
        },
        headers: { default: new Header({ children: [headerPara] }) },
        footers: { default: new Footer({ children: [footerPara] }) },
        children: bodyChildren as any,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Proposal-${solNum || "draft"}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
