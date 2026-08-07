// Shared Fed-Spend (fed-spend.com) API client — SERVER ONLY.
//
// Verified against the live API (not their docs):
//   * base: https://fed-spend.com/api/v1
//   * auth: Authorization: Bearer <key>   (x-api-key returns 401)
//   * Cloudflare blocks default/script user agents -> send a browser UA
//   * every query goes through POST /search with a `searchMode`
//   * real rate limit is 10 requests / minute (x-ratelimit-* headers)
//
// Working modes: "awards", "recompete", "subAwards".
// Broken/empty at our tier: entityVerify, samOpportunities, recipients,
// contractGrowth — do not use them.

import type { RecompeteRow, SubawardRow } from "./fedspend-types";
export type { RecompeteRow, SubawardRow };

const BASE = "https://fed-spend.com/api/v1";
const TIMEOUT_MS = 15_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 10 req/min => ~6s between calls. We pace at 6.5s with a little headroom. */
const MIN_GAP_MS = 6_500;

export type FedSpendMode = "awards" | "recompete" | "subAwards";

export interface FedSpendMeta {
  searchMode: string;
  resultsCount?: number;
  maxResults?: number;
  tier?: string;
  source?: string;
}

export interface FedSpendResult<T = Record<string, unknown>> {
  rows: T[];
  meta: FedSpendMeta | null;
  status: number;
  /** x-ratelimit-remaining as reported by the API, when present. */
  rateLimitRemaining: number | null;
  rateLimitLimit: number | null;
}

/** Simple in-process pacing guard. Serialises calls within one invocation. */
let pacingChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

function pace(): Promise<void> {
  const next = pacingChain.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  // Keep the chain alive even if a caller rejects downstream.
  pacingChain = next.catch(() => undefined);
  return next;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class FedSpendError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FedSpendError";
    this.status = status;
  }
}

/**
 * POST /search with the given mode. Throws FedSpendError on missing key,
 * timeout, network failure, or non-2xx response.
 */
export async function searchFedSpend<T = Record<string, unknown>>(
  mode: FedSpendMode,
  params: Record<string, unknown> = {},
): Promise<FedSpendResult<T>> {
  const apiKey = process.env["FED_SPEND_API_KEY"];
  if (!apiKey) throw new FedSpendError("FED_SPEND_API_KEY not configured");

  await pace();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": BROWSER_UA,
      },
      body: JSON.stringify({ searchMode: mode, ...params }),
      signal: controller.signal,
    });

    const rateLimitRemaining = num(res.headers.get("x-ratelimit-remaining"));
    const rateLimitLimit = num(res.headers.get("x-ratelimit-limit"));
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new FedSpendError(
        `Fed-Spend returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`,
        res.status,
      );
    }

    if (!res.ok) {
      const p = payload as Record<string, unknown>;
      const msg = String(p?.["error"] ?? p?.["message"] ?? `HTTP ${res.status}`);
      const detail = Array.isArray(p?.["details"]) ? ` — ${(p["details"] as unknown[]).join("; ")}` : "";
      throw new FedSpendError(`Fed-Spend ${mode}: ${msg}${detail}`, res.status);
    }

    const p = (payload ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(p["data"]) ? (p["data"] as T[]) : [];
    return {
      rows,
      meta: (p["meta"] as FedSpendMeta | undefined) ?? null,
      status: res.status,
      rateLimitRemaining,
      rateLimitLimit,
    };
  } catch (e) {
    if (e instanceof FedSpendError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new FedSpendError(`Fed-Spend ${mode} timed out after ${TIMEOUT_MS}ms`);
    }
    throw new FedSpendError(
      `Fed-Spend ${mode} request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- normalizers

/** Loose company-name normalizer for cross-source matching. */
export function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(INCORPORATED|INC|LLC|L L C|LLP|LP|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|PLC|PC|THE|GROUP|HOLDINGS|SERVICES|SOLUTIONS|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|FEDERAL|GOVERNMENT|USA|US)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two company names loosely refer to the same firm. */
export function looseNameMatch(a: string, b: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 5 && nb.length >= 5) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
}

// ------------------------------------------------------------- shaped results

function placeString(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { city?: string; state?: string };
  const s = [p.city, p.state].filter(Boolean).join(", ");
  return s || null;
}

export function normalizeRecompeteRow(raw: Record<string, unknown>): RecompeteRow {
  const n = (k: string) => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const s = (k: string) => {
    const v = raw[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  return {
    piid: s("piid") ?? s("awardId") ?? "",
    title: s("description"),
    incumbentName: s("recipientName"),
    incumbentUei: s("recipientUei"),
    agency: s("awardingAgency"),
    naicsCode: s("naicsCode"),
    value: n("awardAmount"),
    obligated: n("obligatedAmount"),
    endDate: s("endDate"),
    daysUntilExpiration: n("daysUntilExpiration"),
    urgency: s("urgency"),
    pscCode: s("pscCode"),
    placeOfPerformance: placeString(raw["placeOfPerformance"]),
  };
}

/** FSRS reporting artifacts show up as absurd sub values. */
export const SUBAWARD_SUSPECT_THRESHOLD = 500_000_000;
