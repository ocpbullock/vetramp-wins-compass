import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Regression: the legacy `company_profile` table is retired as a writable
// source. All readers must go through `src/lib/companies.ts` helpers
// (getOwnCompanyProfileData / saveOwnCompanyProfile). The table is kept
// for one release as a data backup, but no `src/` code may query it.

describe("no legacy company_profile readers in src/", () => {
  it("contains zero `from(\"company_profile\")` references under src/", () => {
    let out = "";
    try {
      out = execSync(
        `grep -rEn "from\\(['\"\\\`]company_profile['\"\\\`]\\)" src || true`,
        { encoding: "utf8" },
      );
    } catch {
      out = "";
    }
    const offending = out.trim().split("\n").filter(Boolean);
    expect(offending, `Found legacy company_profile readers:\n${offending.join("\n")}`)
      .toHaveLength(0);
  });

  it("companies.ts exposes getOwnCompanyProfileData and saveOwnCompanyProfile", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/companies.ts"), "utf8");
    expect(src).toMatch(/export async function getOwnCompanyProfileData/);
    expect(src).toMatch(/export async function saveOwnCompanyProfile/);
  });
});
