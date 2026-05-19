
-- cached_searches: replace global unique(cache_key) with per-team unique
ALTER TABLE public.cached_searches
  DROP CONSTRAINT IF EXISTS cached_searches_cache_key_key;
DROP INDEX IF EXISTS public.idx_cached_searches_key;
ALTER TABLE public.cached_searches
  ADD CONSTRAINT cached_searches_team_key_unique UNIQUE (team_id, cache_key);

-- cached_competitive_intel: same pattern
ALTER TABLE public.cached_competitive_intel
  DROP CONSTRAINT IF EXISTS cached_competitive_intel_cache_key_key;
ALTER TABLE public.cached_competitive_intel
  ADD CONSTRAINT cached_competitive_intel_team_key_unique UNIQUE (team_id, cache_key);

-- ai_response_cache: replace (function_name, cache_key) unique with team-scoped
DROP INDEX IF EXISTS public.ai_response_cache_fn_key_idx;
CREATE UNIQUE INDEX ai_response_cache_team_fn_key_idx
  ON public.ai_response_cache (team_id, function_name, cache_key);
