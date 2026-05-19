// Shared Tango API client (https://docs.makegov.com).
// Free tier: 100 req/day, 25 req/min, 1 webhook. Always cache.

const BASE_URL = "https://tango.makegov.com";

export class TangoError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body = "") {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type TangoResponse<T> = {
  results: T[];
  count?: number;
  next?: string | null;
  previous?: string | null;
  page?: number;
  page_size?: number;
};

function buildQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      // Tango's current API uses pipe-separated OR filters for multi-value params.
      sp.set(k, v.join("|"));
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function tangoFetch<T = any>(
  endpoint: string,
  params: Record<string, unknown> = {},
  init: RequestInit = {},
): Promise<T> {
  const apiKey = Deno.env.get("TANGO_API_KEY");
  if (!apiKey) throw new TangoError(0, "TANGO_API_KEY not configured");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${BASE_URL}${path}${buildQuery(params)}`;
  const headers = new Headers(init.headers);
  headers.set("X-API-KEY", apiKey);
  headers.set("Accept", "application/json");

  const doFetch = () => fetch(url, { ...init, headers });
  let res = await doFetch();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 3000));
    res = await doFetch();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TangoError(res.status, `Tango ${res.status} on ${endpoint}`, text.slice(0, 500));
  }
  return (await res.json()) as T;
}

// ---------- Helpers ----------

export type TangoPagedParams = {
  page?: number;
  page_size?: number;
};

export function searchOpportunities(params: {
  naics?: string | string[];
  search?: string;
  first_notice_date_after?: string;
  first_notice_date_before?: string;
  response_deadline_from?: string;
  response_deadline_to?: string;
  set_aside?: string;
  active?: boolean;
} & TangoPagedParams) {
  const { page_size, ...rest } = params;
  return tangoFetch<TangoResponse<any>>("/api/opportunities/", { ...rest, limit: page_size });
}

export function searchContracts(params: {
  naics?: string | string[];
  recipient?: string;
  awarding_agency?: string;
  award_date_gte?: string;
  award_date_lte?: string;
  award_amount_min?: number;
  award_amount_max?: number;
  search?: string;
} & TangoPagedParams) {
  const { page_size, page, award_amount_min, award_amount_max, ...rest } = params;
  const query = {
    ...rest,
    obligated_gte: award_amount_min,
    obligated_lte: award_amount_max,
    limit: page_size,
  };
  return tangoFetch<TangoResponse<any> | any[]>("/api/contracts/", query).then((res) =>
    Array.isArray(res) ? { results: res, count: res.length, next: null, previous: null } : res,
  );
}

export function searchEntities(params: {
  search?: string;
  uei?: string;
  name?: string;
  naics?: string;
  socioeconomic?: string;
} & TangoPagedParams) {
  const { page_size, ...rest } = params;
  return tangoFetch<TangoResponse<any>>("/api/entities/", { ...rest, limit: page_size });
}

export function searchSubawards(params: {
  prime_uei?: string;
  sub_uei?: string;
  naics?: string | string[];
} & TangoPagedParams) {
  return tangoFetch<TangoResponse<any>>("/subawards/", params);
}

export function getOpportunityDetail(id: string) {
  return tangoFetch<any>(`/api/opportunities/${encodeURIComponent(id)}/`);
}

export function getContractDetail(id: string) {
  return tangoFetch<any>(`/api/contracts/${encodeURIComponent(id)}/`);
}

// ---------- Field mappers ----------

function pick(o: any, keys: string[]): any {
  for (const k of keys) {
    const v = k.split(".").reduce((acc: any, part) => (acc == null ? acc : acc[part]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

/** Map a Tango opportunity to our cache row shape. */
export function mapOpportunityRow(team_id: string, o: any) {
  return {
    team_id,
    tango_id: String(pick(o, ["id", "tango_id", "noticeId", "notice_id"]) ?? crypto.randomUUID()),
    notice_id: pick(o, ["noticeId", "notice_id"]),
    solicitation_number: pick(o, ["solicitationNumber", "solicitation_number"]),
    title: pick(o, ["title", "name"]) ?? "Untitled",
    description: pick(o, ["description", "summary"]),
    naics_code: pick(o, ["naicsCode", "naics_code", "naics"]),
    naics_description: pick(o, ["naicsDescription", "naics_description"]),
    set_aside: pick(o, ["setAside", "set_aside", "typeOfSetAside"]),
    set_aside_description: pick(o, ["setAsideDescription", "set_aside_description"]),
    classification_code: pick(o, ["classificationCode", "classification_code", "psc"]),
    posted_date: pick(o, ["postedDate", "posted_date"]),
    response_deadline: pick(o, ["responseDeadLine", "response_deadline", "responseDeadline"]),
    archive_date: pick(o, ["archiveDate", "archive_date"]),
    agency: pick(o, ["agency", "fullParentPathName", "department"]),
    office: pick(o, ["office", "subAgency"]),
    place_of_performance: pick(o, ["placeOfPerformance", "place_of_performance"]) ?? null,
    point_of_contact: pick(o, ["pointOfContact", "point_of_contact", "contacts"]) ?? null,
    award_info: pick(o, ["award", "award_info", "awardInfo"]) ?? null,
    source_url: pick(o, ["uiLink", "url", "source_url"]),
    raw_data: o,
  };
}

/** Map a Tango contract to our cache row shape. */
export function mapContractRow(team_id: string, c: any) {
  const naicsObj = c?.NAICS;
  const naicsCode = typeof naicsObj === "object" ? naicsObj?.code : pick(c, ["naicsCode", "naics_code", "naics"]);
  return {
    team_id,
    tango_id: String(pick(c, ["id", "tango_id", "generated_internal_id", "Award ID"]) ?? crypto.randomUUID()),
    piid: pick(c, ["piid", "Award ID"]),
    agency: pick(c, ["awarding_agency", "Awarding Agency", "agency"]),
    vendor_name: pick(c, ["recipient_name", "Recipient Name", "vendor_name"]),
    vendor_uei: pick(c, ["recipient_uei", "Recipient UEI", "vendor_uei", "uei"]),
    vendor_duns: pick(c, ["recipient_duns", "vendor_duns", "duns"]),
    naics_code: naicsCode ? String(naicsCode) : null,
    psc_code: pick(c, ["psc_code", "Product or Service Code", "classification_code"]),
    description: pick(c, ["description", "Description"]),
    award_date: pick(c, ["award_date", "action_date", "Start Date"]),
    period_of_performance_start: pick(c, ["period_of_performance_start_date", "Start Date"]),
    period_of_performance_end: pick(c, ["period_of_performance_current_end_date", "End Date"]),
    obligated_amount: Number(pick(c, ["obligated_amount", "Award Amount", "amount"]) ?? 0) || null,
    base_and_all_options: Number(pick(c, ["base_and_all_options_value", "base_and_all_options"]) ?? 0) || null,
    contract_type: pick(c, ["contract_type", "Contract Award Type", "type"]),
    set_aside: pick(c, ["set_aside", "Type of Set Aside", "type_set_aside"]),
    vehicle: pick(c, ["vehicle", "contract_vehicle", "idv_type"]),
    idv_piid: pick(c, ["idv_piid", "Parent Award ID"]),
    parent_award_id: pick(c, ["parent_award_id", "Parent Award ID"]),
    raw_data: c,
  };
}

export function mapEntityRow(team_id: string, e: any) {
  return {
    team_id,
    tango_id: String(pick(e, ["id", "tango_id", "uei", "duns"]) ?? crypto.randomUUID()),
    uei: pick(e, ["uei", "UEI"]),
    cage_code: pick(e, ["cage_code", "cageCode", "cage"]),
    legal_name: pick(e, ["legal_name", "legalBusinessName", "name"]),
    dba_name: pick(e, ["dba_name", "dbaName"]),
    naics_codes: pick(e, ["naics_codes", "naicsCodes"]) ?? [],
    small_business_types: pick(e, ["small_business_types", "businessTypes", "certifications"]) ?? [],
    city: pick(e, ["city", "address.city"]),
    state: pick(e, ["state", "address.state"]),
    country: pick(e, ["country", "address.country"]),
    raw_data: e,
  };
}

// ---------- Frontend-shape adapters ----------

/** Convert a cached Tango opportunity row back to the SAM-style shape the frontend expects. */
export function opportunityRowToSamShape(row: any): any {
  const r = row.raw_data ?? row;
  return {
    title: row.title ?? r.title,
    solicitationNumber: row.solicitation_number ?? r.solicitationNumber,
    noticeId: row.notice_id ?? r.noticeId ?? row.tango_id,
    fullParentPathName: row.agency ?? r.fullParentPathName,
    type: r.type ?? r.opportunity_type ?? null,
    postedDate: row.posted_date ?? r.postedDate,
    responseDeadLine: row.response_deadline ?? r.responseDeadLine,
    naicsCode: row.naics_code ?? r.naicsCode,
    classificationCode: row.classification_code ?? r.classificationCode,
    uiLink: row.source_url ?? r.uiLink,
    description: row.description ?? r.description,
    setAside: row.set_aside ?? r.setAside,
    typeOfSetAside: row.set_aside ?? r.typeOfSetAside,
    placeOfPerformance: row.place_of_performance ?? r.placeOfPerformance,
  };
}

/** Convert a cached Tango contract row back to the USAspending-style shape the frontend expects. */
export function contractRowToUsaspendingShape(row: any): any {
  return {
    "Award ID": row.piid,
    "Recipient Name": row.vendor_name,
    "Recipient UEI": row.vendor_uei,
    "Award Amount": row.obligated_amount,
    "Awarding Agency": row.agency,
    "Awarding Sub Agency": row.raw_data?.["Awarding Sub Agency"] ?? null,
    "Start Date": row.period_of_performance_start ?? row.award_date,
    "End Date": row.period_of_performance_end,
    NAICS: row.naics_code,
    Description: row.description,
    generated_internal_id: row.tango_id,
    "Type of Set Aside": row.set_aside,
    "Contract Award Type": row.contract_type,
    "Parent Award ID": row.parent_award_id,
    "Product or Service Code": row.psc_code,
    psc_description: row.raw_data?.psc_description ?? null,
    "Place of Performance State Code": row.raw_data?.["Place of Performance State Code"] ?? null,
    "Place of Performance City Code": row.raw_data?.["Place of Performance City Code"] ?? null,
  };
}

// ---------- Usage gating ----------

export const DAILY_LIMIT = 100;
export const DAILY_BUFFER = 10;

export async function checkDailyUsage(supabase: any, team_id: string): Promise<{ used: number; remaining: number; allowed: boolean }> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("tango_api_usage")
    .select("id", { count: "exact", head: true })
    .eq("team_id", team_id)
    .eq("cached", false)
    .gte("called_at", since.toISOString());
  const used = count ?? 0;
  const allowed = used < DAILY_LIMIT - DAILY_BUFFER;
  return { used, remaining: Math.max(0, DAILY_LIMIT - used), allowed };
}

export async function logUsage(
  supabase: any,
  row: { team_id: string; endpoint: string; params: any; response_status?: number; cached: boolean },
) {
  try {
    await supabase.from("tango_api_usage").insert(row);
  } catch (e) {
    console.error("tango usage log failed", e);
  }
}
