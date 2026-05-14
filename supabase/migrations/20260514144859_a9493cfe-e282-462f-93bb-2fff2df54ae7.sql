
CREATE TABLE public.tango_cached_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  tango_id text NOT NULL,
  notice_id text,
  solicitation_number text,
  title text NOT NULL,
  description text,
  naics_code text,
  naics_description text,
  set_aside text,
  set_aside_description text,
  classification_code text,
  posted_date timestamptz,
  response_deadline timestamptz,
  archive_date timestamptz,
  agency text,
  office text,
  place_of_performance jsonb,
  point_of_contact jsonb,
  award_info jsonb,
  source_url text,
  raw_data jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, tango_id)
);

CREATE TABLE public.tango_cached_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  tango_id text NOT NULL,
  piid text,
  agency text,
  vendor_name text,
  vendor_uei text,
  vendor_duns text,
  naics_code text,
  psc_code text,
  description text,
  award_date timestamptz,
  period_of_performance_start timestamptz,
  period_of_performance_end timestamptz,
  obligated_amount numeric,
  base_and_all_options numeric,
  contract_type text,
  set_aside text,
  vehicle text,
  idv_piid text,
  parent_award_id text,
  raw_data jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, tango_id)
);

CREATE TABLE public.tango_cached_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  tango_id text NOT NULL,
  uei text,
  cage_code text,
  legal_name text,
  dba_name text,
  naics_codes text[],
  small_business_types text[],
  city text,
  state text,
  country text,
  raw_data jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, tango_id)
);

CREATE TABLE public.tango_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  endpoint text NOT NULL,
  params jsonb,
  called_at timestamptz NOT NULL DEFAULT now(),
  response_status int,
  cached boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_tango_opps_naics ON public.tango_cached_opportunities(naics_code);
CREATE INDEX idx_tango_opps_deadline ON public.tango_cached_opportunities(response_deadline);
CREATE INDEX idx_tango_opps_team ON public.tango_cached_opportunities(team_id);
CREATE INDEX idx_tango_opps_fetched ON public.tango_cached_opportunities(fetched_at);
CREATE INDEX idx_tango_contracts_naics ON public.tango_cached_contracts(naics_code);
CREATE INDEX idx_tango_contracts_vendor ON public.tango_cached_contracts(vendor_name);
CREATE INDEX idx_tango_contracts_team ON public.tango_cached_contracts(team_id);
CREATE INDEX idx_tango_contracts_vehicle ON public.tango_cached_contracts(vehicle);
CREATE INDEX idx_tango_contracts_fetched ON public.tango_cached_contracts(fetched_at);
CREATE INDEX idx_tango_entities_uei ON public.tango_cached_entities(uei);
CREATE INDEX idx_tango_entities_team ON public.tango_cached_entities(team_id);
CREATE INDEX idx_tango_usage_date ON public.tango_api_usage(called_at);
CREATE INDEX idx_tango_usage_team_date ON public.tango_api_usage(team_id, called_at);

ALTER TABLE public.tango_cached_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tango_cached_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tango_cached_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tango_api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members read tango opps" ON public.tango_cached_opportunities
  FOR SELECT TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Team members write tango opps" ON public.tango_cached_opportunities
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Team members update tango opps" ON public.tango_cached_opportunities
  FOR UPDATE TO authenticated USING (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Team members delete tango opps" ON public.tango_cached_opportunities
  FOR DELETE TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Team members read tango contracts" ON public.tango_cached_contracts
  FOR SELECT TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Team members write tango contracts" ON public.tango_cached_contracts
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Team members update tango contracts" ON public.tango_cached_contracts
  FOR UPDATE TO authenticated USING (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Team members delete tango contracts" ON public.tango_cached_contracts
  FOR DELETE TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Team members read tango entities" ON public.tango_cached_entities
  FOR SELECT TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Team members write tango entities" ON public.tango_cached_entities
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Team members update tango entities" ON public.tango_cached_entities
  FOR UPDATE TO authenticated USING (public.is_team_member(team_id, auth.uid()));
CREATE POLICY "Team members delete tango entities" ON public.tango_cached_entities
  FOR DELETE TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Team members read tango usage" ON public.tango_api_usage
  FOR SELECT TO authenticated USING (public.is_team_member(team_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Team members write tango usage" ON public.tango_api_usage
  FOR INSERT TO authenticated WITH CHECK (public.is_team_member(team_id, auth.uid()));
