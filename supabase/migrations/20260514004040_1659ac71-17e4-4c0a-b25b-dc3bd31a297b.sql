
-- Teams table
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER teams_set_updated_at
BEFORE UPDATE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Team members
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_team_members_user ON public.team_members(user_id);
CREATE INDEX idx_team_members_team ON public.team_members(team_id);

-- Security definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_team_member(_team_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = _team_id AND user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.team_role(_team_id uuid, _user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.team_members WHERE team_id = _team_id AND user_id = _user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.team_role_in(_team_id uuid, _user_id uuid, _roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = _team_id AND user_id = _user_id AND role = ANY(_roles));
$$;

-- RLS for teams
CREATE POLICY "Members view their teams" ON public.teams FOR SELECT TO authenticated
USING (public.is_team_member(id, auth.uid()) OR created_by = auth.uid());

CREATE POLICY "Authenticated create teams" ON public.teams FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owners update team" ON public.teams FOR UPDATE TO authenticated
USING (public.team_role_in(id, auth.uid(), ARRAY['owner']));

CREATE POLICY "Owners delete team" ON public.teams FOR DELETE TO authenticated
USING (public.team_role_in(id, auth.uid(), ARRAY['owner']));

-- RLS for team_members
CREATE POLICY "View own membership" ON public.team_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_team_member(team_id, auth.uid()));

CREATE POLICY "Owners admins add members" ON public.team_members FOR INSERT TO authenticated
WITH CHECK (
  public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin'])
  OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.created_by = auth.uid())
);

CREATE POLICY "Owners admins update members" ON public.team_members FOR UPDATE TO authenticated
USING (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']));

CREATE POLICY "Owners admins remove members or self leave" ON public.team_members FOR DELETE TO authenticated
USING (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']) OR user_id = auth.uid());

-- Add team_id columns
ALTER TABLE public.proposals ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.tracked_opportunities ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.proposal_drafts ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.company_profile ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX idx_proposals_team ON public.proposals(team_id);
CREATE INDEX idx_tracked_team ON public.tracked_opportunities(team_id);
CREATE INDEX idx_drafts_team ON public.proposal_drafts(team_id);
CREATE INDEX idx_company_team ON public.company_profile(team_id);

-- Replace proposals policies
DROP POLICY IF EXISTS "Users view own proposals" ON public.proposals;
DROP POLICY IF EXISTS "Users insert own proposals" ON public.proposals;
DROP POLICY IF EXISTS "Users update own proposals" ON public.proposals;
DROP POLICY IF EXISTS "Users delete own proposals" ON public.proposals;

CREATE POLICY "View proposals" ON public.proposals FOR SELECT
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()))
  OR public.has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "Insert proposals" ON public.proposals FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND (team_id IS NULL OR public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
);
CREATE POLICY "Update proposals" ON public.proposals FOR UPDATE
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
  OR public.has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "Delete proposals" ON public.proposals FOR DELETE
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

-- Replace tracked_opportunities policies
DROP POLICY IF EXISTS "Users view own tracked" ON public.tracked_opportunities;
DROP POLICY IF EXISTS "Users insert own tracked" ON public.tracked_opportunities;
DROP POLICY IF EXISTS "Users update own tracked" ON public.tracked_opportunities;
DROP POLICY IF EXISTS "Users delete own tracked" ON public.tracked_opportunities;

CREATE POLICY "View tracked" ON public.tracked_opportunities FOR SELECT
USING (auth.uid() = user_id OR (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid())));
CREATE POLICY "Insert tracked" ON public.tracked_opportunities FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND (team_id IS NULL OR public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
);
CREATE POLICY "Update tracked" ON public.tracked_opportunities FOR UPDATE
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
);
CREATE POLICY "Delete tracked" ON public.tracked_opportunities FOR DELETE
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
);

-- Replace proposal_drafts policies
DROP POLICY IF EXISTS "Users view own drafts" ON public.proposal_drafts;
DROP POLICY IF EXISTS "Users insert own drafts" ON public.proposal_drafts;
DROP POLICY IF EXISTS "Users update own drafts" ON public.proposal_drafts;
DROP POLICY IF EXISTS "Users delete own drafts" ON public.proposal_drafts;

CREATE POLICY "View drafts" ON public.proposal_drafts FOR SELECT
USING (auth.uid() = user_id OR (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid())));
CREATE POLICY "Insert drafts" ON public.proposal_drafts FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND (team_id IS NULL OR public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
);
CREATE POLICY "Update drafts" ON public.proposal_drafts FOR UPDATE
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']))
);
CREATE POLICY "Delete drafts" ON public.proposal_drafts FOR DELETE
USING (
  auth.uid() = user_id
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
);

-- Update company_profile policies (keep legacy global behavior when team_id is null)
DROP POLICY IF EXISTS "Authenticated read company profile" ON public.company_profile;
DROP POLICY IF EXISTS "Admins insert company profile" ON public.company_profile;
DROP POLICY IF EXISTS "Admins update company profile" ON public.company_profile;

CREATE POLICY "View company profile" ON public.company_profile FOR SELECT TO authenticated
USING (
  team_id IS NULL
  OR public.is_team_member(team_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "Insert company profile" ON public.company_profile FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
);
CREATE POLICY "Update company profile" ON public.company_profile FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (team_id IS NOT NULL AND public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']))
);
