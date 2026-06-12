export type AttachmentType = "sow" | "instructions" | "amendment" | "attachment" | "other" | "customer_intel" | "reference" | "template";

export const ATTACHMENT_TYPE_OPTIONS: { value: AttachmentType; label: string }[] = [
  { value: "sow", label: "SOW / PWS" },
  { value: "instructions", label: "Section L / M (Instructions)" },
  { value: "amendment", label: "Amendment / Mod" },
  { value: "attachment", label: "Attachment (QASP / CDRL / DD254)" },
  { value: "template", label: "Proposal Template" },
  { value: "reference", label: "Reference Text" },
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
  if (/(sow|pws|statement[\s_-]of[\s_-]work)/.test(n)) return "sow";
  if (/(section[\s_-]?l|section[\s_-]?m|instructions)/.test(n)) return "instructions";
  if (/(amend|modification|\bmod\b|_mod)/.test(n)) return "amendment";
  if (/(qasp|cdrl|dd[\s_-]?254)/.test(n)) return "attachment";
  return "other";
}
