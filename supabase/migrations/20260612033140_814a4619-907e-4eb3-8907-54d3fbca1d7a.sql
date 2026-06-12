ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS known_incumbent text,
  ADD COLUMN IF NOT EXISTS incumbent_notes text,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS competitive_notes text,
  ADD COLUMN IF NOT EXISTS capture_notes text;