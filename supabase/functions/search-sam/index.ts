import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://api.sam.gov/opportunities/v2/search";

function fmtDate(iso: string) {
  // Convert YYYY-MM-DD to MM/DD/YYYY
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("SAM_GOV_API_KEY");
    if (!apiKey) throw new Error("SAM_GOV_API_KEY not configured");

    const { naicsCodes, postedFrom, postedTo, keyword } = await req.json();
    const from = fmtDate(postedFrom);
    const to = fmtDate(postedTo);

    const all: any[] = [];
    const errors: any[] = [];
    const log: string[] = [];

    for (let i = 0; i < naicsCodes.length; i++) {
      const code = naicsCodes[i];
      const params = new URLSearchParams({
        api_key: apiKey,
        naicsCode: code,
        postedFrom: from,
        postedTo: to,
        limit: "200",
      });
      if (keyword) params.set("q", keyword);

      const url = `${BASE}?${params.toString()}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const text = await res.text();
          errors.push({ naicsCode: code, status: res.status, error: text.slice(0, 300) });
          log.push(`NAICS ${code}: HTTP ${res.status}`);
          continue;
        }
        const json = await res.json();
        const data = json.opportunitiesData || [];
        all.push(...data);
        log.push(`NAICS ${code}: ${data.length} results`);
      } catch (e: any) {
        errors.push({ naicsCode: code, error: e.message });
        log.push(`NAICS ${code}: error ${e.message}`);
      }

      // Throttle: 500ms between calls (max ~10/5min compliance)
      if (i < naicsCodes.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    // Dedupe by solicitationNumber
    const seen = new Set<string>();
    const deduped = all.filter((o) => {
      const key = o.solicitationNumber || o.noticeId || JSON.stringify(o).slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return new Response(
      JSON.stringify({ opportunities: deduped, errors, log }),
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
