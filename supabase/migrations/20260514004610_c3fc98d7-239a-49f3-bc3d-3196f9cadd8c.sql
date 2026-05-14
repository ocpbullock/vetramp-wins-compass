
CREATE TABLE public.teaming_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  uei text,
  cage_code text,
  poc_name text,
  poc_email text,
  poc_phone text,
  certifications text[] NOT NULL DEFAULT '{}',
  naics_codes text[] NOT NULL DEFAULT '{}',
  capabilities_summary text,
  past_performance_summary text,
  contract_vehicles text[] NOT NULL DEFAULT '{}',
  relationship_status text NOT NULL DEFAULT 'active' CHECK (relationship_status IN ('active','prospective','inactive')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.teaming_partners ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_teaming_partners_team ON public.teaming_partners(team_id);
CREATE TRIGGER teaming_partners_set_updated_at
BEFORE UPDATE ON public.teaming_partners
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "View team partners" ON public.teaming_partners FOR SELECT TO authenticated
USING (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Insert team partners" ON public.teaming_partners FOR INSERT TO authenticated
WITH CHECK (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));
CREATE POLICY "Update team partners" ON public.teaming_partners FOR UPDATE TO authenticated
USING (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));
CREATE POLICY "Delete team partners" ON public.teaming_partners FOR DELETE TO authenticated
USING (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']));

CREATE TABLE public.proposal_teaming (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.teaming_partners(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'sub' CHECK (role IN ('prime','sub','mentor','protege','jv_partner')),
  work_share_pct integer CHECK (work_share_pct IS NULL OR (work_share_pct >= 0 AND work_share_pct <= 100)),
  naics_contribution text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, partner_id)
);

ALTER TABLE public.proposal_teaming ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_proposal_teaming_proposal ON public.proposal_teaming(proposal_id);
CREATE INDEX idx_proposal_teaming_partner ON public.proposal_teaming(partner_id);
CREATE TRIGGER proposal_teaming_set_updated_at
BEFORE UPDATE ON public.proposal_teaming
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "View proposal teaming" ON public.proposal_teaming FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.proposals p WHERE p.id = proposal_teaming.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.is_team_member(p.team_id, auth.uid()))
      OR public.has_role(auth.uid(), 'admin'::app_role))
));
CREATE POLICY "Insert proposal teaming" ON public.proposal_teaming FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.proposals p WHERE p.id = proposal_teaming.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.team_role_in(p.team_id, auth.uid(), ARRAY['owner','admin','member'])))
));
CREATE POLICY "Update proposal teaming" ON public.proposal_teaming FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.proposals p WHERE p.id = proposal_teaming.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.team_role_in(p.team_id, auth.uid(), ARRAY['owner','admin','member'])))
));
CREATE POLICY "Delete proposal teaming" ON public.proposal_teaming FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.proposals p WHERE p.id = proposal_teaming.proposal_id
    AND (p.user_id = auth.uid()
      OR (p.team_id IS NOT NULL AND public.team_role_in(p.team_id, auth.uid(), ARRAY['owner','admin','member'])))
));
