// Deterministic competitive-ecosystem orchestration.
//
// Mirrors the market-snapshot.ts pattern: a client library that sequences
// EXISTING data pulls, feeds the pure engine in ecosystem-rank.ts, and
// persists the result. No AI calls, no new edge functions.

import { supabase } from "@/integrations/supabase/client";
import { searchUsaspending, type HistoricalAward } from "./api";
import { canonicalizeAgencyName } from "./agency-match";
import { naicsFamily } from "./market-snapshot";
import { getEffectiveIncumbent } from "./incumbent-source";
import {
  buildEcosystem,
  type BuildEcosystemResult,
  type EligibilityTier,
  type FactorKey,
  type ScopedAward,
  type VehicleAwardeeInput,
} from "./ecosystem-rank";

export type EcosystemConfig = {
  validatedOverrides?: Record<string, EligibilityTier>;
  weights?: Partial<Record<FactorKey, number>>;
};

export type EcosystemExpansion = "adjacent_naics" | "parent_agency";

export function readEcosystemConfig(proposal: any): EcosystemConfig {
  const raw = (proposal?.ecosystem_config ?? {}) as any;
  return {
    validatedOverrides: (raw?.validatedOverrides ?? {}) as Record<string, EligibilityTier>,
    weights: (raw?.weights ?? {}) as Partial<Record<FactorKey, number>>,
  };
}

export function readEcosystem(proposal: any): BuildEcosystemResult | null {
  const raw = proposal?.ecosystem;
  if (!raw || !Array.isArray(raw?.companies)) return null;
  return raw as BuildEcosystemResult;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "will", "shall",
  "support", "services", "service", "contract", "government", "requirements",
  "task", "order", "program", "provide", "provides", "including",
]);

/** Distinctive keyword tokens from user-curated scope + capture notes. */
export function extractScopeKeywords(proposal: any, max = 8): string[] {
  const raw = [proposal?.targeted_scope_areas, proposal?.capture_notes]
    .filter(Boolean)
    .join(" ");
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of String(raw).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (t.length < 5 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function tag(rows: HistoricalAward[] | undefined, scope: "customer" | "agency"): ScopedAward[] {
  return (rows ?? []).map((r) => ({ ...r, scope }));
}

/** Department-level agency (first path segment) from the proposal agency string. */
function departmentOf(agency: string | null | undefined): string | null {
  const s = String(agency ?? "").trim();
  if (!s) return null;
  const parts = s.split(/[\.\/>|\\]+/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[0] : s;
}

export async function generateEcosystem(
  proposal: any,
  opts?: { expand?: EcosystemExpansion },
  onProgress?: (step: string) => void,
): Promise<BuildEcosystemResult> {
  const progress = onProgress ?? (() => {});
  const naics = proposal?.naics_code ? String(proposal.naics_code) : "";
  if (!naics) throw new Error("This opportunity needs a NAICS code before the ecosystem can be built.");

  const customerAgency = canonicalizeAgencyName(proposal?.agency).canonical || (proposal?.agency ?? null);
  const department = departmentOf(proposal?.agency);

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const awards: ScopedAward[] = [];

  // -- PULL A: NAICS at the customer (sub-tier) --------------------------
  progress("Pulling awards at this customer…");
  try {
    const a = await searchUsaspending({
      naicsCodes: [naics],
      startDate,
      endDate,
      agency: customerAgency ?? undefined,
      maxResults: 1000,
    });
    awards.push(...tag(a.results, "customer"));
  } catch {
    /* non-fatal — the engine tolerates thin evidence */
  }

  // -- PULL B: NAICS at the department -----------------------------------
  if (department && department !== customerAgency) {
    progress("Pulling department-level awards…");
    try {
      const b = await searchUsaspending({
        naicsCodes: [naics],
        startDate,
        endDate,
        agency: department,
        maxResults: 1000,
      });
      awards.push(...tag(b.results, "agency"));
    } catch { /* non-fatal */ }
  }

  // -- Expansion pull ------------------------------------------------------
  if (opts?.expand === "adjacent_naics") {
    progress("Expanding to the adjacent NAICS family…");
    const family = naicsFamily(naics).filter((c) => c !== naics).slice(0, 5);
    if (family.length > 0) {
      try {
        const c = await searchUsaspending({
          naicsCodes: family,
          startDate,
          endDate,
          agency: customerAgency ?? undefined,
          maxResults: 1000,
        });
        awards.push(...tag(c.results, "customer"));
      } catch { /* non-fatal */ }
    }
  } else if (opts?.expand === "parent_agency") {
    progress("Expanding to the parent agency…");
    try {
      const d = await searchUsaspending({
        naicsCodes: [naics],
        startDate,
        endDate,
        agency: department ?? undefined,
        maxResults: 1000,
      });
      awards.push(...tag(d.results, "agency"));
    } catch { /* non-fatal */ }
  }

  // -- Vehicle roster ------------------------------------------------------
  const vehicleId: string | null = proposal?.vehicle_registry_id ?? null;
  let vehicleAwardees: VehicleAwardeeInput[] | null = null;
  if (vehicleId) {
    progress("Loading vehicle awardees…");
    const { data } = await supabase
      .from("vehicle_awardees")
      .select("company_name, uei, small_business, socioeconomic")
      .eq("vehicle_id", vehicleId);
    vehicleAwardees = (data ?? []).map((r: any) => ({
      name: r.company_name,
      uei: r.uei ?? null,
      small_business: r.small_business ?? null,
      socioeconomic: Array.isArray(r.socioeconomic) ? r.socioeconomic : [],
    }));
  }
  const vehicleRestricted = proposal?.vehicle_status === "identified" && !!vehicleId;

  // -- User intel ----------------------------------------------------------
  progress("Folding in your intel…");
  const knownIncumbent = getEffectiveIncumbent(proposal).name;
  const matrixRows: any[] = Array.isArray(proposal?.positioning_matrix?.rows)
    ? proposal.positioning_matrix.rows
    : [];
  const knownCompetitors = matrixRows
    .filter((r) => !r?.isUs && r?.company)
    .map((r) => String(r.company).trim())
    .filter(Boolean);

  const { data: teamingRows } = await supabase
    .from("proposal_teaming")
    .select("company_id, companies:company_id ( name )")
    .eq("proposal_id", proposal.id);
  const knownTeammates = (teamingRows ?? [])
    .map((r: any) => r?.companies?.name)
    .filter(Boolean) as string[];

  // -- Rank ----------------------------------------------------------------
  progress("Ranking the ecosystem…");
  const config = readEcosystemConfig(proposal);
  const result = buildEcosystem({
    awards,
    vehicleAwardees,
    vehicleRestricted,
    opportunity: {
      naicsCode: naics,
      adjacentPrefix: naics.slice(0, 4),
      setAside: proposal?.set_aside ?? null,
      estimatedValue: proposal?.estimated_value ?? null,
      agency: department,
      customerSubAgency: customerAgency,
      scopeKeywords: extractScopeKeywords(proposal),
    },
    userIntel: { knownCompetitors, knownIncumbent, knownTeammates },
    validatedOverrides: config.validatedOverrides ?? {},
    weights: config.weights ?? {},
  });

  progress("Saving…");
  const generatedAt = new Date().toISOString();
  await supabase
    .from("proposals")
    .update({ ecosystem: result as any, ecosystem_at: generatedAt } as any)
    .eq("id", proposal.id);

  return result;
}

/** Persist ecosystem_config (overrides + weights) without regenerating. */
export async function saveEcosystemConfig(
  proposalId: string,
  config: EcosystemConfig,
): Promise<void> {
  await supabase
    .from("proposals")
    .update({ ecosystem_config: config as any } as any)
    .eq("id", proposalId);
}
