CREATE TABLE public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid,
  user_id uuid,
  function_name text NOT NULL,
  provider text NOT NULL DEFAULT 'lovable',
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_log_team_created ON public.ai_usage_log(team_id, created_at DESC);
CREATE INDEX idx_ai_usage_log_function ON public.ai_usage_log(function_name);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View team ai usage"
  ON public.ai_usage_log FOR SELECT TO authenticated
  USING (
    (team_id IS NOT NULL AND public.is_team_member(team_id, auth.uid()))
    OR (team_id IS NULL AND user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );