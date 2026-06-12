/**
 * Regression test for PwinChip render contract.
 *
 * The chip is used in OpportunitiesTab, StarredTab, and TrackedOpportunitiesTab.
 * QA observed rows with no chip at all when the own-company lookup returned
 * null. The chip must NEVER resolve to null/empty: every input maps to one
 * of "loading", "setup", or "score". The setup chip links to onboarding /
 * settings; the score chip renders 0-100.
 */
import { describe, it, expect } from "vitest";
import { pwinChipState } from "@/lib/pwin-solo";
import type { PwinResult } from "@/lib/pwin";

const score: PwinResult = {
  pwin: 42,
  factors: [],
} as unknown as PwinResult;

describe("pwinChipState", () => {
  it("returns 'setup' when there is no active team", () => {
    expect(
      pwinChipState({
        teamId: null,
        selfLoading: false,
        self: undefined,
        result: undefined,
        resultLoading: false,
      }),
    ).toEqual({ kind: "setup", reason: "no-team" });
  });

  it("returns 'loading' while self profile is fetching", () => {
    expect(
      pwinChipState({
        teamId: "team-1",
        selfLoading: true,
        self: undefined,
        result: undefined,
        resultLoading: false,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("returns 'setup' (no-own-company) when own-company lookup is null", () => {
    // Regression: previously this combination could fall through to a
    // null/blank cell in the table when result was still undefined.
    const out = pwinChipState({
      teamId: "team-1",
      selfLoading: false,
      self: { ownCompany: null, vehicles: [], pastPerf: [] },
      result: undefined,
      resultLoading: false,
    });
    expect(out).toEqual({ kind: "setup", reason: "no-own-company" });
  });

  it("returns 'setup' (no-capabilities) when own-company exists but is empty", () => {
    const out = pwinChipState({
      teamId: "team-1",
      selfLoading: false,
      self: {
        ownCompany: {
          name: "Acme",
          certifications: [],
          set_asides: [],
          naics_codes: [],
          capabilities_narrative: "",
        } as any,
        vehicles: [],
        pastPerf: [],
      },
      result: undefined,
      resultLoading: false,
    });
    expect(out).toEqual({ kind: "setup", reason: "no-capabilities" });
  });

  it("returns 'loading' when capabilities are ready but per-opp result is pending", () => {
    const out = pwinChipState({
      teamId: "team-1",
      selfLoading: false,
      self: {
        ownCompany: {
          name: "Acme",
          naics_codes: ["541512"],
          certifications: ["8(a)"],
        } as any,
        vehicles: [],
        pastPerf: [],
      },
      result: undefined,
      resultLoading: true,
    });
    expect(out).toEqual({ kind: "loading" });
  });

  it("returns 'score' when self + result are ready", () => {
    const out = pwinChipState({
      teamId: "team-1",
      selfLoading: false,
      self: {
        ownCompany: {
          name: "Acme",
          naics_codes: ["541512"],
          certifications: ["8(a)"],
        } as any,
        vehicles: [],
        pastPerf: [],
      },
      result: score,
      resultLoading: false,
    });
    expect(out).toEqual({ kind: "score", result: score, selfName: "Acme" });
  });
});
