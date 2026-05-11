import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { naicsCodes, startDate, endDate, keyword, limit = 100, page = 1 } = await req.json();

    const body: any = {
      filters: {
        naics_codes: naicsCodes,
        time_period: [{ start_date: startDate, end_date: endDate }],
        award_type_codes: ["A", "B", "C", "D"],
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "Award Amount",
        "Awarding Agency",
        "Awarding Sub Agency",
        "Start Date",
        "End Date",
        "NAICS Code",
        "Description",
        "generated_internal_id",
        "Type of Set Aside",
      ],
      limit,
      page,
      sort: "Award Amount",
      order: "desc",
    };
    if (keyword) body.filters.keywords = [keyword];

    const res = await fetch(
      "https://api.usaspending.gov/api/v2/search/spending_by_award/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json();
    return new Response(JSON.stringify(json), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
