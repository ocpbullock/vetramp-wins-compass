// Shared AI gateway client with retry, fallback provider support,
// timeout handling, response cache, monthly budget enforcement, and usage logging.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type Provider = "lovable" | "openai" | "anthropic";

interface ProviderConfig {
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  lovable: {
    baseUrl: "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKeyEnv: "LOVABLE_API_KEY",
    defaultModel: "google/gemini-2.5-pro",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/chat/completions",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-sonnet-latest",
  },
};

// Rough $/1k token pricing (input/output). Update as pricing changes.
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-pro": { in: 0.00125, out: 0.005 },
  "google/gemini-2.5-flash": { in: 0.000075, out: 0.0003 },
  "google/gemini-2.5-flash-lite": { in: 0.00004, out: 0.00015 },
  "google/gemini-3-flash-preview": { in: 0.000075, out: 0.0003 },
  "openai/gpt-5": { in: 0.005, out: 0.015 },
  "openai/gpt-5-mini": { in: 0.0003, out: 0.0012 },
  "openai/gpt-5-nano": { in: 0.00005, out: 0.0002 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "claude-3-5-sonnet-latest": { in: 0.003, out: 0.015 },
};

/**
 * Per-call model routing. Adjust here without touching each function.
 * Resolver receives a free-form variant key (e.g. section id) and picks the model.
 */
export const MODEL_CONFIG = {
  "parse-sow": { default: "google/gemini-2.5-pro" },
  "customer-intel": { default: "google/gemini-2.5-flash" },
  "generate-proposal-section": {
    default: "google/gemini-3-flash-preview",
    bySection: {
      cover_letter: "google/gemini-2.5-pro",
      executive_summary: "google/gemini-2.5-pro",
      technical_approach: "google/gemini-2.5-flash",
      management_approach: "google/gemini-2.5-flash",
      staffing_plan: "google/gemini-2.5-flash",
      past_performance: "google/gemini-2.5-flash",
      compliance_matrix: "google/gemini-2.5-flash-lite",
    } as Record<string, string>,
  },
  "generate-proposal": { default: "google/gemini-2.5-pro" },
} as const;

export function pickModel(functionName: string, variant?: string): string {
  const cfg = (MODEL_CONFIG as any)[functionName];
  if (!cfg) return "google/gemini-3-flash-preview";
  if (variant && cfg.bySection?.[variant]) return cfg.bySection[variant];
  return cfg.default;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2_000;
const RATE_LIMIT_WAIT_MS = 30_000;

export class AITimeoutError extends Error {
  constructor() {
    super("AI processing timed out — the document may be too large. Try uploading fewer or smaller files.");
    this.name = "AITimeoutError";
  }
}
export class AIRateLimitError extends Error {
  constructor() { super("Rate limit exceeded after multiple retries. Try again in a few minutes."); this.name = "AIRateLimitError"; }
}
export class AICreditsError extends Error {
  constructor() { super("AI credits exhausted. Add funds in Workspace settings."); this.name = "AICreditsError"; }
}
export class AIServiceUnavailableError extends Error {
  constructor(public cause?: unknown) {
    super("AI service is temporarily unavailable. Your documents and data are safe — try again in a few minutes.");
    this.name = "AIServiceUnavailableError";
  }
}
export class AIBudgetExceededError extends Error {
  constructor(public used: number, public budget: number) {
    super(`Monthly AI budget exceeded ($${used.toFixed(2)} of $${budget.toFixed(2)} used). Adjust your budget in Settings or wait until next month.`);
    this.name = "AIBudgetExceededError";
  }
}

export interface AICallOptions {
  body: Record<string, unknown>;
  functionName: string;
  teamId?: string | null;
  userId?: string | null;
  proposalId?: string | null;
  provider?: Provider;
  timeoutMs?: number;
  stream?: boolean;
}

function getProvider(): Provider {
  const v = (Deno.env.get("AI_PROVIDER") || "lovable").toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "lovable") return v;
  return "lovable";
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export function estimateCost(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return ((inTok / 1000) * p.in) + ((outTok / 1000) * p.out);
}

let _adminClient: ReturnType<typeof createClient> | null = null;
function adminClient() {
  if (_adminClient) return _adminClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  _adminClient = createClient(url, key);
  return _adminClient;
}

async function logUsage(opts: {
  functionName: string;
  teamId?: string | null;
  userId?: string | null;
  proposalId?: string | null;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  status: "success" | "error" | "cache_hit";
  errorMessage?: string;
}) {
  try {
    const admin = adminClient();
    if (!admin) return;
    await admin.from("ai_usage_log").insert({
      team_id: opts.teamId ?? null,
      user_id: opts.userId ?? null,
      proposal_id: opts.proposalId ?? null,
      function_name: opts.functionName,
      provider: opts.provider,
      model: opts.model,
      input_tokens: opts.inputTokens,
      output_tokens: opts.outputTokens,
      estimated_cost_usd: estimateCost(opts.model, opts.inputTokens, opts.outputTokens),
      status: opts.status,
      error_message: opts.errorMessage ?? null,
    });
  } catch (e) {
    console.error("ai_usage_log insert failed:", e);
  }
}

function approxTokens(s: string): number { return Math.ceil(s.length / 4); }
function approxBodyTokens(body: Record<string, unknown>): number {
  try {
    const msgs = (body.messages as any[]) || [];
    return msgs.reduce((sum, m) => sum + approxTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")), 0);
  } catch { return 0; }
}

// ---------- Cache ----------

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashCacheKey(parts: unknown): Promise<string> {
  return await sha256Hex(typeof parts === "string" ? parts : JSON.stringify(parts));
}

export interface CachedEntry {
  response_data: any;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

export async function getCachedResponse(functionName: string, cacheKey: string): Promise<CachedEntry | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("ai_response_cache")
    .select("response_data, model, input_tokens, output_tokens, created_at, expires_at")
    .eq("function_name", functionName)
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return data as any;
}

export async function setCachedResponse(opts: {
  functionName: string;
  cacheKey: string;
  teamId?: string | null;
  responseData: any;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  ttlHours?: number;
}) {
  const admin = adminClient();
  if (!admin) return;
  const ttlMs = (opts.ttlHours ?? 24) * 3600_000;
  await admin.from("ai_response_cache").upsert({
    team_id: opts.teamId ?? null,
    function_name: opts.functionName,
    cache_key: opts.cacheKey,
    response_data: opts.responseData,
    model: opts.model ?? null,
    input_tokens: opts.inputTokens ?? 0,
    output_tokens: opts.outputTokens ?? 0,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
  }, { onConflict: "function_name,cache_key" });
}

// ---------- Budget ----------

export async function checkBudget(teamId: string | null, userId: string | null): Promise<{ used: number; budget: number; exceeded: boolean }> {
  const admin = adminClient();
  if (!admin) return { used: 0, budget: Infinity, exceeded: false };

  // Resolve budget
  let budget = 50;
  if (teamId) {
    const { data } = await admin.from("team_settings").select("monthly_ai_budget_usd").eq("team_id", teamId).maybeSingle();
    if (data) budget = Number(data.monthly_ai_budget_usd);
    else await admin.from("team_settings").insert({ team_id: teamId, monthly_ai_budget_usd: 50 }).select();
  } else if (userId) {
    const { data } = await admin.from("user_ai_settings").select("monthly_ai_budget_usd").eq("user_id", userId).maybeSingle();
    if (data) budget = Number(data.monthly_ai_budget_usd);
  }

  // Sum month-to-date usage
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const q = admin.from("ai_usage_log").select("estimated_cost_usd").gte("created_at", monthStart.toISOString());
  const { data: rows } = teamId
    ? await q.eq("team_id", teamId)
    : userId ? await q.eq("user_id", userId).is("team_id", null) : await q.limit(0);
  const used = (rows || []).reduce((s: number, r: any) => s + Number(r.estimated_cost_usd || 0), 0);
  return { used, budget, exceeded: used >= budget };
}

// ---------- Main call ----------

export async function callAI(opts: AICallOptions): Promise<any> {
  const provider = opts.provider ?? getProvider();
  const cfg = PROVIDERS[provider];
  const apiKey = Deno.env.get(cfg.apiKeyEnv);
  if (!apiKey) throw new Error(`${cfg.apiKeyEnv} not configured`);

  // Budget gate (skip if no admin client / no identity)
  if (opts.teamId || opts.userId) {
    const b = await checkBudget(opts.teamId ?? null, opts.userId ?? null);
    if (b.exceeded) throw new AIBudgetExceededError(b.used, b.budget);
  }

  const model = (opts.body.model as string) || cfg.defaultModel;
  const body = { ...opts.body, model };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(cfg.baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RATE_LIMIT_WAIT_MS;
        if (attempt < MAX_ATTEMPTS) { await sleep(wait); continue; }
        await logUsage({ ...opts, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: "rate_limited" });
        throw new AIRateLimitError();
      }
      if (res.status === 402) {
        await logUsage({ ...opts, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: "credits_exhausted" });
        throw new AICreditsError();
      }
      if (res.status >= 500) {
        const t = await res.text().catch(() => "");
        lastErr = new Error(`AI gateway ${res.status}: ${t}`);
        if (attempt < MAX_ATTEMPTS) { await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1)); continue; }
        await logUsage({ ...opts, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: lastErr.message });
        throw lastErr;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        await logUsage({ ...opts, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: t });
        throw new Error(`AI gateway error: ${t}`);
      }

      if (opts.stream) {
        logUsage({ ...opts, provider, model, inputTokens: approxBodyTokens(body), outputTokens: 0, status: "success" });
        return res;
      }

      const data = await res.json();
      const usage = data.usage || {};
      const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? approxBodyTokens(body);
      const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
      logUsage({ ...opts, provider, model, inputTokens, outputTokens, status: "success" });
      // Tag returned data with token counts so callers can persist to cache
      (data as any).__usage = { inputTokens, outputTokens, model };
      return data;
    } catch (e: any) {
      clearTimeout(timer);
      if (e instanceof AIRateLimitError || e instanceof AICreditsError || e instanceof AIBudgetExceededError) throw e;
      if (e?.name === "AbortError") {
        if (attempt < MAX_ATTEMPTS) { await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1)); lastErr = new AITimeoutError(); continue; }
        await logUsage({ ...opts, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: "timeout" });
        throw new AITimeoutError();
      }
      // TypeError from fetch typically = DNS / connection refused / network down
      const isNetwork = e?.name === "TypeError" || /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(String(e?.message || ""));
      lastErr = isNetwork ? new AIServiceUnavailableError(e) : e;
      if (attempt < MAX_ATTEMPTS) { await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1)); continue; }
      await logUsage({ ...opts, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: lastErr?.message || "unknown" });
      throw lastErr;
    }
  }
  throw lastErr || new Error("AI call failed");
}

export function aiErrorResponse(e: unknown, corsHeaders: Record<string, string>): Response {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (e instanceof AIRateLimitError) return new Response(JSON.stringify({ error: e.message }), { status: 429, headers });
  if (e instanceof AICreditsError) return new Response(JSON.stringify({ error: e.message }), { status: 402, headers });
  if (e instanceof AIBudgetExceededError) return new Response(JSON.stringify({ error: e.message, used: e.used, budget: e.budget }), { status: 402, headers });
  if (e instanceof AITimeoutError) return new Response(JSON.stringify({ error: e.message }), { status: 504, headers });
  if (e instanceof AIServiceUnavailableError) return new Response(JSON.stringify({ error: e.message, code: "ai_unavailable" }), { status: 503, headers });
  const msg = e instanceof Error ? e.message : "AI call failed";
  return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
}

export { logUsage as _logUsageInternal };
