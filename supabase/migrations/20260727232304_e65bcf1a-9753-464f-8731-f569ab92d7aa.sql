
-- Backfill any legacy team_id IS NULL rows to the creator's first team, else delete
DELETE FROM public.diagnostics_runs WHERE team_id IS NULL AND ran_by IS NULL;

UPDATE public.diagnostics_runs d
SET team_id = tm.team_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, team_id
  FROM public.team_members
  ORDER BY user_id, joined_at ASC
) tm
WHERE d.team_id IS NULL AND d.ran_by = tm.user_id;

DELETE FROM public.diagnostics_runs WHERE team_id IS NULL;

ALTER TABLE public.diagnostics_runs ALTER COLUMN team_id SET NOT NULL;

DROP POLICY IF EXISTS "Team members can view diagnostics runs" ON public.diagnostics_runs;
DROP POLICY IF EXISTS "Team members can insert diagnostics runs" ON public.diagnostics_runs;

CREATE POLICY "Team members can view diagnostics runs"
ON public.diagnostics_runs
FOR SELECT
TO authenticated
USING (private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members can insert diagnostics runs"
ON public.diagnostics_runs
FOR INSERT
TO authenticated
WITH CHECK (ran_by = auth.uid() AND private.is_team_member(team_id, auth.uid()));
