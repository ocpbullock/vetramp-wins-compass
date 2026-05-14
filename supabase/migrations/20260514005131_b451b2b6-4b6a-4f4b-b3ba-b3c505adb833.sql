
CREATE TABLE public.past_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  contract_number text,
  task_order_number text,
  contract_title text NOT NULL,
  agency text NOT NULL,
  sub_agency text,
  contract_type text,
  contract_vehicle text,
  naics_code text,
  psc_code text,
  period_of_performance_start date,
  period_of_performance_end date,
  total_value numeric,
  annual_value numeric,
  place_of_performance text,
  prime_or_sub text,
  relevance_keywords text[] NOT NULL DEFAULT '{}',
  description text,
  cpars_rating text,
  client_poc_name text,
  client_poc_title text,
  client_poc_phone text,
  client_poc_email text,
  lessons_learned text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_past_performance_team ON public.past_performance(team_id);
CREATE INDEX idx_past_performance_naics ON public.past_performance(naics_code);
CREATE INDEX idx_past_performance_agency ON public.past_performance(agency);

ALTER TABLE public.past_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View team past performance" ON public.past_performance
  FOR SELECT TO authenticated
  USING (is_team_member(team_id, auth.uid()));

CREATE POLICY "Insert team past performance" ON public.past_performance
  FOR INSERT TO authenticated
  WITH CHECK (team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));

CREATE POLICY "Update team past performance" ON public.past_performance
  FOR UPDATE TO authenticated
  USING (team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));

CREATE POLICY "Delete team past performance" ON public.past_performance
  FOR DELETE TO authenticated
  USING (team_role_in(team_id, auth.uid(), ARRAY['owner','admin']));

CREATE TRIGGER update_past_performance_updated_at
  BEFORE UPDATE ON public.past_performance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.proposals
  ADD COLUMN selected_past_performance uuid[] NOT NULL DEFAULT '{}';
