// Regression suite for the Teaming / PWIN workflow.
//
// Combines:
//   - functional pwin & partner-suggest tests (scoring sensitivity, team isolation)
//   - static-analysis checks for RLS, auth gating, and team_id scoping
//
// Covers:
//   1. PWIN sensitivity to role, workshare, engagement, past performance, vehicles
//   2. Proposal-scoped access on teaming_partners / scenarios / outreach drafts
//   3. Team A partners never surface in Team B suggestions
//   4. Outreach generation requires auth + proposal access
//   5. Scenarios + outreach drafts are proposal-scoped
//   6. Existing proposal sharing across teammates still works
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculatePwin,
  type PwinContext,
  type PwinTeamMember,
} from "../src/lib/pwin";
import {
  rankPartnerSuggestions,
  type SuggestContext,
  type SuggestPartner,
  type SuggestSelf,
} from "../src/lib/partner-suggest";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const migrations = () =>
  readdirSync(resolve(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(`supabase/migrations/${f}`))
    .join("\n");

// ---------- shared PWIN fixtures ----------
const self: PwinTeamMember = {
  id: "self", name: "Us", isSelf: true, role: "prime", workShare: 0, active: true,
  certifications: ["SDVOSB"], naicsCodes: ["541512"], contractVehicles: ["GSA MAS"],
  pastPerformance: [{ naics: "541512", agency: "VA", end: "2024-01-01", keywords: ["cyber"] }],
};
const partner: PwinTeamMember = {
  id: "p1", name: "Acme", isSelf: false, role: "sub", workShare: 30, active: true,
  certifications: ["8(A)"], naicsCodes: ["541512", "541611"], contractVehicles: ["SEWP V"],
  pastPerformance: [{ naics: "541611", agency: "VA", end: "2024-06-01", keywords: ["mgmt"] }],
  primeRelationshipStrength: 70,
};
const ctx: PwinContext = {
  engagementType: "prime",
  opportunityNaics: ["541512", "541611"],
  setAside: "SDVOSB",
  requiredVehicles: ["GSA MAS"],
  scopeKeywords: ["cyber"],
};

// ---------- 1. PWIN sensitivity ----------
describe("PWIN scoring sensitivity", () => {
  it("changes when partner is added vs removed from the team", () => {
    const solo = calculatePwin(ctx, [self]);
    const teamed = calculatePwin(ctx, [self, partner]);
    expect(solo.pwin).not.toEqual(teamed.pwin);
    // partner brings NAICS coverage + a second cert
    const sNaics = solo.factors.find((f) => f.key === "naics_coverage")!.score;
    const tNaics = teamed.factors.find((f) => f.key === "naics_coverage")!.score;
    expect(tNaics).toBeGreaterThanOrEqual(sNaics);
  });

  it("changes when workshare allocation changes", () => {
    const low = calculatePwin(ctx, [self, { ...partner, workShare: 10 }]);
    const high = calculatePwin(ctx, [self, { ...partner, workShare: 60 }]);
    expect(low.selfShare).not.toEqual(high.selfShare);
    expect(low.totalPartnerShare).toBe(10);
    expect(high.totalPartnerShare).toBe(60);
  });

  it("changes when engagement model changes (prime vs sub_to_prime)", () => {
    const asPrime = calculatePwin(ctx, [self, partner]);
    const asSub = calculatePwin(
      { ...ctx, engagementType: "sub", relationshipModel: "sub_to_prime" },
      [self, { ...partner, role: "prime", primeRelationshipStrength: 90 }],
    );
    expect(asPrime.pwin).not.toEqual(asSub.pwin);
    const ppPrime = asPrime.factors.find((f) => f.key === "prime_relationship")?.weight ?? 0;
    const ppSub = asSub.factors.find((f) => f.key === "prime_relationship")?.weight ?? 0;
    expect(ppSub).toBeGreaterThan(ppPrime);
  });

  it("rewards stronger past performance", () => {
    const weak = calculatePwin(ctx, [{ ...self, pastPerformance: [] }, partner]);
    const strong = calculatePwin(ctx, [self, partner]);
    const wF = weak.factors.find((f) => f.key === "past_performance")!;
    const sF = strong.factors.find((f) => f.key === "past_performance")!;
    expect(sF.score).toBeGreaterThan(wF.score);
  });

  it("rewards required vehicle access", () => {
    const without = calculatePwin(ctx, [{ ...self, contractVehicles: [] }, { ...partner, contractVehicles: [] }]);
    const withV = calculatePwin(ctx, [self, partner]);
    const wF = without.factors.find((f) => f.key === "vehicle_access")!;
    const vF = withV.factors.find((f) => f.key === "vehicle_access")!;
    expect(vF.score).toBeGreaterThan(wF.score);
  });
});

// ---------- 2. RLS gating on teaming + scenarios + outreach ----------
describe("RLS gates teaming/scenario/outreach to proposal viewers", () => {
  const sql = migrations();

  it("proposal_teaming policies use user_can_see_proposal", () => {
    for (const v of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(sql).toMatch(new RegExp(
        `CREATE POLICY[^;]+proposal_teaming FOR ${v}[\\s\\S]*user_can_see_proposal\\(proposal_id, auth\\.uid\\(\\)\\)`,
      ));
    }
  });

  it("pwin_scenarios policies use user_can_see_proposal", () => {
    for (const v of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(sql).toMatch(new RegExp(
        `CREATE POLICY[^;]+pwin_scenarios FOR ${v}[\\s\\S]*user_can_see_proposal\\(proposal_id, auth\\.uid\\(\\)\\)`,
      ));
    }
  });

  it("proposal_outreach_drafts policies use user_can_see_proposal", () => {
    for (const v of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(sql).toMatch(new RegExp(
        `CREATE POLICY[^;]+proposal_outreach_drafts FOR ${v}[\\s\\S]*user_can_see_proposal\\(proposal_id, auth\\.uid\\(\\)\\)`,
      ));
    }
  });

  it("teaming_partners SELECT is gated by team membership", () => {
    expect(sql).toMatch(/teaming_partners[\s\S]*FOR SELECT[\s\S]*is_team_member\(team_id, auth\.uid\(\)\)/);
  });

  it("pwin_scenarios + outreach drafts require created_by/generated_by = auth.uid() on INSERT", () => {
    expect(sql).toMatch(/pwin_scenarios FOR INSERT[\s\S]*created_by = auth\.uid\(\)/);
    expect(sql).toMatch(/proposal_outreach_drafts FOR INSERT[\s\S]*generated_by = auth\.uid\(\)/);
  });
});

// ---------- 3. Team A partner cannot leak into Team B ----------
describe("partner suggestions are team-scoped", () => {
  const baseSelf: SuggestSelf = { certifications: [], naics_codes: [], contract_vehicles: [] };
  const sctx: SuggestContext = { engagementType: "prime", opportunityNaics: ["541512"] };
  const partnerA: SuggestPartner = {
    id: "A", company_name: "Team-A Partner",
    certifications: ["SDVOSB"], naics_codes: ["541512"], contract_vehicles: [],
    capabilities_summary: "cyber", past_performance_summary: null, notes: null,
    relationship_status: "active",
  };
  const partnerB: SuggestPartner = { ...partnerA, id: "B", company_name: "Team-B Partner" };

  it("ranking only sees the partners passed in (team filtering happens at the query layer)", () => {
    // Simulate query for Team B: only Team B's roster is passed in.
    const out = rankPartnerSuggestions(sctx, baseSelf, [partnerB]);
    expect(out.map((s) => s.partnerId)).toEqual(["B"]);
    expect(out.find((s) => s.partnerId === "A")).toBeUndefined();
  });

  it("every companies-roster query in UI components filters by team_id", () => {
    const files = [
      "src/components/proposals/TeamingCard.tsx",
      "src/components/proposals/TeamCompositionAnalyzer.tsx",
      "src/components/proposals/SuggestedPartnersCard.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      // Components now load partners via listPartnerCompanies(teamId!) from @/lib/companies.
      expect(src, `${f} should pull partners from companies via lib helper`).toMatch(
        /listPartnerCompanies\(\s*teamId!?\s*\)/,
      );
      // queries must be gated on a truthy teamId
      expect(src).toMatch(/enabled:\s*!!\s*teamId/);
      // and the legacy table name must not appear anywhere in component src
      expect(src).not.toMatch(/from\(["']teaming_partners["']\)/);
    }
  });
});

// ---------- 4. Outreach edge function requires auth + proposal access ----------
describe("generate-teaming-outreach auth + proposal-access gating", () => {
  const src = read("supabase/functions/generate-teaming-outreach/index.ts");

  it("calls authenticate(req) before any business logic", () => {
    const authIdx = src.indexOf("authenticate(req)");
    const aiIdx = src.indexOf("callAI(");
    expect(authIdx).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(authIdx);
  });

  it("resolves team and asserts proposal access before generating", () => {
    expect(src).toMatch(/resolveTeamId\(ctx,\s*teamId/);
    expect(src).toMatch(/assertProposalAccess\(ctx,\s*proposalId\)/);
    const guardIdx = src.indexOf("assertProposalAccess");
    const aiIdx = src.indexOf("callAI(");
    expect(guardIdx).toBeLessThan(aiIdx);
  });

  it("uses verifiedTeamId (not raw teamId) for cache scoping", () => {
    expect(src).toMatch(/getCachedResponse\([^)]*verifiedTeamId\)/);
    expect(src).toMatch(/setCachedResponse[\s\S]{0,200}teamId:\s*verifiedTeamId/);
  });

  it("returns auth error responses (401/403) via authErrorResponse", () => {
    expect(src).toMatch(/authErrorResponse/);
  });
});

// ---------- 5. Proposal-scoped storage of scenarios + outreach ----------
describe("scenarios and outreach drafts are proposal-scoped", () => {
  const sql = migrations();
  it("pwin_scenarios.proposal_id is NOT NULL and FK CASCADE", () => {
    expect(sql).toMatch(/proposal_id uuid NOT NULL REFERENCES public\.proposals\(id\) ON DELETE CASCADE/);
  });
  it("proposal_outreach_drafts.proposal_id is NOT NULL and FK CASCADE", () => {
    // covered indirectly by the outreach-drafts test, but we re-assert here.
    const m = sql.match(/CREATE TABLE[^;]*proposal_outreach_drafts[\s\S]*?\);/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/proposal_id uuid NOT NULL REFERENCES public\.proposals\(id\) ON DELETE CASCADE/);
  });
});

// ---------- 6. Existing proposal sharing across teammates ----------
describe("proposals remain visible to teammates and opportunity team members", () => {
  it("user_can_see_proposal is the gate across teaming/scenarios/outreach/milestones/attachments", () => {
    const sql = migrations();
    // Same security-definer function used everywhere proposal-scoped tables enforce access.
    for (const table of [
      "proposal_teaming",
      "pwin_scenarios",
      "proposal_outreach_drafts",
      "proposal_milestones",
      "proposal_attachments",
    ]) {
      expect(sql, `${table} should be gated by user_can_see_proposal`).toMatch(
        new RegExp(`${table}[\\s\\S]*user_can_see_proposal\\(proposal_id, auth\\.uid\\(\\)\\)`),
      );
    }
  });

  it("proposals SELECT policy still exposes proposals to team + opportunity-team members", () => {
    const sql = migrations();
    expect(sql).toMatch(
      /CREATE POLICY[^;]*proposals FOR SELECT[\s\S]*is_team_member\(team_id, auth\.uid\(\)\)[\s\S]*is_team_member\(opportunity_team_id, auth\.uid\(\)\)/,
    );
  });
});
