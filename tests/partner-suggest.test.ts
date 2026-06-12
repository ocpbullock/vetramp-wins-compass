// Ranking + team-isolation tests for Suggested Teaming Partners.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  rankPartnerSuggestions,
  type SuggestPartner,
  type SuggestSelf,
  type SuggestContext,
} from "../src/lib/partner-suggest";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const baseSelf: SuggestSelf = {
  certifications: ["SDB"],          // we don't hold SDVOSB / 8(a) / WOSB / etc.
  naics_codes: ["541512"],
  contract_vehicles: [],
};

function partner(over: Partial<SuggestPartner> = {}): SuggestPartner {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    company_name: over.company_name ?? "Acme",
    certifications: [],
    naics_codes: [],
    contract_vehicles: [],
    capabilities_summary: null,
    past_performance_summary: null,
    notes: null,
    relationship_status: "active",
    ...over,
  };
}

describe("rankPartnerSuggestions — basic ranking", () => {
  const ctx: SuggestContext = {
    engagementType: "prime",
    opportunityNaics: ["541511", "541512"],
    opportunityAgency: "Department of Veterans Affairs",
    setAside: "SDVOSB",
    requiredVehicles: ["SEWP V"],
    scopeKeywords: ["cloud", "migration", "kubernetes"],
    incumbentName: "Booz Allen",
  };

  it("ranks a strong-fit partner above a sparse one", () => {
    const strong = partner({
      id: "strong", company_name: "VetCloud LLC",
      certifications: ["SDVOSB"],
      naics_codes: ["541511", "541512"],
      contract_vehicles: ["SEWP V"],
      capabilities_summary: "Cloud migration and kubernetes platform engineering for federal customers.",
      past_performance_summary: "Migrated 30 systems for Department of Veterans Affairs; kubernetes rollout.",
    });
    const sparse = partner({ id: "sparse", company_name: "Mystery Co" });
    const out = rankPartnerSuggestions(ctx, baseSelf, [strong, sparse]);
    expect(out[0].partnerId).toBe("strong");
    expect(out[0].fitScore).toBeGreaterThan(out[1].fitScore);
    expect(out[0].confidence).not.toBe("not_enough_data");
  });

  it("marks partners with almost no data as not_enough_data and caps score", () => {
    const sparse = partner({ id: "sparse" });
    const out = rankPartnerSuggestions(ctx, baseSelf, [sparse]);
    expect(out[0].confidence).toBe("not_enough_data");
    expect(out[0].fitScore).toBeLessThanOrEqual(35);
    expect(out[0].reasons.join(" ")).toMatch(/not enough data/i);
  });

  it("picks JV partner when prime-mode and only the partner holds the set-aside", () => {
    const p = partner({
      id: "jv", certifications: ["SDVOSB"],
      naics_codes: ["541511"], capabilities_summary: "cloud team",
    });
    const out = rankPartnerSuggestions(ctx, baseSelf, [p]);
    expect(out[0].bestRole).toBe("jv_partner");
    expect(out[0].gapsCovered.some((g) => /SDVOSB/.test(g))).toBe(true);
  });

  it("excludes partners already on the team by default", () => {
    const a = partner({ id: "a" });
    const b = partner({ id: "b" });
    const out = rankPartnerSuggestions(ctx, baseSelf, [a, b], ["a"]);
    expect(out.map((s) => s.partnerId)).toEqual(["b"]);
  });

  it("flags niche capability role when partner has capability match but no NAICS overlap", () => {
    const p = partner({
      id: "niche",
      certifications: [],
      naics_codes: ["999999"],
      capabilities_summary: "kubernetes specialists",
    });
    const out = rankPartnerSuggestions(ctx, baseSelf, [p]);
    expect(out[0].bestRole).toBe("niche_capability");
    expect(out[0].workshareRange[1]).toBeLessThanOrEqual(20);
  });

  it("flags incumbent partners", () => {
    const p = partner({
      id: "incumbent", company_name: "Booz Allen Hamilton",
      naics_codes: ["541511"],
      capabilities_summary: "cloud migration",
    });
    const out = rankPartnerSuggestions(ctx, baseSelf, [p]);
    expect(out[0].reasons.some((r) => /incumbent/i.test(r))).toBe(true);
    expect(out[0].gapsCovered.some((g) => /incumbent/i.test(g))).toBe(true);
  });

  it("sub-mode: named prime gets prime role and set-aside check", () => {
    const subCtx: SuggestContext = {
      engagementType: "sub",
      opportunityNaics: ["541512"],
      setAside: "8(A)",
      primeContractorName: "BigPrime Corp",
      requiredVehicles: [],
      scopeKeywords: [],
    };
    const prime = partner({
      id: "p", company_name: "BigPrime Corp",
      certifications: ["8(A)"], naics_codes: ["541512"],
    });
    const other = partner({ id: "o", company_name: "SomeoneElse Inc" });
    const out = rankPartnerSuggestions(subCtx, baseSelf, [prime, other]);
    expect(out[0].partnerId).toBe("p");
    expect(out[0].bestRole).toBe("prime");
    expect(out[0].reasons.some((r) => /8\(A\)-certified/.test(r))).toBe(true);
  });

  it("sub-mode: named prime missing set-aside raises a risk", () => {
    const subCtx: SuggestContext = {
      engagementType: "sub", opportunityNaics: ["541512"], setAside: "WOSB",
      primeContractorName: "BigPrime Corp",
    };
    const prime = partner({
      id: "p", company_name: "BigPrime Corp",
      certifications: [], naics_codes: ["541512"],
    });
    const out = rankPartnerSuggestions(subCtx, baseSelf, [prime]);
    expect(out[0].risks.some((r) => /WOSB/.test(r) && /set-aside risk/i.test(r))).toBe(true);
  });

  it("inactive relationship surfaces a risk and penalizes score", () => {
    const active = partner({
      id: "active", naics_codes: ["541511"],
      capabilities_summary: "cloud",
      relationship_status: "active",
    });
    const inactive = partner({
      id: "inactive", naics_codes: ["541511"],
      capabilities_summary: "cloud",
      relationship_status: "inactive",
    });
    const out = rankPartnerSuggestions(ctx, baseSelf, [active, inactive]);
    const a = out.find((s) => s.partnerId === "active")!;
    const i = out.find((s) => s.partnerId === "inactive")!;
    expect(a.fitScore).toBeGreaterThan(i.fitScore);
    expect(i.risks.some((r) => /inactive/i.test(r))).toBe(true);
  });

  it("workshare range is sane for each role", () => {
    const sdvosb = partner({
      id: "j", certifications: ["SDVOSB"], naics_codes: ["541511"],
      capabilities_summary: "cloud kubernetes",
    });
    const out = rankPartnerSuggestions(ctx, baseSelf, [sdvosb]);
    const [lo, hi] = out[0].workshareRange;
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(100);
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it("limit option caps the result count", () => {
    const ps = Array.from({ length: 10 }, (_, i) =>
      partner({ id: `p${i}`, naics_codes: ["541511"], capabilities_summary: "cloud" }));
    const out = rankPartnerSuggestions(ctx, baseSelf, ps, [], { limit: 3 });
    expect(out).toHaveLength(3);
  });
});

describe("Suggested Partners UI — team isolation", () => {
  const src = read("src/components/proposals/SuggestedPartnersCard.tsx");

  it("partner roster comes from companies via listPartnerCompanies(teamId)", () => {
    expect(src).toMatch(/listPartnerCompanies\(\s*teamId!?\s*\)/);
    expect(src).not.toMatch(/from\(["']teaming_partners["']\)/);
  });

  it("company_profile / contract_vehicles queries are team-scoped", () => {
    const profRe = /\.from\(["']company_profile["']\)([\s\S]{0,300})/;
    const vehRe = /\.from\(["']contract_vehicles["']\)([\s\S]{0,300})/;
    expect(src.match(profRe)?.[1]).toMatch(/\.eq\(["']team_id["']/);
    expect(src.match(vehRe)?.[1]).toMatch(/\.eq\(["']team_id["']/);
  });

  it("queries are disabled until teamId is available", () => {
    expect(src).toMatch(/enabled:\s*!!teamId/);
  });
});
