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
