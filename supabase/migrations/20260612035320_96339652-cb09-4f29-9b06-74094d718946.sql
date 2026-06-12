ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS pursuit_type text NOT NULL DEFAULT 'rfp_rfq';

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_pursuit_type_check;
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_pursuit_type_check
  CHECK (pursuit_type IN ('rfp_rfq', 'rfi_sources_sought', 'capability_statement'));

CREATE INDEX IF NOT EXISTS idx_proposals_pursuit_type ON public.proposals(pursuit_type);