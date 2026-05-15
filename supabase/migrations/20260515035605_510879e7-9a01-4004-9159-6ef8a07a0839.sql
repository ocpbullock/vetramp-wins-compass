ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS opportunity_source text,
  ADD COLUMN IF NOT EXISTS opportunity_source_id text;

CREATE INDEX IF NOT EXISTS idx_proposals_opp_source
  ON public.proposals (opportunity_source, opportunity_source_id);