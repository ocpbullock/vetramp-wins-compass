// Regression: the companies-cutover must stay complete.
//
// After migrating proposal-side reads and writes to the unified `companies`
// table, the legacy `teaming_partners` table is a back-compat shim only.
// No source file outside the shim (and the auto-generated Supabase types)
// may reference the legacy table name in a Supabase query.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "..");

// Files that are explicitly allowed to mention the legacy table:
//   - the generated Supabase types
//   - the legacy shim module (Partner type re-export + cache keys)
const SHIM_ALLOWED = new Set<string>([
  "src/integrations/supabase/types.ts",
  "src/components/settings/PartnersPanel.tsx",
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("companies cutover: legacy teaming_partners is no longer queried", () => {
  const files = walk(resolve(root, "src"));

  it("no src file outside the legacy shim calls .from('teaming_partners')", () => {
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = abs.slice(root.length + 1).replace(/\\/g, "/");
      if (SHIM_ALLOWED.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      if (/\.from\(\s*["']teaming_partners["']\s*\)/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `These files still query the legacy teaming_partners table:\n  - ${offenders.join("\n  - ")}`,
    ).toEqual([]);
  });
});
