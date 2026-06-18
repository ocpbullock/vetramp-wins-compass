ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS capture_stage text NOT NULL DEFAULT 'intake';

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_capture_stage_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_capture_stage_check
  CHECK (capture_stage IN ('intake','researching','analyzing','pursuing','proposal','submitted','won','lost','no_bid'));

UPDATE public.proposals
SET capture_stage = CASE
  WHEN status IS NULL THEN 'researching'
  WHEN lower(status) = 'intake' THEN 'intake'
  WHEN lower(status) = 'submitted' THEN 'submitted'
  WHEN lower(status) = 'won' THEN 'won'
  WHEN lower(status) = 'lost' THEN 'lost'
  WHEN lower(status) = 'no_bid' OR lower(status) = 'no-bid' THEN 'no_bid'
  WHEN lower(status) LIKE '%propos%' OR lower(status) LIKE '%draft%' OR lower(status) LIKE '%writ%' OR lower(status) LIKE '%review%' THEN 'proposal'
  WHEN lower(status) LIKE '%pursu%' OR lower(status) LIKE '%capture%' THEN 'pursuing'
  WHEN lower(status) LIKE '%analy%' THEN 'analyzing'
  WHEN lower(status) LIKE '%research%' OR lower(status) LIKE '%watch%' OR lower(status) LIKE '%track%' THEN 'researching'
  ELSE 'researching'
END;