import { describe, it, expect } from "vitest";
import { canonicalizeAgencyName, splitAgencyPath } from "../src/lib/agency-match";
import { inferSetAsideFromVehicleName } from "../src/lib/ecosystem-build";

describe("splitAgencyPath", () => {
  it("does not shred abbreviation dots", () => {
    expect(splitAgencyPath("U.S. SPECIAL OPERATIONS COMMAND (USSOCOM)")).toEqual([
      "U.S. SPECIAL OPERATIONS COMMAND (USSOCOM)",
    ]);
  });

  it("splits real dotted paths", () => {
    expect(splitAgencyPath("DEPT OF DEFENSE.DEFENSE HEALTH AGENCY")).toEqual([
      "DEPT OF DEFENSE",
      "DEFENSE HEALTH AGENCY",
    ]);
  });

  it("keeps 'St. Louis District' intact", () => {
    expect(splitAgencyPath("St. Louis District")).toEqual(["St. Louis District"]);
  });

  it("never emits segments shorter than 3 characters", () => {
    for (const seg of splitAgencyPath("U.S. ARMY / U.S. ARMY CORPS OF ENGINEERS")) {
      expect(seg.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("canonicalizeAgencyName", () => {
  it("keeps the command name for USSOCOM", () => {
    const { canonical } = canonicalizeAgencyName("U.S. SPECIAL OPERATIONS COMMAND (USSOCOM)");
    expect(canonical).toContain("SPECIAL OPERATIONS COMMAND");
  });

  it("takes the deepest segment of a dotted path", () => {
    expect(canonicalizeAgencyName("DEPT OF DEFENSE.DEFENSE HEALTH AGENCY").canonical).toBe(
      "DEFENSE HEALTH AGENCY",
    );
  });
});

describe("inferSetAsideFromVehicleName", () => {
  it("infers pool set-asides", () => {
    expect(inferSetAsideFromVehicleName("Polaris SDVOSB Pool")).toBe("SDVOSB");
    expect(inferSetAsideFromVehicleName("Alliant 2 8(a) Pool")).toBe("8(a)");
    expect(inferSetAsideFromVehicleName("OASIS+ HUBZone")).toBe("HUBZone");
    expect(inferSetAsideFromVehicleName("GSA MAS")).toBeNull();
  });
});
