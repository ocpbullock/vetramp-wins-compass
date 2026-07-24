-- 1) ai_usage_log: add INSERT policy so authenticated team members can log usage
CREATE POLICY "Team insert ai usage"
ON public.ai_usage_log
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    team_id IS NULL
    OR public.is_team_member(team_id, auth.uid())
  )
);

-- 2) user_invites: stop platform admins from reading every invite email.
-- Drop the blanket admin read policy and remove the admin bypass from the
-- team-owner read policy so invite emails only surface to owners/admins of
-- the specific team the invite belongs to.
DROP POLICY IF EXISTS "Admins read invites" ON public.user_invites;
DROP POLICY IF EXISTS "Team owners read invites" ON public.user_invites;
CREATE POLICY "Team owners read invites"
ON public.user_invites
FOR SELECT
TO authenticated
USING (
  team_id IS NOT NULL
  AND public.team_role_in(team_id, auth.uid(), ARRAY['owner'::text, 'admin'::text])
);

-- 3) Move SECURITY DEFINER helper functions out of the public (API) schema.
-- ALTER FUNCTION ... SET SCHEMA preserves the function OID, so existing RLS
-- policies (which reference the function by OID in their parse trees) keep
-- resolving to the same function under its new schema — no policy rewrites
-- needed. PostgREST does not expose the `private` schema, so signed-in
-- users can no longer call these via RPC.

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
-- No USAGE for anon: none of these helpers should ever run for anonymous requests.

ALTER FUNCTION public.has_role(uuid, public.app_role)                SET SCHEMA private;
ALTER FUNCTION public.team_role_in(uuid, uuid, text[])               SET SCHEMA private;
ALTER FUNCTION public.is_opp_team_member(uuid, uuid)                 SET SCHEMA private;
ALTER FUNCTION public.has_opp_team_access_to_org(uuid, uuid)         SET SCHEMA private;
ALTER FUNCTION public.is_org_team_member(uuid, uuid)                 SET SCHEMA private;
ALTER FUNCTION public.team_type(uuid)                                SET SCHEMA private;
ALTER FUNCTION public.is_team_member(uuid, uuid)                     SET SCHEMA private;
ALTER FUNCTION public.team_role(uuid, uuid)                          SET SCHEMA private;
ALTER FUNCTION public.user_can_see_tracked(uuid, uuid)               SET SCHEMA private;
ALTER FUNCTION public.users_share_team(uuid, uuid)                   SET SCHEMA private;
ALTER FUNCTION public.user_can_see_proposal(uuid, uuid)              SET SCHEMA private;

-- Trigger-only SECURITY DEFINER helpers — also move so the linter is clean.
ALTER FUNCTION public.update_updated_at_column()                     SET SCHEMA private;
ALTER FUNCTION public.handle_new_user()                              SET SCHEMA private;

-- Lock EXECUTE down on the moved functions: revoke the default PUBLIC grant,
-- keep EXECUTE for authenticated (required for RLS policy evaluation) and
-- service_role (edge/admin code). Trigger-only functions execute as the
-- table owner and don't need role grants.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'has_role(uuid, public.app_role)',
    'team_role_in(uuid, uuid, text[])',
    'is_opp_team_member(uuid, uuid)',
    'has_opp_team_access_to_org(uuid, uuid)',
    'is_org_team_member(uuid, uuid)',
    'team_type(uuid)',
    'is_team_member(uuid, uuid)',
    'team_role(uuid, uuid)',
    'user_can_see_tracked(uuid, uuid)',
    'users_share_team(uuid, uuid)',
    'user_can_see_proposal(uuid, uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION private.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION private.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION private.%s TO service_role', fn);
  END LOOP;

  EXECUTE 'REVOKE ALL ON FUNCTION private.update_updated_at_column() FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC';
END $$;