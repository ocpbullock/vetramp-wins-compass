UPDATE public.proposals
SET capture_notes = btrim(customer_intel->>'notes')
WHERE (capture_notes IS NULL OR btrim(capture_notes) = '')
  AND customer_intel ? 'notes'
  AND btrim(coalesce(customer_intel->>'notes', '')) <> '';

UPDATE public.proposals
SET customer_intel = customer_intel - 'notes'
WHERE customer_intel ? 'notes';