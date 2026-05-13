CREATE TABLE public.tracked_opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  agency text NOT NULL,
  sub_agency text,
  contract_vehicle text NOT NULL,
  contract_vehicle_other text,
  naics_code text NOT NULL,
  estimated_value numeric,
  response_deadline date,
  source_url text,
  description text,
  status text NOT NULL DEFAULT 'Watching',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tracked_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tracked"
  ON public.tracked_opportunities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own tracked"
  ON public.tracked_opportunities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own tracked"
  ON public.tracked_opportunities FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own tracked"
  ON public.tracked_opportunities FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_tracked_opportunities_updated_at
  BEFORE UPDATE ON public.tracked_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_tracked_opportunities_user ON public.tracked_opportunities(user_id);