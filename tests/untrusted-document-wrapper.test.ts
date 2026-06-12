// Regression: every AI-facing edge function that ingests third-party document
// content must wrap that content in clearly delimited UNTRUSTED blocks, and
// the prompt-assembling functions must include the security instruction
// telling the model to ignore any instructions inside those blocks.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const SHARED = read("supabase/functions/_shared/untrusted.ts");

describe("shared untrusted-content helper", () => {
  it("exports wrapUntrusted and the system-instruction constant", () => {
    expect(SHARED).toContain("export function wrapUntrusted");
    expect(SHARED).toContain("UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION");
    expect(SHARED).toContain("<<<UNTRUSTED_DOCUMENT");
    expect(SHARED).toContain("<<<END_UNTRUSTED_DOCUMENT>>>");
  });
});

const PROMPT_FNS = [
  "supabase/functions/parse-sow/index.ts",
  "supabase/functions/generate-proposal/index.ts",
  "supabase/functions/generate-proposal-section/index.ts",
  "supabase/functions/customer-intel/index.ts",
  "supabase/functions/generate-teaming-outreach/index.ts",
];

describe.each(PROMPT_FNS)("%s wraps untrusted document content", (file) => {
  const src = read(file);
  it("imports the shared helper", () => {
    expect(src).toMatch(/from\s+["']\.\.\/_shared\/untrusted\.ts["']/);
    expect(src).toContain("wrapUntrusted");
  });
  it("calls wrapUntrusted at least once in prompt assembly", () => {
    expect(src).toMatch(/wrapUntrusted\s*\(/);
  });
  it("includes the untrusted-content system instruction in the prompt", () => {
    expect(src).toContain("UNTRUSTED_CONTENT_SYSTEM_INSTRUCTION");
  });
});

describe("ingest-knowledge wraps extracted document text at storage time", () => {
  const src = read("supabase/functions/ingest-knowledge/index.ts");
  it("imports and calls wrapUntrusted on extracted content", () => {
    expect(src).toMatch(/from\s+["']\.\.\/_shared\/untrusted\.ts["']/);
    expect(src).toMatch(/wrapUntrusted\s*\(/);
  });
});
