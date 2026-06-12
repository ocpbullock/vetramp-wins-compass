
ALTER TABLE public.proposal_teaming
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.proposal_teaming
SET company_id = partner_id
WHERE company_id IS NULL;

ALTER TABLE public.proposal_teaming
  ALTER COLUMN partner_id DROP NOT NULL;

ALTER TABLE public.proposal_teaming
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proposal_teaming_company ON public.proposal_teaming(company_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_proposal_teaming_proposal_company
  ON public.proposal_teaming(proposal_id, company_id);
