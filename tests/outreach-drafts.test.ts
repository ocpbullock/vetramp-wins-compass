// Static-analysis invariants for proposal_outreach_drafts table + RLS.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const migrations = () =>
  readdirSync(resolve(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(`supabase/migrations/${f}`))
    .join("\n");

describe("proposal_outreach_drafts schema invariants", () => {
  const sql = migrations();

  it("table is created", () => {
    expect(sql).toMatch(/CREATE TABLE[^;]*public\.proposal_outreach_drafts/);
  });

  it("proposal_id is required and cascades on delete", () => {
    expect(sql).toMatch(
      /proposal_id uuid NOT NULL REFERENCES public\.proposals\(id\) ON DELETE CASCADE/,
    );
  });

  it("partner_id sets null when partner is removed", () => {
    expect(sql).toMatch(/partner_id uuid REFERENCES public\.teaming_partners\(id\) ON DELETE SET NULL/);
  });

  it("generated_by is required (audit field)", () => {
    expect(sql).toMatch(/generated_by uuid NOT NULL/);
  });

  it("outreach_type allows all four supported variants", () => {
    expect(sql).toMatch(/outreach_type[\s\S]*'email'[\s\S]*'briefing'[\s\S]*'call_script'[\s\S]*'linkedin'/);
  });

  it("status allows the four documented values", () => {
    expect(sql).toMatch(/status[\s\S]*'draft'[\s\S]*'copied'[\s\S]*'sent_externally'[\s\S]*'archived'/);
  });

  it("relationship_model is constrained", () => {
    expect(sql).toMatch(/relationship_model[\s\S]*CHECK[\s\S]*'prime_with_subs'[\s\S]*'mentor_protege'/);
  });

  it("RLS is enabled", () => {
    expect(sql).toMatch(/ALTER TABLE public\.proposal_outreach_drafts ENABLE ROW LEVEL SECURITY/);
  });

  it("all four RLS policies gate on user_can_see_proposal", () => {
    for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const re = new RegExp(
        `CREATE POLICY[^;]+proposal_outreach_drafts FOR ${verb}[\\s\\S]*user_can_see_proposal\\(proposal_id, auth\\.uid\\(\\)\\)`,
      );
      expect(sql, `missing user_can_see_proposal gate on ${verb} policy`).toMatch(re);
    }
  });

  it("INSERT policy also enforces generated_by = auth.uid()", () => {
    expect(sql).toMatch(
      /CREATE POLICY[^;]+proposal_outreach_drafts FOR INSERT[\s\S]*generated_by = auth\.uid\(\)/,
    );
  });

  it("updated_at trigger is wired", () => {
    expect(sql).toMatch(/update_proposal_outreach_drafts_updated_at[\s\S]*update_updated_at_column/);
  });
});

describe("outreach modal queries are proposal-scoped", () => {
  const modal = read("src/components/proposals/TeamingOutreachModal.tsx");

  it("loads history filtered by proposal_id", () => {
    expect(modal).toMatch(/from\(["']proposal_outreach_drafts["'][\s\S]*\.eq\(["']proposal_id["']/);
  });

  it("inserts include proposal_id and generated_by", () => {
    expect(modal).toMatch(/proposal_id: proposal\.id/);
    expect(modal).toMatch(/generated_by: uid/);
  });

  it("status/delete mutations target a specific row id (RLS still gates proposal access)", () => {
    expect(modal).toMatch(/\.update\(\{ status \}\)[\s\S]*\.eq\(["']id["']/);
    expect(modal).toMatch(/\.delete\(\)\.eq\(["']id["']/);
  });
});
