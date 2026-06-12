import { describe, it, expect } from "vitest";
import { deriveTeamingTargets, companyFromTeamingTarget, isSmallBusinessSetAside } from "../src/lib/teaming-targets";
import type { HistoricalAward } from "../src/lib/api";

const award = (over: Partial<HistoricalAward>): HistoricalAward => ({
  "Recipient Name": "Acme",
  "Recipient UEI": "ACME1",
  "Award Amount": 100_000,
  "Awarding Agency": "Department of Veterans Affairs",
  "Start Date": "2024-01-01",
  "Type of Set Aside": "",
  ...over,
});

describe("deriveTeamingTargets", () => {
  it("aggregates by recipient, picks latest date, and classifies large vs small", () => {
    const awards: HistoricalAward[] = [
      award({ "Recipient Name": "BigPrime Corp", "Recipient UEI": "BIG1", "Award Amount": 12_000_000, "Start Date": "2023-06-01" }),
      award({ "Recipient Name": "BigPrime Corp", "Recipient UEI": "BIG1", "Award Amount": 5_000_000, "Start Date": "2025-02-10" }),
      award({ "Recipient Name": "Small Vet LLC", "Recipient UEI": "SML1", "Award Amount": 800_000, "Start Date": "2024-09-15", "Type of Set Aside": "SDVOSB Sole Source" }),
      award({ "Recipient Name": "Generic Inc",   "Recipient UEI": "GEN1", "Award Amount": 200_000, "Start Date": "2022-01-01" }),
    ];
    const targets = deriveTeamingTargets(awards, { agency: "Veterans Affairs" });

    const big = targets.find((t) => t.name === "BigPrime Corp")!;
    expect(big.classification).toBe("prime");
    expect(big.totalValue).toBe(17_000_000);
    expect(big.awardCount).toBe(2);
    expect(big.latestAwardDate).toBe("2025-02-10");
    expect(big.isSmallBusiness).toBe(false);

    const small = targets.find((t) => t.name === "Small Vet LLC")!;
    expect(small.classification).toBe("partner");
    expect(small.isSmallBusiness).toBe(true);
    expect(small.latestSetAside).toMatch(/SDVOSB/);
  });

  it("filters by agency substring", () => {
    const awards: HistoricalAward[] = [
      award({ "Recipient Name": "InScope",  "Awarding Agency": "Dept of Veterans Affairs" }),
      award({ "Recipient Name": "OutOfScope", "Awarding Agency": "Dept of Defense" }),
    ];
    const targets = deriveTeamingTargets(awards, { agency: "Veterans" });
    expect(targets.map((t) => t.name)).toEqual(["InScope"]);
  });
});

describe("isSmallBusinessSetAside", () => {
  it("matches common SB set-aside codes", () => {
    expect(isSmallBusinessSetAside("SDVOSB Sole Source")).toBe(true);
    expect(isSmallBusinessSetAside("8(a) Competitive")).toBe(true);
    expect(isSmallBusinessSetAside("HUBZone")).toBe(true);
    expect(isSmallBusinessSetAside("WOSB")).toBe(true);
    expect(isSmallBusinessSetAside("Full and Open")).toBe(false);
    expect(isSmallBusinessSetAside(null)).toBe(false);
  });
});

describe("companyFromTeamingTarget", () => {
  it("builds a CompanyDraft with provenance and past performance summary", () => {
    const draft = companyFromTeamingTarget(
      {
        name: "Small Vet LLC",
        uei: "SML1",
        totalValue: 800_000,
        awardCount: 1,
        latestAwardDate: "2024-09-15",
        latestSetAside: "SDVOSB Sole Source",
        isSmallBusiness: true,
        classification: "partner",
        sampleDescriptions: ["IT support services"],
      },
      "team-1",
      { naicsCodes: ["541512"], agency: "VA" },
    );
    expect(draft.team_id).toBe("team-1");
    expect(draft.uei).toBe("SML1");
    expect(draft.naics_codes).toEqual(["541512"]);
    expect(draft.certifications).toEqual(["SDVOSB Sole Source"]);
    expect(draft.source).toBe("teaming_targets");
    expect(draft.past_performance?.[0].customer).toBe("VA");
    expect(draft.is_own_company).toBe(false);
  });
});
