ALTER TABLE public.vehicle_awardees
  ADD COLUMN IF NOT EXISTS team_id uuid NULL REFERENCES public.teams(id) ON DELETE CASCADE;

UPDATE public.vehicle_awardees a
SET team_id = v.team_id
FROM public.vehicle_registry v
WHERE a.vehicle_id = v.id AND a.team_id IS NULL AND v.team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vehicle_awardees_team_id_idx ON public.vehicle_awardees(team_id);

DROP POLICY IF EXISTS "View awardees of visible vehicles" ON public.vehicle_awardees;
DROP POLICY IF EXISTS "Team members insert awardees" ON public.vehicle_awardees;
DROP POLICY IF EXISTS "Team members update awardees" ON public.vehicle_awardees;
DROP POLICY IF EXISTS "Team members delete awardees" ON public.vehicle_awardees;

CREATE POLICY "View global or team awardees"
  ON public.vehicle_awardees FOR SELECT
  TO authenticated
  USING (team_id IS NULL OR private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members insert own-team awardees"
  ON public.vehicle_awardees FOR INSERT
  TO authenticated
  WITH CHECK (team_id IS NOT NULL AND private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members update own-team awardees"
  ON public.vehicle_awardees FOR UPDATE
  TO authenticated
  USING (team_id IS NOT NULL AND private.is_team_member(team_id, auth.uid()))
  WITH CHECK (team_id IS NOT NULL AND private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members delete own-team awardees"
  ON public.vehicle_awardees FOR DELETE
  TO authenticated
  USING (team_id IS NOT NULL AND private.is_team_member(team_id, auth.uid()));