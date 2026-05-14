import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://api.sam.gov/opportunities/v2/search";

// In-memory circuit breaker (resets on cold start)
const breaker = {
  consecutiveErrors: 0,
  openUntil: 0,
  lastSuccessAt: 0 as number,
};
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 60_000;

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("SAM_GOV_API_KEY");
    if (!apiKey) throw new Error("SAM_GOV_API_KEY not configured");

    const { naicsCodes, postedFrom, postedTo, keyword } = await req.json();

    let fromIso = postedFrom;
    const fromMs = new Date(postedFrom).getTime();
    const toMs = new Date(postedTo).getTime();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (toMs - fromMs >= oneYearMs) {
      const adjusted = new Date(toMs - oneYearMs + 24 * 60 * 60 * 1000);
      fromIso = adjusted.toISOString().slice(0, 10);
    }
    const from = fmtDate(fromIso);
    const to = fmtDate(postedTo);

    const all: any[] = [];
    const errors: any[] = [];
    const log: string[] = [];
    let rateLimited = false;
    let circuitOpen = false;
    let processed = 0;

    // Circuit-breaker pre-check
    if (breaker.openUntil > Date.now()) {
      return new Response(JSON.stringify({
        opportunities: [],
        errors: [{ error: "circuit_open" }],
        log: [`Circuit breaker open until ${new Date(breaker.openUntil).toISOString()}`],
        circuitOpen: true,
        message: `SAM.gov is experiencing issues. Showing cached results from ${
          breaker.lastSuccessAt ? new Date(breaker.lastSuccessAt).toISOString() : "(no recent success)"
        }.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    for (let i = 0; i < naicsCodes.length; i++) {
      const code = naicsCodes[i];
      const params = new URLSearchParams({
        api_key: apiKey,
        ncode: code,
        postedFrom: from,
        postedTo: to,
        limit: "200",
      });
      if (keyword) params.set("q", keyword);

      const url = `${BASE}?${params.toString()}`;
      try {
        const res = await fetch(url);

        if (res.status === 429) {
          rateLimited = true;
          breaker.consecutiveErrors++;
          errors.push({ naicsCode: code, status: 429, error: "rate_limited" });
          log.push(`NAICS ${code}: HTTP 429 — stopping all remaining queries`);
          break;
        }

        if (!res.ok) {
          breaker.consecutiveErrors++;
          const text = await res.text();
          errors.push({ naicsCode: code, status: res.status, error: text.slice(0, 300) });
          log.push(`NAICS ${code}: HTTP ${res.status}`);
          if (breaker.consecutiveErrors >= BREAKER_THRESHOLD) {
            breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
            circuitOpen = true;
            log.push(`Circuit breaker tripped after ${breaker.consecutiveErrors} consecutive errors`);
            break;
          }
          continue;
        }

        const json = await res.json();
        // Validate response shape
        if (!json || !Array.isArray(json.opportunitiesData)) {
          breaker.consecutiveErrors++;
          console.error("SAM.gov unexpected response shape:", JSON.stringify(json).slice(0, 500));
          errors.push({ naicsCode: code, error: "Unexpected SAM.gov response shape (missing opportunitiesData)" });
          log.push(`NAICS ${code}: invalid response shape`);
          if (breaker.consecutiveErrors >= BREAKER_THRESHOLD) {
            breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
            circuitOpen = true;
            break;
          }
          continue;
        }

        breaker.consecutiveErrors = 0;
        breaker.lastSuccessAt = Date.now();
        const data = json.opportunitiesData;
        all.push(...data);
        log.push(`NAICS ${code}: ${data.length} results`);
      } catch (e: any) {
        breaker.consecutiveErrors++;
        errors.push({ naicsCode: code, error: e.message });
        log.push(`NAICS ${code}: error ${e.message}`);
        if (breaker.consecutiveErrors >= BREAKER_THRESHOLD) {
          breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
          circuitOpen = true;
          log.push(`Circuit breaker tripped after ${breaker.consecutiveErrors} consecutive errors`);
          break;
        }
      } finally {
        processed = i + 1;
      }

      if (i < naicsCodes.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    const seen = new Set<string>();
    const deduped = all.filter((o) => {
      const key = o.solicitationNumber || o.noticeId || JSON.stringify(o).slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let message: string | undefined;
    if (rateLimited) {
      message = `SAM.gov rate limit reached. Retrieved results for ${processed - 1} of ${naicsCodes.length} NAICS codes. Wait 5 minutes and search again, or reduce the number of selected NAICS codes.`;
    } else if (circuitOpen) {
      message = `SAM.gov is experiencing issues. Returned partial results from ${processed} of ${naicsCodes.length} NAICS codes. Try again in a minute.`;
    }

    return new Response(
      JSON.stringify({
        opportunities: deduped,
        errors,
        log,
        rateLimited,
        circuitOpen,
        processed,
        total: naicsCodes.length,
        message,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("search-sam error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
