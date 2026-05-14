export type AttachmentType = "sow" | "instructions" | "amendment" | "attachment" | "other" | "customer_intel";

export const ATTACHMENT_TYPE_OPTIONS: { value: AttachmentType; label: string }[] = [
  { value: "sow", label: "SOW / PWS" },
  { value: "instructions", label: "Section L / M (Instructions)" },
  { value: "amendment", label: "Amendment / Mod" },
  { value: "attachment", label: "Attachment (QASP / CDRL / DD254)" },
  { value: "other", label: "Other" },
  { value: "customer_intel", label: "Customer Intel" },
];

export function classifyFilename(name: string): AttachmentType {
  const n = name.toLowerCase();
  if (/(sow|pws|statement[\s_-]of[\s_-]work)/.test(n)) return "sow";
  if (/(section[\s_-]?l|section[\s_-]?m|instructions)/.test(n)) return "instructions";
  if (/(amend|modification|\bmod\b|_mod)/.test(n)) return "amendment";
  if (/(qasp|cdrl|dd[\s_-]?254)/.test(n)) return "attachment";
  return "other";
}
