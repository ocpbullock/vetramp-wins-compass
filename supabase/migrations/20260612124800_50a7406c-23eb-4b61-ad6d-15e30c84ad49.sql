
-- 1. Extend teaming_partners with the new relationship fields so writes through the legacy path carry them
ALTER TABLE public.teaming_partners
  ADD COLUMN IF NOT EXISTS relationship_strength int CHECK (relationship_strength BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS worked_together_before boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_existing_partner boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_ref jsonb;

-- 2. Companies table
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  uei text,
  cage_code text,
  duns text,
  website text,
  certifications text[] NOT NULL DEFAULT '{}',
  set_asides text[] NOT NULL DEFAULT '{}',
  naics_codes text[] NOT NULL DEFAULT '{}',
  contract_vehicles text[] NOT NULL DEFAULT '{}',
  capabilities_narrative text,
  past_performance jsonb NOT NULL DEFAULT '[]'::jsonb,
  poc_name text,
  poc_email text,
  poc_phone text,
  is_own_company boolean NOT NULL DEFAULT false,
  is_existing_partner boolean NOT NULL DEFAULT false,
  worked_together_before boolean NOT NULL DEFAULT false,
  relationship_strength int CHECK (relationship_strength BETWEEN 0 AND 100),
  relationship_status text NOT NULL DEFAULT 'prospective' CHECK (relationship_status IN ('active','prospective','inactive')),
  source text NOT NULL DEFAULT 'manual',
  external_ref jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_team ON public.companies(team_id);
CREATE UNIQUE INDEX uniq_own_company_per_team ON public.companies(team_id) WHERE is_own_company = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read team companies" ON public.companies FOR SELECT TO authenticated
  USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Insert team companies" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));
CREATE POLICY "Update team companies" ON public.companies FOR UPDATE TO authenticated
  USING (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));
CREATE POLICY "Delete team companies" ON public.companies FOR DELETE TO authenticated
  USING (public.team_role_in(team_id, auth.uid(), ARRAY['owner','admin']));

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Sync trigger: teaming_partners -> companies (mirror with same id)
CREATE OR REPLACE FUNCTION public.sync_teaming_partner_to_companies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.companies WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO public.companies (
    id, team_id, name, uei, cage_code, poc_name, poc_email, poc_phone,
    certifications, naics_codes, contract_vehicles, capabilities_narrative,
    relationship_status, relationship_strength, worked_together_before,
    is_existing_partner, is_own_company, source, external_ref, notes,
    created_by, past_performance, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.team_id, NEW.company_name, NEW.uei, NEW.cage_code,
    NEW.poc_name, NEW.poc_email, NEW.poc_phone,
    COALESCE(NEW.certifications, '{}'), COALESCE(NEW.naics_codes, '{}'),
    COALESCE(NEW.contract_vehicles, '{}'), NEW.capabilities_summary,
    NEW.relationship_status, NEW.relationship_strength, NEW.worked_together_before,
    NEW.is_existing_partner, false, NEW.source, NEW.external_ref, NEW.notes,
    NEW.created_by,
    CASE WHEN NEW.past_performance_summary IS NOT NULL AND NEW.past_performance_summary <> ''
      THEN jsonb_build_array(jsonb_build_object('summary', NEW.past_performance_summary))
      ELSE '[]'::jsonb END,
    NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, uei = EXCLUDED.uei, cage_code = EXCLUDED.cage_code,
    poc_name = EXCLUDED.poc_name, poc_email = EXCLUDED.poc_email, poc_phone = EXCLUDED.poc_phone,
    certifications = EXCLUDED.certifications, naics_codes = EXCLUDED.naics_codes,
    contract_vehicles = EXCLUDED.contract_vehicles,
    capabilities_narrative = EXCLUDED.capabilities_narrative,
    relationship_status = EXCLUDED.relationship_status,
    relationship_strength = EXCLUDED.relationship_strength,
    worked_together_before = EXCLUDED.worked_together_before,
    is_existing_partner = EXCLUDED.is_existing_partner,
    source = EXCLUDED.source, external_ref = EXCLUDED.external_ref,
    notes = EXCLUDED.notes, updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_teaming_partner ON public.teaming_partners;
CREATE TRIGGER trg_sync_teaming_partner
  AFTER INSERT OR UPDATE OR DELETE ON public.teaming_partners
  FOR EACH ROW EXECUTE FUNCTION public.sync_teaming_partner_to_companies();

-- 4. Sync trigger: company_profile -> companies (own company row, one per team)
CREATE OR REPLACE FUNCTION public.sync_company_profile_to_companies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _name text; _uei text; _cage text; _caps text;
  _certs text[]; _naics text[]; _vehicles text[]; _set_asides text[];
BEGIN
  IF NEW.team_id IS NULL THEN RETURN NEW; END IF;
  _name := COALESCE(NULLIF(NEW.profile_data->>'legal_name', ''), NULLIF(NEW.profile_data->>'companyName',''), NULLIF(NEW.profile_data->>'name',''), 'Our Company');
  _uei := NULLIF(NEW.profile_data->>'uei', '');
  _cage := COALESCE(NULLIF(NEW.profile_data->>'cage_code',''), NULLIF(NEW.profile_data->>'cage',''));
  _caps := COALESCE(NULLIF(NEW.profile_data->>'capabilities',''), NULLIF(NEW.profile_data->>'capabilities_narrative',''));
  _certs := CASE WHEN jsonb_typeof(NEW.profile_data->'certifications')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.profile_data->'certifications')) ELSE '{}'::text[] END;
  _set_asides := CASE WHEN jsonb_typeof(NEW.profile_data->'set_asides')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.profile_data->'set_asides')) ELSE '{}'::text[] END;
  _naics := CASE WHEN jsonb_typeof(NEW.profile_data->'naics')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.profile_data->'naics'))
    WHEN jsonb_typeof(NEW.profile_data->'naics_codes')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.profile_data->'naics_codes'))
    ELSE '{}'::text[] END;
  _vehicles := CASE WHEN jsonb_typeof(NEW.profile_data->'contract_vehicles')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.profile_data->'contract_vehicles'))
    WHEN jsonb_typeof(NEW.profile_data->'contractVehicles')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.profile_data->'contractVehicles'))
    ELSE '{}'::text[] END;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE team_id = NEW.team_id AND is_own_company = true) THEN
    INSERT INTO public.companies (team_id, name, uei, cage_code, certifications, set_asides, naics_codes, contract_vehicles, capabilities_narrative, is_own_company, source, external_ref, past_performance)
    VALUES (NEW.team_id, _name, _uei, _cage, _certs, _set_asides, _naics, _vehicles, _caps, true, 'legacy_profile', jsonb_build_object('profile_data', NEW.profile_data),
      COALESCE(CASE WHEN jsonb_typeof(NEW.profile_data->'past_performance')='array' THEN NEW.profile_data->'past_performance' ELSE NULL END, '[]'::jsonb));
  ELSE
    UPDATE public.companies SET
      name = _name, uei = _uei, cage_code = _cage,
      certifications = _certs, set_asides = _set_asides, naics_codes = _naics, contract_vehicles = _vehicles,
      capabilities_narrative = _caps,
      external_ref = jsonb_build_object('profile_data', NEW.profile_data),
      past_performance = COALESCE(CASE WHEN jsonb_typeof(NEW.profile_data->'past_performance')='array' THEN NEW.profile_data->'past_performance' ELSE NULL END, past_performance),
      updated_at = now()
    WHERE team_id = NEW.team_id AND is_own_company = true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_company_profile ON public.company_profile;
CREATE TRIGGER trg_sync_company_profile
  AFTER INSERT OR UPDATE ON public.company_profile
  FOR EACH ROW EXECUTE FUNCTION public.sync_company_profile_to_companies();

-- 5. Backfill from teaming_partners (same id so existing FKs map)
INSERT INTO public.companies (id, team_id, name, uei, cage_code, poc_name, poc_email, poc_phone,
  certifications, naics_codes, contract_vehicles, capabilities_narrative,
  relationship_status, is_existing_partner, is_own_company, source, notes,
  created_by, past_performance, created_at, updated_at)
SELECT tp.id, tp.team_id, tp.company_name, tp.uei, tp.cage_code, tp.poc_name, tp.poc_email, tp.poc_phone,
  COALESCE(tp.certifications, '{}'), COALESCE(tp.naics_codes, '{}'),
  COALESCE(tp.contract_vehicles, '{}'), tp.capabilities_summary,
  tp.relationship_status, true, false, 'legacy_partner', tp.notes,
  tp.created_by,
  CASE WHEN tp.past_performance_summary IS NOT NULL AND tp.past_performance_summary <> ''
    THEN jsonb_build_array(jsonb_build_object('summary', tp.past_performance_summary))
    ELSE '[]'::jsonb END,
  tp.created_at, tp.updated_at
FROM public.teaming_partners tp
ON CONFLICT (id) DO NOTHING;

-- 6. Backfill from company_profile (own company)
INSERT INTO public.companies (team_id, name, uei, cage_code, certifications, set_asides, naics_codes, contract_vehicles, capabilities_narrative, is_own_company, source, external_ref, past_performance, updated_at)
SELECT
  cp.team_id,
  COALESCE(NULLIF(cp.profile_data->>'legal_name',''), NULLIF(cp.profile_data->>'companyName',''), NULLIF(cp.profile_data->>'name',''), 'Our Company'),
  NULLIF(cp.profile_data->>'uei',''),
  COALESCE(NULLIF(cp.profile_data->>'cage_code',''), NULLIF(cp.profile_data->>'cage','')),
  CASE WHEN jsonb_typeof(cp.profile_data->'certifications')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(cp.profile_data->'certifications')) ELSE '{}'::text[] END,
  CASE WHEN jsonb_typeof(cp.profile_data->'set_asides')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(cp.profile_data->'set_asides')) ELSE '{}'::text[] END,
  CASE WHEN jsonb_typeof(cp.profile_data->'naics')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(cp.profile_data->'naics'))
    WHEN jsonb_typeof(cp.profile_data->'naics_codes')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(cp.profile_data->'naics_codes'))
    ELSE '{}'::text[] END,
  CASE WHEN jsonb_typeof(cp.profile_data->'contract_vehicles')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(cp.profile_data->'contract_vehicles'))
    WHEN jsonb_typeof(cp.profile_data->'contractVehicles')='array'
    THEN ARRAY(SELECT jsonb_array_elements_text(cp.profile_data->'contractVehicles'))
    ELSE '{}'::text[] END,
  COALESCE(NULLIF(cp.profile_data->>'capabilities',''), NULLIF(cp.profile_data->>'capabilities_narrative','')),
  true, 'legacy_profile',
  jsonb_build_object('profile_data', cp.profile_data),
  COALESCE(CASE WHEN jsonb_typeof(cp.profile_data->'past_performance')='array' THEN cp.profile_data->'past_performance' ELSE NULL END, '[]'::jsonb),
  cp.updated_at
FROM public.company_profile cp
WHERE cp.team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.team_id = cp.team_id AND c.is_own_company = true);
