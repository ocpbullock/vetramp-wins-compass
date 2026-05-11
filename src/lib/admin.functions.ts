import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Forbidden", { status: 403 });
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }, { data: authList, error: aErr }] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("user_id,email,display_name,status,created_at"),
        supabaseAdmin.from("user_roles").select("user_id,role"),
        supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    if (aErr) throw new Error(aErr.message);
    const roleByUser = new Map<string, string>();
    for (const r of roles ?? []) {
      // admin wins
      if (r.role === "admin" || !roleByUser.has(r.user_id)) roleByUser.set(r.user_id, r.role);
    }
    const authByUser = new Map(authList.users.map((u) => [u.id, u]));
    const users = (profiles ?? []).map((p) => {
      const a = authByUser.get(p.user_id);
      return {
        userId: p.user_id,
        email: p.email,
        displayName: p.display_name,
        status: p.status as "active" | "deactivated",
        role: (roleByUser.get(p.user_id) ?? "member") as "admin" | "member",
        createdAt: p.created_at,
        lastSignInAt: a?.last_sign_in_at ?? null,
        emailConfirmed: !!a?.email_confirmed_at,
      };
    });
    return { users };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), role: z.enum(["admin", "member"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && data.role !== "admin") {
      throw new Error("You cannot demote yourself.");
    }
    // Wipe existing roles, set the new one (single-role-per-user UX)
    const { error: delErr } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (delErr) throw new Error(delErr.message);
    const { error: insErr } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
    if (insErr) throw new Error(insErr.message);
    return { ok: true };
  });

export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), status: z.enum(["active", "deactivated"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && data.status === "deactivated") {
      throw new Error("You cannot deactivate yourself.");
    }
    const { error } = await supabaseAdmin.from("profiles").update({ status: data.status }).eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    if (data.status === "deactivated") {
      // revoke any active sessions
      await supabaseAdmin.auth.admin.signOut(data.userId).catch(() => {});
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("You cannot remove yourself.");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]).default("member"),
      origin: z.string().url(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const email = data.email.trim().toLowerCase();

    // cancel any prior pending invites for this email
    await supabaseAdmin
      .from("user_invites")
      .update({ status: "cancelled" })
      .eq("status", "pending")
      .ilike("email", email);

    const { data: invite, error: insErr } = await supabaseAdmin
      .from("user_invites")
      .insert({ email, role: data.role, invited_by: context.userId })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    const redirectTo = `${data.origin}/accept-invite?token=${invite.token}`;
    const { error: mailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (mailErr) {
      // Some users may already exist — still return invite row so admin can resend manually
      return { invite, warning: mailErr.message };
    }
    return { invite };
  });

export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("user_invites")
      .select("id,email,role,status,expires_at,created_at,invited_by")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { invites: data ?? [] };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: invite, error } = await supabaseAdmin
      .from("user_invites")
      .update({
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const redirectTo = `${data.origin}/accept-invite?token=${invite.token}`;
    const { error: mailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, { redirectTo });
    if (mailErr) return { ok: true, warning: mailErr.message };
    return { ok: true };
  });

export const cancelInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("user_invites").update({ status: "cancelled" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Public (no admin check) — used by /accept-invite to look up an invite by token
export const getInviteByToken = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ token: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: invite, error } = await supabaseAdmin
      .from("user_invites")
      .select("id,email,role,status,expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invite) return { invite: null as null };
    if (invite.status !== "pending" || new Date(invite.expires_at) < new Date()) {
      return { invite: { ...invite, expired: true } };
    }
    return { invite: { ...invite, expired: false } };
  });
