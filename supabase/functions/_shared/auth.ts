// Shared authentication / authorization helpers for Supabase Edge Functions.
//
// Goals:
//   - Validate the request's Authorization bearer token.
//   - Return the authenticated user + scoped Supabase clients.
//   - Assert team membership before any service-role read/write that
//     references team_id.
//   - Assert proposal access using the same logic as the SQL function
//     public.user_can_see_proposal (which is enforced by RLS on the
//     proposals table). We use the user-scoped client so RLS does the work.
//
// Edge functions should call `authenticate(req)` first, then
// `assertTeamMember` / `assertProposalAccess` / `resolveTeamId` BEFORE
// using the service-role admin client for any reads or writes.

import {
  createClient,
  SupabaseClient,
  User,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AuthContext {
  user: User;
  userClient: SupabaseClient;
  admin: SupabaseClient;
  authHeader: string;
}

export function jsonError(
  status: number,
  message: string,
  corsHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Convert an AuthError to a Response; rethrow anything else. */
export function authErrorResponse(
  e: unknown,
  corsHeaders: Record<string, string> = {},
): Response | null {
  if (e instanceof AuthError) return jsonError(e.status, e.message, corsHeaders);
  return null;
}

/**
 * Validate the bearer token and return the authenticated user plus
 * RLS-scoped (`userClient`) and service-role (`admin`) Supabase clients.
 *
 * Throws AuthError(401) when the token is missing or invalid.
 */
export async function authenticate(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Missing or invalid Authorization header");
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError(401, "Invalid or expired token");
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, userClient, admin, authHeader };
}

/**
 * Assert the authenticated user is a member of the given team.
 * Throws AuthError(400) if no teamId, AuthError(403) if not a member.
 */
export async function assertTeamMember(
  ctx: AuthContext,
  teamId: string | null | undefined,
): Promise<string> {
  if (!teamId) throw new AuthError(400, "teamId required");
  const { data, error } = await ctx.admin
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw new AuthError(500, error.message);
  if (!data) throw new AuthError(403, "Not a member of this team");
  return teamId;
}

/**
 * If a teamId is provided, assert membership and return it.
 * Otherwise return the user's first team membership, or null if none.
 */
export async function resolveTeamId(
  ctx: AuthContext,
  providedTeamId?: string | null,
): Promise<string | null> {
  if (providedTeamId) {
    return await assertTeamMember(ctx, providedTeamId);
  }
  const { data } = await ctx.admin
    .from("team_members")
    .select("team_id")
    .eq("user_id", ctx.user.id)
    .limit(1)
    .maybeSingle();
  return data?.team_id ?? null;
}

export interface ProposalAccess {
  id: string;
  user_id: string;
  team_id: string | null;
  opportunity_team_id: string | null;
}

/**
 * Assert the authenticated user can see the proposal. Uses the user-scoped
 * client so the RLS policy (which mirrors public.user_can_see_proposal)
 * does the access check. Returns the minimal proposal row on success.
 *
 * Throws AuthError(400) if no proposalId, AuthError(403) if not visible.
 */
export async function assertProposalAccess(
  ctx: AuthContext,
  proposalId: string | null | undefined,
): Promise<ProposalAccess> {
  if (!proposalId) throw new AuthError(400, "proposalId required");
  const { data, error } = await ctx.userClient
    .from("proposals")
    .select("id, user_id, team_id, opportunity_team_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new AuthError(500, error.message);
  if (!data) throw new AuthError(403, "Proposal not found or not accessible");
  return data as ProposalAccess;
}
