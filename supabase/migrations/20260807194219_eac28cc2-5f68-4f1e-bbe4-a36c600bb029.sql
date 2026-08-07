CREATE OR REPLACE FUNCTION private.has_opp_team_access_to_org(_org_team_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid()
     AND _org_team_id IS NOT NULL
     AND EXISTS (
    SELECT 1
    FROM public.proposals p
    JOIN public.team_members tm
      ON tm.team_id = p.opportunity_team_id
     AND tm.user_id = _user_id
    JOIN public.teams t
      ON t.id = p.opportunity_team_id
     AND t.team_type = 'opportunity'
     AND t.parent_team_id = _org_team_id
    WHERE p.team_id = _org_team_id
      AND p.opportunity_team_id IS NOT NULL
      AND COALESCE(p.outcome, '') NOT IN ('won', 'lost', 'no_bid')
      AND COALESCE(p.status, '') NOT IN ('archived', 'closed', 'cancelled')
  );
$function$;