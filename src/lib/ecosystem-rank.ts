// Pure, deterministic competitive-ecosystem ranking engine.
//
// No fetching, no Supabase, no side effects. The caller supplies award pulls
// (customer-scoped and agency-scoped), vehicle awardee rosters, and human
// intel; this module classifies eligibility, scores five weighted factors,
// and assigns one ecosystem role per company.

import type { HistoricalAward } from "./api";
import { agencyMatchesLoose } from "./agency-match";
import { isSmallBusinessSetAside } from "./teaming-targets";
import { getSizeStandard } from "./sba-size-standards";

// ---------------------------------------------------------------- types

export type EligibilityTier =
  | "validated"
  | "likely"
  | "requires_validation"
  | "not_eligible";

export type EcosystemRole =
  | "known_competitor"
  | "likely_prime_competitor"
  | "prime_teaming_partner"
  | "coalition_partner"
  | "incumbent"
  | "dark_horse";

export type FactorKey =
  | "customer_experience"
  | "naics_experience"
  | "contract_size"
  | "scope_similarity"
  | "agency_experience"
  | "vehicle_presence";

export type FactorBreakdown = {
  key: FactorKey;
  label: string;
  /** Effective (renormalized) weight, 0–100. */
  weight: number;
  /** Raw factor score 0–1. */
  score: number;
  evidence: string;
};

export type EcosystemEvidence = {
  customerAwards: number;
  naicsAwards: number;
  agencyAwards: number;
  latestRelevantDate: string | null;
  avgAwardSize: number | null;
  sizeSimilarity: number | null;
};

export type EcosystemCompany = {
  name: string;
  uei: string | null;
  onVehicle: boolean;
  eligibility: EligibilityTier;
  eligibilityReasons: string[];
  eligibilityQuestions: string[];
  role: EcosystemRole;
  score: number | null;
  factorBreakdown: FactorBreakdown[];
  evidence: EcosystemEvidence;
  userIdentified: boolean;
  confidence: "high" | "medium" | "low";
  inclusionReason: string;
};

export type ScopedAward = HistoricalAward & {
  /** Which pull this row came from. */
  scope?: "customer" | "agency";
};

export type VehicleAwardeeInput = {
  name: string;
  uei?: string | null;
  small_business?: boolean | null;
  socioeconomic?: string[] | null;
};

export type EcosystemOpportunity = {
  naicsCode: string;
  adjacentPrefix?: string | null;
  setAside?: string | null;
  estimatedValue?: number | null;
  agency?: string | null;
  customerSubAgency?: string | null;
  /** Precomputed scope keywords (lowercase tokens/phrases). */
  scopeKeywords?: string[];
  /** Display name of the linked contract vehicle, used in factor evidence. */
  vehicleName?: string | null;
};

export type EcosystemUserIntel = {
  knownCompetitors?: string[];
  knownIncumbent?: string | null;
  knownTeammates?: string[];
};

export type EcosystemWeights = Partial<Record<FactorKey, number>>;

export type BuildEcosystemInputs = {
  awards: ScopedAward[];
  vehicleAwardees: VehicleAwardeeInput[] | null;
  vehicleRestricted: boolean;
  opportunity: EcosystemOpportunity;
  userIntel?: EcosystemUserIntel;
  validatedOverrides?: Record<string, EligibilityTier>;
  weights?: EcosystemWeights;
  targetSize?: { min: number; max: number };
  /** Override "now" for deterministic tests. */
  now?: Date;
};

export type BuildEcosystemResult = {
  companies: EcosystemCompany[];
  needsExpansion: "adjacent_naics" | "parent_agency" | null;
  summary: { primeCompetitorCount: number; totalCompanies: number };
};

// ---------------------------------------------------------------- config

export const BASE_WEIGHTS: Record<FactorKey, number> = {
  customer_experience: 30,
  naics_experience: 20,
  contract_size: 15,
  scope_similarity: 15,
  agency_experience: 10,
  vehicle_presence: 10,
};

const FACTOR_LABELS: Record<FactorKey, string> = {
  customer_experience: "Customer experience",
  naics_experience: "Primary NAICS experience",
  contract_size: "Similar contract size",
  scope_similarity: "Similar scope",
  agency_experience: "Broader agency experience",
  vehicle_presence: "On contract vehicle",
};

const DEFAULT_TARGET = { min: 12, max: 18 };

// ---------------------------------------------------------------- helpers

export function looseNameKey(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(inc|incorporated|llc|l l c|llp|lp|ltd|corp|corporation|co|company|group|holdings|technologies|technology|solutions|services|systems|the)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

const YEAR_MS = 1000 * 60 * 60 * 24 * 365.25;

function yearsSince(date: string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now.getTime() - t) / YEAR_MS);
}

/**
 * Banded recency weight. >8yr awards normally count 0, except for a known
 * incumbent or a company with continuing recent work (any award <=3yr),
 * where they keep a 0.3 residual weight.
 */
export function recencyBandWeight(
  years: number | null,
  opts: { isIncumbent?: boolean; hasRecentWork?: boolean } = {},
): number {
  if (years == null) return 0;
  if (years <= 3) return 1;
  if (years <= 5) return 0.6;
  if (years <= 8) return 0.3;
  return opts.isIncumbent || opts.hasRecentWork ? 0.3 : 0;
}

const SOCIO_REQUIREMENTS: { test: RegExp; tag: RegExp; label: string }[] = [
  { test: /8\(?a\)?/i, tag: /8\(?a\)?/i, label: "8(a)" },
  { test: /SDVOSB|service.disabled/i, tag: /SDVOSB|service.disabled/i, label: "SDVOSB" },
  { test: /HUB.?ZONE/i, tag: /HUB.?ZONE/i, label: "HUBZone" },
  { test: /EDWOSB/i, tag: /EDWOSB/i, label: "EDWOSB" },
  { test: /WOSB|woman.owned/i, tag: /WOSB|woman.owned/i, label: "WOSB" },
  { test: /\bVOSB\b|veteran.owned/i, tag: /\bVOSB\b|veteran.owned/i, label: "VOSB" },
];

function requiredSocio(setAside: string | null | undefined): { tag: RegExp; label: string } | null {
  const s = (setAside ?? "").toString();
  if (!s) return null;
  for (const r of SOCIO_REQUIREMENTS) if (r.test.test(s)) return { tag: r.tag, label: r.label };
  return null;
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function tokenize(s: string | null | undefined): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 4);
}

// ---------------------------------------------------------------- core

type Bucket = {
  name: string;
  uei: string | null;
  key: string;
  customerWeighted: number;
  naicsWeighted: number;
  agencyWeighted: number;
  adjacentWeighted: number;
  exactNaicsCount: number;
  adjacentNaicsCount: number;
  customerCount: number;
  naicsCount: number;
  agencyCount: number;
  latestRelevantDate: string | null;
  amounts: number[];
  descriptions: string[];
  setAsides: string[];
};

export function buildEcosystem(inputs: BuildEcosystemInputs): BuildEcosystemResult {
  const {
    awards,
    vehicleAwardees,
    vehicleRestricted,
    opportunity,
    userIntel = {},
    validatedOverrides = {},
    weights = {},
    targetSize = DEFAULT_TARGET,
    now = new Date(),
  } = inputs;

  const oppNaics = (opportunity.naicsCode || "").trim();
  const adjacentPrefix = (opportunity.adjacentPrefix || oppNaics.slice(0, 4) || "").trim();
  const customer = opportunity.customerSubAgency || opportunity.agency || null;
  const scopeKeywords = (opportunity.scopeKeywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);

  const knownCompetitors = (userIntel.knownCompetitors ?? []).filter(Boolean);
  const knownTeammates = (userIntel.knownTeammates ?? []).filter(Boolean);
  const knownIncumbent = userIntel.knownIncumbent || null;

  const competitorKeys = new Set(knownCompetitors.map(looseNameKey));
  const teammateKeys = new Set(knownTeammates.map(looseNameKey));
  const incumbentKey = knownIncumbent ? looseNameKey(knownIncumbent) : null;

  // -- vehicle roster index
  const vehicleByKey = new Map<string, VehicleAwardeeInput>();
  const vehicleByUei = new Map<string, VehicleAwardeeInput>();
  for (const v of vehicleAwardees ?? []) {
    vehicleByKey.set(looseNameKey(v.name), v);
    if (v.uei) vehicleByUei.set(v.uei.toUpperCase(), v);
  }

  // -- 1. aggregate awards per company
  const buckets = new Map<string, Bucket>();
  const getBucket = (name: string, uei: string | null): Bucket => {
    const key = looseNameKey(name) || (uei ?? name).toLowerCase();
    let b = buckets.get(key);
    if (!b) {
      b = {
        name,
        uei,
        key,
        customerWeighted: 0,
        naicsWeighted: 0,
        agencyWeighted: 0,
        adjacentWeighted: 0,
        exactNaicsCount: 0,
        adjacentNaicsCount: 0,
        customerCount: 0,
        naicsCount: 0,
        agencyCount: 0,
        latestRelevantDate: null,
        amounts: [],
        descriptions: [],
        setAsides: [],
      };
      buckets.set(key, b);
    }
    if (!b.uei && uei) b.uei = uei;
    return b;
  };

  // First pass: latest award date per company (for the incumbency/continuity rule)
  const latestByKey = new Map<string, string>();
  for (const a of awards) {
    const name = a["Recipient Name"];
    if (!name) continue;
    const key = looseNameKey(name) || name.toLowerCase();
    const d = a["Start Date"] || null;
    if (d && (!latestByKey.get(key) || d > latestByKey.get(key)!)) latestByKey.set(key, d);
  }

  for (const a of awards) {
    const name = a["Recipient Name"];
    if (!name) continue;
    const b = getBucket(name, a["Recipient UEI"] ?? null);
    const isIncumbent = incumbentKey != null && b.key === incumbentKey;
    const hasRecentWork = (() => {
      const y = yearsSince(latestByKey.get(b.key) ?? null, now);
      return y != null && y <= 3;
    })();
    const w = recencyBandWeight(yearsSince(a["Start Date"], now), { isIncumbent, hasRecentWork });
    if (w === 0) continue;

    const naics = (a.NAICS || "").trim();
    const isCustomer =
      a.scope === "customer" ||
      (!!customer &&
        (agencyMatchesLoose(a["Awarding Sub Agency"], customer) ||
          agencyMatchesLoose(a["Awarding Agency"], customer)));
    const isAgency =
      a.scope === "agency" ||
      (!!opportunity.agency && agencyMatchesLoose(a["Awarding Agency"], opportunity.agency));

    if (isCustomer) {
      b.customerWeighted += w;
      b.customerCount += 1;
    }
    if (isAgency) {
      b.agencyWeighted += w;
      b.agencyCount += 1;
    }
    if (naics && oppNaics && naics === oppNaics) {
      b.naicsWeighted += w;
      b.naicsCount += 1;
      b.exactNaicsCount += 1;
    } else if (naics && adjacentPrefix && naics.slice(0, adjacentPrefix.length) === adjacentPrefix) {
      b.adjacentWeighted += w;
      b.adjacentNaicsCount += 1;
    }

    const amt = Number(a["Award Amount"]) || 0;
    if (amt > 0) b.amounts.push(amt);
    const d = a["Start Date"] || null;
    if (d && (!b.latestRelevantDate || d > b.latestRelevantDate)) b.latestRelevantDate = d;
    if (a.Description && b.descriptions.length < 8) b.descriptions.push(a.Description);
    if (a["Type of Set Aside"]) b.setAsides.push(a["Type of Set Aside"]!);
  }

  // Ensure vehicle awardees and user-named companies exist as candidates.
  for (const v of vehicleAwardees ?? []) {
    if (!v.name) continue;
    getBucket(v.name, v.uei ?? null);
  }
  for (const n of [...knownCompetitors, ...knownTeammates, ...(knownIncumbent ? [knownIncumbent] : [])]) {
    getBucket(n, null);
  }

  // -- 2. score + eligibility
  const oppSetAsideSmall = isSmallBusinessSetAside(opportunity.setAside);
  const socioReq = requiredSocio(opportunity.setAside);
  const sizeStd = getSizeStandard(oppNaics);
  const estimate = opportunity.estimatedValue && opportunity.estimatedValue > 0
    ? opportunity.estimatedValue
    : null;

  type Scored = {
    company: EcosystemCompany;
    primeBlocked: boolean;
    adjacentOnly: boolean;
    hasEvidence: boolean;
  };

  const scored: Scored[] = [];

  for (const b of buckets.values()) {
    const vehicleEntry = (b.uei ? vehicleByUei.get(b.uei.toUpperCase()) : undefined) ?? vehicleByKey.get(b.key);
    const onVehicle = !!vehicleEntry;
    const socio = (vehicleEntry?.socioeconomic ?? []).map((s) => String(s));
    const rosterSmall = vehicleEntry?.small_business;
    const awardSmall = b.setAsides.some((s) => isSmallBusinessSetAside(s));

    const reasons: string[] = [];
    const questions: string[] = [];
    let tier: EligibilityTier = "requires_validation";
    let primeBlocked = false;

    if (vehicleRestricted && !onVehicle) {
      primeBlocked = true;
      reasons.push("Not on the required contract vehicle — cannot prime this action.");
      questions.push("Could they reach this vehicle through a teaming arrangement?");
    }

    if (oppSetAsideSmall && rosterSmall === false) {
      tier = "not_eligible";
      reasons.push(
        `Flagged other-than-small${sizeStd ? ` against the ${oppNaics} size standard` : ""} on a small-business set-aside.`,
      );
    } else if (socioReq && socio.length > 0 && !socio.some((s) => socioReq.tag.test(s))) {
      tier = "not_eligible";
      reasons.push(`Socioeconomic profile (${socio.join(", ")}) lacks required ${socioReq.label} status.`);
    } else if (socioReq && socio.some((s) => socioReq.tag.test(s))) {
      tier = "likely";
      reasons.push(`Holds ${socioReq.label} status per the vehicle roster.`);
    } else if (oppSetAsideSmall && (rosterSmall === true || awardSmall)) {
      tier = "likely";
      reasons.push("Small-business status indicated by roster / prior set-aside awards.");
    } else {
      reasons.push("No authoritative size or socioeconomic record on file.");
      questions.push("Confirm current SAM.gov size and socioeconomic certifications.");
    }

    if (sizeStd && oppSetAsideSmall) {
      questions.push(
        sizeStd.standard.type === "receipts"
          ? `Verify average annual receipts under $${(sizeStd.standard.value / 1_000_000).toFixed(1)}M for NAICS ${oppNaics}.`
          : `Verify employee count under ${sizeStd.standard.value} for NAICS ${oppNaics}.`,
      );
    }

    const override = validatedOverrides[b.name] ?? validatedOverrides[b.key];
    if (override) {
      tier = override;
      reasons.unshift("Human-validated eligibility override.");
    }

    // --- factors
    const isIncumbentCo = incumbentKey != null && b.key === incumbentKey;
    const factors: FactorBreakdown[] = [];
    const push = (key: FactorKey, score: number | null, evidence: string) => {
      if (score == null) return;
      factors.push({
        key,
        label: FACTOR_LABELS[key],
        weight: weights[key] ?? BASE_WEIGHTS[key],
        score: Math.max(0, Math.min(1, score)),
        evidence,
      });
    };

    push(
      "customer_experience",
      Math.min(1, b.customerWeighted / 5),
      `${b.customerCount} award(s) at ${customer ?? "the customer"} (recency-weighted ${b.customerWeighted.toFixed(1)})`,
    );
    push(
      "naics_experience",
      Math.min(1, b.naicsWeighted / 5),
      `${b.naicsCount} award(s) in NAICS ${oppNaics}`,
    );

    const med = median(b.amounts);
    if (estimate != null && med != null) {
      const dist = Math.abs(Math.log10(med / estimate));
      push("contract_size", Math.max(0, 1 - dist / 2), `Median relevant award $${Math.round(med).toLocaleString()} vs estimate $${Math.round(estimate).toLocaleString()}`);
    }

    if (scopeKeywords.length > 0 && b.descriptions.length > 0) {
      const tokens = new Set(b.descriptions.flatMap(tokenize));
      const hits = scopeKeywords.filter((k) =>
        tokenize(k).every((t) => tokens.has(t)),
      );
      push(
        "scope_similarity",
        hits.length / scopeKeywords.length,
        hits.length ? `Scope overlap: ${hits.join(", ")}` : "No scope keyword overlap in award descriptions",
      );
    }

    // Vehicle access is a scored factor, not just a role qualifier: a holder
    // with no award history still has a real, weighted advantage on this action.
    if (vehicleAwardees != null) {
      const vehicleLabel = opportunity.vehicleName?.trim() || "the required vehicle";
      push(
        "vehicle_presence",
        onVehicle ? 1 : 0,
        onVehicle ? `Holds ${vehicleLabel}` : "Not a vehicle holder",
      );
    }

    push(
      "agency_experience",
      Math.min(1, b.agencyWeighted / 8),
      `${b.agencyCount} award(s) at ${opportunity.agency ?? "the department"}`,
    );

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    let score: number | null = null;
    if (totalWeight > 0) {
      // renormalize weights over the available factors
      for (const f of factors) f.weight = Math.round((f.weight / totalWeight) * 1000) / 10;
      score = Math.round(factors.reduce((s, f) => s + f.weight * f.score, 0));
    }

    const hasEvidence =
      b.customerCount + b.naicsCount + b.agencyCount + b.adjacentNaicsCount > 0;
    const adjacentOnly = b.exactNaicsCount === 0 && b.adjacentNaicsCount > 0;

    const userIdentified =
      competitorKeys.has(b.key) || teammateKeys.has(b.key) || isIncumbentCo;

    const confidence: "high" | "medium" | "low" = userIdentified || b.customerCount >= 2
      ? "high"
      : hasEvidence
        ? "medium"
        : "low";

    scored.push({
      company: {
        name: b.name,
        uei: b.uei,
        onVehicle,
        eligibility: tier,
        eligibilityReasons: reasons,
        eligibilityQuestions: questions,
        role: "coalition_partner", // provisional; assigned below
        score,
        factorBreakdown: factors,
        evidence: {
          customerAwards: b.customerCount,
          naicsAwards: b.naicsCount,
          agencyAwards: b.agencyCount,
          latestRelevantDate: b.latestRelevantDate,
          avgAwardSize: b.amounts.length
            ? Math.round(b.amounts.reduce((s, x) => s + x, 0) / b.amounts.length)
            : null,
          sizeSimilarity:
            estimate != null && med != null
              ? Math.max(0, 1 - Math.abs(Math.log10(med / estimate)) / 2)
              : null,
        },
        userIdentified,
        confidence,
        inclusionReason: "",
      },
      primeBlocked,
      adjacentOnly,
      hasEvidence,
    });
  }

  // -- 3. role assignment
  const byScore = [...scored].sort(
    (a, b) => (b.company.score ?? -1) - (a.company.score ?? -1) || a.company.name.localeCompare(b.company.name),
  );

  const assigned = new Set<string>();
  const take = (s: Scored, role: EcosystemRole, reason: string) => {
    s.company.role = role;
    s.company.inclusionReason = reason;
    assigned.add(s.company.name);
  };

  // user intel wins first
  for (const s of byScore) {
    const key = looseNameKey(s.company.name);
    if (incumbentKey && key === incumbentKey) take(s, "incumbent", "Named as the incumbent by the capture team.");
    else if (competitorKeys.has(key)) take(s, "known_competitor", "Named as a competitor by the capture team.");
    else if (teammateKeys.has(key)) take(s, "coalition_partner", "Named as a teammate by the capture team.");
  }

  const eligibleForPrime = (s: Scored) =>
    !assigned.has(s.company.name) &&
    !s.primeBlocked &&
    s.company.onVehicle &&
    (s.company.eligibility === "validated" || s.company.eligibility === "likely");

  const primePool = byScore.filter(eligibleForPrime);
  const primeCount = Math.min(8, Math.max(0, Math.min(primePool.length, primePool.length >= 5 ? 8 : primePool.length)));
  primePool.slice(0, primeCount).forEach((s) =>
    take(s, "likely_prime_competitor", "On the vehicle, eligible, and strong relevant past performance."),
  );
  primePool
    .slice(primeCount, primeCount + 4)
    .forEach((s) => take(s, "prime_teaming_partner", "Vehicle holder better suited as a prime to team with."));

  const remaining = byScore.filter((s) => !assigned.has(s.company.name));
  for (const s of remaining) {
    if (s.adjacentOnly) {
      take(s, "dark_horse", "Evidence is mostly in adjacent NAICS — a credible entrant, not a proven incumbent-class bidder.");
    }
  }

  let coalitionTaken = 0;
  for (const s of byScore) {
    if (assigned.has(s.company.name)) continue;
    if (coalitionTaken >= 6) break;
    if (!s.hasEvidence) continue;
    take(s, "coalition_partner", "Relevant experience but off-vehicle or unvalidated — best approached as a teammate.");
    coalitionTaken += 1;
  }
  for (const s of byScore) {
    if (assigned.has(s.company.name)) continue;
    take(s, "coalition_partner", "Included as a possible teammate pending validation.");
  }

  // -- 4. ordering, cap, expansion flag
  const ROLE_ORDER: EcosystemRole[] = [
    "known_competitor",
    "incumbent",
    "likely_prime_competitor",
    "prime_teaming_partner",
    "coalition_partner",
    "dark_horse",
  ];

  const ordered = [...scored].sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.company.role);
    const rb = ROLE_ORDER.indexOf(b.company.role);
    if (ra !== rb) return ra - rb;
    return (b.company.score ?? -1) - (a.company.score ?? -1) || a.company.name.localeCompare(b.company.name);
  });

  const max = targetSize?.max ?? DEFAULT_TARGET.max;
  const capped: EcosystemCompany[] = [];
  for (const s of ordered) {
    // A vehicle holder is a real bidder on this action whether or not the award
    // pull found evidence for them — never let the cap hide one.
    const alwaysKeep =
      s.company.role === "known_competitor" ||
      s.company.role === "incumbent" ||
      s.company.userIdentified ||
      s.company.onVehicle;
    if (capped.length < max || alwaysKeep) capped.push(s.company);
  }

  const credible = capped.filter(
    (c) => c.eligibility !== "not_eligible" && (c.userIdentified || c.evidence.customerAwards + c.evidence.naicsAwards + c.evidence.agencyAwards > 0),
  );

  let needsExpansion: "adjacent_naics" | "parent_agency" | null = null;
  if (credible.length < Math.min(10, targetSize?.min ?? DEFAULT_TARGET.min)) {
    const anyAdjacent = scored.some((s) => s.adjacentOnly);
    needsExpansion = anyAdjacent ? "parent_agency" : "adjacent_naics";
  }

  return {
    companies: capped,
    needsExpansion,
    summary: {
      primeCompetitorCount: capped.filter(
        (c) => c.role === "likely_prime_competitor" || c.role === "known_competitor" || c.role === "incumbent",
      ).length,
      totalCompanies: capped.length,
    },
  };
}
