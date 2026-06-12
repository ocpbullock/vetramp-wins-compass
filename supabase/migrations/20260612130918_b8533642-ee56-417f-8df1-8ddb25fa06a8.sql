
-- Fix: restrict profiles SELECT to self + teammates + admin
DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;

CREATE OR REPLACE FUNCTION public.users_share_team(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm1
    JOIN public.team_members tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.user_id = _a AND tm2.user_id = _b
  );
$$;
REVOKE EXECUTE ON FUNCTION public.users_share_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_share_team(uuid, uuid) TO authenticated, service_role;

CREATE POLICY "View own or teammate profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.users_share_team(auth.uid(), user_id)
  );

-- Fix: company_profile - remove team_id IS NULL branch in SELECT
DROP POLICY IF EXISTS "View company profile" ON public.company_profile;
CREATE POLICY "View company profile" ON public.company_profile
  FOR SELECT TO authenticated
  USING (
    (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()))
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Fix: add UPDATE policy for proposal-attachments storage objects
DROP POLICY IF EXISTS "Update proposal files by proposal access" ON storage.objects;
CREATE POLICY "Update proposal files by proposal access" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'proposal-attachments'
    AND (storage.foldername(name))[1] = 'proposals'
    AND public.user_can_see_proposal(((storage.foldername(name))[2])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'proposal-attachments'
    AND (storage.foldername(name))[1] = 'proposals'
    AND public.user_can_see_proposal(((storage.foldername(name))[2])::uuid, auth.uid())
  );

-- Lock down SECURITY DEFINER helper functions: revoke from anon/public; keep authenticated + service_role
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'has_role','is_team_member','team_role','team_role_in','team_type',
        'is_org_team_member','is_opp_team_member','has_opp_team_access_to_org',
        'user_can_see_proposal','user_can_see_tracked'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
