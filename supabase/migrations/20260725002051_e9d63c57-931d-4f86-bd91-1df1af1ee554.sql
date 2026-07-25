CREATE OR REPLACE FUNCTION private.user_can_see_tracked(_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.tracked_opportunities t
    WHERE t.id = _id AND (
      t.user_id = _user_id
      OR (t.team_id IS NOT NULL AND private.is_team_member(t.team_id, _user_id))
      OR private.has_role(_user_id, 'admin'::app_role)
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.user_can_see_proposal(_proposal_id uuid, _user_id uuid)
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
        OR (p.team_id IS NOT NULL AND private.is_team_member(p.team_id, _user_id))
        OR (p.opportunity_team_id IS NOT NULL AND private.is_team_member(p.opportunity_team_id, _user_id))
        OR private.has_role(_user_id, 'admin'::app_role)
      )
  );
$function$;