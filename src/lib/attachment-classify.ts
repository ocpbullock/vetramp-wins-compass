export type AttachmentType =
  | "sow"
  | "instructions"
  | "amendment"
  | "attachment"
  | "other"
  | "customer_intel"
  | "reference"
  | "template"
  | "rfi"
  | "draft_solicitation"
  | "final_solicitation"
  | "previous_solicitation";

export const ATTACHMENT_TYPE_OPTIONS: { value: AttachmentType; label: string }[] = [
  { value: "sow", label: "SOW / PWS" },
  { value: "instructions", label: "Section L / M (Instructions)" },
  { value: "amendment", label: "Amendment / Mod" },
  { value: "attachment", label: "Attachment (QASP / CDRL / DD254)" },
  { value: "template", label: "Proposal Template" },
  { value: "reference", label: "Reference Text" },
  { value: "rfi", label: "RFI / Sources Sought" },
  { value: "draft_solicitation", label: "Draft Solicitation" },
  { value: "final_solicitation", label: "Final Solicitation" },
  { value: "previous_solicitation", label: "Previous Solicitation (recompete baseline)" },
  { value: "other", label: "Other" },
  { value: "customer_intel", label: "Customer Intel" },
];

export function labelForAttachmentType(value?: string | null): string {
  if (!value) return "Other";
  const opt = ATTACHMENT_TYPE_OPTIONS.find((o) => o.value === value);
  return opt?.label ?? value;
}

export function classifyFilename(name: string): AttachmentType {
  const n = name.toLowerCase();
  if (/(template|outline|sample[\s_-]proposal|proposal[\s_-]template)/.test(n)) return "template";
  if (/(sources[\s_-]sought|\brfi\b|request[\s_-]for[\s_-]information)/.test(n)) return "rfi";
  if (/(draft[\s_-]?(rfp|rfq|solicitation|pws|sow))/.test(n)) return "draft_solicitation";
  if (/(final[\s_-]?(rfp|rfq|solicitation))/.test(n)) return "final_solicitation";
  // Prior fiscal-year markers (FY18–FY24, 2015–2023, or "prior/previous/recompete/baseline")
  if (/(prior|previous|recompete|re[\s_-]?compete|baseline)/.test(n)) return "previous_solicitation";
  if (/\bfy[\s_-]?(1[5-9]|2[0-4])\b/.test(n)) return "previous_solicitation";
  if (/\b(20(1[5-9]|2[0-4]))\b/.test(n) && /(rfp|rfq|solicitation|pws|sow|award)/.test(n)) return "previous_solicitation";
  if (/(sow|pws|statement[\s_-]of[\s_-]work)/.test(n)) return "sow";
  if (/(section[\s_-]?l|section[\s_-]?m|instructions)/.test(n)) return "instructions";
  if (/(amend|modification|\bmod\b|_mod)/.test(n)) return "amendment";
  if (/(qasp|cdrl|dd[\s_-]?254)/.test(n)) return "attachment";
  return "other";
}

// ---------------------------------------------------------------------------
// Acquisition maturity — derived from most advanced doc type present.
// ---------------------------------------------------------------------------

export type AcquisitionMaturity =
  | "none"
  | "previous_baseline"
  | "market_research"
  | "draft_out"
  | "final_out";

const MATURITY_LABEL: Record<AcquisitionMaturity, string> = {
  none: "",
  previous_baseline: "Recompete baseline — watching for RFI/draft",
  market_research: "Market research stage",
  draft_out: "Draft out — final expected",
  final_out: "Final — proposal clock running",
};

export function acquisitionMaturity(
  attachments: Array<{ file_type?: string | null } | null | undefined>,
): { stage: AcquisitionMaturity; label: string } {
  const types = new Set(
    attachments
      .map((a) => (a?.file_type ?? "").toString().toLowerCase())
      .filter(Boolean),
  );
  let stage: AcquisitionMaturity = "none";
  if (types.has("previous_solicitation")) stage = "previous_baseline";
  if (types.has("rfi")) stage = "market_research";
  if (types.has("draft_solicitation")) stage = "draft_out";
  if (types.has("final_solicitation") || types.has("sow") || types.has("instructions")) stage = "final_out";
  return { stage, label: MATURITY_LABEL[stage] };
}
