import { labelForAttachmentType } from "./attachment-classify";

export type AttachmentLike = {
  filename?: string | null;
  file_type?: string | null;
  notes?: string | null;
  parsed_content?: string | null;
};

/**
 * Compose the attachmentsText blob that gets sent to AI functions.
 * Each attachment is prefixed with a header:
 *   Document: {name} ({type}) — User note: {note or "(none)"}
 * followed by its extracted/pasted text. Attachments with no extracted
 * text are skipped.
 */
export function composeAttachmentsText(attachments: AttachmentLike[] | null | undefined): string {
  if (!attachments?.length) return "";
  const blocks: string[] = [];
  for (const a of attachments) {
    const content = (a.parsed_content || "").trim();
    if (!content) continue;
    const name = a.filename || "Untitled";
    const type = labelForAttachmentType(a.file_type);
    const note = (a.notes || "").trim();
    const header = `Document: ${name} (${type}) — User note: ${note ? note : "(none)"}`;
    blocks.push(`${header}\n${content}`);
  }
  return blocks.join("\n\n---\n\n");
}
