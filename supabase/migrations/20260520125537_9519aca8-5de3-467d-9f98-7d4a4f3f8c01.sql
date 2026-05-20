ALTER TABLE public.pwin_scenarios
  ADD COLUMN IF NOT EXISTS relationship_model text NOT NULL DEFAULT 'prime_with_subs',
  ADD COLUMN IF NOT EXISTS targeted_scope_areas text,
  ADD COLUMN IF NOT EXISTS strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_action text;

ALTER TABLE public.pwin_scenarios
  ADD CONSTRAINT pwin_scenarios_relationship_model_chk
  CHECK (relationship_model IN ('prime_with_subs','sub_to_prime','joint_venture','mentor_protege','niche_sub'));