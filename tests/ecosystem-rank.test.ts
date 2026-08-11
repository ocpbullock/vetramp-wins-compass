import { describe, it, expect } from "vitest";
import {
  buildEcosystem,
  recencyBandWeight,
  type ScopedAward,
  type BuildEcosystemInputs,
} from "../src/lib/ecosystem-rank";

const NOW = new Date("2026-06-01T00:00:00Z");

function award(over: Partial<ScopedAward> = {}): ScopedAward {
  return {
    "Recipient Name": "Acme",
    "Recipient UEI": "UEI-ACME",
    "Awarding Agency": "Department of Veterans Affairs",
    "Awarding Sub Agency": "Veterans Health Administration",
    "Start Date": "2025-01-01",
    "Award Amount": 5_000_000,
    "Type of Set Aside": "",
    NAICS: "541512",
    Description: "cloud migration and systems integration support",
    scope: "customer",
    ...over,
  } as ScopedAward;
}

function base(over: Partial<BuildEcosystemInputs> = {}): BuildEcosystemInputs {
  return {
    awards: [],
    vehicleAwardees: null,
    vehicleRestricted: false,
    opportunity: {
      naicsCode: "541512",
      adjacentPrefix: "5415",
      setAside: null,
      estimatedValue: 5_000_000,
      agency: "Department of Veterans Affairs",
      customerSubAgency: "Veterans Health Administration",
      scopeKeywords: ["cloud migration"],
    },
    now: NOW,
    ...over,
  };
}

function find(res: ReturnType<typeof buildEcosystem>, name: string) {
  return res.companies.find((c) => c.name === name)!;
}

describe("recencyBandWeight", () => {
  it("bands by age", () => {
    expect(recencyBandWeight(1)).toBe(1);
    expect(recencyBandWeight(4.5)).toBe(0.6);
    expect(recencyBandWeight(7)).toBe(0.3);
    expect(recencyBandWeight(10)).toBe(0);
  });

  it("keeps >8yr awards for the incumbent or a firm with continuing work", () => {
    expect(recencyBandWeight(10, { isIncumbent: true })).toBe(0.3);
    expect(recencyBandWeight(10, { hasRecentWork: true })).toBe(0.3);
  });
});

describe("buildEcosystem", () => {
  it("applies the vehicle gate to prime roles but not coalition roles", () => {
    const res = buildEcosystem(
      base({
        vehicleRestricted: true,
        vehicleAwardees: [{ name: "OnVehicle Inc", uei: "UEI-ON", small_business: true }],
        awards: [
          award({ "Recipient Name": "OnVehicle Inc", "Recipient UEI": "UEI-ON" }),
          award({ "Recipient Name": "OffVehicle Inc", "Recipient UEI": "UEI-OFF" }),
        ],
        opportunity: { ...base().opportunity, setAside: "SBA" },
      }),
    );
    expect(find(res, "OnVehicle Inc").role).toBe("likely_prime_competitor");
    const off = find(res, "OffVehicle Inc");
    expect(off.role).toBe("coalition_partner");
    expect(off.eligibilityReasons.join(" ")).toMatch(/cannot prime/i);
  });

  it("marks a set-aside mismatch as not_eligible", () => {
    const res = buildEcosystem(
      base({
        vehicleAwardees: [
          { name: "BigCo", uei: "UEI-BIG", small_business: false, socioeconomic: [] },
          { name: "SDV Co", uei: "UEI-SDV", small_business: true, socioeconomic: ["WOSB"] },
        ],
        awards: [award({ "Recipient Name": "BigCo", "Recipient UEI": "UEI-BIG" })],
        opportunity: { ...base().opportunity, setAside: "SDVOSB Set-Aside" },
      }),
    );
    expect(find(res, "BigCo").eligibility).toBe("not_eligible");
    // socioeconomic list present but lacking SDVOSB
    expect(find(res, "SDV Co").eligibility).toBe("not_eligible");
  });

  it("validatedOverrides win over computed tiers", () => {
    const res = buildEcosystem(
      base({
        vehicleAwardees: [{ name: "BigCo", uei: "UEI-BIG", small_business: false }],
        awards: [award({ "Recipient Name": "BigCo", "Recipient UEI": "UEI-BIG" })],
        opportunity: { ...base().opportunity, setAside: "SBA" },
        validatedOverrides: { BigCo: "validated" },
      }),
    );
    expect(find(res, "BigCo").eligibility).toBe("validated");
  });

  it("drops stale awards unless the company is the incumbent", () => {
    const stale = { "Start Date": "2014-01-01" } as Partial<ScopedAward>;
    const res = buildEcosystem(
      base({
        awards: [
          award({ "Recipient Name": "StaleCo", "Recipient UEI": "UEI-ST", ...stale }),
          award({ "Recipient Name": "OldIncumbent", "Recipient UEI": "UEI-OI", ...stale }),
        ],
        userIntel: { knownIncumbent: "OldIncumbent" },
      }),
    );
    expect(find(res, "StaleCo").evidence.customerAwards).toBe(0);
    expect(find(res, "OldIncumbent").evidence.customerAwards).toBe(1);
    expect(find(res, "OldIncumbent").role).toBe("incumbent");
  });

  it("renormalizes weights when estimatedValue is unknown", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "Acme" })],
        opportunity: { ...base().opportunity, estimatedValue: null },
      }),
    );
    const acme = find(res, "Acme");
    expect(acme.factorBreakdown.some((f) => f.key === "contract_size")).toBe(false);
    const total = acme.factorBreakdown.reduce((s, f) => s + f.weight, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it("keeps known competitors past the 18-company cap", () => {
    const filler: ScopedAward[] = Array.from({ length: 30 }, (_, i) =>
      award({ "Recipient Name": `Filler ${i}`, "Recipient UEI": `UEI-F${i}` }),
    );
    const res = buildEcosystem(
      base({
        awards: [
          ...filler,
          award({
            "Recipient Name": "Rival Corp",
            "Recipient UEI": "UEI-RV",
            "Award Amount": 1_000,
            "Start Date": "2019-01-01",
            NAICS: "999999",
            Description: "",
          }),
        ],
        userIntel: {
          knownCompetitors: [
            "Rival Corp",
            ...Array.from({ length: 19 }, (_, i) => `Known ${i}`),
          ],
        },
      }),
    );
    expect(res.companies.length).toBeGreaterThan(18);
    expect(find(res, "Rival Corp").role).toBe("known_competitor");
    expect(res.companies[0].name).toBe("Rival Corp");
  });

  it("classifies adjacent-NAICS-only evidence as a dark horse", () => {
    const res = buildEcosystem(
      base({
        awards: [
          award({ "Recipient Name": "AdjacentCo", "Recipient UEI": "UEI-ADJ", NAICS: "541519" }),
          award({ "Recipient Name": "DirectCo", "Recipient UEI": "UEI-DIR", NAICS: "541512" }),
        ],
      }),
    );
    expect(find(res, "AdjacentCo").role).toBe("dark_horse");
    expect(find(res, "DirectCo").role).not.toBe("dark_horse");
  });

  it("dedupes a user-known name that also appears on the vehicle", () => {
    const res = buildEcosystem(
      base({
        vehicleRestricted: true,
        vehicleAwardees: [{ name: "Rival Corporation, Inc.", uei: "UEI-RV", small_business: true }],
        awards: [award({ "Recipient Name": "Rival Corp", "Recipient UEI": "UEI-RV" })],
        userIntel: { knownCompetitors: ["Rival Corp"] },
      }),
    );
    const matches = res.companies.filter((c) => /rival/i.test(c.name));
    expect(matches).toHaveLength(1);
    expect(matches[0].role).toBe("known_competitor");
    expect(matches[0].onVehicle).toBe(true);
  });

  it("flags expansion when too few credible companies are found", () => {
    const res = buildEcosystem(base({ awards: [award()] }));
    expect(res.needsExpansion).toBe("adjacent_naics");
    expect(res.summary.primeCompetitorCount).toBeGreaterThanOrEqual(0);
  });
});
