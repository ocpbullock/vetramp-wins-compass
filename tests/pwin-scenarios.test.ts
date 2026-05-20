// Static-analysis invariants for pwin_scenarios + teaming queries.
//
// We don't have a live DB in unit tests, so we assert structural
// properties of the migrations and components that, if violated,
// would break tenancy or audit guarantees.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const migrationFiles = () =>
  readdirSync(resolve(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(`supabase/migrations/${f}`))
    .join("\n");

describe("pwin_scenarios schema invariants", () => {
  const sql = migrationFiles();

  it("table is created", () => {
    expect(sql).toMatch(/CREATE TABLE public\.pwin_scenarios/);
  });

  it("proposal_id is required", () => {
    expect(sql).toMatch(/proposal_id uuid NOT NULL/);
  });

  it("has FK on proposal_id with cascade delete", () => {
    expect(sql).toMatch(
      /pwin_scenarios_proposal_id_fkey[\s\S]*REFERENCES public\.proposals\(id\) ON DELETE CASCADE/,
    );
  });

  it("created_by is NOT NULL", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.pwin_scenarios[\s\S]*ALTER COLUMN created_by SET NOT NULL/,
    );
  });

  it("has created_at and updated_at audit fields", () => {
    expect(sql).toMatch(/created_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).toMatch(/updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  });

  it("updated_at has trigger", () => {
    expect(sql).toMatch(/CREATE TRIGGER update_pwin_scenarios_updated_at/);
  });

  it("RLS is enabled", () => {
    expect(sql).toMatch(/ALTER TABLE public\.pwin_scenarios ENABLE ROW LEVEL SECURITY/);
  });

  it("all four RLS policies scope by user_can_see_proposal", () => {
    for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const re = new RegExp(
        `CREATE POLICY[^;]+pwin_scenarios FOR ${cmd}[\\s\\S]*?user_can_see_proposal\\(proposal_id, auth\\.uid\\(\\)\\)`,
      );
      expect(sql, `policy for ${cmd} must use user_can_see_proposal`).toMatch(re);
    }
  });

  it("INSERT policy enforces created_by = auth.uid()", () => {
    expect(sql).toMatch(
      /CREATE POLICY[^;]+pwin_scenarios FOR INSERT[\s\S]*?created_by = auth\.uid\(\)/,
    );
  });
});

describe("teaming partner queries are team-scoped", () => {
  const files = [
    "src/components/proposals/TeamCompositionAnalyzer.tsx",
    "src/components/proposals/TeamingCard.tsx",
    "src/components/proposals/PrimeContractorCombobox.tsx",
  ];

  for (const f of files) {
    it(`${f}: every teaming_partners query filters by team_id`, () => {
      const src = read(f);
      // For each .from("teaming_partners") usage, require .eq("team_id", ...) within the next 400 chars.
      const re = /\.from\(["']teaming_partners["']\)([\s\S]{0,400})/g;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = re.exec(src)) !== null) {
        count++;
        expect(m[1], `${f}: teaming_partners query missing .eq("team_id"`).toMatch(
          /\.eq\(["']team_id["']/,
        );
      }
      expect(count, `${f}: expected at least one teaming_partners query`).toBeGreaterThan(0);
    });
  }
});

describe("pwin scenario insert includes created_by", () => {
  it("TeamCompositionAnalyzer sets created_by from auth user", () => {
    const src = read("src/components/proposals/TeamCompositionAnalyzer.tsx");
    expect(src).toMatch(/supabase\.auth\.getUser\(\)/);
    expect(src).toMatch(/from\(["']pwin_scenarios["']\)\.insert\([\s\S]*?created_by:/);
  });
});

describe("Pwin UI labels scores as estimates", () => {
  const src = read("src/components/proposals/TeamCompositionAnalyzer.tsx");
  it("uses 'estimate' wording, not 'guaranteed probability'", () => {
    expect(src.toLowerCase()).toContain("estimate");
    expect(src).toMatch(/not a guaranteed probability/i);
  });
  it("allows more than 3 saved scenarios", () => {
    expect(src).toMatch(/MAX_SCENARIOS\s*=\s*([4-9]|\d{2,})/);
  });
});
