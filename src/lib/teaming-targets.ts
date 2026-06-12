import type { HistoricalAward } from "./api";
import type { CompanyDraft } from "./companies";

export type TeamingTarget = {
  name: string;
  uei: string | null;
  totalValue: number;
  awardCount: number;
  latestAwardDate: string | null;
  latestSetAside: string | null;
  isSmallBusiness: boolean;
  /** "prime" => potential prime to sub under; "partner" => potential teaming partner / sub */
  classification: "prime" | "partner";
  /** Sample of award descriptions for context. */
  sampleDescriptions: string[];
};

const SB_PATTERNS = /SDVOSB|VOSB|SBA|SMALL BUSINESS|8\(?A\)?|WOSB|EDWOSB|HUBZONE|HUB-?ZONE|SDB|VSB/i;

export function isSmallBusinessSetAside(setAside?: string | null): boolean {
  if (!setAside) return false;
  return SB_PATTERNS.test(setAside);
}

/**
 * Aggregate USAspending awards by recipient to produce teaming-target candidates.
 *
 * Large vendors (total value above {@link primeThreshold}) are flagged as
 * potential primes the user should consider subbing under; smaller vendors are
 * flagged as potential teaming partners.
 *
 * If `agency` is provided, only awards whose awarding agency / sub-agency
 * matches (case-insensitive substring) are considered.
 */
export function deriveTeamingTargets(
  awards: HistoricalAward[],
  opts: { agency?: string | null; limit?: number; primeThreshold?: number } = {},
): TeamingTarget[] {
  const { agency, limit = 25, primeThreshold = 10_000_000 } = opts;

  const filtered = agency
    ? awards.filter((w) => {
        const a = agency.toLowerCase();
        return (
          (w["Awarding Agency"] || "").toLowerCase().includes(a) ||
          (w["Awarding Sub Agency"] || "").toLowerCase().includes(a)
        );
      })
    : awards;

  const byVendor = new Map<string, {
    name: string;
    uei: string | null;
    totalValue: number;
    awardCount: number;
    latestAwardDate: string | null;
    latestSetAside: string | null;
    smallBizHits: number;
    descriptions: string[];
  }>();

  for (const a of filtered) {
    const name = a["Recipient Name"];
    if (!name) continue;
    const key = (a["Recipient UEI"] || name).toUpperCase();
    const cur = byVendor.get(key) ?? {
      name,
      uei: a["Recipient UEI"] ?? null,
      totalValue: 0,
      awardCount: 0,
      latestAwardDate: null as string | null,
      latestSetAside: null as string | null,
      smallBizHits: 0,
      descriptions: [] as string[],
    };
    cur.totalValue += Number(a["Award Amount"]) || 0;
    cur.awardCount += 1;
    const d = a["Start Date"] || null;
    if (d && (!cur.latestAwardDate || d > cur.latestAwardDate)) {
      cur.latestAwardDate = d;
      cur.latestSetAside = a["Type of Set Aside"] || cur.latestSetAside;
    }
    if (isSmallBusinessSetAside(a["Type of Set Aside"])) cur.smallBizHits += 1;
    if (a.Description && cur.descriptions.length < 3) cur.descriptions.push(a.Description);
    byVendor.set(key, cur);
  }

  return Array.from(byVendor.values())
    .map((v) => {
      const isSmall = v.smallBizHits > 0;
      return {
        name: v.name,
        uei: v.uei,
        totalValue: v.totalValue,
        awardCount: v.awardCount,
        latestAwardDate: v.latestAwardDate,
        latestSetAside: v.latestSetAside,
        isSmallBusiness: isSmall,
        classification: (!isSmall && v.totalValue >= primeThreshold ? "prime" : "partner") as "prime" | "partner",
        sampleDescriptions: v.descriptions,
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, limit);
}

export function companyFromTeamingTarget(
  t: TeamingTarget,
  teamId: string,
  context: { naicsCodes?: string[]; agency?: string | null } = {},
): CompanyDraft {
  const certs = t.isSmallBusiness && t.latestSetAside ? [t.latestSetAside] : [];
  return {
    team_id: teamId,
    name: t.name,
    uei: t.uei,
    naics_codes: context.naicsCodes ?? [],
    certifications: certs,
    set_asides: certs,
    capabilities_narrative: t.sampleDescriptions.length
      ? `Past performance on similar work: ${t.sampleDescriptions.join(" | ")}`
      : null,
    past_performance: [
      {
        title: `${t.awardCount} prior awards${context.agency ? ` at ${context.agency}` : ""}`,
        customer: context.agency ?? undefined,
        value: t.totalValue,
        period: t.latestAwardDate ?? undefined,
        summary: `Total $${t.totalValue.toLocaleString()} across ${t.awardCount} awards. Latest: ${t.latestAwardDate?.slice(0, 10) ?? "n/a"}.`,
      },
    ],
    source: "teaming_targets",
    external_ref: { recipient_uei: t.uei, classification: t.classification },
    relationship_status: "prospective",
    is_existing_partner: false,
    is_own_company: false,
  };
}
