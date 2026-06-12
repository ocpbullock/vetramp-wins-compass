
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS has_nda boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_teaming_agreement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prior_contract_together boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketplace_visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS marketplace_listing jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Marketplace visibility is forward-looking only; lock the values now so the
-- future cross-org teaming marketplace has a clean enum to switch on. No
-- marketplace UI exists yet.
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_marketplace_visibility_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_marketplace_visibility_check
  CHECK (marketplace_visibility IN ('private', 'team', 'org', 'public'));

CREATE INDEX IF NOT EXISTS companies_marketplace_visibility_idx
  ON public.companies (marketplace_visibility)
  WHERE marketplace_visibility <> 'private';

COMMENT ON COLUMN public.companies.has_nda IS 'Mutual NDA in place. Feeds the partner-fit bonus in pWin.';
COMMENT ON COLUMN public.companies.has_teaming_agreement IS 'Signed teaming agreement (TA) on file. Feeds the partner-fit bonus in pWin.';
COMMENT ON COLUMN public.companies.prior_contract_together IS 'We have jointly performed on a contract before. Feeds the partner-fit bonus in pWin.';
COMMENT ON COLUMN public.companies.marketplace_visibility IS 'Forward-looking field for a future cross-org teaming marketplace. ''private'' (current behavior) means this row is only visible inside its team_id. Other values are reserved.';
COMMENT ON COLUMN public.companies.marketplace_listing IS 'Reserved JSONB envelope for marketplace metadata (capabilities pitch, geo, availability). Unused until the marketplace ships.';
