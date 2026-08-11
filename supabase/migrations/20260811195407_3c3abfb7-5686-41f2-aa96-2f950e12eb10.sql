ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS ecosystem jsonb NULL,
  ADD COLUMN IF NOT EXISTS ecosystem_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ecosystem_config jsonb NULL;