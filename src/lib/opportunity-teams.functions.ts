import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "opp";
}

/**
 * Create an opportunity-scoped team for collaborating on a single proposal.
 * The caller becomes the owner. Optionally links an existing proposal.
 */
export const createOpportunityTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      parentTeamId: z.string().uuid(),
      proposalId: z.string().uuid().optional(),
      opportunityTitle: z.string().min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller is a member of the parent org team
    const { data: membership } = await supabaseAdmin
      .from("team_members")
      .select("role")
      .eq("team_id", data.parentTeamId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("You are not a member of this organization.");

    const name = data.opportunityTitle.slice(0, 60);
    const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;

    const { data: team, error: tErr } = await supabaseAdmin
      .from("teams")
      .insert({
        name,
        slug,
        created_by: userId,
        team_type: "opportunity",
        parent_team_id: data.parentTeamId,
      })
      .select("id, name, slug, team_type, parent_team_id, created_by")
      .single();
    if (tErr) throw new Error(tErr.message);

    const { error: mErr } = await supabaseAdmin
      .from("team_members")
      .insert({ team_id: team.id, user_id: userId, role: "owner" });
    if (mErr) throw new Error(mErr.message);

    if (data.proposalId) {
      const { error: pErr } = await supabaseAdmin
        .from("proposals")
        .update({ opportunity_team_id: team.id })
        .eq("id", data.proposalId);
      if (pErr) throw new Error(pErr.message);
    }

    return { team };
  });

/**
 * Invite a teaming partner to an opportunity team. Allowed for owners/admins
 * of that team — does NOT require app-admin rights.
 */
export const inviteToOpportunityTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      teamId: z.string().uuid(),
      email: z.string().email(),
      origin: z.string().url(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller can invite to this team
    const { data: membership } = await supabaseAdmin
      .from("team_members")
      .select("role")
      .eq("team_id", data.teamId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Only owners or admins can invite to this team.");
    }

    const email = data.email.trim().toLowerCase();

    // Cancel prior pending invites for this email + team
    await supabaseAdmin
      .from("user_invites")
      .update({ status: "cancelled" })
      .eq("status", "pending")
      .eq("team_id", data.teamId)
      .ilike("email", email);

    const { data: invite, error: insErr } = await supabaseAdmin
      .from("user_invites")
      .insert({
        email,
        role: "member",
        invited_by: userId,
        team_id: data.teamId,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    const redirectTo = `${data.origin}/accept-invite?token=${invite.token}`;
    const { error: mailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (mailErr) return { invite, warning: mailErr.message };
    return { invite };
  });

/**
 * Get the proposal id linked to an opportunity team (for accept-invite redirect
 * and the opp-team nav).
 */
export const getOpportunityTeamProposal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ teamId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: prop } = await supabaseAdmin
      .from("proposals")
      .select("id, opportunity_title, solicitation_number")
      .eq("opportunity_team_id", data.teamId)
      .maybeSingle();
    return { proposal: prop };
  });
