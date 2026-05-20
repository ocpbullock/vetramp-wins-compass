
-- Tighten pwin_scenarios integrity: FK cascade on proposal, NOT NULL created_by,
-- and INSERT policy enforces created_by = auth.uid().

ALTER TABLE public.pwin_scenarios
  ADD CONSTRAINT pwin_scenarios_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;

ALTER TABLE public.pwin_scenarios
  ALTER COLUMN created_by SET NOT NULL;

DROP POLICY IF EXISTS "Insert pwin scenarios" ON public.pwin_scenarios;
CREATE POLICY "Insert pwin scenarios"
ON public.pwin_scenarios FOR INSERT
WITH CHECK (
  public.user_can_see_proposal(proposal_id, auth.uid())
  AND created_by = auth.uid()
);
