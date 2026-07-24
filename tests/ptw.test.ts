import { describe, it, expect } from "vitest";
import { computePtw, compareRatings, downgradeRating, type PtwCompetitor } from "../src/lib/ptw";

function comp(over: Partial<PtwCompetitor> = {}): PtwCompetitor {
  return {
    name: "X",
    tepM: 10,
    fte: 50,
    ratingTechnical: "good",
    ratingStaffing: "good",
    ...over,
  };
}

describe("compareRatings", () => {
  it("equal pair is similar", () => {
    expect(compareRatings({ ratingTechnical: "good", ratingStaffing: "good" }, { technical: "good", staffing: "good" })).toBe("similar");
  });
  it("one higher none lower = higher", () => {
    expect(compareRatings({ ratingTechnical: "outstanding", ratingStaffing: "good" }, { technical: "good", staffing: "good" })).toBe("higher");
  });
  it("mixed = similar", () => {
    expect(compareRatings({ ratingTechnical: "outstanding", ratingStaffing: "acceptable" }, { technical: "good", staffing: "good" })).toBe("similar");
  });
  it("unknown on comp treated as non-comparable", () => {
    expect(compareRatings({ ratingTechnical: "unknown", ratingStaffing: "good" }, { technical: "good", staffing: "good" })).toBe("similar");
  });
});

describe("downgradeRating", () => {
  it("steps down", () => {
    expect(downgradeRating("outstanding")).toBe("good");
    expect(downgradeRating("good")).toBe("acceptable");
    expect(downgradeRating("acceptable")).toBe("marginal");
    expect(downgradeRating("marginal")).toBe("marginal");
    expect(downgradeRating("unknown")).toBe("unknown");
  });
});

describe("computePtw", () => {
  const us = { technical: "good" as const, staffing: "good" as const };

  it("premium cap binds when lower-rated is much cheaper", () => {
    const res = computePtw({
      competitors: [
        comp({ name: "High-Rated Inc", tepM: 12, ratingTechnical: "good", ratingStaffing: "good" }),
        comp({ name: "Cheap Marginal", tepM: 5, ratingTechnical: "marginal", ratingStaffing: "marginal" }),
      ],
      ourRatings: us,
    });
    const a = res.scenarios.find((s) => s.label === "If rated as assumed")!;
    // undercut of 12 = 11.88; cap = 5 * 1.1 = 5.5 → cap binds.
    expect(a.recommendedTepM).toBeCloseTo(5.5, 2);
    expect(a.rationale.toLowerCase()).toContain("cheap marginal");
    expect(a.rationale).toMatch(/10%/);
  });

  it("undercut scenario prices ~1% below tied competitor when we downgrade", () => {
    const res = computePtw({
      competitors: [
        comp({ name: "Rival A", tepM: 10, ratingTechnical: "acceptable", ratingStaffing: "acceptable" }),
        comp({ name: "Rival B", tepM: 15, ratingTechnical: "good", ratingStaffing: "good" }),
      ],
      ourRatings: us,
    });
    const b = res.scenarios.find((s) => s.label === "If rated lower than assumed")!;
    // Downgraded us = acceptable/acceptable → Rival A is similar, Rival B higher → min SH = 10
    expect(b.recommendedTepM).toBeCloseTo(9.9, 2);
    expect(b.rationale.toLowerCase()).toContain("rival a");
  });

  it("mixed ratings count as similar for binding", () => {
    const res = computePtw({
      competitors: [
        comp({ name: "Mix Co", tepM: 8, ratingTechnical: "outstanding", ratingStaffing: "marginal" }),
      ],
      ourRatings: us,
    });
    const a = res.scenarios.find((s) => s.label === "If rated as assumed")!;
    // Mix Co is "similar" → undercut it
    expect(a.recommendedTepM).toBeCloseTo(7.92, 2);
  });

  it("competitors with null TEP are ignored", () => {
    const res = computePtw({
      competitors: [
        comp({ name: "Priced", tepM: 10 }),
        comp({ name: "NoBid", tepM: null }),
      ],
      ourRatings: us,
    });
    expect(res.warnings.some((w) => w.includes("Fewer than 2"))).toBe(true);
    expect(res.scenarios.length).toBeGreaterThan(0);
  });

  it("warns when all ratings unknown", () => {
    const res = computePtw({
      competitors: [
        comp({ name: "U1", tepM: 8, ratingTechnical: "unknown", ratingStaffing: "unknown" }),
        comp({ name: "U2", tepM: 9, ratingTechnical: "unknown", ratingStaffing: "unknown" }),
      ],
      ourRatings: us,
    });
    expect(res.warnings.some((w) => w.toLowerCase().includes("unknown"))).toBe(true);
  });

  it("no priced competitors → warning, no scenarios", () => {
    const res = computePtw({
      competitors: [comp({ tepM: null })],
      ourRatings: us,
    });
    expect(res.scenarios).toHaveLength(0);
    expect(res.warnings.some((w) => w.toLowerCase().includes("cannot compute"))).toBe(true);
  });
});
