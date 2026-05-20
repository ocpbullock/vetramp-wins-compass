import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertTeamAdmin(teamId: string, userId: string) {
  const { data: m } = await supabaseAdmin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) {
    throw new Error("Only team owners or admins can perform this action.");
  }
  return m.role as "owner" | "admin";
}

export const listTeamInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ teamId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTeamAdmin(data.teamId, context.userId);
    const { data: invites, error } = await supabaseAdmin
      .from("user_invites")
      .select("id,email,role,status,expires_at,created_at,invited_by")
      .eq("team_id", data.teamId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { invites: invites ?? [] };
  });

export const resendTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), origin: z.string().url() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("user_invites")
      .select("id, email, team_id")
      .eq("id", data.id)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv || !inv.team_id) throw new Error("Invite not found.");
    await assertTeamAdmin(inv.team_id, context.userId);
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("user_invites")
      .update({
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", data.id)
      .select()
      .single();
    if (uErr) throw new Error(uErr.message);
    const redirectTo = `${data.origin}/accept-invite?token=${updated.token}`;
    const { error: mailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(updated.email, { redirectTo });
    if (mailErr) return { ok: true, warning: mailErr.message };
    return { ok: true };
  });

export const cancelTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: inv } = await supabaseAdmin
      .from("user_invites")
      .select("team_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!inv || !inv.team_id) throw new Error("Invite not found.");
    await assertTeamAdmin(inv.team_id, context.userId);
    const { error } = await supabaseAdmin
      .from("user_invites")
      .update({ status: "cancelled" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTeamProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ teamId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Caller must be a member of the team
    const { data: m } = await supabaseAdmin
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!m) throw new Error("Not a team member.");
    const { data: props, error } = await supabaseAdmin
      .from("proposals")
      .select("id, opportunity_title, solicitation_number, status, updated_at")
      .or(`team_id.eq.${data.teamId},opportunity_team_id.eq.${data.teamId}`)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { proposals: props ?? [] };
  });
