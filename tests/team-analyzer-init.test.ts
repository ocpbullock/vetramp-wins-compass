/**
 * Regression test for TeamCompositionAnalyzer initialization loop
 * (React error #185 "Maximum update depth exceeded").
 *
 * The analyzer's init effect must:
 *   1. Bail out while any required query is still undefined (no setState
 *      between query resolutions).
 *   2. Skip rebuilding members when nothing relevant has changed (so it
 *      doesn't overwrite the user's in-progress edits and doesn't loop).
 *   3. Only rebuild on (a) different proposal id, (b) new query-result
 *      identity (self / partners / entries), or (c) changed scalar
 *      proposal fields.
 *
 * We model the guard as a pure function and assert its behavior across
 * query-resolution orderings that historically triggered the loop —
 * especially self resolving BEFORE partners/entries.
 */
import { describe, it, expect } from "vitest";

type Snap = {
  open: boolean;
  proposalId: string;
  self: unknown;
  partners: unknown;
  entries: unknown;
  engagementType: string | null;
  primeContractorId: string | null;
  primeContractorName: string | null;
  incumbentName: string | null;
};

type LastInit = Omit<Snap, "open"> | null;

// Mirrors the gating logic inside TeamCompositionAnalyzer's init effect.
function shouldInitialize(snap: Snap, last: LastInit): boolean {
  if (!snap.open) return false;
  if (!snap.self || !snap.partners || !snap.entries) return false;
  if (
    last
    && last.proposalId === snap.proposalId
    && last.self === snap.self
    && last.partners === snap.partners
    && last.entries === snap.entries
    && last.engagementType === snap.engagementType
    && last.primeContractorId === snap.primeContractorId
    && last.primeContractorName === snap.primeContractorName
    && last.incumbentName === snap.incumbentName
  ) {
    return false;
  }
  return true;
}

const baseSnap = (over: Partial<Snap> = {}): Snap => ({
  open: true,
  proposalId: "prop-1",
  self: null,
  partners: undefined,
  entries: undefined,
  engagementType: "prime",
  primeContractorId: null,
  primeContractorName: null,
  incumbentName: null,
  ...over,
});

describe("TeamCompositionAnalyzer init guard (React #185 regression)", () => {
  it("does not initialize while dialog is closed", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const snap = baseSnap({ open: false, self: selfObj, partners: [], entries: [] });
    expect(shouldInitialize(snap, null)).toBe(false);
  });

  it("does not initialize while any query is still loading (self only)", () => {
    // Self loads first, partners + entries still undefined. This is the
    // scenario that historically caused the loop because the effect would
    // run with fresh `[]` defaults each render.
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const snap = baseSnap({ self: selfObj, partners: undefined, entries: undefined });
    expect(shouldInitialize(snap, null)).toBe(false);
  });

  it("does not initialize while partners loaded but entries still loading", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const snap = baseSnap({ self: selfObj, partners: [], entries: undefined });
    expect(shouldInitialize(snap, null)).toBe(false);
  });

  it("initializes exactly once when all three queries finally resolve", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const partners: unknown[] = [];
    const entries: unknown[] = [];
    const snap = baseSnap({ self: selfObj, partners, entries });
    expect(shouldInitialize(snap, null)).toBe(true);

    const last: LastInit = {
      proposalId: snap.proposalId,
      self: snap.self,
      partners: snap.partners,
      entries: snap.entries,
      engagementType: snap.engagementType,
      primeContractorId: snap.primeContractorId,
      primeContractorName: snap.primeContractorName,
      incumbentName: snap.incumbentName,
    };
    // A re-render with the same query identities and the same scalars must
    // NOT trigger another setMembers call — this is what prevents the loop.
    expect(shouldInitialize(snap, last)).toBe(false);
  });

  it("does not reinitialize while the user toggles partners or roles (parent re-renders)", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const partners: unknown[] = [{ id: "p1", company_name: "Acme" }];
    const entries: unknown[] = [];
    const snap = baseSnap({ self: selfObj, partners, entries });
    const last: LastInit = {
      proposalId: snap.proposalId,
      self: snap.self,
      partners: snap.partners,
      entries: snap.entries,
      engagementType: snap.engagementType,
      primeContractorId: snap.primeContractorId,
      primeContractorName: snap.primeContractorName,
      incumbentName: snap.incumbentName,
    };
    // Simulate parent re-renders that pass a fresh `proposal` object but
    // unchanged scalar fields and unchanged query results.
    for (let i = 0; i < 10; i++) {
      expect(shouldInitialize(snap, last)).toBe(false);
    }
  });

  it("reinitializes when the analyzer opens for a different proposal", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const partners: unknown[] = [];
    const entries: unknown[] = [];
    const last: LastInit = {
      proposalId: "prop-1",
      self: selfObj,
      partners,
      entries,
      engagementType: "prime",
      primeContractorId: null,
      primeContractorName: null,
      incumbentName: null,
    };
    const snap = baseSnap({ proposalId: "prop-2", self: selfObj, partners, entries });
    expect(shouldInitialize(snap, last)).toBe(true);
  });

  it("reinitializes when partner roster identity changes (refetch)", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const partnersV1: unknown[] = [];
    const partnersV2: unknown[] = [{ id: "p1", company_name: "Acme" }];
    const entries: unknown[] = [];
    const last: LastInit = {
      proposalId: "prop-1",
      self: selfObj,
      partners: partnersV1,
      entries,
      engagementType: "prime",
      primeContractorId: null,
      primeContractorName: null,
      incumbentName: null,
    };
    const snap = baseSnap({ self: selfObj, partners: partnersV2, entries });
    expect(shouldInitialize(snap, last)).toBe(true);
  });

  it("simulates query-resolution orderings and never initializes more than once per stable dataset", () => {
    const selfObj = { profile: { company_name: "Us", certifications: [], naics_codes: [] } };
    const partners: unknown[] = [];
    const entries: unknown[] = [];
    const orderings: Array<Array<keyof Snap>> = [
      ["self", "partners", "entries"],
      ["partners", "self", "entries"],
      ["partners", "entries", "self"],
      ["entries", "self", "partners"],
      ["self", "entries", "partners"],
    ];
    for (const order of orderings) {
      let snap = baseSnap();
      let last: LastInit = null;
      let initCount = 0;
      // Each "render" reveals one more resolved query.
      for (const key of order) {
        const next: any = key === "self" ? selfObj : key === "partners" ? partners : entries;
        snap = { ...snap, [key]: next };
        if (shouldInitialize(snap, last)) {
          initCount++;
          last = {
            proposalId: snap.proposalId,
            self: snap.self,
            partners: snap.partners,
            entries: snap.entries,
            engagementType: snap.engagementType,
            primeContractorId: snap.primeContractorId,
            primeContractorName: snap.primeContractorName,
            incumbentName: snap.incumbentName,
          };
        }
      }
      // Extra "settling" renders with identical data must not retrigger.
      for (let i = 0; i < 5; i++) {
        if (shouldInitialize(snap, last)) initCount++;
      }
      expect(initCount).toBe(1);
    }
  });
});
