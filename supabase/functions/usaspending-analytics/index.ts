import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { naicsCodes, startDate, endDate } = await req.json();
    const baseFilters = {
      naics_codes: naicsCodes,
      time_period: [{ start_date: startDate, end_date: endDate }],
      award_type_codes: ["A", "B", "C", "D"],
    };

    const overTimePromise = fetch(
      "https://api.usaspending.gov/api/v2/search/spending_over_time/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: "month", filters: baseFilters }),
      },
    ).then((r) => r.json());

    const vendorsPromise = fetch(
      "https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: baseFilters, limit: 10, page: 1 }),
      },
    ).then((r) => r.json());

    const agenciesPromise = fetch(
      "https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: baseFilters, limit: 8, page: 1 }),
      },
    ).then((r) => r.json());

    const [overTime, vendors, agencies] = await Promise.all([
      overTimePromise,
      vendorsPromise,
      agenciesPromise,
    ]);

    return new Response(
      JSON.stringify({ overTime, vendors, agencies }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
