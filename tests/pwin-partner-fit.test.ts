import { describe, it, expect } from "vitest";
import {
  calculatePwin, computePartnershipBonus,
  type PwinContext, type PwinTeamMember,
} from "../src/lib/pwin";

const baseSelf: PwinTeamMember = {
  id: "self", name: "Us", isSelf: true, role: "prime", workShare: 0, active: true,
  certifications: ["SDVOSB"], naicsCodes: ["541512"], contractVehicles: [], pastPerformance: [],
};

const ctx: PwinContext = {
  engagementType: "prime",
  opportunityNaics: ["541512"],
  setAside: "SDVOSB",
};

function partner(over: Partial<PwinTeamMember> = {}): PwinTeamMember {
  return {
    id: "p1", name: "Acme", isSelf: false, role: "sub", workShare: 40, active: true,
    certifications: [], naicsCodes: ["541512"], contractVehicles: [], pastPerformance: [],
    ...over,
  };
}

describe("computePartnershipBonus", () => {
  it("stacks each established-partner signal with a fixed labelled bonus", () => {
    const { bonus, lines } = computePartnershipBonus(partner({
      isEstablishedPartner: true,
      priorContractTogether: true,
      hasNda: true,
      hasTeamingAgreement: true,
    }));
    expect(lines.map((l) => l.label)).toEqual([
      "Established partner", "Prior contract together",
      "Teaming agreement on file", "NDA on file",
    ]);
    // 10 + 15 + 10 + 5 = 40, capped at 35.
    expect(bonus).toBe(35);
  });

  it("returns zero bonus and no lines when no signals are set", () => {
    const { bonus, lines } = computePartnershipBonus(partner());
    expect(bonus).toBe(0);
    expect(lines).toEqual([]);
  });
});

describe("partner_fit factor", () => {
  it("appears in prime mode and surfaces each established-partner bonus in its explanation", () => {
    const p = partner({
      primeRelationshipStrength: 50,
      isEstablishedPartner: true,
      priorContractTogether: true,
      hasNda: true,
    });
    const res = calculatePwin(ctx, [baseSelf, p]);
    const pf = res.factors.find((f) => f.key === "partner_fit");
    expect(pf, "partner_fit factor should be present in prime mode").toBeDefined();
    // Base 50 + 10 + 15 + 5 = 80
    expect(pf!.score).toBe(80);
    expect(pf!.explanation).toMatch(/Established partner: \+10/);
    expect(pf!.explanation).toMatch(/Prior contract together: \+15/);
    expect(pf!.explanation).toMatch(/NDA on file: \+5/);
    expect(pf!.explanation).toMatch(/base 50/);
  });

  it("is not present in sub mode (prime_relationship covers it)", () => {
    const subCtx: PwinContext = { ...ctx, engagementType: "sub" };
    const prime = partner({ role: "prime", primeRelationshipStrength: 40 });
    const res = calculatePwin(subCtx, [baseSelf, prime]);
    expect(res.factors.find((f) => f.key === "partner_fit")).toBeUndefined();
    const pr = res.factors.find((f) => f.key === "prime_relationship");
    expect(pr).toBeDefined();
  });

  it("higher partnership signals produce a strictly higher pWin (all else equal)", () => {
    const cold = partner({ primeRelationshipStrength: 0 });
    const warm = partner({
      primeRelationshipStrength: 0,
      isEstablishedPartner: true,
      priorContractTogether: true,
      hasTeamingAgreement: true,
    });
    const coldRes = calculatePwin(ctx, [baseSelf, cold]);
    const warmRes = calculatePwin(ctx, [baseSelf, warm]);
    expect(warmRes.pwin).toBeGreaterThan(coldRes.pwin);
  });

  it("solo bid returns a neutral partner_fit factor", () => {
    const res = calculatePwin(ctx, [baseSelf]);
    const pf = res.factors.find((f) => f.key === "partner_fit")!;
    expect(pf.score).toBe(60);
    expect(pf.explanation).toMatch(/solo bid/i);
  });
});

describe("prime_relationship factor in sub mode", () => {
  it("adds the established-partner bonus on top of baseline strength and shows breakdown", () => {
    const subCtx: PwinContext = { ...ctx, engagementType: "sub" };
    const prime = partner({
      role: "prime",
      primeRelationshipStrength: 60,
      isEstablishedPartner: true,
      hasTeamingAgreement: true,
    });
    const res = calculatePwin(subCtx, [baseSelf, prime]);
    const pr = res.factors.find((f) => f.key === "prime_relationship")!;
    // 60 + 10 + 10 = 80
    expect(pr.score).toBe(80);
    expect(pr.explanation).toMatch(/Established partner: \+10/);
    expect(pr.explanation).toMatch(/Teaming agreement on file: \+10/);
  });
});

describe("weights still sum to ~1 with partner_fit added", () => {
  it("prime mode", () => {
    const res = calculatePwin(ctx, [baseSelf, partner({ isEstablishedPartner: true })]);
    const total = res.factors.reduce((s, f) => s + f.weight, 0);
    expect(total).toBeGreaterThan(0.98);
    expect(total).toBeLessThan(1.02);
  });
});
