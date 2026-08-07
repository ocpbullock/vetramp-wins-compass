// TEMPORARY provider-evaluation harness for fed-spend.com.
// Admin / team-owner gated, user-triggered only. Runs four isolated probes
// against https://fed-spend.com/api/v1 and returns raw results.
// NOTHING is persisted to the database.
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
  raw: any;
  extras: Record<string, any>;
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

export function hasRecipientKey(obj: unknown, depth = 0): boolean {
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

export async function probe(
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
