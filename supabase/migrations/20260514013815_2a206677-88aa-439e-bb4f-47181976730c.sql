
-- AI response cache
CREATE TABLE public.ai_response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID,
  function_name TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  response_data JSONB NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE UNIQUE INDEX ai_response_cache_fn_key_idx ON public.ai_response_cache (function_name, cache_key);
CREATE INDEX ai_response_cache_team_idx ON public.ai_response_cache (team_id);
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read cache for team" ON public.ai_response_cache FOR SELECT TO authenticated
  USING (team_id IS NULL OR is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Insert cache for team" ON public.ai_response_cache FOR INSERT TO authenticated
  WITH CHECK (team_id IS NULL OR is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Delete cache for team" ON public.ai_response_cache FOR DELETE TO authenticated
  USING (team_id IS NULL OR is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- Per-proposal cost: extend ai_usage_log
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS proposal_id UUID;
CREATE INDEX IF NOT EXISTS ai_usage_log_proposal_idx ON public.ai_usage_log (proposal_id);
CREATE INDEX IF NOT EXISTS ai_usage_log_team_created_idx ON public.ai_usage_log (team_id, created_at DESC);

-- Team budget settings
CREATE TABLE public.team_settings (
  team_id UUID PRIMARY KEY,
  monthly_ai_budget_usd NUMERIC NOT NULL DEFAULT 50.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View team settings" ON public.team_settings FOR SELECT TO authenticated
  USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Insert team settings" ON public.team_settings FOR INSERT TO authenticated
  WITH CHECK (team_role_in(team_id, auth.uid(), ARRAY['owner','admin']) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Update team settings" ON public.team_settings FOR UPDATE TO authenticated
  USING (team_role_in(team_id, auth.uid(), ARRAY['owner','admin']) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_team_settings_updated_at
BEFORE UPDATE ON public.team_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Solo (no-team) user budgets
CREATE TABLE public.user_ai_settings (
  user_id UUID PRIMARY KEY,
  monthly_ai_budget_usd NUMERIC NOT NULL DEFAULT 50.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own ai settings" ON public.user_ai_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Insert own ai settings" ON public.user_ai_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Update own ai settings" ON public.user_ai_settings FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER update_user_ai_settings_updated_at
BEFORE UPDATE ON public.user_ai_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
