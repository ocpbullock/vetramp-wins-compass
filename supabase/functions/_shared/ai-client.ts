// Shared AI gateway client with retry, fallback provider support,
// timeout handling, and usage logging.
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
    // Anthropic OpenAI-compatible chat completions endpoint
    baseUrl: "https://api.anthropic.com/v1/chat/completions",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-sonnet-latest",
  },
};

// Rough $/1k token pricing (input/output). Update as pricing changes.
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-pro": { in: 0.00125, out: 0.005 },
  "google/gemini-2.5-flash": { in: 0.000075, out: 0.0003 },
  "google/gemini-3-flash-preview": { in: 0.000075, out: 0.0003 },
  "openai/gpt-5": { in: 0.005, out: 0.015 },
  "openai/gpt-5-mini": { in: 0.0003, out: 0.0012 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "claude-3-5-sonnet-latest": { in: 0.003, out: 0.015 },
};

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
  constructor() {
    super("Rate limit exceeded after multiple retries. Try again in a few minutes.");
    this.name = "AIRateLimitError";
  }
}

export class AICreditsError extends Error {
  constructor() {
    super("AI credits exhausted. Add funds in Workspace settings.");
    this.name = "AICreditsError";
  }
}

export interface AICallOptions {
  body: Record<string, unknown>; // OpenAI-compatible chat completions body
  functionName: string;
  teamId?: string | null;
  userId?: string | null;
  provider?: Provider;
  timeoutMs?: number;
  // For streaming responses, return raw Response (caller handles body)
  stream?: boolean;
}

function getProvider(): Provider {
  const v = (Deno.env.get("AI_PROVIDER") || "lovable").toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "lovable") return v;
  return "lovable";
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function estimateCost(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return ((inTok / 1000) * p.in) + ((outTok / 1000) * p.out);
}

async function logUsage(opts: {
  functionName: string;
  teamId?: string | null;
  userId?: string | null;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  status: "success" | "error";
  errorMessage?: string;
}) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const admin = createClient(url, key);
    await admin.from("ai_usage_log").insert({
      team_id: opts.teamId ?? null,
      user_id: opts.userId ?? null,
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

/** Approximate token count from char length when API doesn't return usage. */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function approxBodyTokens(body: Record<string, unknown>): number {
  try {
    const msgs = (body.messages as any[]) || [];
    return msgs.reduce((sum, m) => sum + approxTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")), 0);
  } catch { return 0; }
}

/**
 * Call AI gateway with retry + timeout + usage logging.
 * Returns either parsed JSON (non-stream) or a Response (stream=true).
 */
export async function callAI(opts: AICallOptions): Promise<any> {
  const provider = opts.provider ?? getProvider();
  const cfg = PROVIDERS[provider];
  const apiKey = Deno.env.get(cfg.apiKeyEnv);
  if (!apiKey) throw new Error(`${cfg.apiKeyEnv} not configured`);

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
        await logUsage({ functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: "rate_limited" });
        throw new AIRateLimitError();
      }
      if (res.status === 402) {
        await logUsage({ functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: "credits_exhausted" });
        throw new AICreditsError();
      }
      if (res.status >= 500) {
        const t = await res.text().catch(() => "");
        lastErr = new Error(`AI gateway ${res.status}: ${t}`);
        if (attempt < MAX_ATTEMPTS) { await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1)); continue; }
        await logUsage({ functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: lastErr.message });
        throw lastErr;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        await logUsage({ functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: t });
        throw new Error(`AI gateway error: ${t}`);
      }

      if (opts.stream) {
        // Best-effort log estimated input tokens; output unknown for streaming.
        logUsage({
          functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model,
          inputTokens: approxBodyTokens(body), outputTokens: 0, status: "success",
        });
        return res;
      }

      const data = await res.json();
      const usage = data.usage || {};
      const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? approxBodyTokens(body);
      const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
      logUsage({
        functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model,
        inputTokens, outputTokens, status: "success",
      });
      return data;
    } catch (e: any) {
      clearTimeout(timer);
      if (e instanceof AIRateLimitError || e instanceof AICreditsError) throw e;
      if (e?.name === "AbortError") {
        if (attempt < MAX_ATTEMPTS) { await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1)); lastErr = new AITimeoutError(); continue; }
        await logUsage({ functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: "timeout" });
        throw new AITimeoutError();
      }
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) { await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1)); continue; }
      await logUsage({ functionName: opts.functionName, teamId: opts.teamId, userId: opts.userId, provider, model, inputTokens: 0, outputTokens: 0, status: "error", errorMessage: e?.message || "unknown" });
      throw e;
    }
  }
  throw lastErr || new Error("AI call failed");
}

export function aiErrorResponse(e: unknown, corsHeaders: Record<string, string>): Response {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (e instanceof AIRateLimitError) return new Response(JSON.stringify({ error: e.message }), { status: 429, headers });
  if (e instanceof AICreditsError) return new Response(JSON.stringify({ error: e.message }), { status: 402, headers });
  if (e instanceof AITimeoutError) return new Response(JSON.stringify({ error: e.message }), { status: 504, headers });
  const msg = e instanceof Error ? e.message : "AI call failed";
  return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
}
