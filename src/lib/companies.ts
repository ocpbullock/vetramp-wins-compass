import { supabase } from "@/integrations/supabase/client";

export type PastPerfEntry = {
  title?: string;
  customer?: string;
  value?: string | number;
  period?: string;
  role?: string;
  summary?: string;
};

export type Company = {
  id: string;
  team_id: string;
  name: string;
  uei: string | null;
  cage_code: string | null;
  duns: string | null;
  website: string | null;
  certifications: string[];
  set_asides: string[];
  naics_codes: string[];
  contract_vehicles: string[];
  capabilities_narrative: string | null;
  past_performance: PastPerfEntry[];
  poc_name: string | null;
  poc_email: string | null;
  poc_phone: string | null;
  is_own_company: boolean;
  is_existing_partner: boolean;
  worked_together_before: boolean;
  relationship_strength: number | null;
  relationship_status: "active" | "prospective" | "inactive";
  /** Mutual NDA signed. Feeds partner-fit bonus in pWin. */
  has_nda: boolean;
  /** Teaming agreement (TA) on file. Feeds partner-fit bonus in pWin. */
  has_teaming_agreement: boolean;
  /** Jointly performed on a prior contract. Feeds partner-fit bonus in pWin. */
  prior_contract_together: boolean;
  /**
   * Forward-looking field for a future cross-org teaming marketplace.
   * Always 'private' today; other values are reserved.
   */
  marketplace_visibility: "private" | "team" | "org" | "public";
  /** Reserved JSON envelope for marketplace metadata; unused until marketplace ships. */
  marketplace_listing: Record<string, unknown>;
  source: string;
  external_ref: any;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyDraft = Partial<Omit<Company, "id" | "created_at" | "updated_at">> & {
  name: string;
  team_id: string;
};

export async function listCompanies(teamId: string): Promise<Company[]> {
  const { data, error } = await supabase
    .from("companies" as any)
    .select("*")
    .eq("team_id", teamId)
    .order("is_own_company", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Company[];
}

export async function getOwnCompany(teamId: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from("companies" as any)
    .select("*")
    .eq("team_id", teamId)
    .eq("is_own_company", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Company) ?? null;
}

/**
 * Legacy company_profile.profile_data shape, sourced from the team's
 * own-company row in `companies`. The trigger on company_profile mirrors
 * profile_data into companies.external_ref.profile_data so the proposal
 * flow can keep reading the same blob without dual-writing.
 */
export async function getOwnCompanyProfileData(teamId: string | null | undefined): Promise<any | null> {
  if (!teamId) return null;
  const own = await getOwnCompany(teamId);
  if (!own) return null;
  const ref = own.external_ref as { profile_data?: any } | null | undefined;
  return ref?.profile_data ?? null;
}

export async function upsertCompany(draft: CompanyDraft & { id?: string }): Promise<Company> {
  const { id, ...rest } = draft;
  if (id) {
    const { data, error } = await supabase
      .from("companies" as any)
      .update(rest)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as Company;
  }
  const { data, error } = await supabase
    .from("companies" as any)
    .insert(rest)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as Company;
}

export async function deleteCompany(id: string): Promise<void> {
  const { error } = await supabase.from("companies" as any).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Companies-as-partners adapter
// ---------------------------------------------------------------------------
// The proposal-side UI used to read its teaming roster from `teaming_partners`.
// That table is now a back-compat shim; `companies` is the source of truth.
// These helpers expose the legacy row shape so consumers can migrate without
// rewriting every render path.

export type PartnerView = {
  id: string;
  team_id: string;
  company_name: string;
  uei: string | null;
  cage_code: string | null;
  poc_name: string | null;
  poc_email: string | null;
  poc_phone: string | null;
  certifications: string[];
  naics_codes: string[];
  capabilities_summary: string | null;
  past_performance_summary: string | null;
  contract_vehicles: string[];
  relationship_status: "active" | "prospective" | "inactive";
  relationship_strength: number | null;
  worked_together_before: boolean;
  is_existing_partner: boolean;
  notes: string | null;
};

export function companyToPartnerView(c: Company): PartnerView {
  const ppSummary = Array.isArray(c.past_performance) && c.past_performance.length > 0
    ? (c.past_performance[0]?.summary ?? null)
    : null;
  return {
    id: c.id,
    team_id: c.team_id,
    company_name: c.name,
    uei: c.uei,
    cage_code: c.cage_code,
    poc_name: c.poc_name,
    poc_email: c.poc_email,
    poc_phone: c.poc_phone,
    certifications: c.certifications ?? [],
    naics_codes: c.naics_codes ?? [],
    capabilities_summary: c.capabilities_narrative,
    past_performance_summary: ppSummary,
    contract_vehicles: c.contract_vehicles ?? [],
    relationship_status: c.relationship_status,
    relationship_strength: c.relationship_strength,
    worked_together_before: c.worked_together_before,
    is_existing_partner: c.is_existing_partner,
    notes: c.notes,
  };
}

/** All non-own companies on a team, mapped to the legacy partner shape. */
export async function listPartnerCompanies(teamId: string): Promise<PartnerView[]> {
  const { data, error } = await supabase
    .from("companies" as any)
    .select("*")
    .eq("team_id", teamId)
    .eq("is_own_company", false)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Company[]).map(companyToPartnerView);
}

/** Count companies on the team flagged as existing teaming partners. */
export async function countPartnerCompanies(teamId: string): Promise<number> {
  const { count, error } = await supabase
    .from("companies" as any)
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("is_existing_partner", true)
    .eq("is_own_company", false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Distinct set of contract vehicles held by partner companies. */
export async function listPartnerContractVehicles(teamId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("companies" as any)
    .select("contract_vehicles")
    .eq("team_id", teamId)
    .eq("is_own_company", false);
  if (error) throw new Error(error.message);
  const out = new Set<string>();
  for (const row of (data ?? []) as { contract_vehicles?: string[] | null }[]) {
    for (const v of row.contract_vehicles ?? []) out.add(v);
  }
  return Array.from(out);
}

/**
 * Find an existing companies row matching a SAM/Tango entity (by UEI or
 * exact name) or insert a new one flagged as an existing teaming partner.
 */
export async function findOrInsertPartnerFromSamEntity(
  teamId: string,
  entity: any,
): Promise<PartnerView | null> {
  // Normalize both SAM.gov-shaped and Tango-shaped entities into a draft.
  const samDraft = companyFromSamEntity(entity, teamId);
  const tangoName = entity.legal_name || entity.dba_name || null;
  const tangoUei = entity.uei || null;
  const draft: CompanyDraft = {
    ...samDraft,
    name: samDraft.name === "Unknown entity" && tangoName ? tangoName : samDraft.name,
    uei: samDraft.uei ?? tangoUei,
    cage_code: samDraft.cage_code ?? (entity.cage_code ?? null),
    certifications: samDraft.certifications?.length ? samDraft.certifications : (entity.small_business_types ?? []),
    naics_codes: samDraft.naics_codes?.length ? samDraft.naics_codes : (entity.naics_codes ?? []),
  };
  const matchCol = draft.uei ? "uei" : "name";
  const matchVal = draft.uei ?? draft.name;
  const { data: existing, error: lookupErr } = await supabase
    .from("companies" as any)
    .select("*")
    .eq("team_id", teamId)
    .eq(matchCol, matchVal)
    .limit(1)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (existing) return companyToPartnerView(existing as unknown as Company);

  const inserted = await upsertCompany({
    ...draft,
    is_existing_partner: true,
    notes: `Imported from entity search · ${entity.city ?? ""} ${entity.state ?? ""}`.trim(),
  });
  return companyToPartnerView(inserted);
}

/** Build a company draft from a vendor-profile lookup (USAspending/our getVendorProfile). */
export function companyFromVendorLookup(payload: any, teamId: string): CompanyDraft {
  const p = payload?.profile ?? {};
  const naics = (payload?.naicsBreakdown ?? [])
    .slice(0, 8)
    .map((n: any) => String(n.code))
    .filter(Boolean);
  return {
    team_id: teamId,
    name: p.recipient_name || p.name || payload?.recipientName || "Unknown vendor",
    uei: p.uei ?? null,
    duns: p.duns ?? null,
    website: p.website ?? null,
    naics_codes: naics,
    certifications: (p.business_types as string[] | undefined) ?? [],
    capabilities_narrative: payload?.summary
      ? `${payload.summary.totalContracts} contracts, ~$${payload.summary.totalValue?.toLocaleString?.() ?? ""} total.`
      : null,
    source: "vendor_lookup",
    external_ref: { recipient_id: payload?.recipientId, profile: p },
    relationship_status: "prospective",
  };
}

/** Build a company draft from a SAM.gov / search-entities result. */
export function companyFromSamEntity(entity: any, teamId: string): CompanyDraft {
  return {
    team_id: teamId,
    name: entity.legalBusinessName || entity.name || entity.entityName || "Unknown entity",
    uei: entity.ueiSAM || entity.uei || null,
    cage_code: entity.cageCode || entity.cage_code || null,
    website: entity.entityURL || entity.website || null,
    naics_codes: Array.isArray(entity.naicsList)
      ? entity.naicsList.map((n: any) => String(n.code || n)).filter(Boolean)
      : Array.isArray(entity.naics_codes)
      ? entity.naics_codes
      : [],
    certifications: Array.isArray(entity.certifications) ? entity.certifications : [],
    set_asides: Array.isArray(entity.businessTypes) ? entity.businessTypes : [],
    source: "sam_gov",
    external_ref: { entity },
    relationship_status: "prospective",
  };
}
