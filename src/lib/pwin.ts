// Pwin (probability of win) calculator for team compositions.
// Pure functions — no React, no I/O. Inputs come from the analyzer panel.

export type PwinRole = "prime" | "sub" | "mentor" | "protege" | "jv_partner";
export type EngagementType = "prime" | "sub";

// Higher-level teaming strategy. Drives factor reweighting in calculatePwin.
export type RelationshipModel =
  | "prime_with_subs"   // we prime, others sub
  | "sub_to_prime"      // we sub to a named prime
  | "joint_venture"     // formal JV with a partner
  | "mentor_protege"    // SBA mentor-protege arrangement
  | "niche_sub";        // narrow niche capability sub on a larger team

export const RELATIONSHIP_MODELS: { value: RelationshipModel; label: string; engagement: EngagementType }[] = [
  { value: "prime_with_subs", label: "We prime with selected subs", engagement: "prime" },
  { value: "sub_to_prime",    label: "We sub to a named prime",     engagement: "sub"   },
  { value: "joint_venture",   label: "Joint venture",                engagement: "prime" },
  { value: "mentor_protege",  label: "Mentor-protégé",               engagement: "prime" },
  { value: "niche_sub",       label: "Niche subcontractor",          engagement: "sub"   },
];

export function engagementForModel(m: RelationshipModel): EngagementType {
  return RELATIONSHIP_MODELS.find((r) => r.value === m)?.engagement ?? "prime";
}

export type PwinTeamMember = {
  id: string;                     // partner id or "self"
  name: string;
  isSelf: boolean;
  role: PwinRole;
  workShare: number;              // 0..100
  active: boolean;
  certifications: string[];       // e.g. ["SDVOSB","8(a)"]
  naicsCodes: string[];
  contractVehicles: string[];     // names or ids
  pastPerformance: Array<{
    naics?: string | null;
    agency?: string | null;
    end?: string | null;          // ISO date of POP end
    keywords?: string[];
  }>;
  isIncumbent?: boolean;
  workedWithIncumbent?: boolean;
  /** 0..100 baseline relationship strength (subjective). Used by both
   *  prime_relationship (sub mode) and partner_fit (prime mode). */
  primeRelationshipStrength?: number;
  // ----- Established-partnership signals. Each contributes an explicit
  // bonus to the partner-fit / prime-relationship factor and is shown in
  // the factor breakdown so users can see WHY the score moved.
  isEstablishedPartner?: boolean;       // is_existing_partner on the company
  priorContractTogether?: boolean;      // worked_together_before / prior_contract_together
  hasNda?: boolean;                     // mutual NDA signed
  hasTeamingAgreement?: boolean;        // TA on file
};

export type PwinContext = {
  engagementType: EngagementType;
  relationshipModel?: RelationshipModel; // optional: reweights factors per teaming model
  opportunityNaics: string[];     // codes for the opp
  opportunityAgency?: string | null;
  setAside?: string | null;       // e.g. "SDVOSB", "8(a)", "WOSB", "Total_Small_Business", null
  requiredVehicles?: string[];    // contract vehicle names if specified
  scopeKeywords?: string[];
  incumbentName?: string | null;
};

export type FactorKey =
  | "set_aside"
  | "past_performance"
  | "naics_coverage"
  | "vehicle_access"
  | "incumbent"
  | "completeness"
  | "prime_relationship"
  | "partner_fit";

export type FactorScore = {
  key: FactorKey;
  label: string;
  weight: number;       // 0..1
  score: number;        // 0..100
  explanation: string;
};

export type PwinResult = {
  pwin: number;                   // 0..100
  factors: FactorScore[];
  selfShare: number;              // remainder for "your company"
  totalPartnerShare: number;
  overAllocated: boolean;
};

// ---------- helpers ----------

const SET_ASIDE_CERT_MAP: Record<string, string[]> = {
  SDVOSB: ["SDVOSB", "VOSB"],
  VOSB: ["VOSB"],
  "8(A)": ["8(A)", "8A"],
  "8A": ["8(A)", "8A"],
  WOSB: ["WOSB", "EDWOSB"],
  EDWOSB: ["EDWOSB"],
  HUBZONE: ["HUBZONE"],
  SDB: ["SDB", "8(A)"],
};

function normSetAside(s?: string | null): string | null {
  if (!s) return null;
  const u = s.toUpperCase().replace(/[^A-Z0-9()]/g, "");
  if (u.includes("SDVOSB")) return "SDVOSB";
  if (u.includes("VOSB")) return "VOSB";
  if (u.includes("8A") || u.includes("8(A)")) return "8(A)";
  if (u.includes("EDWOSB")) return "EDWOSB";
  if (u.includes("WOSB")) return "WOSB";
  if (u.includes("HUBZONE")) return "HUBZONE";
  if (u.includes("SMALL")) return "SMALL";
  return null;
}

function memberSatisfiesSetAside(m: PwinTeamMember, target: string): boolean {
  const allowed = SET_ASIDE_CERT_MAP[target] ?? [target];
  const certs = m.certifications.map((c) => c.toUpperCase().replace(/[^A-Z0-9()]/g, ""));
  return allowed.some((a) => certs.some((c) => c.includes(a.replace(/[()]/g, ""))));
}

function recencyWeight(end?: string | null): number {
  if (!end) return 0.6;
  const t = Date.parse(end);
  if (Number.isNaN(t)) return 0.6;
  const years = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
  if (years <= 3) return 1;
  if (years <= 5) return 0.75;
  return 0.5;
}

// ---------- factor calculators ----------

function scoreSetAside(ctx: PwinContext, active: PwinTeamMember[]): FactorScore {
  const target = normSetAside(ctx.setAside);
  if (!target || target === "SMALL") {
    return {
      key: "set_aside", label: "Set-Aside Alignment", weight: 0.20, score: 75,
      explanation: target === "SMALL"
        ? "Small business set-aside — verify all team members are small."
        : "No socioeconomic set-aside specified.",
    };
  }

  // In sub mode, the prime must hold the set-aside.
  if (ctx.engagementType === "sub") {
    const prime = active.find((m) => m.role === "prime" && !m.isSelf)
      ?? active.find((m) => m.role === "prime");
    if (!prime) {
      return {
        key: "set_aside", label: "Set-Aside Alignment", weight: 0.20, score: 20,
        explanation: `${target} set-aside but no prime on the team.`,
      };
    }
    const ok = memberSatisfiesSetAside(prime, target);
    return {
      key: "set_aside", label: "Set-Aside Alignment", weight: 0.20, score: ok ? 95 : 25,
      explanation: ok
        ? `${target} set-aside — prime ${prime.name} is ${target}-certified.`
        : `${target} set-aside but prime ${prime.name} is not ${target}-certified.`,
    };
  }

  // Prime mode: self must hold the set-aside.
  const self = active.find((m) => m.isSelf);
  if (!self) {
    return {
      key: "set_aside", label: "Set-Aside Alignment", weight: 0.20, score: 30,
      explanation: "Your company is not active on this team.",
    };
  }
  const ok = memberSatisfiesSetAside(self, target);
  return {
    key: "set_aside", label: "Set-Aside Alignment", weight: 0.20, score: ok ? 95 : 25,
    explanation: ok
      ? `${target} set-aside — your company is ${target}-certified as prime.`
      : `${target} set-aside but your company is not ${target}-certified.`,
  };
}

function scorePastPerformance(ctx: PwinContext, active: PwinTeamMember[]): FactorScore {
  const oppNaics = new Set(ctx.opportunityNaics.filter(Boolean));
  const agency = (ctx.opportunityAgency ?? "").toLowerCase();
  const kw = (ctx.scopeKeywords ?? []).map((s) => s.toLowerCase()).filter(Boolean);

  let weighted = 0;
  for (const m of active) {
    for (const pp of m.pastPerformance ?? []) {
      const hits =
        (pp.naics && oppNaics.has(pp.naics) ? 1 : 0) +
        (pp.agency && agency && pp.agency.toLowerCase().includes(agency) ? 1 : 0) +
        ((pp.keywords ?? []).some((k) => kw.includes(k.toLowerCase())) ? 1 : 0);
      if (hits > 0) weighted += hits * recencyWeight(pp.end);
    }
  }
  // Saturating curve: ~6 weighted hits ≈ 100.
  const score = Math.min(100, Math.round((weighted / 6) * 100));
  return {
    key: "past_performance", label: "Past Performance Relevance", weight: 0.25, score,
    explanation: weighted === 0
      ? "No relevant past performance found across the team."
      : `${weighted.toFixed(1)} weighted relevant past performance entries (recency-adjusted).`,
  };
}

function scoreNaicsCoverage(ctx: PwinContext, active: PwinTeamMember[]): FactorScore {
  const opp = ctx.opportunityNaics.filter(Boolean);
  if (opp.length === 0) {
    return { key: "naics_coverage", label: "NAICS Coverage", weight: 0.15, score: 70,
      explanation: "Opportunity NAICS not specified." };
  }
  const covered = new Set<string>();
  for (const m of active) for (const n of m.naicsCodes) if (opp.includes(n)) covered.add(n);
  const pct = (covered.size / opp.length) * 100;
  return {
    key: "naics_coverage", label: "NAICS Coverage", weight: 0.15, score: Math.round(pct),
    explanation: `${covered.size}/${opp.length} required NAICS covered by the team.`,
  };
}

function scoreVehicles(ctx: PwinContext, active: PwinTeamMember[]): FactorScore {
  const required = (ctx.requiredVehicles ?? []).filter(Boolean);
  if (required.length === 0) {
    return { key: "vehicle_access", label: "Contract Vehicle Access", weight: 0.15, score: 70,
      explanation: "No vehicle requirement specified." };
  }
  const checkPool = ctx.engagementType === "sub"
    ? active.filter((m) => m.role === "prime")
    : active;
  const held = new Set<string>();
  for (const m of checkPool) for (const v of m.contractVehicles) {
    if (required.some((r) => r.toLowerCase() === v.toLowerCase())) held.add(v);
  }
  const pct = (held.size / required.length) * 100;
  return {
    key: "vehicle_access", label: "Contract Vehicle Access", weight: 0.15, score: Math.round(pct),
    explanation: held.size === 0
      ? `Required vehicle(s) ${required.join(", ")} not held by ${ctx.engagementType === "sub" ? "the prime" : "the team"}.`
      : `Held: ${[...held].join(", ")}.`,
  };
}

function scoreIncumbent(_ctx: PwinContext, active: PwinTeamMember[]): FactorScore {
  const isIncumbent = active.some((m) => m.isIncumbent);
  const knows = active.some((m) => m.workedWithIncumbent);
  let score = 50;
  let explanation = "No incumbent ties on the team.";
  if (isIncumbent) { score = 95; explanation = "A team member IS the incumbent."; }
  else if (knows) { score = 70; explanation = "A team member has worked with the incumbent."; }
  return { key: "incumbent", label: "Incumbent Advantage", weight: 0.15, score, explanation };
}

function scoreCompleteness(_ctx: PwinContext, active: PwinTeamMember[], selfShare: number): FactorScore {
  const shares = active.map((m) => m.isSelf ? selfShare : m.workShare).filter((s) => s > 0);
  const total = shares.reduce((s, x) => s + x, 0);
  if (total === 0 || shares.length === 0) {
    return { key: "completeness", label: "Team Completeness", weight: 0.10, score: 20,
      explanation: "No work share allocated." };
  }
  if (total > 100) {
    return { key: "completeness", label: "Team Completeness", weight: 0.10, score: 15,
      explanation: `Allocated work share is ${total}% (over 100%).` };
  }
  // Penalize concentration: HHI-like (lower is more diverse).
  const hhi = shares.reduce((s, x) => s + (x / 100) * (x / 100), 0);
  // hhi=1 (one player) -> 40, hhi=0.5 (two balanced) -> 75, hhi=0.33 -> 90
  const distribution = Math.max(0, Math.min(100, Math.round(100 - (hhi - 0.25) * 120)));
  const closure = total >= 95 ? 100 : Math.round((total / 95) * 100);
  const score = Math.round(distribution * 0.6 + closure * 0.4);
  return {
    key: "completeness", label: "Team Completeness", weight: 0.10, score,
    explanation: `${total}% allocated across ${shares.length} member(s); distribution score ${distribution}.`,
  };
}

function scorePrimeRelationship(ctx: PwinContext, active: PwinTeamMember[]): FactorScore | null {
  if (ctx.engagementType !== "sub") return null;
  const prime = active.find((m) => m.role === "prime");
  const strength = prime?.primeRelationshipStrength ?? 0;
  return {
    key: "prime_relationship", label: "Prime Relationship Strength", weight: 0.10,
    score: Math.round(strength),
    explanation: prime
      ? (strength > 0
          ? `Prior teaming history with ${prime.name} (strength ${Math.round(strength)}).`
          : `No prior teaming history found with ${prime.name}.`)
      : "No prime selected on the team.",
  };
}

// ---------- model-specific reweighting ----------

// Multiplicative bumps applied before renormalizing to sum-to-1.
// Values reflect what tends to matter most under each teaming model.
const MODEL_MULTIPLIERS: Record<RelationshipModel, Partial<Record<FactorKey, number>>> = {
  prime_with_subs: {},
  sub_to_prime: {
    prime_relationship: 2.0, // who you sub to dominates
    past_performance:   1.3, // scope fit / proof on similar work matters more
    set_aside:          0.6, // prime carries the set-aside
    incumbent:          0.9,
  },
  joint_venture: {
    set_aside:          1.4, // JVs commonly stack set-aside qualification
    past_performance:   1.2,
    completeness:       1.1,
  },
  mentor_protege: {
    set_aside:          1.5, // mentor enables protégé to bid
    past_performance:   1.2,
    prime_relationship: 1.3,
  },
  niche_sub: {
    past_performance:   1.6, // niche capability proof dominates
    naics_coverage:     0.5, // team NAICS isn't ours to cover
    set_aside:          0.5,
    prime_relationship: 1.4,
    incumbent:          0.8,
  },
};

function applyModelWeights(factors: FactorScore[], model?: RelationshipModel): void {
  if (!model) return;
  const mult = MODEL_MULTIPLIERS[model] ?? {};
  for (const f of factors) {
    const m = mult[f.key];
    if (m && m !== 1) f.weight = f.weight * m;
  }
  const total = factors.reduce((s, f) => s + f.weight, 0);
  if (total > 0) for (const f of factors) f.weight = +(f.weight / total).toFixed(4);
}

// ---------- main ----------

export function calculatePwin(ctx: PwinContext, members: PwinTeamMember[]): PwinResult {
  const active = members.filter((m) => m.active);

  const partnerShare = active
    .filter((m) => !m.isSelf)
    .reduce((s, m) => s + (m.workShare || 0), 0);
  const selfShare = Math.max(0, 100 - partnerShare);
  const overAllocated = partnerShare > 100;

  const factors: FactorScore[] = [
    scoreSetAside(ctx, active),
    scorePastPerformance(ctx, active),
    scoreNaicsCoverage(ctx, active),
    scoreVehicles(ctx, active),
    scoreIncumbent(ctx, active),
    scoreCompleteness(ctx, active, selfShare),
  ];
  const rel = scorePrimeRelationship(ctx, active);
  if (rel) {
    // Rebalance: shrink the other weights slightly to fit prime relationship.
    const totalOther = factors.reduce((s, f) => s + f.weight, 0);
    const scale = (1 - rel.weight) / totalOther;
    for (const f of factors) f.weight = +(f.weight * scale).toFixed(4);
    factors.push(rel);
  }

  // Apply per-relationship-model reweighting after baseline weights are set.
  applyModelWeights(factors, ctx.relationshipModel);

  const pwinRaw = factors.reduce((s, f) => s + f.score * f.weight, 0);
  const pwin = overAllocated ? Math.round(pwinRaw * 0.7) : Math.round(pwinRaw);

  return { pwin, factors, selfShare, totalPartnerShare: partnerShare, overAllocated };
}

export function colorFor(score: number): "green" | "amber" | "red" {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

// ---------- scenario narrative helpers ----------

export type ScenarioInsights = {
  strengths: { label: string; detail: string }[];
  weaknesses: { label: string; detail: string }[];
  recommendedAction: string;
};

const NEXT_ACTION_BY_FACTOR: Record<FactorKey, (model?: RelationshipModel) => string> = {
  set_aside: (m) =>
    m === "mentor_protege"
      ? "Confirm the SBA-approved mentor-protégé agreement covers this set-aside."
      : m === "joint_venture"
        ? "Verify the JV's set-aside eligibility is documented and current."
        : "Add a teaming partner that holds the required socioeconomic certification.",
  past_performance: (m) =>
    m === "niche_sub"
      ? "Surface two more niche-capability past performance references with recent end dates."
      : "Attach 2–3 recent, scope-relevant past performance citations from the team.",
  naics_coverage: () => "Bring in a partner whose primary NAICS matches the solicitation.",
  vehicle_access: (m) =>
    m === "sub_to_prime"
      ? "Confirm the prime holds the required contract vehicle."
      : "Confirm vehicle access — team in a holder or pursue a direct-award path.",
  incumbent: () => "Recruit incumbent staff or an incumbent-adjacent partner before proposal start.",
  completeness: () => "Rebalance work share so allocations sum to ~100% across the team.",
  prime_relationship: () =>
    "Schedule a discovery call with the prime and document prior teaming wins in the file.",
};

export function deriveInsights(result: PwinResult, model?: RelationshipModel): ScenarioInsights {
  const strengths = result.factors
    .filter((f) => f.score >= 75)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map((f) => ({ label: f.label, detail: f.explanation }));

  const weaknesses = result.factors
    .filter((f) => f.score <= 45)
    .sort((a, b) => a.score * b.weight - b.score * a.weight)
    .slice(0, 3)
    .map((f) => ({ label: f.label, detail: f.explanation }));

  // Recommended action targets the lowest weighted-score factor.
  const lowest = [...result.factors].sort(
    (a, b) => a.score * a.weight - b.score * b.weight,
  )[0];

  let recommendedAction = lowest
    ? NEXT_ACTION_BY_FACTOR[lowest.key](model)
    : "Document the teaming plan and lock in partner commitments.";

  if (result.overAllocated) {
    recommendedAction = "Reduce partner work shares — current total exceeds 100%.";
  }

  return { strengths, weaknesses, recommendedAction };
}

