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

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const addDays = (d: Date, days: number) => {
      const next = new Date(d);
      next.setUTCDate(next.getUTCDate() + days);
      return next;
    };
    const addYears = (d: Date, years: number) => {
      const next = new Date(d);
      next.setUTCFullYear(next.getUTCFullYear() + years);
      return next;
    };
    const chunks: { start: string; end: string }[] = [];
    let cursor = new Date(`${startDate}T00:00:00.000Z`);
    const finalEnd = new Date(`${endDate}T00:00:00.000Z`);
    while (cursor <= finalEnd) {
      const chunkEnd = addYears(cursor, 1) > finalEnd ? finalEnd : addDays(addYears(cursor, 1), -1);
      chunks.push({ start: fmt(cursor), end: fmt(chunkEnd) });
      cursor = addDays(chunkEnd, 1);
    }

    const baseBody: any = {
      filters: {
        naics_codes: naicsCodes,
        // new_awards_only restricts to awards whose base date falls inside the
        // window — without this USAspending returns awards from years ago that
        // simply had a recent action_date.
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
    const all: any[] = [];
    let lastMeta: any = null;
    let totalReported: number | undefined;

    for (const chunk of [...chunks].reverse()) {
      if (all.length >= maxResults) break;
      const chunkBody = {
        ...baseBody,
        filters: {
          ...baseBody.filters,
          time_period: [{ start_date: chunk.start, end_date: chunk.end, date_type: "new_awards_only" }],
        },
      };
      const hardPageLimit = Math.min(100, Math.ceil((maxResults - all.length) / PAGE_SIZE));
      for (let page = 1; page <= hardPageLimit; page++) {
        const res = await fetch(
          "https://api.usaspending.gov/api/v2/search/spending_by_award/",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...chunkBody, page }),
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
        if (page === 1 && typeof json.page_metadata?.total === "number") {
          totalReported = (totalReported ?? 0) + json.page_metadata.total;
        }
        const hasNext = json.page_metadata?.hasNext;
        if (!hasNext || results.length === 0 || all.length >= maxResults) break;
      }
    }

    // Flatten NAICS object → string code so the client can filter, sort,
    // render, and match incumbents on a plain value.
    const seen = new Set<string>();
    const flat = all.filter((r: any) => {
      const key = r.generated_internal_id || `${r["Award ID"]}|${r["Start Date"]}|${r["Award Amount"]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((r: any) => {
      const n = r?.NAICS;
      if (n && typeof n === "object") {
        return { ...r, NAICS: n.code ?? "", NAICS_Description: n.description ?? "" };
      }
      return r;
    });

    const returned = flat.slice(0, maxResults);

    return new Response(
      JSON.stringify({
        results: returned,
        page_metadata: {
          total: totalReported ?? all.length,
          fetched: returned.length,
          hasNext: (totalReported ?? all.length) > returned.length,
          chunks: chunks.length,
          truncated: (totalReported ?? all.length) > returned.length,
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
