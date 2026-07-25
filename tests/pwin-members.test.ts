import { describe, it, expect } from "vitest";
import {
  buildPartnerPwinMember, buildPwinMembers, buildSelfPwinMember,
  deriveRelationshipStrength, mapPartnerPastPerformance,
} from "../src/lib/pwin-members";

describe("mapPartnerPastPerformance", () => {
  it("normalizes company_profile shape", () => {
    const out = mapPartnerPastPerformance([
      { title: "X", customer: "USAF", period: "2022-06-30", summary: "…" },
    ]);
    expect(out[0]).toMatchObject({ agency: "USAF", end: "2022-06-30" });
  });
  it("normalizes past_performance table shape", () => {
    const out = mapPartnerPastPerformance([
      { naics_code: "541512", agency: "DHS", period_of_performance_end: "2024-01-01", relevance_keywords: ["cyber"] },
    ]);
    expect(out[0]).toEqual({ naics: "541512", agency: "DHS", end: "2024-01-01", keywords: ["cyber"] });
  });
  it("returns [] for junk", () => {
    expect(mapPartnerPastPerformance(null)).toEqual([]);
    expect(mapPartnerPastPerformance({})).toEqual([]);
  });
});

describe("deriveRelationshipStrength", () => {
  it("prefers explicit column", () => {
    expect(deriveRelationshipStrength({ id: "1", relationship_strength: 75 })).toBe(75);
  });
  it("falls back to status baseline", () => {
    expect(deriveRelationshipStrength({ id: "1", relationship_status: "active" })).toBe(60);
    expect(deriveRelationshipStrength({ id: "1", relationship_status: "prospective" })).toBe(20);
    expect(deriveRelationshipStrength({ id: "1", relationship_status: "inactive" })).toBe(10);
    expect(deriveRelationshipStrength({ id: "1" })).toBe(0);
  });
});

describe("buildPartnerPwinMember", () => {
  it("propagates NDA/TA/prior-contract/relationship signals + past perf", () => {
    const m = buildPartnerPwinMember({
      id: "p1",
      company_name: "Acme",
      certifications: ["SDVOSB"],
      naics_codes: ["541512"],
      past_performance: [{ naics: "541512", customer: "USAF", end: "2024-01-01" }],
      is_existing_partner: true,
      has_nda: true,
      has_teaming_agreement: true,
      prior_contract_together: true,
      relationship_strength: 80,
    }, { entry: { role: "sub", work_share_pct: 25 } });
    expect(m.isSelf).toBe(false);
    expect(m.role).toBe("sub");
    expect(m.workShare).toBe(25);
    expect(m.hasNda).toBe(true);
    expect(m.hasTeamingAgreement).toBe(true);
    expect(m.priorContractTogether).toBe(true);
    expect(m.isEstablishedPartner).toBe(true);
    expect(m.primeRelationshipStrength).toBe(80);
    expect(m.pastPerformance?.[0]).toMatchObject({ agency: "USAF", end: "2024-01-01" });
    expect(m.active).toBe(true);
  });
  it("worked_together_before implies priorContractTogether", () => {
    const m = buildPartnerPwinMember({ id: "p", company_name: "X", worked_together_before: true });
    expect(m.priorContractTogether).toBe(true);
  });
});

describe("buildPwinMembers", () => {
  const self = {
    company_name: "Us", certifications: ["SDVOSB"], naics_codes: ["541512"], vehicles: [],
    pastPerf: [{ naics: "541512", agency: "USAF", end: "2024-01-01" }],
  };
  const partners = [
    { id: "p1", company_name: "Acme", naics_codes: ["541512"], relationship_status: "active",
      past_performance: [{ naics: "541512", customer: "Navy" }], is_existing_partner: true },
  ];
  it("self share equals 100 minus partner shares (prime)", () => {
    const out = buildPwinMembers({
      self, isSelfPrime: true, partners,
      entries: [{ company_id: "p1", role: "sub", work_share_pct: 30 }],
    });
    expect(out[0].workShare).toBe(70);
    expect(out[1].workShare).toBe(30);
    expect(out[1].primeRelationshipStrength).toBe(60);
    expect(out[1].pastPerformance?.length).toBe(1);
  });

  it("sub mode: self share uses selfWorkSharePct, external prime is synthesized as remainder", () => {
    const out = buildPwinMembers({
      self: { company_name: "Us" },
      isSelfPrime: false,
      partners: [],
      entries: [],
      primeContractorName: "Big Prime LLC",
      selfWorkSharePct: 25,
    });
    expect(out[0].workShare).toBe(25);
    expect(out[0].isSelf).toBe(true);
    const prime = out.find((m) => m.role === "prime");
    expect(prime).toBeTruthy();
    expect(prime!.id).toBe("prime-external");
    expect(prime!.name).toBe("Big Prime LLC");
    expect(prime!.workShare).toBe(75);
  });

  it("sub mode: roster prime gets remainder, no synthetic member added", () => {
    const out = buildPwinMembers({
      self: { company_name: "Us" },
      isSelfPrime: false,
      partners: [
        { id: "prime1", company_name: "Big Prime LLC", naics_codes: ["541512"] },
        { id: "p2", company_name: "Other Sub" },
      ],
      entries: [{ company_id: "p2", role: "sub", work_share_pct: 20 }],
      primeContractorId: "prime1",
      primeContractorName: "Big Prime LLC",
      selfWorkSharePct: 30,
    });
    expect(out.filter((m) => m.role === "prime").length).toBe(1);
    const prime = out.find((m) => m.role === "prime")!;
    expect(prime.id).toBe("prime1");
    expect(prime.workShare).toBe(50); // 100 - 30 (us) - 20 (other sub)
    const us = out.find((m) => m.isSelf)!;
    expect(us.workShare).toBe(30);
  });

  it("sub mode: defaults selfWorkSharePct to 20 when unset", () => {
    const out = buildPwinMembers({
      self: { company_name: "Us" },
      isSelfPrime: false,
      partners: [],
      entries: [],
      primeContractorName: "P",
    });
    expect(out[0].workShare).toBe(20);
  });
});

