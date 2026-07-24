
ALTER TABLE public.proposal_teaming
  ADD COLUMN IF NOT EXISTS outreach_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS outreach_updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS outreach_notes text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposal_teaming_outreach_status_check'
  ) THEN
    ALTER TABLE public.proposal_teaming
      ADD CONSTRAINT proposal_teaming_outreach_status_check
      CHECK (outreach_status IN ('not_started','contacted','call_held','nda_signed','ta_signed','declined'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_proposal_teaming_outreach()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.outreach_status IS DISTINCT FROM OLD.outreach_status THEN
    NEW.outreach_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_proposal_teaming_outreach_trg ON public.proposal_teaming;
CREATE TRIGGER touch_proposal_teaming_outreach_trg
BEFORE UPDATE ON public.proposal_teaming
FOR EACH ROW EXECUTE FUNCTION public.touch_proposal_teaming_outreach();
