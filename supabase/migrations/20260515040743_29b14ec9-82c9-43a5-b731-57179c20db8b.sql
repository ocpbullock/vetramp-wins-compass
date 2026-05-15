
-- 1. Schema additions
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS team_type text NOT NULL DEFAULT 'organization' CHECK (team_type IN ('organization','opportunity')),
  ADD COLUMN IF NOT EXISTS parent_team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_teams_parent ON public.teams(parent_team_id);
CREATE INDEX IF NOT EXISTS idx_teams_type ON public.teams(team_type);

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS opportunity_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_opp_team ON public.proposals(opportunity_team_id);

ALTER TABLE public.user_invites
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_invites_team ON public.user_invites(team_id);

-- 2. Helper SECURITY DEFINER functions
CREATE OR REPLACE FUNCTION public.team_type(_team_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_type FROM public.teams WHERE id = _team_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_team_member(_team_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.team_id = _team_id
      AND tm.user_id = _user_id
      AND t.team_type = 'organization'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_opp_team_member(_team_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.team_id = _team_id
      AND tm.user_id = _user_id
      AND t.team_type = 'opportunity'
  );
$$;

-- True if user is in an opportunity team whose parent_team_id = _org_team_id
CREATE OR REPLACE FUNCTION public.has_opp_team_access_to_org(_org_team_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = _user_id
      AND t.team_type = 'opportunity'
      AND t.parent_team_id = _org_team_id
  );
$$;

-- True if proposal is visible to user via opp team membership
CREATE OR REPLACE FUNCTION public.user_can_see_proposal(_proposal_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
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
$$;

-- 3. RLS policy rewrites

-- proposals: include opportunity_team_id
DROP POLICY IF EXISTS "View proposals" ON public.proposals;
CREATE POLICY "View proposals" ON public.proposals
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (team_id IS NOT NULL AND is_team_member(team_id, auth.uid()))
    OR (opportunity_team_id IS NOT NULL AND is_team_member(opportunity_team_id, auth.uid()))
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Update proposals" ON public.proposals;
CREATE POLICY "Update proposals" ON public.proposals
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (team_id IS NOT NULL AND team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
    OR (opportunity_team_id IS NOT NULL AND team_role_in(opportunity_team_id, auth.uid(), ARRAY['owner','admin','member']))
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- proposal_milestones / teaming / attachments use proposal-derived checks already; update to include opp team membership
DROP POLICY IF EXISTS "View proposal milestones" ON public.proposal_milestones;
CREATE POLICY "View proposal milestones" ON public.proposal_milestones
  FOR SELECT
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Insert proposal milestones" ON public.proposal_milestones;
CREATE POLICY "Insert proposal milestones" ON public.proposal_milestones
  FOR INSERT
  WITH CHECK (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Update proposal milestones" ON public.proposal_milestones;
CREATE POLICY "Update proposal milestones" ON public.proposal_milestones
  FOR UPDATE
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Delete proposal milestones" ON public.proposal_milestones;
CREATE POLICY "Delete proposal milestones" ON public.proposal_milestones
  FOR DELETE
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "View proposal teaming" ON public.proposal_teaming;
CREATE POLICY "View proposal teaming" ON public.proposal_teaming
  FOR SELECT
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Insert proposal teaming" ON public.proposal_teaming;
CREATE POLICY "Insert proposal teaming" ON public.proposal_teaming
  FOR INSERT
  WITH CHECK (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Update proposal teaming" ON public.proposal_teaming;
CREATE POLICY "Update proposal teaming" ON public.proposal_teaming
  FOR UPDATE
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Delete proposal teaming" ON public.proposal_teaming;
CREATE POLICY "Delete proposal teaming" ON public.proposal_teaming
  FOR DELETE
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Users view own attachments" ON public.proposal_attachments;
CREATE POLICY "Users view own attachments" ON public.proposal_attachments
  FOR SELECT
  USING (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Users insert own attachments" ON public.proposal_attachments;
CREATE POLICY "Users insert own attachments" ON public.proposal_attachments
  FOR INSERT
  WITH CHECK (user_can_see_proposal(proposal_id, auth.uid()));

DROP POLICY IF EXISTS "Users delete own attachments" ON public.proposal_attachments;
CREATE POLICY "Users delete own attachments" ON public.proposal_attachments
  FOR DELETE
  USING (user_can_see_proposal(proposal_id, auth.uid()));

-- starred / tracked / search caches: restrict to ORG team members only (not opp teams)
DROP POLICY IF EXISTS "View team starred opportunities" ON public.starred_opportunities;
CREATE POLICY "View team starred opportunities" ON public.starred_opportunities
  FOR SELECT
  USING (is_org_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Insert team starred opportunities" ON public.starred_opportunities;
CREATE POLICY "Insert team starred opportunities" ON public.starred_opportunities
  FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND is_org_team_member(team_id, auth.uid()));

DROP POLICY IF EXISTS "Delete team starred opportunities" ON public.starred_opportunities;
CREATE POLICY "Delete team starred opportunities" ON public.starred_opportunities
  FOR DELETE
  USING (is_org_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "View tracked" ON public.tracked_opportunities;
CREATE POLICY "View tracked" ON public.tracked_opportunities
  FOR SELECT
  USING (
    (auth.uid() = user_id)
    OR (team_id IS NOT NULL AND is_org_team_member(team_id, auth.uid()))
  );

-- knowledge_base / past_performance / contract_vehicles: read-only for opp team members of the parent org
DROP POLICY IF EXISTS "Team read knowledge_base" ON public.knowledge_base;
CREATE POLICY "Team read knowledge_base" ON public.knowledge_base
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (team_id IS NOT NULL AND (is_team_member(team_id, auth.uid()) OR has_opp_team_access_to_org(team_id, auth.uid())))
  );

DROP POLICY IF EXISTS "View team past performance" ON public.past_performance;
CREATE POLICY "View team past performance" ON public.past_performance
  FOR SELECT
  USING (is_team_member(team_id, auth.uid()) OR has_opp_team_access_to_org(team_id, auth.uid()));

DROP POLICY IF EXISTS "View team contract vehicles" ON public.contract_vehicles;
CREATE POLICY "View team contract vehicles" ON public.contract_vehicles
  FOR SELECT
  USING (is_team_member(team_id, auth.uid()) OR has_opp_team_access_to_org(team_id, auth.uid()));

-- user_invites: allow team owners/admins to manage invites scoped to their team
DROP POLICY IF EXISTS "Team owners read invites" ON public.user_invites;
CREATE POLICY "Team owners read invites" ON public.user_invites
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (team_id IS NOT NULL AND team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "Team owners insert invites" ON public.user_invites;
CREATE POLICY "Team owners insert invites" ON public.user_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (team_id IS NOT NULL AND team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "Team owners update invites" ON public.user_invites;
CREATE POLICY "Team owners update invites" ON public.user_invites
  FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (team_id IS NOT NULL AND team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "Team owners delete invites" ON public.user_invites;
CREATE POLICY "Team owners delete invites" ON public.user_invites
  FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (team_id IS NOT NULL AND team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
  );
