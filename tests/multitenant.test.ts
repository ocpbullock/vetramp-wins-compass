// Multi-tenant isolation invariants.
//
// Static-analysis style — the edge functions can't execute under Node
// (they import Deno URL modules), so we read the sources and assert the
// ordering / scoping properties that, if broken, would let one team
// read or overwrite another team's data.
//
// Scenario covered:
//   - Team A and Team B each own proposal / KB / attachments / cache / AI rows.
//   - "Outsider" belongs to neither.
//   - "Partner" is invited only to one opportunity team (child of an org).
//
// We check the source code of every service-role edge function and every
// relevant RLS policy migration to make sure:
//   1. Authentication happens before any service-role read/write.
//   2. teamId / proposalId from the request body is verified via
//      assertTeamMember / resolveTeamId / assertProposalAccess BEFORE
//      it's used to scope a query or written into a row.
//   3. Cache rows use the verified team id, never the raw body field.
//   4. RLS policies on team-scoped tables actually check is_team_member.
//   5. Partner scoping: only knowledge_base / past_performance /
//      contract_vehicles widen to parent org via has_opp_team_access_to_org;
//      cache / AI usage / starred opportunities / teaming partners do NOT.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

// All service-role edge functions in scope of the security hardening.
const SERVICE_ROLE_FUNCTIONS = [
  "competitive-intel",
  "customer-intel",
  "generate-proposal",
  "generate-proposal-section",
  "ingest-knowledge",
  "parse-sow",
  "sam-attachments",
  "search-entities",
  "search-sam",
  "search-usaspending",
];

describe("multi-tenant: edge functions authenticate before service-role use", () => {
  for (const fn of SERVICE_ROLE_FUNCTIONS) {
    it(`${fn}: authenticate(req) runs before ctx.admin / supabaseAdmin`, () => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      const authIdx = src.indexOf("authenticate(req)");
      expect(authIdx, "authenticate must be called").toBeGreaterThan(-1);

      // Find the earliest reference to the service-role client.
      const candidates = [
        src.indexOf("ctx.admin"),
        src.indexOf("supabaseAdmin"),
      ].filter((i) => i > -1);
      if (candidates.length === 0) return; // function may not need admin
      const firstAdminUse = Math.min(...candidates);
      expect(
        firstAdminUse,
        "service-role client must be used only after authenticate()",
      ).toBeGreaterThan(authIdx);
    });
  }
});

describe("multi-tenant: teamId from body is verified before being used", () => {
  it("competitive-intel: assertTeamMember runs before reading/writing cache", () => {
    const src = read("supabase/functions/competitive-intel/index.ts");
    const assertIdx = src.indexOf("assertTeamMember(ctx, teamId)");
    const firstTeamFilter = src.search(/\.eq\(["']team_id["']\s*,\s*teamId\)/);
    const firstTeamWrite = src.search(/team_id:\s*teamId/);
    expect(assertIdx).toBeGreaterThan(-1);
    expect(firstTeamFilter).toBeGreaterThan(assertIdx);
    expect(firstTeamWrite).toBeGreaterThan(assertIdx);
  });

  for (const fn of [
    "customer-intel",
    "generate-proposal",
    "generate-proposal-section",
    "ingest-knowledge",
    "search-entities",
    "search-sam",
    "search-usaspending",
  ]) {
    it(`${fn}: passes body teamId through resolveTeamId, not directly`, () => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).toMatch(/resolveTeamId\(ctx,\s*teamId\s*\?\?\s*null\)/);
    });
  }
});

describe("multi-tenant: cache + AI writes use the VERIFIED team id", () => {
  it("customer-intel cache + logUsage use verifiedTeamId", () => {
    const src = read("supabase/functions/customer-intel/index.ts");
    // Both setCachedResponse and callAI receive verifiedTeamId, not raw teamId.
    const matches = src.match(/teamId:\s*verifiedTeamId/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // And the cache lookup uses verifiedTeamId.
    expect(src).toMatch(/getCachedResponse\([^)]*verifiedTeamId\)/);
  });

  it("generate-proposal-section cache + logUsage use verifiedTeamId", () => {
    const src = read("supabase/functions/generate-proposal-section/index.ts");
    expect(src).toMatch(/teamId:\s*verifiedTeamId/);
    // Knowledge base context is scoped to verifiedTeamId, not body teamId.
    expect(src).toMatch(/fetchKnowledgeContext\([^)]*verifiedTeamId\)/);
  });

  it("generate-proposal logUsage uses verifiedTeamId", () => {
    const src = read("supabase/functions/generate-proposal/index.ts");
    expect(src).toMatch(/teamId:\s*verifiedTeamId/);
  });

  it("parse-sow scopes cache + AI to proposal.team_id (server-verified), not body", () => {
    const src = read("supabase/functions/parse-sow/index.ts");
    // The teamId used downstream is sourced from the proposal row, not the body.
    expect(src).toMatch(/const\s+teamId\s*=\s*proposal\.team_id/);
    // Body parse intentionally does NOT pull teamId out — only proposalId.
    expect(src).toMatch(/const\s*\{\s*proposalId\s*,\s*skipCache\s*\}\s*=\s*await req\.json/);
  });

  it("ingest-knowledge insert payload uses verifiedTeamId + ctx.user.id", () => {
    const src = read("supabase/functions/ingest-knowledge/index.ts");
    expect(src).toMatch(/team_id:\s*verifiedTeamId/);
    expect(src).toMatch(/user_id:\s*ctx\.user\.id/);
  });
});

describe("multi-tenant: proposalId from body is verified before any write", () => {
  it("parse-sow: assertProposalAccess runs before any parsing_status update", () => {
    const src = read("supabase/functions/parse-sow/index.ts");
    const accessIdx = src.indexOf("assertProposalAccess(ctx, proposalId)");
    const updates = [...src.matchAll(/\.from\(["']proposals["']\)\.update\(/g)];
    expect(accessIdx).toBeGreaterThan(-1);
    expect(updates.length).toBeGreaterThan(0);
    for (const m of updates) {
      expect(m.index!).toBeGreaterThan(accessIdx);
    }
  });

  it("sam-attachments: assertProposalAccess runs before download/insert", () => {
    const src = read("supabase/functions/sam-attachments/index.ts");
    const accessIdx = src.indexOf("assertProposalAccess(ctx, proposalId)");
    const downloadIdx = src.indexOf("storage.from");
    const insertIdx = src.indexOf('.from("proposal_attachments").insert');
    expect(accessIdx).toBeGreaterThan(-1);
    if (downloadIdx > -1) expect(downloadIdx).toBeGreaterThan(accessIdx);
    if (insertIdx > -1) expect(insertIdx).toBeGreaterThan(accessIdx);
  });
});

describe("multi-tenant: RLS policies on team-scoped tables", () => {
  // Concatenate every migration file so we can grep policies regardless of
  // which migration created them.
  const migrations = (() => {
    const dir = resolve(root, "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    return files.map((f) => read(`supabase/migrations/${f}`)).join("\n");
  })();

  // Tables that must NEVER widen access to opportunity-team children of a
  // parent org. A partner invited only to one opportunity must NOT be able
  // to read these for the parent org.
  const STRICT_TEAM_TABLES = [
    "ai_response_cache",
    "cached_searches",
    "cached_competitive_intel",
    "tango_cached_opportunities",
    "tango_cached_entities",
    "tango_cached_contracts",
  ];

  for (const table of STRICT_TEAM_TABLES) {
    it(`${table}: SELECT policy gates on is_team_member, not has_opp_team_access_to_org`, () => {
      // Find every SELECT policy block on this table and assert isolation.
      const policyRegex = new RegExp(
        `(CREATE|create)\\s+POLICY[\\s\\S]*?ON\\s+public\\.${table}[\\s\\S]*?FOR\\s+SELECT[\\s\\S]*?;`,
        "gi",
      );
      const blocks = migrations.match(policyRegex) || [];
      expect(blocks.length, `${table} should have at least one SELECT policy`).toBeGreaterThan(0);
      for (const b of blocks) {
        expect(b).toMatch(/is_team_member/);
        // No partner-widening allowed on these tables.
        expect(b).not.toMatch(/has_opp_team_access_to_org/);
      }
    });
  }

  it("knowledge_base: SELECT widens to parent org for opportunity-team partners (by design)", () => {
    // This is the *intentional* shared-knowledge path. Lock the design in.
    expect(migrations).toMatch(
      /CREATE POLICY[\s\S]*knowledge_base[\s\S]*FOR SELECT[\s\S]*has_opp_team_access_to_org/i,
    );
  });

  it("proposals: SELECT allows opportunity-team members only via opportunity_team_id", () => {
    // A partner sees a proposal only when opportunity_team_id matches a team
    // they belong to — not when they happen to be in some unrelated team.
    expect(migrations).toMatch(
      /proposals[\s\S]*FOR SELECT[\s\S]*opportunity_team_id[\s\S]*is_team_member\(opportunity_team_id/i,
    );
  });

  it("proposal_attachments: every CRUD policy delegates to user_can_see_proposal", () => {
    const blocks =
      migrations.match(
        /CREATE POLICY[\s\S]*?ON\s+public\.proposal_attachments[\s\S]*?;/gi,
      ) || [];
    expect(blocks.length).toBeGreaterThanOrEqual(3); // select/insert/delete
    for (const b of blocks) {
      expect(b).toMatch(/user_can_see_proposal/);
    }
  });

  it("proposal-attachments storage policies are scoped by user_can_see_proposal", () => {
    // The 20260519... migration adds proposals/{proposalId}/ storage RLS so
    // opportunity-team collaborators can read attachments via the bucket.
    expect(migrations).toMatch(
      /storage\.objects[\s\S]*proposal-attachments[\s\S]*user_can_see_proposal/i,
    );
  });
});

describe("multi-tenant: outsider has no path into team data", () => {
  it("auth helper returns 401 before any team membership check", () => {
    const src = read("supabase/functions/_shared/auth.ts");
    // authenticate() throws AuthError(401) before exporting the user — the
    // assert* helpers are only callable on a valid AuthContext.
    expect(src).toMatch(
      /export async function authenticate[\s\S]*AuthError\(401[\s\S]*return\s*\{\s*user:/,
    );
    // assertTeamMember requires a teamId and returns 403 on miss — no path
    // for an outsider to silently succeed.
    expect(src).toMatch(
      /export async function assertTeamMember[\s\S]*AuthError\(403,\s*["']Not a member of this team["']\)/,
    );
  });
});
