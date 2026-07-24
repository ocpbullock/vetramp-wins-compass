
-- 1. vehicle_registry
CREATE TABLE public.vehicle_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NULL,
  vehicle_name text NOT NULL,
  vehicle_type text CHECK (vehicle_type IN ('gwac','agency_idiq','bpa','schedule','other')),
  managing_agency text,
  description text,
  url text,
  status text DEFAULT 'active' CHECK (status IN ('active','upcoming','expired')),
  created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_registry TO authenticated;
GRANT ALL ON public.vehicle_registry TO service_role;

ALTER TABLE public.vehicle_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View global or team vehicles"
  ON public.vehicle_registry FOR SELECT
  TO authenticated
  USING (team_id IS NULL OR public.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members insert team vehicles"
  ON public.vehicle_registry FOR INSERT
  TO authenticated
  WITH CHECK (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members update team vehicles"
  ON public.vehicle_registry FOR UPDATE
  TO authenticated
  USING (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()))
  WITH CHECK (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members delete team vehicles"
  ON public.vehicle_registry FOR DELETE
  TO authenticated
  USING (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()));

-- 2. vehicle_awardees
CREATE TABLE public.vehicle_awardees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_registry(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  uei text,
  small_business boolean,
  socioeconomic text[],
  created_at timestamptz DEFAULT now()
);

CREATE INDEX vehicle_awardees_vehicle_id_idx ON public.vehicle_awardees(vehicle_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_awardees TO authenticated;
GRANT ALL ON public.vehicle_awardees TO service_role;

ALTER TABLE public.vehicle_awardees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View awardees of visible vehicles"
  ON public.vehicle_awardees FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_registry v
    WHERE v.id = vehicle_id
      AND (v.team_id IS NULL OR public.is_team_member(v.team_id, auth.uid()))
  ));

CREATE POLICY "Team members insert awardees"
  ON public.vehicle_awardees FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vehicle_registry v
    WHERE v.id = vehicle_id
      AND v.team_id IS NOT NULL
      AND public.is_team_member(v.team_id, auth.uid())
  ));

CREATE POLICY "Team members update awardees"
  ON public.vehicle_awardees FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_registry v
    WHERE v.id = vehicle_id
      AND v.team_id IS NOT NULL
      AND public.is_team_member(v.team_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vehicle_registry v
    WHERE v.id = vehicle_id
      AND v.team_id IS NOT NULL
      AND public.is_team_member(v.team_id, auth.uid())
  ));

CREATE POLICY "Team members delete awardees"
  ON public.vehicle_awardees FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_registry v
    WHERE v.id = vehicle_id
      AND v.team_id IS NOT NULL
      AND public.is_team_member(v.team_id, auth.uid())
  ));

-- 4. Seed global vehicles
INSERT INTO public.vehicle_registry (team_id, vehicle_name, vehicle_type, managing_agency, url, description) VALUES
  (NULL, 'Alliant 2', 'gwac', 'GSA', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/alliant-2-governmentwide-acquisition', 'GSA GWAC for integrated IT solutions.'),
  (NULL, '8(a) STARS III', 'gwac', 'GSA', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/8a-stars-iii', 'Small business set-aside GWAC for 8(a) firms.'),
  (NULL, 'VETS 2', 'gwac', 'GSA', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/vets-2-governmentwide-acquisition-contract', 'SDVOSB set-aside GWAC for IT services.'),
  (NULL, 'OASIS+', 'gwac', 'GSA', 'https://www.gsa.gov/oasisplus', 'Multi-agency contract for professional services.'),
  (NULL, 'SEWP V', 'gwac', 'NASA', 'https://www.sewp.nasa.gov/', 'NASA GWAC for IT products and product-based services.'),
  (NULL, 'CIO-SP3', 'gwac', 'NIH NITAAC', 'https://nitaac.nih.gov/gwacs/cio-sp3', 'NITAAC GWAC for health and IT services.'),
  (NULL, 'POLARIS', 'gwac', 'GSA', 'https://www.gsa.gov/technology/technology-purchasing-programs/governmentwide-acquisition-contracts/polaris', 'Small business GWAC for IT services (successor to Alliant SB).'),
  (NULL, 'DISA Encore III', 'agency_idiq', 'DISA', 'https://www.disa.mil/network-services/contracts/encore3', 'DISA IDIQ for IT solutions worldwide.'),
  (NULL, 'Army ITES-3S', 'agency_idiq', 'US Army', 'https://ascp.monmouth.army.mil/scp/contracts/ites3s.jsp', 'Army IDIQ for IT enterprise services.'),
  (NULL, 'Air Force SBEAS', 'agency_idiq', 'US Air Force', NULL, 'Small Business Enterprise Application Solutions IDIQ.');

-- 5. proposals additions
ALTER TABLE public.proposals
  ADD COLUMN vehicle_status text DEFAULT 'unknown' CHECK (vehicle_status IN ('unknown','tbd_market_research','identified','new_vehicle_expected')),
  ADD COLUMN vehicle_registry_id uuid NULL REFERENCES public.vehicle_registry(id);
