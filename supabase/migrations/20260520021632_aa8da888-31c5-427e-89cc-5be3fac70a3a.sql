ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS engagement_type text NOT NULL DEFAULT 'prime',
  ADD COLUMN IF NOT EXISTS prime_contractor_id uuid NULL,
  ADD COLUMN IF NOT EXISTS prime_contractor_name text NULL,
  ADD COLUMN IF NOT EXISTS targeted_scope_areas text NULL;

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_engagement_type_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_engagement_type_check
  CHECK (engagement_type IN ('prime', 'sub'));

CREATE INDEX IF NOT EXISTS idx_proposals_engagement_type ON public.proposals(engagement_type);