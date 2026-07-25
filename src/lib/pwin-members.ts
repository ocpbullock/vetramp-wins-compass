// Shared PwinTeamMember assembly. One canonical mapping from a company row
// (own or partner) + optional proposal_teaming entry into the shape the pWin
// engine consumes. Every call site (CaptureAnalysisPanel, TeamCompositionAnalyzer,
// TeamingSandbox, export helpers) must go through here so partner strength —
// past performance, NDA/TA, prior work, relationship strength — reaches the
// factors on every team change.
import type { PwinTeamMember, PwinRole } from "@/lib/pwin";

export type PastPerf = {
  naics?: string | null;
  agency?: string | null;
  end?: string | null;
  keywords?: string[];
};

export type CompanyLike = {
  id: string;
  name?: string | null;
  company_name?: string | null;
  certifications?: string[] | null;
  naics_codes?: string[] | null;
  contract_vehicles?: string[] | null;
  past_performance?: any;
  is_existing_partner?: boolean | null;
  prior_contract_together?: boolean | null;
  worked_together_before?: boolean | null;
  has_nda?: boolean | null;
  has_teaming_agreement?: boolean | null;
  relationship_strength?: number | null;
  relationship_status?: string | null;
};

export type TeamingEntryLike = {
  company_id?: string;
  partner_id?: string;
  role?: string | null;
  work_share_pct?: number | null;
};

export type SelfProfileLike = {
  company_name?: string | null;
  legal_name?: string | null;
  certifications?: string[] | null;
  naics_codes?: string[] | null;
  vehicles?: string[] | null;
  pastPerf?: PastPerf[] | null;
};

/**
 * Normalize a company's `past_performance` jsonb (can be the company_profile
 * blob shape `{ title, customer, period, summary }` or the past_performance
 * table shape `{ naics_code, agency, period_of_performance_end, relevance_keywords }`)
 * into the tuple the pWin engine expects.
 */
export function mapPartnerPastPerformance(list: any): PastPerf[] {
  if (!Array.isArray(list)) return [];
  return list.map((pp: any) => ({
    naics: pp?.naics ?? pp?.naics_code ?? null,
    agency: pp?.customer ?? pp?.agency ?? null,
    end: pp?.end ?? pp?.period_of_performance_end ?? pp?.period ?? null,
    keywords: Array.isArray(pp?.keywords)
      ? pp.keywords
      : Array.isArray(pp?.relevance_keywords)
      ? pp.relevance_keywords
      : [],
  }));
}

/**
 * Derive a 0–100 relationship-strength baseline. Prefer the explicit
 * `relationship_strength` column when set; otherwise infer from status so a
 * newly-imported "active" partner still contributes to the partner-fit factor.
 */
export function deriveRelationshipStrength(c: CompanyLike): number {
  if (typeof c.relationship_strength === "number" && c.relationship_strength > 0) {
    return c.relationship_strength;
  }
  switch ((c.relationship_status ?? "").toLowerCase()) {
    case "active": return 60;
    case "prospective": return 20;
    case "inactive": return 10;
    default: return 0;
  }
}

export function buildSelfPwinMember(opts: {
  self: SelfProfileLike;
  isSelfPrime: boolean;
  workShare: number;
  incumbentName?: string | null;
}): PwinTeamMember {
  const { self, isSelfPrime, workShare, incumbentName } = opts;
  const name = self.company_name ?? self.legal_name ?? "Our Company";
  return {
    id: "self",
    name,
    isSelf: true,
    role: isSelfPrime ? "prime" : "sub",
    workShare,
    active: true,
    certifications: self.certifications ?? [],
    naicsCodes: self.naics_codes ?? [],
    contractVehicles: self.vehicles ?? [],
    pastPerformance: self.pastPerf ?? [],
    isIncumbent: !!incumbentName && name.toLowerCase().includes(incumbentName.toLowerCase()),
  };
}

export function buildPartnerPwinMember(
  c: CompanyLike,
  opts: {
    entry?: TeamingEntryLike | null;
    role?: PwinRole;
    workShare?: number;
    isPrime?: boolean;
    incumbentName?: string | null;
  } = {},
): PwinTeamMember {
  const name = c.name ?? c.company_name ?? "Unknown partner";
  const role: PwinRole =
    opts.role ?? ((opts.entry?.role as PwinRole | undefined) ?? "sub");
  const workShare =
    typeof opts.workShare === "number"
      ? opts.workShare
      : Number(opts.entry?.work_share_pct ?? 0);
  const active = !!opts.entry || !!opts.isPrime;
  return {
    id: c.id,
    name,
    isSelf: false,
    role,
    workShare: Number.isFinite(workShare) ? workShare : 0,
    active,
    certifications: c.certifications ?? [],
    naicsCodes: c.naics_codes ?? [],
    contractVehicles: c.contract_vehicles ?? [],
    pastPerformance: mapPartnerPastPerformance(c.past_performance),
    isIncumbent:
      !!opts.incumbentName &&
      name.toLowerCase().includes(opts.incumbentName.toLowerCase()),
    isEstablishedPartner: !!c.is_existing_partner,
    priorContractTogether:
      !!c.prior_contract_together || !!c.worked_together_before,
    hasNda: !!c.has_nda,
    hasTeamingAgreement: !!c.has_teaming_agreement,
    primeRelationshipStrength: deriveRelationshipStrength(c),
  };
}

/**
 * Assemble a full PwinTeamMember[] for the analyzer/summary cards.
 * `entries` is the proposal_teaming rows for this pursuit (partner_id or
 * company_id both accepted).
 */
export function buildPwinMembers(opts: {
  self: SelfProfileLike;
  isSelfPrime: boolean;
  partners: CompanyLike[];
  entries: TeamingEntryLike[];
  incumbentName?: string | null;
  primeContractorId?: string | null;
  primeContractorName?: string | null;
  /**
   * Sub-mode only: our negotiated share under the prime. When undefined in
   * sub mode we default to 20 so the engine has a plausible number.
   * Ignored in prime mode (self share is the remainder there).
   */
  selfWorkSharePct?: number | null;
}): PwinTeamMember[] {
  const {
    self, isSelfPrime, partners, entries, incumbentName,
    primeContractorId, primeContractorName, selfWorkSharePct,
  } = opts;

  const entryMap = new Map<string, TeamingEntryLike>();
  for (const e of entries) {
    const key = (e.company_id ?? e.partner_id) as string | undefined;
    if (key) entryMap.set(key, e);
  }

  const primeNameLower = (primeContractorName ?? "").toLowerCase();
  const rosterPrime = !isSelfPrime
    ? partners.find((p) =>
        (primeContractorId && p.id === primeContractorId) ||
        (primeNameLower && (p.company_name ?? p.name ?? "").toLowerCase() === primeNameLower),
      ) ?? null
    : null;
  const rosterPrimeId = rosterPrime?.id ?? null;

  // Sum shares of "other subs" — exclude any entry that represents the prime
  // itself, so the prime's remainder math stays coherent.
  const otherSubShare = entries.reduce((s, e) => {
    const key = (e.company_id ?? e.partner_id) as string | undefined;
    if (rosterPrimeId && key === rosterPrimeId) return s;
    return s + (Number(e.work_share_pct) || 0);
  }, 0);

  let selfShare: number;
  if (isSelfPrime) {
    selfShare = Math.max(0, 100 - otherSubShare);
  } else {
    const raw = typeof selfWorkSharePct === "number" && Number.isFinite(selfWorkSharePct)
      ? selfWorkSharePct : 20;
    selfShare = Math.max(0, Math.min(100, raw));
  }

  const selfMember = buildSelfPwinMember({
    self, isSelfPrime, workShare: selfShare, incumbentName,
  });

  const primeRemainder = !isSelfPrime
    ? Math.max(0, 100 - selfShare - otherSubShare)
    : 0;

  const partnerMembers: PwinTeamMember[] = [];
  for (const p of partners) {
    const entry = entryMap.get(p.id) ?? null;
    if (rosterPrime && p.id === rosterPrime.id) {
      partnerMembers.push(buildPartnerPwinMember(p, {
        entry,
        role: "prime",
        workShare: primeRemainder,
        isPrime: true,
        incumbentName,
      }));
    } else {
      partnerMembers.push(buildPartnerPwinMember(p, {
        entry,
        role: (entry?.role as PwinRole | undefined) ?? "sub",
        incumbentName,
      }));
    }
  }

  // Sub mode with a named prime that isn't in the roster: add a synthetic
  // prime so the pWin engine's prime-relationship factor has a prime to find.
  if (!isSelfPrime && !rosterPrime && primeContractorName) {
    partnerMembers.push({
      id: "prime-external",
      name: primeContractorName,
      isSelf: false,
      role: "prime",
      workShare: primeRemainder,
      active: true,
      certifications: [],
      naicsCodes: [],
      contractVehicles: [],
      pastPerformance: [],
      isIncumbent:
        !!incumbentName &&
        primeContractorName.toLowerCase().includes(incumbentName.toLowerCase()),
    });
  }

  return [selfMember, ...partnerMembers];
}
