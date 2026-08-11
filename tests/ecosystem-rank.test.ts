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

describe("vehicle_presence factor", () => {
  it("scores an on-vehicle holder with zero award evidence above zero", () => {
    const res = buildEcosystem(
      base({
        awards: [],
        vehicleAwardees: [{ name: "Holder Co", uei: "UEI-H", small_business: true }],
        vehicleRestricted: true,
        opportunity: { ...base().opportunity, vehicleName: "Polaris SDVOSB Pool" },
      }),
    );
    const row = find(res, "Holder Co");
    const f = row.factorBreakdown.find((x) => x.key === "vehicle_presence")!;
    expect(f).toBeTruthy();
    expect(f.score).toBe(1);
    expect(f.evidence).toContain("Polaris SDVOSB Pool");
    expect(row.score!).toBeGreaterThan(0);
    expect(row.score!).toBeCloseTo(f.weight, 0);
  });

  it("gives off-vehicle companies the factor at score 0", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "OffCo", "Recipient UEI": "UEI-OFF" })],
        vehicleAwardees: [{ name: "Holder Co", uei: "UEI-H", small_business: true }],
      }),
    );
    const f = find(res, "OffCo").factorBreakdown.find((x) => x.key === "vehicle_presence")!;
    expect(f.score).toBe(0);
    expect(f.evidence).toBe("Not a vehicle holder");
  });

  it("omits the factor entirely when no vehicle is linked", () => {
    const res = buildEcosystem(base({ awards: [award()] }));
    expect(find(res, "Acme").factorBreakdown.some((f) => f.key === "vehicle_presence")).toBe(false);
  });
});

describe("vehicle holders", () => {
  const holders = Array.from({ length: 25 }, (_, i) => ({
    name: `Holder ${i}`,
    uei: `UEI-H${i}`,
    small_business: null as boolean | null,
    socioeconomic: [] as string[],
  }));

  it("keeps every vehicle holder despite the default cap", () => {
    // 25 holders with no award evidence + 20 award-rich non-holders > cap of 18.
    const awards = Array.from({ length: 20 }, (_, i) =>
      award({ "Recipient Name": `Bidder ${i}`, "Recipient UEI": `UEI-B${i}` }),
    );
    const res = buildEcosystem(base({ awards, vehicleAwardees: holders, vehicleRestricted: true }));
    for (const h of holders) {
      const row = res.companies.find((c) => c.name === h.name);
      expect(row, `${h.name} was dropped by the cap`).toBeTruthy();
      expect(row!.onVehicle).toBe(true);
    }
  });

  it("classifies an SDVOSB-tagged holder as likely on an SDVOSB set-aside and lets it prime", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "Vet Co", "Recipient UEI": "UEI-VET" })],
        vehicleAwardees: [
          { name: "Vet Co", uei: "UEI-VET", small_business: true, socioeconomic: ["SDVOSB"] },
        ],
        vehicleRestricted: true,
        opportunity: { ...base().opportunity, setAside: "SDVOSB Set-Aside" },
      }),
    );
    const row = find(res, "Vet Co");
    expect(row.eligibility).toBe("likely");
    expect(["likely_prime_competitor", "prime_teaming_partner"]).toContain(row.role);
  });

  it("treats unknown small_business as requires_validation, never not_eligible", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "Unknown Co", "Recipient UEI": "UEI-UNK" })],
        vehicleAwardees: [
          { name: "Unknown Co", uei: "UEI-UNK", small_business: null, socioeconomic: [] },
        ],
        vehicleRestricted: true,
        opportunity: { ...base().opportunity, setAside: "Total Small Business Set-Aside" },
      }),
    );
    const row = find(res, "Unknown Co");
    expect(row.eligibility).not.toBe("not_eligible");
    expect(row.eligibility).toBe("requires_validation");
  });
});

describe("demonstrated capacity factor", () => {
  function capacity(res: ReturnType<typeof buildEcosystem>, name: string) {
    return find(res, name).factorBreakdown.find((f) => f.key === "contract_size")!;
  }

  it("annualizes a large estimate by the default 5-year assumption", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "MidCo", "Award Amount": 20_000_000 })],
        opportunity: { ...base().opportunity, estimatedValue: 200_000_000 },
      }),
    );
    const f = capacity(res, "MidCo");
    // 20M vs 40M/yr => ratio 0.5 => 1.0
    expect(f.score).toBe(1);
    expect(f.label).toBe("Demonstrated capacity");
    expect(f.evidence).toMatch(/run-rate/);
  });

  it("uses popMonths when provided", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "MidCo", "Award Amount": 20_000_000 })],
        opportunity: { ...base().opportunity, estimatedValue: 200_000_000, popMonths: 24 },
      }),
    );
    // 20M vs 100M/yr => 0.2 => 0.75
    expect(capacity(res, "MidCo").score).toBe(0.75);
  });

  it("gives tiny-award vendors a 0.1 floor instead of 0", () => {
    const res = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "TinyCo", "Award Amount": 50_000 })],
        opportunity: { ...base().opportunity, estimatedValue: 200_000_000 },
      }),
    );
    expect(capacity(res, "TinyCo").score).toBe(0.1);
  });

  it("hits each band threshold", () => {
    const cases: [number, number][] = [
      [40_000_000, 1],
      [6_000_000, 0.75],
      [2_000_000, 0.5],
      [400_000, 0.25],
    ];
    for (const [amount, expected] of cases) {
      const res = buildEcosystem(
        base({
          awards: [award({ "Recipient Name": "BandCo", "Award Amount": amount })],
          opportunity: { ...base().opportunity, estimatedValue: 200_000_000 },
        }),
      );
      expect(capacity(res, "BandCo").score, `amount ${amount}`).toBe(expected);
    }
  });

  it("does not penalize oversized performers until 20x", () => {
    const big = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "BigCo", "Award Amount": 400_000_000 })],
        opportunity: { ...base().opportunity, estimatedValue: 200_000_000 },
      }),
    );
    expect(capacity(big, "BigCo").score).toBe(1);

    const huge = buildEcosystem(
      base({
        awards: [award({ "Recipient Name": "HugeCo", "Award Amount": 2_000_000_000 })],
        opportunity: { ...base().opportunity, estimatedValue: 200_000_000 },
      }),
    );
    const f = capacity(huge, "HugeCo");
    expect(f.score).toBe(0.8);
    expect(f.evidence).toMatch(/verify appetite/i);
  });
});
