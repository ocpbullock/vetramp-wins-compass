ALTER TABLE public.opportunity_intel DROP CONSTRAINT IF EXISTS opportunity_intel_intel_type_check;
ALTER TABLE public.opportunity_intel ADD CONSTRAINT opportunity_intel_intel_type_check
  CHECK (intel_type = ANY (ARRAY[
    'incumbent_interview'::text,
    'partner_conversation'::text,
    'customer_meeting'::text,
    'capture_note'::text,
    'candidate_interview'::text,
    'candidate_profile'::text,
    'conference_note'::text,
    'other'::text
  ]));