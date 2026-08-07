// TEMPORARY provider-evaluation harness for fed-spend.com.
// Admin / team-owner gated, user-triggered only. Runs four isolated probes
// against https://fed-spend.com/api/v1 and returns raw results.
// NOTHING is persisted to the database.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BASE = "https://fed-spend.com/api/v1";
const TIMEOUT_MS = 15_000;

export interface FedSpendTestResult {
  id: string;
  label: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  count: number | null;
  headers: Record<string, string>;
  notes: string[];
  raw: unknown;
  extras: Record<string, unknown>;
}

export interface FedSpendVerifyResponse {
  error?: string;
  message?: string;
  tests?: FedSpendTestResult[];
}

const RATE_HEADER_RE = /^(x-ratelimit|ratelimit|retry-after|x-quota)/i;

function pickRateHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    if (RATE_HEADER_RE.test(k)) out[k] = v;
  });
  return out;
}

function hasRecipientKey(obj: unknown, depth = 0): boolean {
  if (!obj || typeof obj !== "object" || depth > 4) return false;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/recipient|vendor|uei/i.test(k)) return true;
    if (hasRecipientKey(v, depth + 1)) return true;
  }
  return false;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  for (const key of ["results", "data", "awards", "opportunities", "rows", "items"]) {
    const v = p[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

async function probe(
  id: string,
  label: string,
  apiKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<FedSpendTestResult> {
  const result: FedSpendTestResult = {
    id, label, ok: false, status: null, error: null, count: null,
    headers: {}, notes: [], raw: null, extras: {},
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    result.status = res.status;
    result.headers = pickRateHeaders(res.headers);
    const text = await res.text();
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      result.notes.push("response was not valid JSON");
    }

    if (res.status === 403) result.notes.push("403 — likely Professional-tier gating for this endpoint");
    if (res.status === 401) result.notes.push("401 — API key rejected (check FED_SPEND_API_KEY)");
    if (res.status === 429) result.notes.push("429 — rate limited");

    const rows = extractRows(payload);
    result.count = rows.length;
    result.raw = payload;
    result.ok = res.ok;

    const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    if (p["meta"] !== undefined) result.extras["meta"] = p["meta"];
    if (p["stats"] !== undefined) result.extras["stats"] = p["stats"];
    if (p["total"] !== undefined) result.extras["total"] = p["total"];
    result.extras["rows"] = rows;
    return result;
  } catch (e) {
    result.error = e instanceof Error
      ? (e.name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : e.message)
      : String(e);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export const runFedSpendVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FedSpendVerifyResponse> => {
    const { supabase, userId } = context;

    // Authorization: app admin OR team owner/admin (RLS-scoped reads).
    const [{ data: roleRow }, { data: teamRoles }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      supabase.from("team_members").select("role").eq("user_id", userId),
    ]);
    const isAppAdmin = (roleRow as { role?: string } | null)?.role === "admin";
    const isTeamAdmin = ((teamRoles ?? []) as Array<{ role?: string }>).some(
      (r) => r.role === "owner" || r.role === "admin",
    );
    if (!isAppAdmin && !isTeamAdmin) {
      return { error: "forbidden", message: "Fed-Spend verification requires admin or team owner role" };
    }

    const apiKey = process.env["FED_SPEND_API_KEY"];
    if (!apiKey) {
      return { error: "missing_secret", message: "Add FED_SPEND_API_KEY in project secrets first." };
    }

    const [t1, t2, t3] = await Promise.all([
      probe("t1", "T1 — recipient fields (POST /search awards)", apiKey, "/search", {
        method: "POST",
        body: { searchMode: "awards", naicsCode: "541512", maxResults: 25 },
      }),
      probe("t2", "T2 — recompete (GET /recompete)", apiKey, "/recompete?maxDays=180&limit=25", {
        method: "GET",
      }),
      probe("t3", "T3 — opportunity search (POST /search opportunities)", apiKey, "/search", {
        method: "POST",
        body: {
          searchMode: "opportunities",
          naicsCode: "541512",
          agency: "Defense Health Agency",
          maxResults: 10,
        },
      }),
    ]);

    // T1 specifics: first 2 rows verbatim + recipient-field detection.
    const t1Rows = (t1.extras["rows"] as unknown[] | undefined) ?? [];
    t1.extras = {
      ...t1.extras,
      first_two: t1Rows.slice(0, 2),
      fields_have_recipient: t1Rows.slice(0, 2).some((r) => hasRecipientKey(r)),
    };
    delete t1.extras["rows"];

    // T2 specifics: first 3 rows + presence checks.
    const t2Rows = (t2.extras["rows"] as unknown[] | undefined) ?? [];
    const t2First = t2Rows.slice(0, 3);
    const hasKey = (rows: unknown[], key: string) =>
      rows.some((r) => !!r && typeof r === "object" && key in (r as Record<string, unknown>));
    t2.extras = {
      ...t2.extras,
      first_three: t2First,
      has_incumbent: hasKey(t2First, "incumbent"),
      has_expiration_date: hasKey(t2First, "expirationDate"),
      has_recompete_score: hasKey(t2First, "recompeteScore"),
      professional_tier_gated: t2.status === 403,
    };
    delete t2.extras["rows"];

    // T3 specifics: first 2 rows.
    const t3Rows = (t3.extras["rows"] as unknown[] | undefined) ?? [];
    t3.extras = { ...t3.extras, first_two: t3Rows.slice(0, 2) };
    delete t3.extras["rows"];

    // T4: aggregate rate-limit signals observed across the three calls.
    const headersByTest: Record<string, Record<string, string>> = {
      t1: t1.headers, t2: t2.headers, t3: t3.headers,
    };
    const anyHeaders = Object.values(headersByTest).some((h) => Object.keys(h).length > 0);
    const quotaMeta = [t1, t2, t3]
      .filter((t) => t.extras["meta"] !== undefined)
      .map((t) => ({ test: t.id, meta: t.extras["meta"] }));
    const t4: FedSpendTestResult = {
      id: "t4",
      label: "T4 — rate-limit headers & quota metadata",
      ok: true,
      status: null,
      error: null,
      count: null,
      headers: {},
      notes: anyHeaders ? [] : ["no rate-limit headers observed on any call"],
      raw: { headersByTest, quotaMeta },
      extras: { any_rate_limit_headers: anyHeaders, quota_meta_count: quotaMeta.length },
    };

    return { tests: [t1, t2, t3, t4] };
  });
