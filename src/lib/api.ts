import { supabase } from "@/integrations/supabase/client";
import { useLogStore } from "./log-store";

export type SamOpportunity = {
  title?: string;
  solicitationNumber?: string;
  noticeId?: string;
  fullParentPathName?: string;
  type?: string;
  postedDate?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string; // PSC
  uiLink?: string;
  description?: string;
  setAside?: string;
  typeOfSetAside?: string;
  placeOfPerformance?: any;
};

export type HistoricalAward = {
  "Award ID"?: string;
  "Recipient Name"?: string;
  "Recipient UEI"?: string;
  "Award Amount"?: number;
  "Awarding Agency"?: string;
  "Awarding Sub Agency"?: string;
  "Start Date"?: string;
  "End Date"?: string;
  NAICS?: string;
  Description?: string;
  generated_internal_id?: string;
  "Type of Set Aside"?: string;
  "Contract Award Type"?: string;
  "Parent Award ID"?: string;
  "Product or Service Code"?: string;
  psc_description?: string;
  "Place of Performance State Code"?: string;
  "Place of Performance City Code"?: string;
};

function logCall(name: string) {
  const log = useLogStore.getState().log;
  log("info", `→ ${name}`);
}
function logOk(name: string, msg: string) {
  useLogStore.getState().log("success", `✓ ${name}: ${msg}`);
}
function logErr(name: string, msg: string) {
  useLogStore.getState().log("error", `✗ ${name}: ${msg}`);
}

export async function searchSam(input: {
  naicsCodes: string[];
  postedFrom: string;
  postedTo: string;
  keyword?: string;
}) {
  logCall(`SAM.gov for ${input.naicsCodes.length} NAICS codes`);
  const { data, error } = await supabase.functions.invoke("search-sam", { body: input });
  if (error) {
    logErr("search-sam", error.message);
    throw error;
  }
  if (data?.log) data.log.forEach((l: string) => useLogStore.getState().log("info", `  ${l}`));
  logOk("search-sam", `${data?.opportunities?.length ?? 0} unique opportunities`);
  return data as { opportunities: SamOpportunity[]; errors: any[]; log: string[] };
}

export async function searchUsaspending(input: {
  naicsCodes: string[];
  startDate: string;
  endDate: string;
  keyword?: string;
  maxResults?: number;
}) {
  logCall(`USAspending awards (up to ${input.maxResults ?? 1000})`);
  const { data, error } = await supabase.functions.invoke("search-usaspending", { body: input });
  if (error) {
    logErr("search-usaspending", error.message);
    throw error;
  }
  logOk(
    "search-usaspending",
    `${data?.results?.length ?? 0} of ${data?.page_metadata?.total ?? "?"} awards${data?.page_metadata?.truncated ? " (truncated)" : ""}`,
  );
  return data as {
    results: HistoricalAward[];
    page_metadata: { total: number; fetched: number; hasNext: boolean; truncated: boolean };
  };
}

export async function getAwardDetail(generatedInternalId: string) {
  logCall(`USAspending detail ${generatedInternalId}`);
  const { data, error } = await supabase.functions.invoke("usaspending-detail", {
    body: { generatedInternalId },
  });
  if (error) {
    logErr("usaspending-detail", error.message);
    throw error;
  }
  logOk("usaspending-detail", "ok");
  return data;
}

export type CompeteVendor = {
  recipientId: string | null;
  name: string;
  awards: number;
  totalValue: number;
  avgValue: number;
  mostRecent: string;
  setAside: string;
};

export type CompetitiveIntel = {
  incumbent: {
    top: null | {
      vendor: string; recipientId: string | null; piid: string;
      value: number; popStart: string | null; popEnd: string | null;
      naics: string | null; description: string | null; generatedInternalId: string | null;
    };
    alternates: any[];
  };
  agencyHistory: {
    agencyName: string; totalContracts: number; totalValue: number; avgValue: number;
    vendors: CompeteVendor[];
  };
  marketLandscape: {
    setAside: string | null; totalVendors: number; totalContracts: number;
    totalValue: number; avgValue: number; vendors: CompeteVendor[];
  };
  scorecard: {
    naicsMatch: string; setAsideMatch: string; agencyExperience: string;
    incumbentRisk: string; contractSize: string; competitionLevel: string;
    timeline: string; overall: string;
  };
  cachedAt: string;
  fromCache: boolean;
};

export async function getCompetitiveIntel(input: {
  solicitationNumber?: string;
  title?: string;
  agency: string;
  naicsCode: string;
  setAside?: string;
  postedDate?: string;
  responseDeadLine?: string;
}) {
  logCall(`competitive-intel ${input.naicsCode}`);
  const { data, error } = await supabase.functions.invoke("competitive-intel", { body: input });
  if (error) { logErr("competitive-intel", error.message); throw error; }
  logOk("competitive-intel", data?.fromCache ? "cache hit" : "fresh");
  return data as CompetitiveIntel;
}

export async function getVendorProfile(recipientId: string) {
  logCall(`vendor-profile ${recipientId.slice(0, 12)}`);
  const { data, error } = await supabase.functions.invoke("vendor-profile", {
    body: { recipientId },
  });
  if (error) { logErr("vendor-profile", error.message); throw error; }
  logOk("vendor-profile", `${data?.summary?.totalContracts ?? 0} contracts`);
  return data;
}

export async function getAnalytics(input: {
  naicsCodes: string[];
  startDate: string;
  endDate: string;
}) {
  logCall("USAspending analytics");
  const { data, error } = await supabase.functions.invoke("usaspending-analytics", { body: input });
  if (error) {
    logErr("usaspending-analytics", error.message);
    throw error;
  }
  logOk("usaspending-analytics", "ok");
  return data;
}

export function makeCacheKey(input: {
  naicsCodes: string[];
  postedFrom: string;
  postedTo: string;
  keyword?: string;
  historicalFrom?: string;
}) {
  return [
    "v3", // bump when fetched fields/shape change
    [...input.naicsCodes].sort().join(","),
    input.postedFrom,
    input.postedTo,
    input.historicalFrom || input.postedFrom,
    (input.keyword || "").trim().toLowerCase(),
  ].join("|");
}

export async function readCache(
  cacheKey: string,
  teamId: string,
  input?: { naicsCodes: string[]; postedFrom: string; postedTo: string; keyword?: string; historicalFrom?: string },
) {
  if (!teamId) return null;
  // 1. Exact match (fast path) — scoped to team
  const exact = await supabase
    .from("cached_searches")
    .select("*")
    .eq("team_id", teamId)
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (exact.data) {
    useLogStore.getState().log("success", `↻ cache hit (exact) ${cacheKey.slice(0, 60)}`);
    return exact.data;
  }

  // 2. Superset match within the same team.
  if (!input) return null;
  const kw = (input.keyword || "").trim();
  let q = supabase
    .from("cached_searches")
    .select("*")
    .eq("team_id", teamId)
    .eq("date_from", input.postedFrom)
    .eq("date_to", input.postedTo)
    .contains("naics_codes", input.naicsCodes)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  q = kw ? q.eq("keyword", kw) : q.is("keyword", null);
  if (input.historicalFrom) q = q.filter("summary->>historicalFrom", "eq", input.historicalFrom);
  const { data: candidates } = await q;
  const hit = candidates?.[0];
  if (hit) {
    useLogStore.getState().log(
      "success",
      `↻ cache hit (superset of ${(hit.naics_codes as string[]).length} NAICS)`,
    );
  }
  return hit ?? null;
}

export async function writeCache(payload: {
  cacheKey: string;
  teamId: string;
  naicsCodes: string[];
  dateFrom: string;
  dateTo: string;
  historicalFrom?: string;
  keyword?: string;
  opportunities: any;
  historical: any;
  summary: any;
}) {
  if (!payload.teamId) {
    useLogStore.getState().log("info", "↳ cache skipped (no team selected)");
    return;
  }
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("cached_searches").upsert(
    {
      team_id: payload.teamId,
      cache_key: payload.cacheKey,
      naics_codes: payload.naicsCodes,
      date_from: payload.dateFrom,
      date_to: payload.dateTo,
      keyword: payload.keyword || null,
      opportunities: payload.opportunities,
      historical: payload.historical,
      summary: { ...payload.summary, historicalFrom: payload.historicalFrom },
      expires_at: expiresAt,
    },
    { onConflict: "cache_key" },
  );
  useLogStore.getState().log("info", `↳ cache written (24h TTL)`);
}
