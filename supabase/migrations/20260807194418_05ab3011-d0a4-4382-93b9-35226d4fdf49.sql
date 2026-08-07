ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS team_lead_company_id uuid NULL,
  ADD COLUMN IF NOT EXISTS team_lead_name text NULL;