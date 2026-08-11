// Deterministic competitive-ecosystem orchestration.
//
// Mirrors the market-snapshot.ts pattern: a client library that sequences
// EXISTING data pulls, feeds the pure engine in ecosystem-rank.ts, and
// persists the result. No AI calls, no new edge functions.

import { supabase } from "@/integrations/supabase/client";
import { searchUsaspending, type HistoricalAward } from "./api";
import { canonicalizeAgencyName, splitAgencyPath } from "./agency-match";
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

export type EcosystemUserIntel = {
  /** Manually entered competitor names (merged with positioning-matrix rows). */
  knownCompetitors?: string[];
  /** Manually entered teammate names (merged with proposal_teaming rows). */
  knownTeammates?: string[];
};

export type EcosystemConfig = {
  validatedOverrides?: Record<string, EligibilityTier>;
  weights?: Partial<Record<FactorKey, number>>;
  userIntel?: EcosystemUserIntel;
};

export type EcosystemExpansion = "adjacent_naics" | "parent_agency";

export function readEcosystemConfig(proposal: any): EcosystemConfig {
  const raw = (proposal?.ecosystem_config ?? {}) as any;
  return {
    validatedOverrides: (raw?.validatedOverrides ?? {}) as Record<string, EligibilityTier>,
    weights: (raw?.weights ?? {}) as Partial<Record<FactorKey, number>>,
    userIntel: {
      knownCompetitors: Array.isArray(raw?.userIntel?.knownCompetitors) ? raw.userIntel.knownCompetitors : [],
      knownTeammates: Array.isArray(raw?.userIntel?.knownTeammates) ? raw.userIntel.knownTeammates : [],
    },
  };
}

export function readEcosystem(proposal: any): StoredEcosystem | null {
  const raw = proposal?.ecosystem;
  if (!raw || !Array.isArray(raw?.companies)) return null;
  return raw as StoredEcosystem;
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

/** Case-insensitive dedupe preserving first-seen casing. */
function dedupeNames(names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = String(n ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function tag(rows: HistoricalAward[] | undefined, scope: "customer" | "agency"): ScopedAward[] {
  return (rows ?? []).map((r) => ({ ...r, scope }));
}

/** Department-level agency (first path segment) from the proposal agency string. */
function departmentOf(agency: string | null | undefined): string | null {
  const parts = splitAgencyPath(agency);
  return parts.length > 0 ? parts[0] : null;
}

/** Set-aside pools whose membership is itself evidence of the socio status. */
const VEHICLE_SET_ASIDE_PATTERNS: { re: RegExp; setAside: string }[] = [
  { re: /sdvosb|service[- ]disabled/i, setAside: "SDVOSB" },
  { re: /8\s*\(\s*a\s*\)/i, setAside: "8(a)" },
  { re: /edwosb/i, setAside: "EDWOSB" },
  { re: /wosb|woman[- ]owned|women[- ]owned/i, setAside: "WOSB" },
  { re: /hubzone/i, setAside: "HUBZone" },
  { re: /\bvosb\b|veteran[- ]owned/i, setAside: "VOSB" },
];

/** Infer a set-aside from a pool/vehicle name, or null when it implies none. */
export function inferSetAsideFromVehicleName(name: string | null | undefined): string | null {
  const s = String(name ?? "");
  if (!s.trim()) return null;
  for (const p of VEHICLE_SET_ASIDE_PATTERNS) if (p.re.test(s)) return p.setAside;
  return null;
}

export type EcosystemInputsMeta = {
  setAside: string | null;
  setAsideSource: "opportunity" | "inferred_from_vehicle" | "none";
  agency: string | null;
  customerSubAgency: string | null;
  vehicleName?: string | null;
};

export type StoredEcosystem = BuildEcosystemResult & { inputs?: EcosystemInputsMeta };

export function readEcosystemInputs(proposal: any): EcosystemInputsMeta | null {
  const raw = proposal?.ecosystem?.inputs;
  return raw && typeof raw === "object" ? (raw as EcosystemInputsMeta) : null;
}


export async function generateEcosystem(
  proposal: any,
  opts?: { expand?: EcosystemExpansion },
  onProgress?: (step: string) => void,
): Promise<StoredEcosystem> {
  const progress = onProgress ?? (() => {});
  const naics = proposal?.naics_code ? String(proposal.naics_code) : "";
  if (!naics) throw new Error("This opportunity needs a NAICS code before the ecosystem can be built.");

  const customerAgency = canonicalizeAgencyName(proposal?.agency).canonical || (proposal?.agency ?? null);
  const department = departmentOf(proposal?.agency);
  // Evidence lines and the department pull must both use the cleaned name.
  const departmentDisplay = department ? (canonicalizeAgencyName(department).display || department) : null;

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
        agency: departmentDisplay ?? undefined,
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
        agency: departmentDisplay ?? undefined,
        maxResults: 1000,
      });
      awards.push(...tag(d.results, "agency"));
    } catch { /* non-fatal */ }
  }

  // -- Vehicle roster ------------------------------------------------------
  // NOTE: no team filter here on purpose — the RLS SELECT policy on
  // vehicle_awardees already returns BOTH global rows (team_id IS NULL) and the
  // caller's own team rows, so filtering client-side would silently drop half
  // the roster.
  const vehicleId: string | null = proposal?.vehicle_registry_id ?? null;
  let vehicleAwardees: VehicleAwardeeInput[] | null = null;
  let vehicleName: string | null = (proposal?.opportunity_data as any)?.contract_vehicle ?? null;
  if (vehicleId) {
    progress("Loading vehicle awardees…");
    const { data: veh } = await supabase
      .from("vehicle_registry")
      .select("vehicle_name")
      .eq("id", vehicleId)
      .maybeSingle();
    vehicleName = (veh as any)?.vehicle_name ?? vehicleName;
    const { data } = await supabase
      .from("vehicle_awardees")
      .select("company_name, uei, small_business, socioeconomic, team_id")
      .eq("vehicle_id", vehicleId);
    vehicleAwardees = (data ?? [])
      .map((r: any) => ({
        name: String(r.company_name ?? "").trim(),
        uei: r.uei ?? null,
        // Only `true` is authoritative. Bulk imports default this column to
        // false when the source file has no size column, and a literal false
        // makes the engine hard-disqualify the holder on a small-business
        // set-aside. Treat anything but an explicit true as "unknown".
        small_business: r.small_business === true ? true : null,
        socioeconomic: Array.isArray(r.socioeconomic) ? r.socioeconomic : [],
      }))
      .filter((v) => !!v.name);
  }
  const vehicleRestricted = proposal?.vehicle_status === "identified" && !!vehicleId;

  // -- Effective set-aside --------------------------------------------------
  // A pool vehicle (e.g. "Polaris SDVOSB Pool") IS the set-aside for actions
  // competed under it; an empty proposal field would otherwise grade every
  // holder as unverifiable.
  const declaredSetAside = String(proposal?.set_aside ?? "").trim() || null;
  const inferredSetAside = declaredSetAside ? null : inferSetAsideFromVehicleName(vehicleName);
  const effectiveSetAside = declaredSetAside ?? inferredSetAside;
  const setAsideSource: EcosystemInputsMeta["setAsideSource"] = declaredSetAside
    ? "opportunity"
    : inferredSetAside
      ? "inferred_from_vehicle"
      : "none";

  // -- User intel ----------------------------------------------------------
  progress("Folding in your intel…");
  const knownIncumbent = getEffectiveIncumbent(proposal).name;
  const matrixRows: any[] = Array.isArray(proposal?.positioning_matrix?.rows)
    ? proposal.positioning_matrix.rows
    : [];
  const matrixCompetitors = matrixRows
    .filter((r) => !r?.isUs && r?.company)
    .map((r) => String(r.company).trim())
    .filter(Boolean);

  const { data: teamingRows } = await supabase
    .from("proposal_teaming")
    .select("company_id, companies:company_id ( name )")
    .eq("proposal_id", proposal.id);
  const teamingNames = (teamingRows ?? [])
    .map((r: any) => r?.companies?.name)
    .filter(Boolean) as string[];

  const config = readEcosystemConfig(proposal);
  const knownCompetitors = dedupeNames([
    ...matrixCompetitors,
    ...(config.userIntel?.knownCompetitors ?? []),
  ]);
  const knownTeammates = dedupeNames([
    ...teamingNames,
    ...(config.userIntel?.knownTeammates ?? []),
  ]);

  // -- Rank ----------------------------------------------------------------
  progress("Ranking the ecosystem…");
  // When the action is locked to a vehicle, every holder must survive the cap —
  // a holder with no award history is still a real bidder on this action.
  const holderCount = vehicleAwardees?.length ?? 0;
  const targetSize =
    vehicleRestricted && holderCount > 0
      ? { min: 10, max: Math.max(18, holderCount + 12) }
      : undefined;

  const result = buildEcosystem({
    awards,
    vehicleAwardees,
    vehicleRestricted,
    opportunity: {
      naicsCode: naics,
      adjacentPrefix: naics.slice(0, 4),
      setAside: effectiveSetAside,
      estimatedValue: proposal?.estimated_value ?? null,
      agency: departmentDisplay,
      customerSubAgency: customerAgency,
      scopeKeywords: extractScopeKeywords(proposal),
    },
    userIntel: { knownCompetitors, knownIncumbent, knownTeammates },
    validatedOverrides: config.validatedOverrides ?? {},
    weights: config.weights ?? {},
    ...(targetSize ? { targetSize } : {}),
  });

  progress("Saving…");
  const stored: StoredEcosystem = {
    ...result,
    inputs: {
      setAside: effectiveSetAside,
      setAsideSource,
      agency: departmentDisplay,
      customerSubAgency: customerAgency,
      vehicleName,
    },
  };
  const generatedAt = new Date().toISOString();
  await supabase
    .from("proposals")
    .update({ ecosystem: stored as any, ecosystem_at: generatedAt } as any)
    .eq("id", proposal.id);

  return stored;
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
