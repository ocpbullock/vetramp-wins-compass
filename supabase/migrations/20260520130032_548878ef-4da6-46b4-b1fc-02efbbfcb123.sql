CREATE TABLE IF NOT EXISTS public.proposal_outreach_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.teaming_partners(id) ON DELETE SET NULL,
  partner_name text NOT NULL,
  generated_by uuid NOT NULL,
  outreach_type text NOT NULL DEFAULT 'email'
    CHECK (outreach_type IN ('email','briefing','call_script','linkedin')),
  relationship_model text NOT NULL DEFAULT 'prime_with_subs'
    CHECK (relationship_model IN ('prime_with_subs','sub_to_prime','joint_venture','mentor_protege','niche_sub')),
  subject text,
  content text NOT NULL,
  fit_rationale jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','copied','sent_externally','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_outreach_drafts_proposal_idx
  ON public.proposal_outreach_drafts (proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proposal_outreach_drafts_partner_idx
  ON public.proposal_outreach_drafts (partner_id);

ALTER TABLE public.proposal_outreach_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View proposal outreach drafts"
  ON public.proposal_outreach_drafts FOR SELECT
  USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Insert proposal outreach drafts"
  ON public.proposal_outreach_drafts FOR INSERT
  WITH CHECK (
    public.user_can_see_proposal(proposal_id, auth.uid())
    AND generated_by = auth.uid()
  );

CREATE POLICY "Update proposal outreach drafts"
  ON public.proposal_outreach_drafts FOR UPDATE
  USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Delete proposal outreach drafts"
  ON public.proposal_outreach_drafts FOR DELETE
  USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE TRIGGER update_proposal_outreach_drafts_updated_at
  BEFORE UPDATE ON public.proposal_outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();