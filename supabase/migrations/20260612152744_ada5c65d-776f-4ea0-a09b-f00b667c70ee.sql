-- Retire the legacy company_profile <-> companies and teaming_partners <-> companies
-- sync triggers. The app now writes to public.companies directly via
-- src/lib/companies.ts helpers. The company_profile and teaming_partners
-- tables remain for one release as a read-only data backup.

DROP TRIGGER IF EXISTS trg_sync_company_profile ON public.company_profile;
DROP FUNCTION IF EXISTS public.sync_company_profile_to_companies();

DROP TRIGGER IF EXISTS trg_sync_teaming_partner ON public.teaming_partners;
DROP FUNCTION IF EXISTS public.sync_teaming_partner_to_companies();