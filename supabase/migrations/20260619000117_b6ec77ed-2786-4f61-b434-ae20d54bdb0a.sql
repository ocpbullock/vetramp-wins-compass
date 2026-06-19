
CREATE TABLE public.opportunity_intel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  team_id uuid,
  user_id uuid,
  intel_type text NOT NULL CHECK (intel_type IN ('incumbent_interview','partner_conversation','customer_meeting','capture_note','other')),
  title text,
  source_name text,
  occurred_on date,
  body text,
  file_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opportunity_intel_proposal_id_idx ON public.opportunity_intel(proposal_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_intel TO authenticated;
GRANT ALL ON public.opportunity_intel TO service_role;

ALTER TABLE public.opportunity_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View opportunity intel"
  ON public.opportunity_intel FOR SELECT
  USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Insert opportunity intel"
  ON public.opportunity_intel FOR INSERT
  WITH CHECK (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Update opportunity intel"
  ON public.opportunity_intel FOR UPDATE
  USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Delete opportunity intel"
  ON public.opportunity_intel FOR DELETE
  USING (public.user_can_see_proposal(proposal_id, auth.uid()));
