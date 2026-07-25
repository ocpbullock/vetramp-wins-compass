// Realistic PWIN probability model layered on top of the capability-based
// Team Strength score (calculatePwin in pwin.ts). Pure — no React, no I/O.
//
// The Team Strength number is a scorecard of qualification. This module
// converts that into a *probability* by anchoring on the size of the
// credible bidder field, the incumbent situation, and hard eligibility
// gates. Output is deliberately conservative and hard-capped.

export type GateStatus = "pass" | "fail" | "unknown";

export type PwinProbabilityInputs = {
  gates: {
    setAsideEligible: GateStatus;
    vehicleAccess: GateStatus;
    clearance: GateStatus;
  };
  field: {
    minCredibleBidders: number;
    maxCredibleBidders: number;
  };
  incumbent: {
    present: boolean;
    weAreIncumbent: boolean;
    /** 0.30..0.85 default 0.60 */
    retention: number;
  };
  /** 0..100 from calculatePwin().pwin */
  teamStrength: number;
  /** hard cap on the final probability, default 50 */
  capPct?: number;
};

export type PwinProbabilityResult = {
  lowPct: number;
  likelyPct: number;
  highPct: number;
  drivers: string[];
  gateFailed: string | null;
};

const GATE_LABEL: Record<keyof PwinProbabilityInputs["gates"], string> = {
  setAsideEligible: "Set-aside eligibility",
  vehicleAccess: "Contract vehicle access",
  clearance: "Facility/personnel clearance",
};

function clampN(n: number): number {
  if (!Number.isFinite(n)) return 2;
  return Math.max(2, Math.min(30, Math.round(n)));
}

function baseRateFor(
  n: number,
  incumbent: PwinProbabilityInputs["incumbent"],
): number {
  const N = clampN(n);
  if (incumbent.present && incumbent.weAreIncumbent) {
    return incumbent.retention;
  }
  if (incumbent.present && !incumbent.weAreIncumbent) {
    return (1 - incumbent.retention) / Math.max(1, N - 1);
  }
  return 1 / N;
}

/** Strength multiplier anchored so 50 → 1.0x. */
export function strengthMultiplier(s: number): number {
  const v = Math.max(0, Math.min(100, s));
  if (v < 50) return 0.4 + (v / 50) * 0.6;
  return 1.0 + ((v - 50) / 50) * 0.8;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computePwinProbability(
  inputs: PwinProbabilityInputs,
): PwinProbabilityResult {
  const capPctBase = inputs.capPct ?? 50;

  // ---- GATES ----
  const failed = (Object.keys(inputs.gates) as Array<keyof PwinProbabilityInputs["gates"]>)
    .find((k) => inputs.gates[k] === "fail");
  if (failed) {
    return {
      lowPct: 0,
      likelyPct: 2,
      highPct: 5,
      drivers: [
        `${GATE_LABEL[failed]} gate FAILED — this pursuit is not winnable as scoped. Fix the gate or no-bid.`,
      ],
      gateFailed: GATE_LABEL[failed],
    };
  }

  const drivers: string[] = [];

  // Unknown-gate discount: 0.8x per unknown, floor 0.6.
  const unknownGates = (Object.keys(inputs.gates) as Array<keyof PwinProbabilityInputs["gates"]>)
    .filter((k) => inputs.gates[k] === "unknown");
  let gateDiscount = 1;
  for (const _g of unknownGates) gateDiscount *= 0.8;
  gateDiscount = Math.max(0.6, gateDiscount);
  if (unknownGates.length > 0) {
    drivers.push(
      `${unknownGates.length} unverified gate(s) (${unknownGates.map((g) => GATE_LABEL[g]).join(", ")}) → ${Math.round((1 - gateDiscount) * 100)}% discount`,
    );
  }

  // ---- FIELD SCENARIOS ----
  const nMax = clampN(inputs.field.maxCredibleBidders);
  const nMin = clampN(Math.min(inputs.field.minCredibleBidders, inputs.field.maxCredibleBidders));
  const nMid = clampN(Math.round((nMin + nMax) / 2));

  const baseHigh = baseRateFor(nMin, inputs.incumbent);   // small field → higher
  const baseLikely = baseRateFor(nMid, inputs.incumbent);
  const baseLow = baseRateFor(nMax, inputs.incumbent);    // large field → lower

  // Base-rate driver line.
  if (inputs.incumbent.present && inputs.incumbent.weAreIncumbent) {
    drivers.push(
      `Base rate ${Math.round(baseLikely * 100)}% — we are the incumbent (${Math.round(inputs.incumbent.retention * 100)}% retention), field of ~${nMid}`,
    );
  } else if (inputs.incumbent.present) {
    drivers.push(
      `Base rate ${Math.round(baseLikely * 100)}% — challenger against incumbent (${Math.round(inputs.incumbent.retention * 100)}% retention) in a field of ~${nMid}`,
    );
  } else {
    drivers.push(
      `Base rate ${Math.round(baseLikely * 100)}% — open competition, field of ~${nMid}`,
    );
  }

  // ---- STRENGTH MULTIPLIER ----
  const m = strengthMultiplier(inputs.teamStrength);
  drivers.push(`Team strength ${Math.round(inputs.teamStrength)} → ${m.toFixed(2)}x`);

  // ---- CAP ----
  const cap = inputs.incumbent.weAreIncumbent
    ? Math.max(capPctBase, inputs.incumbent.retention * 100)
    : capPctBase;

  const apply = (base: number) => {
    const raw = base * m * gateDiscount * 100;
    return round1(Math.min(cap, Math.max(0, raw)));
  };

  const lowPct = apply(baseLow);
  const likelyPct = apply(baseLikely);
  const highPct = apply(baseHigh);

  const rawLikely = baseLikely * m * gateDiscount * 100;
  if (rawLikely > cap) {
    drivers.push(`Capped at ${Math.round(cap)}%`);
  }

  return { lowPct, likelyPct, highPct, drivers, gateFailed: null };
}

export function formatProbabilityRange(r: PwinProbabilityResult): string {
  return `${r.likelyPct}% (${r.lowPct}–${r.highPct}%)`;
}
