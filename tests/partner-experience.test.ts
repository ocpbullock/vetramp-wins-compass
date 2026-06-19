import { describe, it, expect } from "vitest";
import type { HistoricalAward } from "../src/lib/api";
import { rankPartnerExperience } from "../src/lib/partner-experience";

function award(over: Partial<HistoricalAward> = {}): HistoricalAward {
  return {
    "Recipient Name": "Acme",
    "Recipient UEI": "UEI-ACME",
    "Awarding Agency": "Department of Defense",
    "Awarding Sub Agency": "",
    "Start Date": "2024-01-01",
    "Award Amount": 1_000_000,
    "Type of Set Aside": "",
    Description: "work",
    ...over,
  } as HistoricalAward;
}

const NOW = new Date("2026-06-01T00:00:00Z");

describe("rankPartnerExperience", () => {
  it("agency experience boosts ordering", () => {
    const awards: HistoricalAward[] = [
      // Vendor A: prior work with VA (the opp agency)
      award({ "Recipient Name": "VendorA", "Recipient UEI": "UEI-A",
              "Awarding Agency": "Department of Veterans Affairs",
              "Award Amount": 500_000, "Start Date": "2025-01-01" }),
      // Vendor B: same volume, but at DoD (no agency experience)
      award({ "Recipient Name": "VendorB", "Recipient UEI": "UEI-B",
              "Awarding Agency": "Department of Defense",
              "Award Amount": 500_000, "Start Date": "2025-01-01" }),
    ];
    const out = rankPartnerExperience(
      awards,
      { agency: "Veterans Affairs" },
      { now: NOW },
    );
    expect(out[0].name).toBe("VendorA");
    expect(out[0].agencyExperience).toBe(true);
    expect(out[1].agencyExperience).toBe(false);
    expect(out[0].relevanceScore).toBeGreaterThan(out[1].relevanceScore);
  });

  it("recency decays score", () => {
    const awards: HistoricalAward[] = [
      award({ "Recipient Name": "Recent", "Recipient UEI": "UEI-R",
              "Start Date": "2026-04-01", "Award Amount": 1_000_000 }),
      award({ "Recipient Name": "Stale", "Recipient UEI": "UEI-S",
              "Start Date": "2018-01-01", "Award Amount": 1_000_000 }),
    ];
    const out = rankPartnerExperience(
      awards,
      { agency: null },
      { now: NOW },
    );
    const recent = out.find((t) => t.name === "Recent")!;
    const stale = out.find((t) => t.name === "Stale")!;
    expect(recent.relevanceScore).toBeGreaterThan(stale.relevanceScore);
    expect(recent.recencyMonths!).toBeLessThan(stale.recencyMonths!);
  });

  it("hardFilterAgency excludes vendors without agency awards", () => {
    const awards: HistoricalAward[] = [
      award({ "Recipient Name": "VAVendor", "Recipient UEI": "UEI-VA",
              "Awarding Agency": "Department of Veterans Affairs" }),
      award({ "Recipient Name": "DoDVendor", "Recipient UEI": "UEI-DOD",
              "Awarding Agency": "Department of Defense" }),
    ];
    const out = rankPartnerExperience(
      awards,
      { agency: "Veterans Affairs" },
      { hardFilterAgency: true, now: NOW },
    );
    expect(out.map((t) => t.name)).toEqual(["VAVendor"]);
  });
});
