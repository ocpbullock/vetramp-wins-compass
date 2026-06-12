// CORS helper for edge functions.
//
// We do NOT use a wildcard `Access-Control-Allow-Origin: *`. Instead, the
// request's `Origin` header is reflected ONLY when it appears verbatim in the
// `ALLOWED_ORIGINS` env allowlist (comma-separated). Comparison is exact —
// no suffix / wildcard matching. If the request origin doesn't match
// anything in the allowlist, the `Access-Control-Allow-Origin` header is
// omitted entirely (never sent as `""` or `"*"`).
//
// When `ALLOWED_ORIGINS` is unset, the defaults below are used.

const DEFAULT_ALLOWED_ORIGINS = [
  "https://vetramp-wins-compass.lovable.app",
  "https://id-preview--bafe3a4b-f889-4ccf-8587-5e092cb4ed6c.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getAllowedOrigins(): string[] {
  const raw = (globalThis as any).Deno?.env?.get?.("ALLOWED_ORIGINS");
  if (!raw || typeof raw !== "string") return DEFAULT_ALLOWED_ORIGINS;
  const parsed = raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Vary": "Origin",
};

/**
 * Build CORS headers for a specific request. Reflects the request's `Origin`
 * header only when it exactly matches the ALLOWED_ORIGINS allowlist;
 * otherwise omits the `Access-Control-Allow-Origin` header entirely.
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  const allowed = getAllowedOrigins();
  if (origin && allowed.includes(origin)) {
    return { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  return { ...BASE_CORS_HEADERS };
}

/**
 * Legacy static export retained for backward compatibility with shared
 * helpers that accept a default `corsHeaders` parameter. Does NOT include
 * `Access-Control-Allow-Origin` — handlers must call `buildCorsHeaders(req)`.
 */
export const corsHeaders: Record<string, string> = { ...BASE_CORS_HEADERS };
