
ALTER TABLE public.pwin_scenarios
  ALTER COLUMN proposal_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS tracked_opportunity_id uuid REFERENCES public.tracked_opportunities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS perspective_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opportunity_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_label text;

ALTER TABLE public.pwin_scenarios
  DROP CONSTRAINT IF EXISTS pwin_scenarios_parent_chk;
ALTER TABLE public.pwin_scenarios
  ADD CONSTRAINT pwin_scenarios_parent_chk CHECK (
    (proposal_id IS NOT NULL AND tracked_opportunity_id IS NULL)
    OR (proposal_id IS NULL AND tracked_opportunity_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_pwin_scenarios_tracked
  ON public.pwin_scenarios(tracked_opportunity_id);

-- Helper: user can see a tracked opportunity (mirrors user_can_see_proposal)
CREATE OR REPLACE FUNCTION public.user_can_see_tracked(_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tracked_opportunities t
    WHERE t.id = _id AND (
      t.user_id = _user_id
      OR (t.team_id IS NOT NULL AND public.is_team_member(t.team_id, _user_id))
      OR public.has_role(_user_id, 'admin'::app_role)
    )
  );
$$;

-- Replace policies so tracked-opportunity scenarios are governed by tracked-opportunity access
DROP POLICY IF EXISTS "View pwin scenarios" ON public.pwin_scenarios;
DROP POLICY IF EXISTS "Insert pwin scenarios" ON public.pwin_scenarios;
DROP POLICY IF EXISTS "Update pwin scenarios" ON public.pwin_scenarios;
DROP POLICY IF EXISTS "Delete pwin scenarios" ON public.pwin_scenarios;

CREATE POLICY "View pwin scenarios" ON public.pwin_scenarios FOR SELECT TO authenticated
  USING (
    (proposal_id IS NOT NULL AND public.user_can_see_proposal(proposal_id, auth.uid()))
    OR (tracked_opportunity_id IS NOT NULL AND public.user_can_see_tracked(tracked_opportunity_id, auth.uid()))
  );
CREATE POLICY "Insert pwin scenarios" ON public.pwin_scenarios FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND (
      (proposal_id IS NOT NULL AND public.user_can_see_proposal(proposal_id, auth.uid()))
      OR (tracked_opportunity_id IS NOT NULL AND public.user_can_see_tracked(tracked_opportunity_id, auth.uid()))
    )
  );
CREATE POLICY "Update pwin scenarios" ON public.pwin_scenarios FOR UPDATE TO authenticated
  USING (
    (proposal_id IS NOT NULL AND public.user_can_see_proposal(proposal_id, auth.uid()))
    OR (tracked_opportunity_id IS NOT NULL AND public.user_can_see_tracked(tracked_opportunity_id, auth.uid()))
  );
CREATE POLICY "Delete pwin scenarios" ON public.pwin_scenarios FOR DELETE TO authenticated
  USING (
    (proposal_id IS NOT NULL AND public.user_can_see_proposal(proposal_id, auth.uid()))
    OR (tracked_opportunity_id IS NOT NULL AND public.user_can_see_tracked(tracked_opportunity_id, auth.uid()))
  );
