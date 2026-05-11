
-- Reusable timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Cached searches (shared)
CREATE TABLE public.cached_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  naics_codes TEXT[] NOT NULL,
  date_from DATE,
  date_to DATE,
  keyword TEXT,
  opportunities JSONB,
  historical JSONB,
  summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_cached_searches_key ON public.cached_searches(cache_key);
CREATE INDEX idx_cached_searches_expires ON public.cached_searches(expires_at);
ALTER TABLE public.cached_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read cache" ON public.cached_searches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert cache" ON public.cached_searches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update cache" ON public.cached_searches FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete cache" ON public.cached_searches FOR DELETE TO authenticated USING (true);

-- Proposal drafts
CREATE TABLE public.proposal_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  solicitation_number TEXT NOT NULL,
  opportunity_title TEXT,
  agency TEXT,
  naics_code TEXT,
  response_deadline TIMESTAMPTZ,
  draft_content TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drafts_user ON public.proposal_drafts(user_id);
ALTER TABLE public.proposal_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own drafts" ON public.proposal_drafts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own drafts" ON public.proposal_drafts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own drafts" ON public.proposal_drafts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own drafts" ON public.proposal_drafts FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_drafts_updated BEFORE UPDATE ON public.proposal_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User preferences
CREATE TABLE public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_naics TEXT[] NOT NULL DEFAULT ARRAY['541511','541512','541513','541519'],
  default_date_range_months INT NOT NULL DEFAULT 12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own prefs" ON public.user_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prefs" ON public.user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs" ON public.user_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE TRIGGER trg_prefs_updated BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger on auth.users for auto-profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
