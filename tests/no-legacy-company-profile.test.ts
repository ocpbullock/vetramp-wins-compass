import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Regression: the legacy `company_profile` table is retired as a writable
// source. All readers must go through `src/lib/companies.ts` helpers
// (getOwnCompanyProfileData / saveOwnCompanyProfile). The table is kept
// for one release as a data backup, but no `src/` code may query it.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const LEGACY_RE = /from\(\s*["'`]company_profile["'`]\s*\)/;

describe("no legacy company_profile readers in src/", () => {
  it("contains zero `from(\"company_profile\")` references under src/", () => {
    const files = walk(join(process.cwd(), "src"));
    const offending: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      if (LEGACY_RE.test(content)) offending.push(f);
    }
    expect(offending, `Found legacy company_profile readers:\n${offending.join("\n")}`)
      .toHaveLength(0);
  });

  it("companies.ts exposes getOwnCompanyProfileData and saveOwnCompanyProfile", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/companies.ts"), "utf8");
    expect(src).toMatch(/export async function getOwnCompanyProfileData/);
    expect(src).toMatch(/export async function saveOwnCompanyProfile/);
  });
});
