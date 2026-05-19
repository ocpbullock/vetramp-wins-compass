import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, authErrorResponse } from "../_shared/auth.ts";

const USA = "https://api.usaspending.gov";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    try { await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    const { recipientId } = await req.json();
    if (!recipientId) throw new Error("recipientId required");

    // Profile (may 404 for some IDs — handle gracefully)
    let profile: any = null;
    try {
      const pRes = await fetch(`${USA}/api/v2/recipient/${recipientId}/`);
      if (pRes.ok) profile = await pRes.json();
    } catch { /* ignore */ }

    // Contract history
    const today = new Date().toISOString().slice(0, 10);
    const fiveYrs = new Date(); fiveYrs.setFullYear(fiveYrs.getFullYear() - 5);
    const body = {
      filters: {
        recipient_id: recipientId,
        time_period: [{ start_date: fiveYrs.toISOString().slice(0, 10), end_date: today }],
        award_type_codes: ["A", "B", "C", "D"],
      },
      fields: [
        "Award ID", "Recipient Name", "Award Amount", "Awarding Agency",
        "Awarding Sub Agency", "Start Date", "End Date", "NAICS",
        "Description", "generated_internal_id", "Type of Set Aside",
      ],
      sort: "Award Amount", order: "desc", limit: 100, page: 1,
    };

    const res = await fetch(`${USA}/api/v2/search/spending_by_award/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = res.ok ? await res.json() : { results: [] };
    const contracts = (json.results || []).map((r: any) => {
      const n = r?.NAICS;
      return n && typeof n === "object"
        ? { ...r, NAICS: n.code ?? "", NAICS_Description: n.description ?? "" }
        : r;
    });

    // Aggregations
    const naicsMap = new Map<string, { code: string; awards: number; totalValue: number }>();
    const agencyMap = new Map<string, { name: string; awards: number; totalValue: number }>();
    let totalValue = 0;
    let activeCount = 0;
    const now = Date.now();
    for (const c of contracts) {
      const v = Number(c["Award Amount"]) || 0;
      totalValue += v;
      if (c["End Date"] && new Date(c["End Date"]).getTime() > now) activeCount++;
      const n = c.NAICS || "—";
      const ne = naicsMap.get(n) ?? { code: n, awards: 0, totalValue: 0 };
      ne.awards++; ne.totalValue += v; naicsMap.set(n, ne);
      const a = c["Awarding Sub Agency"] || c["Awarding Agency"] || "—";
      const ae = agencyMap.get(a) ?? { name: a, awards: 0, totalValue: 0 };
      ae.awards++; ae.totalValue += v; agencyMap.set(a, ae);
    }

    const naicsBreakdown = [...naicsMap.values()].sort((a, b) => b.totalValue - a.totalValue);
    const agencyBreakdown = [...agencyMap.values()].sort((a, b) => b.totalValue - a.totalValue);

    return new Response(JSON.stringify({
      profile,
      summary: {
        totalContracts: contracts.length,
        totalValue,
        activeCount,
      },
      naicsBreakdown,
      agencyBreakdown,
      contracts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
