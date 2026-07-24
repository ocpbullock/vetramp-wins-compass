import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, PageNumber, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageBreak, LevelFormat, PageOrientation,
} from "docx";
import type { MarketSnapshot } from "@/lib/market-snapshot";
import type { PwinResult } from "@/lib/pwin";
import type { PartnerSuggestion } from "@/lib/partner-suggest";
import type { DarkHorseTarget } from "@/lib/partner-experience";
import type { TeamingTarget } from "@/lib/teaming-targets";

const FONT_BODY = "Times New Roman";
const FONT_HEAD = "Arial";

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function tr(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; font?: string; color?: string } = {}) {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italic,
    size: opts.size ?? 22,
    font: opts.font ?? FONT_BODY,
    color: opts.color,
  });
}

function p(text: string, opts: Parameters<typeof tr>[1] = {}): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [tr(text, opts)] });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [tr(text, { font: FONT_HEAD, bold: true, size: 28 })],
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 80 },
    children: [tr(text, { font: FONT_HEAD, bold: true, size: 24 })],
  });
}

function noteEmpty(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [tr(text, { italic: true, color: "6B7280" })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [tr(text)],
  });
}

const fmtMoney = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

function buildTable(headers: string[], rows: string[][], colWidths?: number[]): Table {
  const tableWidth = 9360;
  const widths = colWidths ?? Array(headers.length).fill(Math.floor(tableWidth / headers.length));
  const mkCell = (text: string, w: number, bold: boolean, shade?: string, color?: string) =>
    new TableCell({
      borders: allBorders,
      width: { size: w, type: WidthType.DXA },
      shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [tr(text, { bold, size: 20, color })] })],
    });
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((hd, i) => mkCell(hd, widths[i], true, "1F2937", "FFFFFF")),
      }),
      ...rows.map((row) => new TableRow({
        children: Array.from({ length: headers.length }, (_, i) => mkCell(row[i] ?? "", widths[i], false)),
      })),
    ],
  });
}

function slug(s: string): string {
  return (s || "capture")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "capture";
}

// -------------------------------------------------------------------------

export type CaptureReportInputs = {
  proposal: any;
  marketSnapshot: MarketSnapshot | null;
  captureAnalysis: any | null;
  intelItems: Array<{
    intel_type?: string | null;
    occurred_on?: string | null;
    created_at?: string | null;
    source_name?: string | null;
    body?: string | null;
    title?: string | null;
  }>;
  teamingSummary: {
    pwin: PwinResult | null;
    suggestions: PartnerSuggestion[];
    ourCompanyName?: string | null;
  } | null;
  darkHorses?: DarkHorseTarget[] | null;
  positioningMatrix?: {
    updatedAt?: string;
    dimensions?: string[];
    rows?: Array<{
      company?: string;
      isUs?: boolean;
      threat?: string;
      ratings?: Record<string, string>;
      coverage?: string;
    }>;
  } | null;
};

export type CaptureReportOptions = {
  variant?: "internal" | "partner"; // partner = external, omits intel log + hides bid rationale detail
};

export async function exportCaptureReportDocx(
  inputs: CaptureReportInputs,
  options: CaptureReportOptions = {},
) {
  const variant = options.variant ?? "internal";
  const isInternal = variant === "internal";
  const { proposal, marketSnapshot, captureAnalysis, intelItems, teamingSummary, darkHorses, positioningMatrix } = inputs;

  const children: (Paragraph | Table)[] = [];

  // ============ 1. Cover ============
  const title = proposal?.opportunity_title || proposal?.title || "Opportunity";
  const solNum = proposal?.solicitation_number || "";
  const naics = proposal?.naics_code || "—";
  const agency = proposal?.agency || "—";
  const setAside = proposal?.set_aside || "—";
  const vehicle = proposal?.contract_vehicle || "—";
  const vehicleStatus = proposal?.vehicle_status || "unknown";
  const captureStage = proposal?.capture_stage || "—";
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const cover: Paragraph[] = [
    new Paragraph({ spacing: { before: 2400 }, children: [tr("")] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [tr("CAPTURE REPORT", { font: FONT_HEAD, bold: true, size: 28, color: "555555" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
      children: [tr(title, { font: FONT_HEAD, bold: true, size: 44 })],
    }),
    solNum
      ? new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 },
          children: [tr(`Solicitation ${solNum}`, { font: FONT_HEAD, size: 26 })],
        })
      : new Paragraph({ children: [tr("")] }),
    new Paragraph({ spacing: { before: 400 }, children: [tr("")] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [tr(`Agency: ${agency}`, { size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [tr(`NAICS: ${naics}    Set-aside: ${setAside}`, { size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [tr(`Vehicle: ${vehicle} (${vehicleStatus})`, { size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [tr(`Capture stage: ${captureStage}`, { size: 24 })] }),
    new Paragraph({ spacing: { before: 800 }, alignment: AlignmentType.CENTER, children: [tr(`Date: ${dateStr}`, { size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [tr("Prepared by VetRamp Pursuit", { font: FONT_HEAD, size: 22, color: "555555" })] }),
    new Paragraph({
      spacing: { before: 1200 },
      alignment: AlignmentType.CENTER,
      children: [tr(
        isInternal
          ? "INTERNAL — CAPTURE TEAM USE"
          : "PARTNER-FACING BRIEF",
        { font: FONT_HEAD, bold: true, size: 20, color: "B91C1C" },
      )],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  children.push(...cover);

  // ============ 2. Executive summary ============
  children.push(h1("Executive Summary"));
  const bnb = captureAnalysis?.bid_no_bid ?? null;
  if (!bnb) {
    children.push(noteEmpty("No capture analysis available — run the analysis to populate this section."));
  } else {
    const recMap: Record<string, string> = {
      bid: "BID", lean_bid: "LEAN BID", lean_no_bid: "LEAN NO-BID", no_bid: "NO-BID",
    };
    const recText = recMap[bnb.recommendation] ?? String(bnb.recommendation ?? "—").toUpperCase();
    const conf = typeof bnb.confidence === "number"
      ? `${Math.round(bnb.confidence * 100)}%`
      : String(bnb.confidence ?? "—");
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [
        tr("Recommendation: ", { bold: true, size: 26 }),
        tr(recText, { bold: true, size: 26, color: recText.includes("NO") ? "B91C1C" : "047857" }),
        tr(`    Confidence: ${conf}`, { size: 24 }),
      ],
    }));
    if (isInternal && bnb.rationale) {
      children.push(h2("Rationale"));
      children.push(p(String(bnb.rationale)));
    } else if (!isInternal) {
      children.push(noteEmpty("Detailed rationale omitted from partner-facing brief."));
    }
    if (Array.isArray(bnb.key_factors) && bnb.key_factors.length) {
      children.push(h2("Key factors"));
      for (const f of bnb.key_factors) children.push(bullet(String(f)));
    }
  }

  // ============ 3. Competitive landscape ============
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1("Competitive Landscape"));

  // Incumbent
  children.push(h2("Incumbent"));
  const inc = marketSnapshot?.incumbent ?? null;
  if (!inc || inc.confidence === "none" || !inc.topRecipient) {
    children.push(noteEmpty("No incumbent identified in the market snapshot."));
  } else {
    children.push(p(`${inc.topRecipient} — confidence: ${inc.confidence}`, { bold: true }));
    const bits: string[] = [];
    if (inc.totalAmount) bits.push(`Total: ${fmtMoney(inc.totalAmount)}`);
    if (inc.latestEndDate) bits.push(`Latest PoP end: ${inc.latestEndDate.slice(0, 10)}`);
    if (inc.popExpiringSoon) bits.push("PoP expiring within ±9 months");
    if (bits.length) children.push(p(bits.join("   •   ")));
  }

  // Competitor assessment narrative
  children.push(h2("Competitor assessment"));
  if (captureAnalysis?.competitor_assessment) {
    children.push(p(String(captureAnalysis.competitor_assessment)));
  } else {
    children.push(noteEmpty("No competitor assessment on file."));
  }

  // Top competitors table
  children.push(h2("Top competitors"));
  const competitors = marketSnapshot?.competitors ?? [];
  if (competitors.length === 0) {
    children.push(noteEmpty("No competitor data in the market snapshot."));
  } else {
    children.push(buildTable(
      ["Vendor", "Awards", "Total $", "Avg $", "Most recent", "Set-aside"],
      competitors.slice(0, 12).map((c) => [
        c.name ?? "—",
        String(c.awards ?? 0),
        fmtMoney(c.totalValue),
        fmtMoney(c.avgValue),
        c.mostRecent ? c.mostRecent.slice(0, 10) : "—",
        c.setAside || "—",
      ]),
      [2600, 900, 1400, 1400, 1400, 1660],
    ));
  }

  // Competitive Positioning matrix
  children.push(h2("Competitive Positioning"));
  const pm = positioningMatrix;
  const pmRows = Array.isArray(pm?.rows) ? pm!.rows! : [];
  const pmDims = Array.isArray(pm?.dimensions) && pm!.dimensions!.length ? pm!.dimensions! : [];
  if (pmRows.length === 0 || pmDims.length === 0) {
    children.push(noteEmpty("No positioning matrix saved for this opportunity."));
  } else {
    const RATING_SHADE: Record<string, { fill: string; label: string; color?: string }> = {
      strong:   { fill: "D1FAE5", label: "Strong" },
      moderate: { fill: "FEF3C7", label: "Moderate" },
      weak:     { fill: "FEE2E2", label: "Weak" },
      unknown:  { fill: "F3F4F6", label: "—" },
    };
    const THREAT_SHADE: Record<string, { fill: string; label: string; color: string }> = {
      very_high: { fill: "B91C1C", label: "Very High", color: "FFFFFF" },
      high:      { fill: "DC2626", label: "High", color: "FFFFFF" },
      medium:    { fill: "F59E0B", label: "Medium", color: "FFFFFF" },
      low:       { fill: "059669", label: "Low", color: "FFFFFF" },
    };
    const tableWidth = 9360;
    const coverageW = 2400;
    const companyW = 1800;
    const threatW = 1000;
    const dimW = Math.max(700, Math.floor((tableWidth - companyW - threatW - coverageW) / pmDims.length));
    const widths = [companyW, threatW, ...pmDims.map(() => dimW), coverageW];
    const total = widths.reduce((s, w) => s + w, 0);
    // adjust last column to match tableWidth
    widths[widths.length - 1] = coverageW + (tableWidth - total);

    const mkCell = (text: string, w: number, opts: { bold?: boolean; shade?: string; color?: string; align?: any } = {}) =>
      new TableCell({
        borders: allBorders,
        width: { size: w, type: WidthType.DXA },
        shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({
          alignment: opts.align,
          children: [tr(text, { bold: opts.bold, size: 18, color: opts.color })],
        })],
      });

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        mkCell("Company", widths[0], { bold: true, shade: "1F2937", color: "FFFFFF" }),
        mkCell("Threat", widths[1], { bold: true, shade: "1F2937", color: "FFFFFF", align: AlignmentType.CENTER }),
        ...pmDims.map((d, i) => mkCell(d, widths[2 + i], { bold: true, shade: "1F2937", color: "FFFFFF", align: AlignmentType.CENTER })),
        mkCell("Overall Coverage", widths[widths.length - 1], { bold: true, shade: "1F2937", color: "FFFFFF" }),
      ],
    });

    const dataRows = pmRows.map((r) => {
      const threat = THREAT_SHADE[String(r.threat ?? "")] ?? { fill: "9CA3AF", label: String(r.threat ?? "—"), color: "FFFFFF" };
      const companyLabel = `${r.company ?? "—"}${r.isUs ? "  (Our team)" : ""}`;
      return new TableRow({
        children: [
          mkCell(companyLabel, widths[0], { bold: !!r.isUs, shade: r.isUs ? "EFF6FF" : undefined }),
          mkCell(threat.label, widths[1], { bold: true, shade: threat.fill, color: threat.color, align: AlignmentType.CENTER }),
          ...pmDims.map((d, i) => {
            const val = String(r.ratings?.[d] ?? "unknown");
            const cfg = RATING_SHADE[val] ?? RATING_SHADE.unknown;
            return mkCell(cfg.label, widths[2 + i], { shade: cfg.fill, align: AlignmentType.CENTER });
          }),
          mkCell(String(r.coverage ?? ""), widths[widths.length - 1]),
        ],
      });
    });

    children.push(new Table({
      width: { size: tableWidth, type: WidthType.DXA },
      columnWidths: widths,
      rows: [headerRow, ...dataRows],
    }));
    if (pm?.updatedAt) {
      children.push(new Paragraph({
        spacing: { before: 60, after: 120 },
        children: [tr(`Matrix updated ${new Date(pm.updatedAt).toLocaleString()}`, { italic: true, size: 18, color: "6B7280" })],
      }));
    }
  }



  // Prior primes
  children.push(h2("Prior primes"));
  const primes: TeamingTarget[] = marketSnapshot?.priorPrimes ?? [];
  if (primes.length === 0) {
    children.push(noteEmpty("No prior primes in the market snapshot."));
  } else {
    children.push(buildTable(
      ["Firm", "Total $", "Awards", "Latest", "Set-aside"],
      primes.slice(0, 12).map((t) => [
        t.name,
        fmtMoney(t.totalValue),
        String(t.awardCount),
        t.latestAwardDate ? t.latestAwardDate.slice(0, 10) : "—",
        t.latestSetAside || (t.isSmallBusiness ? "SB" : "—"),
      ]),
      [3360, 1500, 1000, 1500, 2000],
    ));
  }

  // Candidate partners
  children.push(h2("Candidate partners"));
  const partners = marketSnapshot?.candidatePartners ?? [];
  if (partners.length === 0) {
    children.push(noteEmpty("No candidate partners in the market snapshot."));
  } else {
    children.push(buildTable(
      ["Firm", "Total $", "Awards", "Latest", "Set-aside"],
      partners.slice(0, 15).map((t) => [
        t.name,
        fmtMoney(t.totalValue),
        String(t.awardCount),
        t.latestAwardDate ? t.latestAwardDate.slice(0, 10) : "—",
        t.latestSetAside || (t.isSmallBusiness ? "SB" : "—"),
      ]),
      [3360, 1500, 1000, 1500, 2000],
    ));
  }

  // Dark horses (optional)
  if (darkHorses && darkHorses.length > 0) {
    children.push(h2("Dark horses (adjacent-NAICS crossover)"));
    children.push(buildTable(
      ["Firm", "Agency $", "Awards", "Latest", "Adjacent NAICS"],
      darkHorses.slice(0, 12).map((d) => [
        d.name,
        fmtMoney(d.sameAgencyValue),
        String(d.awardCount),
        d.latestAwardDate ? d.latestAwardDate.slice(0, 10) : "—",
        (d.adjacentNaics ?? []).slice(0, 4).join(", "),
      ]),
      [3060, 1400, 1000, 1400, 2500],
    ));
  }

  // ============ 4. Recommended team ============
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1("Recommended Team"));
  const pwin = teamingSummary?.pwin ?? null;
  if (!pwin) {
    children.push(noteEmpty("PWIN not yet computed for this opportunity."));
  } else {
    children.push(p(`Current PWIN: ${pwin.pwin}`, { bold: true, size: 28 }));
    if (pwin.overAllocated) {
      children.push(p("⚠ Team is over-allocated on work share.", { color: "B91C1C", italic: true }));
    }
    children.push(h2("Factor breakdown"));
    children.push(buildTable(
      ["Factor", "Score", "Weight"],
      pwin.factors.map((f) => [f.label, String(f.score), `${Math.round((f.weight ?? 0) * 100)}%`]),
      [5360, 2000, 2000],
    ));
  }

  children.push(h2("Suggested partners"));
  const suggestions = teamingSummary?.suggestions ?? [];
  if (suggestions.length === 0) {
    children.push(noteEmpty("No additional partner suggestions from the roster."));
  } else {
    for (const s of suggestions) {
      children.push(new Paragraph({
        spacing: { before: 100, after: 40 },
        children: [
          tr(`${s.partnerName}`, { bold: true, size: 24 }),
          tr(`    Fit ${s.fitScore}   ·   ${s.bestRoleLabel}`, { size: 22, color: "555555" }),
        ],
      }));
      for (const r of (s.reasons ?? []).slice(0, 4)) children.push(bullet(String(r)));
    }
  }

  // ============ 5. Win themes & staffing concerns ============
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1("Win Themes & Staffing"));
  children.push(h2("Win themes"));
  const themes: string[] = Array.isArray(captureAnalysis?.win_themes) ? captureAnalysis.win_themes : [];
  if (themes.length === 0) {
    children.push(noteEmpty("No win themes proposed."));
  } else {
    for (const t of themes) children.push(bullet(String(t)));
  }
  children.push(h2("Staffing concerns"));
  const staffing: string[] = Array.isArray(captureAnalysis?.staffing_concerns) ? captureAnalysis.staffing_concerns : [];
  if (staffing.length === 0) {
    children.push(noteEmpty("No staffing concerns flagged."));
  } else {
    for (const s of staffing) children.push(bullet(String(s)));
  }

  // ============ 6. Intelligence log (internal only) ============
  if (isInternal) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(h1("Intelligence Log"));
    if (!intelItems || intelItems.length === 0) {
      children.push(noteEmpty("No intel entries recorded."));
    } else {
      children.push(buildTable(
        ["Type", "Date", "Source", "Summary"],
        intelItems.slice(0, 60).map((i) => [
          String(i.intel_type ?? "—"),
          String((i.occurred_on || i.created_at || "").slice(0, 10) || "—"),
          String(i.source_name ?? "—"),
          String(i.body ?? i.title ?? "—").slice(0, 240),
        ]),
        [1400, 1200, 1800, 4960],
      ));
    }
  }

  // ============ 7. Next actions ============
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h1("Next Actions"));
  const actions: Array<{ action: string; why: string; priority: string }> =
    Array.isArray(captureAnalysis?.next_actions) ? captureAnalysis.next_actions : [];
  if (actions.length === 0) {
    children.push(noteEmpty("No next actions recorded."));
  } else {
    children.push(buildTable(
      ["Priority", "Action", "Why"],
      actions.map((a) => [
        String(a.priority ?? "—").toUpperCase(),
        String(a.action ?? "—"),
        String(a.why ?? "—"),
      ]),
      [1200, 3800, 4360],
    ));
  }

  // -------- Document assembly --------
  const headerPara = new Paragraph({
    tabStops: [{ type: "right" as any, position: 9360 }],
    children: [
      tr(title, { size: 18, color: "555555" }),
      new TextRun({
        text: `\t${isInternal ? "INTERNAL — CAPTURE TEAM USE" : "PARTNER-FACING BRIEF"}`,
        size: 18, color: "B91C1C", bold: true, font: FONT_BODY,
      }),
    ],
  });
  const footerPara = new Paragraph({
    tabStops: [{ type: "right" as any, position: 9360 }],
    children: [
      tr(`Capture Report · ${dateStr}`, { size: 18, color: "555555" }),
      new TextRun({ text: "\tPage ", size: 18, color: "555555" }),
      new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "555555" }),
      new TextRun({ text: " of ", size: 18, color: "555555" }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "555555" }),
    ],
  });

  const doc = new Document({
    creator: teamingSummary?.ourCompanyName || "VetRamp Pursuit",
    title: `Capture Report — ${title}`,
    styles: {
      default: { document: { run: { font: FONT_BODY, size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT_HEAD, bold: true, size: 28 },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT_HEAD, bold: true, size: 24 },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }] },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: { default: new Header({ children: [headerPara] }) },
        footers: { default: new Footer({ children: [footerPara] }) },
        children: children as any,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const label = solNum || title;
  a.download = `CaptureReport-${slug(label)}${isInternal ? "" : "-partner"}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
