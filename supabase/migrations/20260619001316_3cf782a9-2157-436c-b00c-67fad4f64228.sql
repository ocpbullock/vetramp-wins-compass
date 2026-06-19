ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS capture_analysis jsonb,
  ADD COLUMN IF NOT EXISTS capture_analysis_at timestamptz;