-- knowledge_base: allow authors to manage their own team entries
CREATE POLICY "Authors update own knowledge_base"
ON public.knowledge_base
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  AND team_id IS NOT NULL
  AND private.is_team_member(team_id, auth.uid())
)
WITH CHECK (
  auth.uid() = user_id
  AND team_id IS NOT NULL
  AND private.is_team_member(team_id, auth.uid())
);

CREATE POLICY "Authors delete own knowledge_base"
ON public.knowledge_base
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  AND team_id IS NOT NULL
  AND private.is_team_member(team_id, auth.uid())
);

-- proposals: validate opportunity_team_id can only be set to a team the actor belongs to
DROP POLICY IF EXISTS "Insert proposals" ON public.proposals;
CREATE POLICY "Insert proposals"
ON public.proposals
FOR INSERT
WITH CHECK (
  (auth.uid() = user_id)
  AND ((team_id IS NULL) OR private.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
  AND (
    opportunity_team_id IS NULL
    OR private.is_team_member(opportunity_team_id, auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  )
);

DROP POLICY IF EXISTS "Update proposals" ON public.proposals;
CREATE POLICY "Update proposals"
ON public.proposals
FOR UPDATE
USING (
  (auth.uid() = user_id)
  OR ((team_id IS NOT NULL) AND private.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
  OR ((opportunity_team_id IS NOT NULL) AND private.team_role_in(opportunity_team_id, auth.uid(), ARRAY['owner','admin','member']))
  OR private.has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  (
    (auth.uid() = user_id)
    OR ((team_id IS NOT NULL) AND private.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
    OR ((opportunity_team_id IS NOT NULL) AND private.team_role_in(opportunity_team_id, auth.uid(), ARRAY['owner','admin','member']))
    OR private.has_role(auth.uid(), 'admin'::app_role)
  )
  AND (
    opportunity_team_id IS NULL
    OR private.is_team_member(opportunity_team_id, auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  )
);