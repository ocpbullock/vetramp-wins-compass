// Regression: generate-proposal-section must apply the same offeror-provided
// "What we know" capture-knowledge block as generate-proposal, so regenerated
// sections respect user-confirmed facts over model assumptions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("generate-proposal-section applies userContext", () => {
  const src = readFileSync(
    resolve(root, "supabase/functions/generate-proposal-section/index.ts"),
    "utf8",
  );

  it("imports normalizeUserContext from the shared module", () => {
    expect(src).toMatch(/from\s+["']\.\.\/_shared\/user-context\.ts["']/);
    expect(src).toContain("normalizeUserContext");
    expect(src).toContain("renderUserContextPrompt");
  });

  it("normalizes the userContext payload and renders it into the prompt", () => {
    expect(src).toMatch(/normalizeUserContext\(\s*userContextRaw\s*\)/);
    expect(src).toMatch(/renderUserContextPrompt\(\s*userContext\s*\)/);
    // The rendered block must be embedded in the system prompt body.
    expect(src).toContain("${userContextBlock}");
  });
});
