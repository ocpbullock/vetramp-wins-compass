
CREATE TABLE public.contract_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  vehicle_name text NOT NULL,
  vehicle_type text,
  contract_number text,
  awarding_agency text,
  period_of_performance_start date,
  period_of_performance_end date,
  ceiling_value numeric,
  naics_codes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  ordering_guide_url text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_vehicles_team ON public.contract_vehicles(team_id);

ALTER TABLE public.contract_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View team contract vehicles" ON public.contract_vehicles
  FOR SELECT TO authenticated
  USING (is_team_member(team_id, auth.uid()));

CREATE POLICY "Insert team contract vehicles" ON public.contract_vehicles
  FOR INSERT TO authenticated
  WITH CHECK (team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));

CREATE POLICY "Update team contract vehicles" ON public.contract_vehicles
  FOR UPDATE TO authenticated
  USING (team_role_in(team_id, auth.uid(), ARRAY['owner','admin','member']));

CREATE POLICY "Delete team contract vehicles" ON public.contract_vehicles
  FOR DELETE TO authenticated
  USING (team_role_in(team_id, auth.uid(), ARRAY['owner','admin']));

CREATE TRIGGER update_contract_vehicles_updated_at
  BEFORE UPDATE ON public.contract_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
