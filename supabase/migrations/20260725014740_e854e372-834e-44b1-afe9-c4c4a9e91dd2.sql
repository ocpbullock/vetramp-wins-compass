
CREATE OR REPLACE FUNCTION public.diagnostics_stale_schema_scan()
RETURNS TABLE(schema_name text, function_name text, needle text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.nspname::text AS schema_name,
         p.proname::text AS function_name,
         needle::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL (VALUES ('public.is_team_member'), ('public.has_role')) v(needle)
  WHERE n.nspname IN ('public', 'private')
    AND pg_get_functiondef(p.oid) ILIKE '%' || v.needle || '%'
    AND p.proname NOT IN ('diagnostics_stale_schema_scan');
$$;

REVOKE ALL ON FUNCTION public.diagnostics_stale_schema_scan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.diagnostics_stale_schema_scan() TO service_role;
