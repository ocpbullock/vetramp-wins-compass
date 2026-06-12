import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateInviteToken } from "@/lib/invite-tokens";

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

    const { token, tokenHash } = generateInviteToken();
    const { data: invite, error: insErr } = await supabaseAdmin
      .from("user_invites")
      .insert({
        email,
        role: "member",
        invited_by: userId,
        team_id: data.teamId,
        token_hash: tokenHash,
      })
      .select("id,email,role,status,expires_at,team_id")
      .single();
    if (insErr) throw new Error(insErr.message);

    const redirectTo = `${data.origin}/accept-invite?token=${token}`;
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

/**
 * List proposals in the given org team that aren't yet linked to any
 * opportunity team. Used by the "Link existing proposal" pickers.
 */
export const listLinkableProposalsForOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ parentTeamId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("team_members")
      .select("role")
      .eq("team_id", data.parentTeamId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!m) throw new Error("Not a member of this organization.");
    const { data: props, error } = await supabaseAdmin
      .from("proposals")
      .select("id, opportunity_title, solicitation_number, agency, status, response_deadline, updated_at")
      .eq("team_id", data.parentTeamId)
      .is("opportunity_team_id", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { proposals: props ?? [] };
  });

/**
 * Opportunity teams under the given org, with the linked proposal title
 * (if any). Caller must be a member of the parent org team. Used to power
 * link/unlink pickers on the proposal workspace.
 */
export const listOpportunityTeamsForOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ parentTeamId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("team_members")
      .select("role")
      .eq("team_id", data.parentTeamId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!m) throw new Error("Not a member of this organization.");

    const { data: teams, error: tErr } = await supabaseAdmin
      .from("teams")
      .select("id, name, slug, status, created_at")
      .eq("parent_team_id", data.parentTeamId)
      .eq("team_type", "opportunity");
    if (tErr) throw new Error(tErr.message);

    const ids = (teams ?? []).map((t) => t.id);
    let linkedByTeam: Record<string, { id: string; opportunity_title: string | null; solicitation_number: string | null }> = {};
    if (ids.length) {
      const { data: props } = await supabaseAdmin
        .from("proposals")
        .select("id, opportunity_title, solicitation_number, opportunity_team_id")
        .in("opportunity_team_id", ids);
      for (const p of props ?? []) {
        if (p.opportunity_team_id) {
          linkedByTeam[p.opportunity_team_id] = {
            id: p.id,
            opportunity_title: p.opportunity_title,
            solicitation_number: p.solicitation_number,
          };
        }
      }
    }
    return {
      teams: (teams ?? []).map((t) => ({ ...t, linked_proposal: linkedByTeam[t.id] ?? null })),
    };
  });

async function assertCanManageOppTeamLink(opportunityTeamId: string, userId: string) {
  const { data: oppTeam, error: tErr } = await supabaseAdmin
    .from("teams")
    .select("id, team_type, parent_team_id")
    .eq("id", opportunityTeamId)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!oppTeam || oppTeam.team_type !== "opportunity" || !oppTeam.parent_team_id) {
    throw new Error("Opportunity team not found.");
  }
  const { data: m } = await supabaseAdmin
    .from("team_members")
    .select("role")
    .eq("team_id", oppTeam.parent_team_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) {
    throw new Error("Only owners or admins of the parent organization can link proposals.");
  }
  return { parentTeamId: oppTeam.parent_team_id as string };
}

/**
 * Link a proposal to an opportunity team. The proposal must already belong
 * to the parent organization of the opportunity team, and the caller must
 * be an owner/admin of that organization.
 */
export const linkProposalToOpportunityTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      proposalId: z.string().uuid(),
      opportunityTeamId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { parentTeamId } = await assertCanManageOppTeamLink(
      data.opportunityTeamId,
      context.userId,
    );

    const { data: prop, error: pErr } = await supabaseAdmin
      .from("proposals")
      .select("id, team_id, opportunity_team_id")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prop) throw new Error("Proposal not found.");
    if (prop.team_id !== parentTeamId) {
      throw new Error("Proposal does not belong to this organization.");
    }
    if (prop.opportunity_team_id && prop.opportunity_team_id !== data.opportunityTeamId) {
      throw new Error("Proposal is already linked to a different opportunity team. Unlink it first.");
    }

    const { error: uErr } = await supabaseAdmin
      .from("proposals")
      .update({ opportunity_team_id: data.opportunityTeamId })
      .eq("id", data.proposalId);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

/**
 * Unlink a proposal from an opportunity team. Same auth rules as linking.
 */
export const unlinkProposalFromOpportunityTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      proposalId: z.string().uuid(),
      opportunityTeamId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCanManageOppTeamLink(data.opportunityTeamId, context.userId);
    const { error } = await supabaseAdmin
      .from("proposals")
      .update({ opportunity_team_id: null })
      .eq("id", data.proposalId)
      .eq("opportunity_team_id", data.opportunityTeamId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
