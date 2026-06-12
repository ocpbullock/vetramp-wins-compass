import { describe, it, expect } from "vitest";
import { composeAttachmentsText } from "../src/lib/attachments-text";

describe("composeAttachmentsText", () => {
  it("returns empty string for no attachments", () => {
    expect(composeAttachmentsText([])).toBe("");
    expect(composeAttachmentsText(null)).toBe("");
  });

  it("skips attachments without parsed_content", () => {
    const out = composeAttachmentsText([
      { filename: "a.pdf", file_type: "sow", parsed_content: "" },
      { filename: "b.pdf", file_type: "sow", parsed_content: null },
    ]);
    expect(out).toBe("");
  });

  it("formats header with name, type label, and note", () => {
    const out = composeAttachmentsText([
      {
        filename: "RFP.pdf",
        file_type: "sow",
        notes: "Final version, supersedes draft",
        parsed_content: "Section C body...",
      },
    ]);
    expect(out).toContain(
      "Document: RFP.pdf (SOW / PWS) — User note: Final version, supersedes draft",
    );
    expect(out).toContain("Section C body...");
  });

  it('uses "(none)" when no note is present', () => {
    const out = composeAttachmentsText([
      { filename: "x.pdf", file_type: "instructions", parsed_content: "text" },
    ]);
    expect(out).toContain(
      "Document: x.pdf (Section L / M (Instructions)) — User note: (none)",
    );
  });

  it("joins multiple attachments with separators", () => {
    const out = composeAttachmentsText([
      { filename: "a.pdf", file_type: "sow", parsed_content: "AAA" },
      { filename: "b.pdf", file_type: "amendment", notes: "Mod 0002", parsed_content: "BBB" },
    ]);
    expect(out.split("---")).toHaveLength(2);
    expect(out).toContain("Document: a.pdf (SOW / PWS) — User note: (none)");
    expect(out).toContain("Document: b.pdf (Amendment / Mod) — User note: Mod 0002");
  });

  it("handles pasted reference text rows the same way", () => {
    const out = composeAttachmentsText([
      {
        filename: "Agency RFI Q&A",
        file_type: "reference",
        notes: "Customer confirmed incumbent",
        parsed_content: "Q1: Who is the incumbent? A: Acme.",
      },
    ]);
    expect(out).toContain(
      "Document: Agency RFI Q&A (Reference Text) — User note: Customer confirmed incumbent",
    );
    expect(out).toContain("Q1: Who is the incumbent? A: Acme.");
  });
});
