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
}) {
  return [
    [...input.naicsCodes].sort().join(","),
    input.postedFrom,
    input.postedTo,
    (input.keyword || "").trim().toLowerCase(),
  ].join("|");
}

export async function readCache(cacheKey: string) {
  const { data } = await supabase
    .from("cached_searches")
    .select("*")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (data) useLogStore.getState().log("success", `↻ cache hit ${cacheKey.slice(0, 60)}`);
  return data;
}

export async function writeCache(payload: {
  cacheKey: string;
  naicsCodes: string[];
  dateFrom: string;
  dateTo: string;
  keyword?: string;
  opportunities: any;
  historical: any;
  summary: any;
}) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("cached_searches").upsert(
    {
      cache_key: payload.cacheKey,
      naics_codes: payload.naicsCodes,
      date_from: payload.dateFrom,
      date_to: payload.dateTo,
      keyword: payload.keyword || null,
      opportunities: payload.opportunities,
      historical: payload.historical,
      summary: payload.summary,
      expires_at: expiresAt,
    },
    { onConflict: "cache_key" },
  );
  useLogStore.getState().log("info", `↳ cache written (24h TTL)`);
}
