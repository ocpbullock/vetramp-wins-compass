// Pure Price-to-Win logic. No React, no IO. Do not couple to storage.

export type EvalRating = "outstanding" | "good" | "acceptable" | "marginal" | "unknown";

export type PtwCompetitor = {
  name: string;
  tepM: number | null;
  fte: number | null;
  ratingTechnical: EvalRating;
  ratingStaffing: EvalRating;
  note?: string;
};

export type PtwInputs = {
  competitors: PtwCompetitor[];
  ourRatings: { technical: EvalRating; staffing: EvalRating };
  premiumCapPct?: number; // default 10
  undercutPct?: number;   // default 1
};

export type PtwScenario = {
  label: string;
  recommendedTepM: number;
  rationale: string;
};

export type PtwResult = {
  scenarios: PtwScenario[];
  warnings: string[];
};

const RANK: Record<EvalRating, number | null> = {
  outstanding: 4,
  good: 3,
  acceptable: 2,
  marginal: 1,
  unknown: null,
};

const RATING_ORDER: EvalRating[] = ["marginal", "acceptable", "good", "outstanding"];

export function downgradeRating(r: EvalRating): EvalRating {
  if (r === "unknown") return "unknown";
  const idx = RATING_ORDER.indexOf(r);
  if (idx <= 0) return "marginal";
  return RATING_ORDER[idx - 1];
}

/**
 * Compare a competitor to us across (technical, staffing).
 * - "similar" if both dimensions equal, or mixed (one higher + one lower), or all dims non-comparable.
 * - "higher" if at least one dimension higher and none lower.
 * - "lower" if at least one lower and none higher.
 * Unknown on either side makes that dimension non-comparable.
 */
export function compareRatings(
  competitor: { ratingTechnical: EvalRating; ratingStaffing: EvalRating },
  us: { technical: EvalRating; staffing: EvalRating },
): "higher" | "lower" | "similar" {
  const pairs: Array<[EvalRating, EvalRating]> = [
    [competitor.ratingTechnical, us.technical],
    [competitor.ratingStaffing, us.staffing],
  ];
  let anyHigher = false;
  let anyLower = false;
  for (const [c, u] of pairs) {
    const cr = RANK[c];
    const ur = RANK[u];
    if (cr == null || ur == null) continue; // non-comparable
    if (cr > ur) anyHigher = true;
    else if (cr < ur) anyLower = true;
  }
  if (anyHigher && !anyLower) return "higher";
  if (anyLower && !anyHigher) return "lower";
  return "similar";
}

function fmt(n: number): string {
  return `$${n.toFixed(1)}M`;
}

export function computePtw(inputs: PtwInputs): PtwResult {
  const premiumCapPct = inputs.premiumCapPct ?? 10;
  const undercutPct = inputs.undercutPct ?? 1;
  const priced = (inputs.competitors ?? []).filter(
    (c) => typeof c.tepM === "number" && Number.isFinite(c.tepM) && (c.tepM as number) > 0,
  ) as Array<PtwCompetitor & { tepM: number }>;

  const warnings: string[] = [];
  if (priced.length < 2) {
    warnings.push("Fewer than 2 priced competitors — recommendations are indicative only.");
  }
  const allUnknown =
    priced.length > 0 &&
    priced.every((c) => c.ratingTechnical === "unknown" && c.ratingStaffing === "unknown");
  if (allUnknown) {
    warnings.push("All competitor ratings are unknown — comparisons default to similar.");
  }
  if (inputs.ourRatings.technical === "unknown" && inputs.ourRatings.staffing === "unknown") {
    warnings.push("Our assumed ratings are unknown — set at least one to sharpen recommendations.");
  }

  const scenarios: PtwScenario[] = [];

  if (priced.length === 0) {
    warnings.push("No priced competitors — cannot compute Price-to-Win.");
    return { scenarios, warnings };
  }

  // ---------- Scenario A: If rated as assumed ----------
  const scored = priced.map((c) => ({ c, rel: compareRatings(c, inputs.ourRatings) }));
  const similarOrHigher = scored.filter((s) => s.rel !== "lower").map((s) => s.c);
  const lowerRated = scored.filter((s) => s.rel === "lower").map((s) => s.c);

  const minSH = similarOrHigher.length
    ? similarOrHigher.reduce((m, c) => (c.tepM < m.tepM ? c : m))
    : null;
  const minLower = lowerRated.length
    ? lowerRated.reduce((m, c) => (c.tepM < m.tepM ? c : m))
    : null;
  const lowerCap = minLower ? minLower.tepM * (1 + premiumCapPct / 100) : null;

  if (minSH) {
    const undercut = minSH.tepM * (1 - undercutPct / 100);
    let recA = undercut;
    let rationaleBits = [`Just below ${minSH.name} (${fmt(minSH.tepM)})`];
    if (lowerCap != null && lowerCap < recA) {
      recA = lowerCap;
      rationaleBits = [
        `NTE ${premiumCapPct.toFixed(0)}% above lower-rated ${minLower!.name} (${fmt(minLower!.tepM)})`,
        `bound by lower-rated cap ahead of undercutting ${minSH.name}`,
      ];
    } else if (lowerCap != null) {
      rationaleBits.push(`headroom above lower-rated ${minLower!.name} within ${premiumCapPct.toFixed(0)}% cap`);
    }
    scenarios.push({
      label: "If rated as assumed",
      recommendedTepM: round2(recA),
      rationale: rationaleBits.join(" — "),
    });
  } else if (minLower && lowerCap != null) {
    scenarios.push({
      label: "If rated as assumed",
      recommendedTepM: round2(lowerCap),
      rationale: `No similarly- or higher-rated competitors — price at rating premium cap (${premiumCapPct.toFixed(0)}%) above lower-rated ${minLower.name} (${fmt(minLower.tepM)})`,
    });
  }

  // ---------- Scenario B: If rated lower than assumed ----------
  const downgraded = {
    technical: downgradeRating(inputs.ourRatings.technical),
    staffing: downgradeRating(inputs.ourRatings.staffing),
  };
  const scoredB = priced.map((c) => ({ c, rel: compareRatings(c, downgraded) }));
  const similarOrHigherB = scoredB.filter((s) => s.rel !== "lower").map((s) => s.c);
  const minSHB = similarOrHigherB.length
    ? similarOrHigherB.reduce((m, c) => (c.tepM < m.tepM ? c : m))
    : null;
  if (minSHB) {
    const recB = minSHB.tepM * (1 - undercutPct / 100);
    scenarios.push({
      label: "If rated lower than assumed",
      recommendedTepM: round2(recB),
      rationale: `${undercutPct.toFixed(0)}% below ${minSHB.name} (${fmt(minSHB.tepM)}) — priced to win against the field we'd be tied with at a lower rating`,
    });
  } else {
    // Everyone still lower-rated even after our downgrade — use cap
    const minLowerB = priced.reduce((m, c) => (c.tepM < m.tepM ? c : m));
    scenarios.push({
      label: "If rated lower than assumed",
      recommendedTepM: round2(minLowerB.tepM * (1 + premiumCapPct / 100)),
      rationale: `Even downgraded, no competitor rates similar-or-better — cap at ${premiumCapPct.toFixed(0)}% above lowest competitor ${minLowerB.name} (${fmt(minLowerB.tepM)})`,
    });
  }

  return { scenarios, warnings };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
