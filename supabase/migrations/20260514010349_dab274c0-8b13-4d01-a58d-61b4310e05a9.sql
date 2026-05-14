
CREATE TABLE public.proposal_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid NOT NULL,
  title text NOT NULL,
  due_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'upcoming',
  assignee_id uuid,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX proposal_milestones_proposal_id_idx ON public.proposal_milestones(proposal_id);
CREATE INDEX proposal_milestones_due_date_idx ON public.proposal_milestones(due_date);

ALTER TABLE public.proposal_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View proposal milestones"
ON public.proposal_milestones FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.proposals p
  WHERE p.id = proposal_milestones.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.is_team_member(p.team_id, auth.uid()))
      OR public.has_role(auth.uid(), 'admin'::app_role))
));

CREATE POLICY "Insert proposal milestones"
ON public.proposal_milestones FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.proposals p
  WHERE p.id = proposal_milestones.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.team_role_in(p.team_id, auth.uid(), ARRAY['owner','admin','member'])))
));

CREATE POLICY "Update proposal milestones"
ON public.proposal_milestones FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.proposals p
  WHERE p.id = proposal_milestones.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.team_role_in(p.team_id, auth.uid(), ARRAY['owner','admin','member'])))
));

CREATE POLICY "Delete proposal milestones"
ON public.proposal_milestones FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.proposals p
  WHERE p.id = proposal_milestones.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.team_role_in(p.team_id, auth.uid(), ARRAY['owner','admin','member'])))
));

CREATE TRIGGER update_proposal_milestones_updated_at
BEFORE UPDATE ON public.proposal_milestones
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
