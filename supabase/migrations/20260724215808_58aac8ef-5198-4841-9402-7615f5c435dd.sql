-- Restrict SECURITY DEFINER helper functions so callers cannot probe
-- team membership or proposal/tracked visibility for arbitrary user ids.
-- Policies always pass auth.uid(), so enforcing _user_id = auth.uid()
-- keeps RLS behaviour identical while neutralising direct RPC probing.

CREATE OR REPLACE FUNCTION public.team_role_in(_team_id uuid, _user_id uuid, _roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = _team_id AND user_id = _user_id AND role = ANY(_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_opp_team_member(_team_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.team_id = _team_id
      AND tm.user_id = _user_id
      AND t.team_type = 'opportunity'
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_opp_team_access_to_org(_org_team_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = _user_id
      AND t.team_type = 'opportunity'
      AND t.parent_team_id = _org_team_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_org_team_member(_team_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.team_id = _team_id
      AND tm.user_id = _user_id
      AND t.team_type = 'organization'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_team_member(_team_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.team_members WHERE team_id = _team_id AND user_id = _user_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.team_role(_team_id uuid, _user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.team_members
   WHERE team_id = _team_id AND user_id = _user_id AND _user_id = auth.uid()
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.user_can_see_tracked(_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.tracked_opportunities t
    WHERE t.id = _id AND (
      t.user_id = _user_id
      OR (t.team_id IS NOT NULL AND public.is_team_member(t.team_id, _user_id))
      OR public.has_role(_user_id, 'admin'::app_role)
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.users_share_team(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (auth.uid() = _a OR auth.uid() = _b) AND EXISTS (
    SELECT 1 FROM public.team_members tm1
    JOIN public.team_members tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.user_id = _a AND tm2.user_id = _b
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_see_proposal(_proposal_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1
    FROM public.proposals p
    WHERE p.id = _proposal_id
      AND (
        p.user_id = _user_id
        OR (p.team_id IS NOT NULL AND public.is_team_member(p.team_id, _user_id))
        OR (p.opportunity_team_id IS NOT NULL AND public.is_team_member(p.opportunity_team_id, _user_id))
        OR public.has_role(_user_id, 'admin'::app_role)
      )
  );
$function$;
