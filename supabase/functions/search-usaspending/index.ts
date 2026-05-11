import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const {
      naicsCodes,
      startDate,
      endDate,
      keyword,
      maxResults = 10000,
    } = await req.json();

    const baseBody: any = {
      filters: {
        naics_codes: naicsCodes,
        // new_awards_only restricts to awards whose base date falls inside the
        // window — without this USAspending returns awards from years ago that
        // simply had a recent action_date.
        time_period: [
          { start_date: startDate, end_date: endDate, date_type: "new_awards_only" },
        ],
        award_type_codes: ["A", "B", "C", "D"],
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "Recipient UEI",
        "Award Amount",
        "Awarding Agency",
        "Awarding Sub Agency",
        "Start Date",
        "End Date",
        "NAICS",
        "Description",
        "generated_internal_id",
        "Type of Set Aside",
        "Contract Award Type",
        "Parent Award ID",
      ],
      sort: "Start Date",
      order: "desc",
      limit: 100,
    };
    if (keyword) baseBody.filters.keywords = [keyword];

    // USAspending caps each request at 100 rows. Loop pages until we hit
    // maxResults or run out of data. USAspending hard-caps result windows
    // around 10,000 (page * limit), so 100 pages * 100 rows is the ceiling.
    const PAGE_SIZE = 100;
    const HARD_PAGE_LIMIT = Math.min(100, Math.ceil(maxResults / PAGE_SIZE));
    const all: any[] = [];
    let lastMeta: any = null;
    let totalReported: number | undefined;

    for (let page = 1; page <= HARD_PAGE_LIMIT; page++) {
      const res = await fetch(
        "https://api.usaspending.gov/api/v2/search/spending_by_award/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...baseBody, page }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        return new Response(
          JSON.stringify({ error: `USAspending HTTP ${res.status}: ${text.slice(0, 300)}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const json = await res.json();
      const results = json.results || [];
      all.push(...results);
      lastMeta = json.page_metadata;
      if (typeof json.page_metadata?.total === "number") totalReported = json.page_metadata.total;
      const hasNext = json.page_metadata?.hasNext;
      if (!hasNext || results.length === 0 || all.length >= maxResults) break;
    }

    // Flatten NAICS object → string code so the client can filter, sort,
    // render, and match incumbents on a plain value.
    const flat = all.map((r: any) => {
      const n = r?.NAICS;
      if (n && typeof n === "object") {
        return { ...r, NAICS: n.code ?? "", NAICS_Description: n.description ?? "" };
      }
      return r;
    });

    return new Response(
      JSON.stringify({
        results: flat.slice(0, maxResults),
        page_metadata: {
          total: totalReported ?? all.length,
          fetched: all.length,
          hasNext: lastMeta?.hasNext ?? false,
          truncated: all.length >= maxResults,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
