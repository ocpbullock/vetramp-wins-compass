// Admin-gated diagnostics metadata endpoint.
// Returns platform-integrity signals that require privileged reads:
//   - cron.job entries (not visible to authenticated role via PostgREST)
//   - most recent recompete-watch run (max proposals.last_watched_at)
//   - stale-schema scan: pg_proc functions still referencing the old
//     public.is_team_member / public.has_role symbols.
//
// Caller must be an app admin (has_role admin) OR an owner/admin of at least
// one team. We verify with the user-scoped client (RLS) BEFORE using the
// service-role admin client for the privileged reads.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { authenticate, authErrorResponse, jsonError } from "../_shared/auth.ts";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let ctx;
    try { ctx = await authenticate(req); }
    catch (e) { const r = authErrorResponse(e, corsHeaders); if (r) return r; throw e; }

    // Authorization: app admin OR team owner/admin.
    const [{ data: roleRow }, { data: teamRoles }] = await Promise.all([
      ctx.userClient.from("user_roles").select("role").eq("user_id", ctx.user.id).maybeSingle(),
      ctx.userClient.from("team_members").select("role").eq("user_id", ctx.user.id),
    ]);
    const isAppAdmin = roleRow?.role === "admin";
    const isTeamAdmin = (teamRoles ?? []).some((r: any) => r.role === "owner" || r.role === "admin");
    if (!isAppAdmin && !isTeamAdmin) {
      return jsonError(403, "Diagnostics metadata requires admin or team owner role", corsHeaders);
    }

    // Privileged reads via service-role client.
    const cronJobsRes = await ctx.admin
      .schema("cron" as never)
      .from("job" as never)
      .select("jobid, jobname, schedule, active, command")
      .order("jobname" as never);

    const cronJobs = (cronJobsRes.data as any[] | null)?.map((r) => ({
      jobid: r.jobid, jobname: r.jobname, schedule: r.schedule, active: r.active,
    })) ?? [];

    const { data: lastWatchRow } = await ctx.admin
      .from("proposals")
      .select("last_watched_at")
      .not("last_watched_at", "is", null)
      .order("last_watched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Stale-schema scan: legacy public.* helpers were moved to private.*.
    // Any pg_proc body still referencing them is a regression.
    const { data: staleFns, error: staleErr } = await ctx.admin.rpc(
      "diagnostics_stale_schema_scan" as never,
      {} as never,
    );

    return new Response(
      JSON.stringify({
        cronJobs,
        lastWatchRun: lastWatchRow?.last_watched_at ?? null,
        staleSchemaFunctions: staleFns ?? [],
        staleSchemaError: staleErr?.message ?? (cronJobsRes.error?.message ?? null),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[diagnostics-meta] error", e);
    return jsonError(500, e instanceof Error ? e.message : String(e), corsHeaders);
  }
});
