import { describe, it, expect } from "vitest";
import {
  calculatePwin, deriveInsights, engagementForModel, RELATIONSHIP_MODELS,
  type PwinContext, type PwinTeamMember,
} from "../src/lib/pwin";

const self: PwinTeamMember = {
  id: "self", name: "Us", isSelf: true, role: "prime", workShare: 0, active: true,
  certifications: [], naicsCodes: ["541512"], contractVehicles: [], pastPerformance: [],
};
const partner: PwinTeamMember = {
  id: "p1", name: "Acme", isSelf: false, role: "sub", workShare: 40, active: true,
  certifications: ["SDVOSB"], naicsCodes: ["541512"], contractVehicles: [], pastPerformance: [],
  primeRelationshipStrength: 80,
};

const baseCtx: PwinContext = {
  engagementType: "prime",
  opportunityNaics: ["541512"],
  setAside: null,
};

describe("relationship model reweighting", () => {
  it("RELATIONSHIP_MODELS map cleanly to engagement types", () => {
    expect(RELATIONSHIP_MODELS).toHaveLength(5);
    expect(engagementForModel("sub_to_prime")).toBe("sub");
    expect(engagementForModel("niche_sub")).toBe("sub");
    expect(engagementForModel("joint_venture")).toBe("prime");
  });

  it("factor weights still sum to ~1 after model reweight", () => {
    for (const m of RELATIONSHIP_MODELS) {
      const ctx: PwinContext = {
        ...baseCtx,
        engagementType: m.engagement,
        relationshipModel: m.value,
        setAside: "SDVOSB",
      };
      const res = calculatePwin(ctx, [self, { ...partner, role: m.engagement === "sub" ? "prime" : "sub" }]);
      const total = res.factors.reduce((s, f) => s + f.weight, 0);
      expect(total).toBeGreaterThan(0.98);
      expect(total).toBeLessThan(1.02);
    }
  });

  it("sub_to_prime weights prime_relationship heavier than baseline sub", () => {
    const ctxBase: PwinContext = { ...baseCtx, engagementType: "sub", setAside: "SDVOSB" };
    const ctxModel: PwinContext = { ...ctxBase, relationshipModel: "sub_to_prime" };
    const members = [self, { ...partner, role: "prime" as const }];
    const wBase = calculatePwin(ctxBase, members).factors.find((f) => f.key === "prime_relationship")!.weight;
    const wModel = calculatePwin(ctxModel, members).factors.find((f) => f.key === "prime_relationship")!.weight;
    expect(wModel).toBeGreaterThan(wBase);
  });

  it("niche_sub down-weights NAICS coverage", () => {
    const ctxBase: PwinContext = { ...baseCtx, engagementType: "sub" };
    const ctxModel: PwinContext = { ...ctxBase, relationshipModel: "niche_sub" };
    const members = [self, { ...partner, role: "prime" as const }];
    const wBase = calculatePwin(ctxBase, members).factors.find((f) => f.key === "naics_coverage")!.weight;
    const wModel = calculatePwin(ctxModel, members).factors.find((f) => f.key === "naics_coverage")!.weight;
    expect(wModel).toBeLessThan(wBase);
  });

  it("deriveInsights surfaces a recommended action and weaknesses on a weak team", () => {
    const ctx: PwinContext = { ...baseCtx, setAside: "SDVOSB", engagementType: "prime", relationshipModel: "prime_with_subs" };
    const result = calculatePwin(ctx, [{ ...self, certifications: [] }]); // we lack the set-aside
    const insights = deriveInsights(result, "prime_with_subs");
    expect(insights.recommendedAction).toMatch(/socioeconomic|partner|share/i);
    expect(insights.weaknesses.length).toBeGreaterThan(0);
  });

  it("over-allocated teams get an explicit rebalance recommendation", () => {
    const ctx: PwinContext = { ...baseCtx, relationshipModel: "prime_with_subs" };
    const members = [self, { ...partner, workShare: 80 }, { ...partner, id: "p2", workShare: 80 }];
    const result = calculatePwin(ctx, members);
    expect(result.overAllocated).toBe(true);
    expect(deriveInsights(result).recommendedAction).toMatch(/100%/);
  });
});
