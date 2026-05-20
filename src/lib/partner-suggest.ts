// Pure ranking module for "Suggested Teaming Partners".
// No React, no I/O. Inputs come from the proposal + team roster.
//
// Honest-by-default: when a partner has thin data we emit
// confidence === "not_enough_data" and avoid inflating the fit score.

export type EngagementType = "prime" | "sub";

export type SuggestedRole =
  | "prime"
  | "sub"
  | "mentor"
  | "protege"
  | "jv_partner"
  | "niche_capability";

export type Confidence = "high" | "medium" | "low" | "not_enough_data";

export type SuggestPartner = {
  id: string;
  company_name: string;
  certifications: string[];
  naics_codes: string[];
  contract_vehicles: string[];
  capabilities_summary: string | null;
  past_performance_summary: string | null;
  notes: string | null;
  relationship_status: "active" | "prospective" | "inactive";
};

export type SuggestSelf = {
  certifications: string[];
  naics_codes: string[];
  contract_vehicles: string[];
};

export type SuggestContext = {
  engagementType: EngagementType;
  opportunityNaics: string[];          // required NAICS for the opp
  opportunityPsc?: string | null;
  opportunityAgency?: string | null;
  setAside?: string | null;
  requiredVehicles?: string[];
  scopeKeywords?: string[];            // tokenized scope/category words
  incumbentName?: string | null;
  primeContractorName?: string | null; // sub-mode named prime
};

export type SuggestionReason = string;

export type PartnerSuggestion = {
  partnerId: string;
  partnerName: string;
  fitScore: number;                // 0..100
  confidence: Confidence;
  bestRole: SuggestedRole;
  bestRoleLabel: string;
  reasons: SuggestionReason[];     // why they fit (verifiable facts)
  gapsCovered: string[];           // which team gaps they close
  risks: string[];                 // concerns and unknowns
  workshareRange: [number, number]; // suggested % range
  outreachAngle: string;           // one-line pitch
};

// ---------- helpers (mirror pwin.ts conventions) ----------

const SET_ASIDE_TARGETS = new Set([
  "SDVOSB", "VOSB", "8(A)", "WOSB", "EDWOSB", "HUBZONE", "SDB", "SMALL",
]);

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

function holdsCert(certs: string[], target: string): boolean {
  const norm = certs.map((c) => c.toUpperCase().replace(/[^A-Z0-9()]/g, ""));
  const t = target.replace(/[()]/g, "");
  return norm.some((c) => c.includes(t));
}

function ciEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function uniq<T>(xs: T[]): T[] { return [...new Set(xs)]; }

function tokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function keywordOverlap(haystack: string | null, needles: string[]): string[] {
  if (!haystack || needles.length === 0) return [];
  const hs = new Set(tokens(haystack));
  return uniq(needles.map((n) => n.toLowerCase()).filter((n) => hs.has(n)));
}

function dataDensity(p: SuggestPartner): number {
  // 0..1 — how much we know about this partner.
  let score = 0;
  if (p.naics_codes.length > 0) score += 0.25;
  if (p.certifications.length > 0) score += 0.20;
  if (p.contract_vehicles.length > 0) score += 0.15;
  if (p.capabilities_summary && p.capabilities_summary.length >= 30) score += 0.20;
  if (p.past_performance_summary && p.past_performance_summary.length >= 30) score += 0.20;
  return Math.min(1, score);
}

function confidenceFor(density: number, hardSignals: number): Confidence {
  if (density < 0.2) return "not_enough_data";
  if (hardSignals >= 3 && density >= 0.6) return "high";
  if (hardSignals >= 2 && density >= 0.4) return "medium";
  return "low";
}

const ROLE_LABEL: Record<SuggestedRole, string> = {
  prime: "Prime",
  sub: "Sub",
  mentor: "Mentor",
  protege: "Protégé",
  jv_partner: "JV Partner",
  niche_capability: "Niche Capability Partner",
};

const ROLE_DEFAULT_SHARE: Record<SuggestedRole, [number, number]> = {
  prime: [51, 80],
  sub: [10, 30],
  mentor: [20, 40],
  protege: [15, 35],
  jv_partner: [30, 49],
  niche_capability: [5, 15],
};

// ---------- core ranking ----------

export function rankPartnerSuggestions(
  ctx: SuggestContext,
  self: SuggestSelf,
  partners: SuggestPartner[],
  existingPartnerIds: string[] = [],
  opts: { limit?: number; includeExisting?: boolean } = {},
): PartnerSuggestion[] {
  const limit = opts.limit ?? 8;
  const existing = new Set(existingPartnerIds);

  // Team gap analysis (vs. self only — partners suggested fill these gaps).
  const target = normSetAside(ctx.setAside);
  const selfHoldsSetAside = !!target && target !== "SMALL"
    && SET_ASIDE_TARGETS.has(target) && holdsCert(self.certifications, target);

  const oppNaics = ctx.opportunityNaics.filter(Boolean);
  const missingNaics = oppNaics.filter((n) => !self.naics_codes.includes(n));

  const requiredVehicles = (ctx.requiredVehicles ?? []).filter(Boolean);
  const missingVehicles = requiredVehicles.filter(
    (v) => !self.contract_vehicles.some((sv) => ciEq(sv, v)),
  );

  const scope = (ctx.scopeKeywords ?? []).filter(Boolean);
  const incumbentLc = (ctx.incumbentName ?? "").toLowerCase().trim();
  const primeLc = (ctx.primeContractorName ?? "").toLowerCase().trim();
  const agencyLc = (ctx.opportunityAgency ?? "").toLowerCase().trim();

  const suggestions: PartnerSuggestion[] = [];

  for (const p of partners) {
    if (!opts.includeExisting && existing.has(p.id)) continue;

    const reasons: string[] = [];
    const gaps: string[] = [];
    const risks: string[] = [];
    let score = 0;
    let hardSignals = 0;

    // --- NAICS fit
    const naicsHits = p.naics_codes.filter((n) => oppNaics.includes(n));
    if (naicsHits.length > 0) {
      score += Math.min(20, naicsHits.length * 10);
      hardSignals++;
      reasons.push(
        `Holds opportunity NAICS ${naicsHits.join(", ")}.`,
      );
    }
    const naicsGapsCovered = naicsHits.filter((n) => missingNaics.includes(n));
    if (naicsGapsCovered.length > 0) {
      score += 10;
      gaps.push(`NAICS we lack: ${naicsGapsCovered.join(", ")}`);
    }

    // --- Set-aside fit
    if (target && SET_ASIDE_TARGETS.has(target) && target !== "SMALL") {
      const partnerHolds = holdsCert(p.certifications, target);
      if (ctx.engagementType === "prime") {
        if (!selfHoldsSetAside && partnerHolds) {
          score += 20; hardSignals++;
          reasons.push(`${target}-certified — opens mentor-protégé / JV path for this set-aside.`);
          gaps.push(`${target} set-aside (we don't hold it)`);
        } else if (selfHoldsSetAside && partnerHolds) {
          score += 5;
          reasons.push(`${target}-certified (we already qualify).`);
        }
      } else {
        // sub mode: if this partner is the named prime, set-aside on them is critical
        if (primeLc && ciEq(p.company_name, ctx.primeContractorName ?? "")) {
          if (partnerHolds) {
            score += 25; hardSignals++;
            reasons.push(`Named prime is ${target}-certified.`);
          } else {
            risks.push(`Named prime is not ${target}-certified — set-aside risk.`);
          }
        } else if (partnerHolds) {
          score += 5;
          reasons.push(`${target}-certified.`);
        }
      }
    }

    // --- Vehicle access
    const vehicleHits = p.contract_vehicles.filter(
      (v) => requiredVehicles.some((r) => ciEq(r, v)),
    );
    if (vehicleHits.length > 0) {
      score += Math.min(15, vehicleHits.length * 10);
      hardSignals++;
      reasons.push(`Holds required vehicle(s): ${vehicleHits.join(", ")}.`);
      const vehicleGapsCovered = vehicleHits.filter(
        (v) => missingVehicles.some((m) => ciEq(m, v)),
      );
      if (vehicleGapsCovered.length > 0) {
        gaps.push(`Vehicle(s) we lack: ${vehicleGapsCovered.join(", ")}`);
      }
    }

    // --- Capability / scope overlap
    const capHits = keywordOverlap(p.capabilities_summary, scope);
    if (capHits.length > 0) {
      score += Math.min(15, capHits.length * 4);
      hardSignals++;
      reasons.push(`Capabilities mention: ${capHits.slice(0, 4).join(", ")}.`);
    }

    // --- Past performance summary keyword overlap (scope + agency)
    const ppText = p.past_performance_summary ?? "";
    const ppHits = keywordOverlap(ppText, scope);
    const agencyInPp = !!agencyLc && ppText.toLowerCase().includes(agencyLc);
    if (ppHits.length > 0 || agencyInPp) {
      score += (ppHits.length > 0 ? 10 : 0) + (agencyInPp ? 8 : 0);
      hardSignals++;
      const bits = [];
      if (agencyInPp) bits.push(`prior work at ${ctx.opportunityAgency}`);
      if (ppHits.length > 0) bits.push(`scope keywords ${ppHits.slice(0, 3).join(", ")}`);
      reasons.push(`Past performance shows ${bits.join(" and ")}.`);
    }

    // --- Incumbent
    if (incumbentLc) {
      if (p.company_name.toLowerCase().includes(incumbentLc)) {
        score += 20; hardSignals++;
        reasons.push(`This partner IS the incumbent.`);
        gaps.push("Incumbent knowledge");
      } else {
        const notesLc = (p.notes ?? "").toLowerCase();
        const ppLc = ppText.toLowerCase();
        if (notesLc.includes(incumbentLc) || ppLc.includes(incumbentLc)) {
          score += 8;
          reasons.push(`Notes / past performance reference incumbent ${ctx.incumbentName}.`);
        }
      }
    }

    // --- Relationship
    if (p.relationship_status === "active") {
      score += 8;
      reasons.push("Active teaming relationship.");
    } else if (p.relationship_status === "prospective") {
      score += 2;
      risks.push("Prospective relationship — no prior teaming history.");
    } else {
      risks.push("Inactive relationship — verify status before outreach.");
      score -= 5;
    }

    // --- Data density / honesty
    const density = dataDensity(p);
    if (density < 0.2) {
      risks.push("Very little data on file — needs validation before pursuit.");
    } else if (density < 0.4) {
      risks.push("Sparse partner profile — confirm capabilities directly.");
    }

    // --- Decide best role
    let role: SuggestedRole = "sub";
    if (ctx.engagementType === "sub" && primeLc
        && ciEq(p.company_name, ctx.primeContractorName ?? "")) {
      role = "prime";
    } else if (
      ctx.engagementType === "prime"
      && target && SET_ASIDE_TARGETS.has(target) && target !== "SMALL"
      && !selfHoldsSetAside && holdsCert(p.certifications, target)
    ) {
      role = "jv_partner";
    } else if (naicsHits.length === 0 && capHits.length > 0) {
      role = "niche_capability";
    }
    // mentor-protege heuristic: if self lacks set-aside but partner holds it
    // and notes mention "mentor", call it mentor
    if (role === "jv_partner" && /mentor|prot[eé]g[eé]/i.test(p.notes ?? "")) {
      role = "mentor";
    }

    // --- Concentration risk: partner holds everything we lack on its own
    if (
      naicsGapsCovered.length === missingNaics.length
      && missingNaics.length > 0
      && requiredVehicles.length === 0
    ) {
      risks.push("Heavy reliance on a single partner — consider a backup.");
    }

    // --- Confidence + cap score
    const confidence = confidenceFor(density, hardSignals);
    if (confidence === "not_enough_data") {
      score = Math.min(score, 35);
      reasons.unshift("Not enough data — score is a lower-bound estimate.");
    } else if (confidence === "low") {
      score = Math.min(score, 65);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    // --- Outreach angle
    const outreachAngle = buildOutreachAngle(role, reasons, gaps, ctx);

    suggestions.push({
      partnerId: p.id,
      partnerName: p.company_name,
      fitScore: score,
      confidence,
      bestRole: role,
      bestRoleLabel: ROLE_LABEL[role],
      reasons,
      gapsCovered: gaps,
      risks,
      workshareRange: ROLE_DEFAULT_SHARE[role],
      outreachAngle,
    });
  }

  suggestions.sort((a, b) => {
    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
    // Tie-break: higher confidence first
    const order: Record<Confidence, number> = {
      high: 3, medium: 2, low: 1, not_enough_data: 0,
    };
    return order[b.confidence] - order[a.confidence];
  });

  return suggestions.slice(0, limit);
}

function buildOutreachAngle(
  role: SuggestedRole,
  reasons: string[],
  gaps: string[],
  ctx: SuggestContext,
): string {
  const oppLabel = ctx.opportunityAgency
    ? `the ${ctx.opportunityAgency} opportunity`
    : "this opportunity";
  if (role === "prime") {
    return `Position us as a value-add subcontractor on ${oppLabel}, leading on the capabilities you don't typically self-perform.`;
  }
  if (role === "jv_partner" || role === "mentor") {
    return `Propose a JV / mentor-protégé arrangement to qualify for the set-aside on ${oppLabel}.`;
  }
  if (role === "niche_capability") {
    return `Bring them in as a niche capability partner to plug a specific scope gap on ${oppLabel}.`;
  }
  const headline = gaps[0] ?? reasons[0] ?? "their relevant past performance";
  return `Invite them to sub on ${oppLabel}, leveraging ${headline.toLowerCase()}.`;
}
