
-- 1) Add team_id to cache tables and clear legacy rows
ALTER TABLE public.cached_searches ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE public.cached_competitive_intel ADD COLUMN IF NOT EXISTS team_id uuid;

DELETE FROM public.cached_searches;
DELETE FROM public.cached_competitive_intel;
DELETE FROM public.ai_response_cache WHERE team_id IS NULL;

ALTER TABLE public.cached_searches ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE public.cached_competitive_intel ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE public.ai_response_cache ALTER COLUMN team_id SET NOT NULL;

-- 2) Replace permissive RLS on cache tables with team-scoped policies
DROP POLICY IF EXISTS "Authenticated can read cache" ON public.cached_searches;
DROP POLICY IF EXISTS "Authenticated can insert cache" ON public.cached_searches;
DROP POLICY IF EXISTS "Authenticated can update cache" ON public.cached_searches;
DROP POLICY IF EXISTS "Authenticated can delete cache" ON public.cached_searches;

CREATE POLICY "Team read cached_searches" ON public.cached_searches
  FOR SELECT TO authenticated USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Team insert cached_searches" ON public.cached_searches
  FOR INSERT TO authenticated WITH CHECK (is_team_member(team_id, auth.uid()));
CREATE POLICY "Team update cached_searches" ON public.cached_searches
  FOR UPDATE TO authenticated USING (is_team_member(team_id, auth.uid()));
CREATE POLICY "Team delete cached_searches" ON public.cached_searches
  FOR DELETE TO authenticated USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Auth read cci" ON public.cached_competitive_intel;
DROP POLICY IF EXISTS "Auth insert cci" ON public.cached_competitive_intel;
DROP POLICY IF EXISTS "Auth update cci" ON public.cached_competitive_intel;
DROP POLICY IF EXISTS "Auth delete cci" ON public.cached_competitive_intel;

CREATE POLICY "Team read cci" ON public.cached_competitive_intel
  FOR SELECT TO authenticated USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Team insert cci" ON public.cached_competitive_intel
  FOR INSERT TO authenticated WITH CHECK (is_team_member(team_id, auth.uid()));
CREATE POLICY "Team update cci" ON public.cached_competitive_intel
  FOR UPDATE TO authenticated USING (is_team_member(team_id, auth.uid()));
CREATE POLICY "Team delete cci" ON public.cached_competitive_intel
  FOR DELETE TO authenticated USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Read cache for team" ON public.ai_response_cache;
DROP POLICY IF EXISTS "Insert cache for team" ON public.ai_response_cache;
DROP POLICY IF EXISTS "Delete cache for team" ON public.ai_response_cache;

CREATE POLICY "Team read ai cache" ON public.ai_response_cache
  FOR SELECT TO authenticated USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Team insert ai cache" ON public.ai_response_cache
  FOR INSERT TO authenticated WITH CHECK (is_team_member(team_id, auth.uid()));
CREATE POLICY "Team delete ai cache" ON public.ai_response_cache
  FOR DELETE TO authenticated USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- 3) knowledge_base: add team_id and scope SELECT/INSERT
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS team_id uuid;

DROP POLICY IF EXISTS "Authenticated read knowledge_base" ON public.knowledge_base;
DROP POLICY IF EXISTS "Members insert own knowledge_base" ON public.knowledge_base;

CREATE POLICY "Team read knowledge_base" ON public.knowledge_base
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (team_id IS NOT NULL AND is_team_member(team_id, auth.uid()))
  );

CREATE POLICY "Team insert knowledge_base" ON public.knowledge_base
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (auth.uid() = user_id AND team_id IS NOT NULL AND is_team_member(team_id, auth.uid()))
  );

-- 4) Foreign keys
ALTER TABLE public.past_performance
  ADD CONSTRAINT past_performance_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE public.contract_vehicles
  ADD CONSTRAINT contract_vehicles_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE public.proposal_milestones
  ADD CONSTRAINT proposal_milestones_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
