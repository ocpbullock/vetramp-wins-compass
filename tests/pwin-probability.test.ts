import { describe, it, expect } from "vitest";
import {
  computePwinProbability,
  strengthMultiplier,
  type PwinProbabilityInputs,
} from "@/lib/pwin-probability";

const base: PwinProbabilityInputs = {
  gates: { setAsideEligible: "pass", vehicleAccess: "pass", clearance: "pass" },
  field: { minCredibleBidders: 6, maxCredibleBidders: 12 },
  incumbent: { present: false, weAreIncumbent: false, retention: 0.6 },
  teamStrength: 50,
};

describe("computePwinProbability", () => {
  it("gate failure floors the result", () => {
    const r = computePwinProbability({
      ...base,
      gates: { ...base.gates, vehicleAccess: "fail" },
      teamStrength: 90,
    });
    expect(r.gateFailed).toBe("Contract vehicle access");
    expect(r.likelyPct).toBe(2);
    expect(r.highPct).toBe(5);
    expect(r.lowPct).toBe(0);
  });

  it("strength=50 leaves base rate unchanged (1.0x multiplier)", () => {
    expect(strengthMultiplier(50)).toBeCloseTo(1.0);
    const r = computePwinProbability({ ...base, teamStrength: 50 });
    // Field of ~9 → 1/9 ≈ 11.1
    expect(r.likelyPct).toBeGreaterThan(10);
    expect(r.likelyPct).toBeLessThan(12);
  });

  it("strength scale: 0 → 0.4x, 100 → 1.8x", () => {
    expect(strengthMultiplier(0)).toBeCloseTo(0.4);
    expect(strengthMultiplier(100)).toBeCloseTo(1.8);
  });

  it("incumbent vs challenger asymmetry", () => {
    const incumbent = computePwinProbability({
      ...base,
      incumbent: { present: true, weAreIncumbent: true, retention: 0.6 },
    });
    const challenger = computePwinProbability({
      ...base,
      incumbent: { present: true, weAreIncumbent: false, retention: 0.6 },
    });
    expect(incumbent.likelyPct).toBeGreaterThan(challenger.likelyPct * 5);
  });

  it("cap binds at capPct (default 50)", () => {
    const r = computePwinProbability({
      ...base,
      incumbent: { present: true, weAreIncumbent: true, retention: 0.4 },
      teamStrength: 100,
      field: { minCredibleBidders: 2, maxCredibleBidders: 2 },
    });
    expect(r.likelyPct).toBeLessThanOrEqual(50);
    expect(r.drivers.some((d) => /capped/i.test(d))).toBe(true);
  });

  it("incumbent cap floors at retention*100", () => {
    const r = computePwinProbability({
      ...base,
      incumbent: { present: true, weAreIncumbent: true, retention: 0.8 },
      teamStrength: 100,
    });
    expect(r.likelyPct).toBeGreaterThan(50);
    expect(r.likelyPct).toBeLessThanOrEqual(80);
  });

  it("unknown-gate discount applies (0.8x per unknown, floor 0.6)", () => {
    const clean = computePwinProbability(base);
    const oneUnknown = computePwinProbability({
      ...base,
      gates: { ...base.gates, clearance: "unknown" },
    });
    expect(oneUnknown.likelyPct).toBeCloseTo(clean.likelyPct * 0.8, 1);
    const allUnknown = computePwinProbability({
      ...base,
      gates: { setAsideEligible: "unknown", vehicleAccess: "unknown", clearance: "unknown" },
    });
    // 0.8^3 = 0.512 → floored at 0.6
    expect(allUnknown.likelyPct).toBeCloseTo(clean.likelyPct * 0.6, 1);
  });

  it("wider field range widens low/high spread", () => {
    const narrow = computePwinProbability({
      ...base,
      field: { minCredibleBidders: 6, maxCredibleBidders: 8 },
    });
    const wide = computePwinProbability({
      ...base,
      field: { minCredibleBidders: 3, maxCredibleBidders: 20 },
    });
    expect(wide.highPct - wide.lowPct).toBeGreaterThan(narrow.highPct - narrow.lowPct);
  });
});
