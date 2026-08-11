-- a. Header-echo junk rows
DELETE FROM public.vehicle_awardees
WHERE lower(trim(company_name)) IN ('contractor name','company','name','company name','vendor','vendor name')
   OR lower(coalesce(trim(uei),'')) = 'uei';

-- b. Untrusted import-default falses -> unknown
UPDATE public.vehicle_awardees
SET small_business = NULL
WHERE small_business = false
  AND (socioeconomic IS NULL OR array_length(socioeconomic, 1) IS NULL);

-- c. Set-aside-only pools imply status
UPDATE public.vehicle_awardees a
SET socioeconomic = ARRAY['SDVOSB'], small_business = true
FROM public.vehicle_registry v
WHERE v.id = a.vehicle_id
  AND v.vehicle_name ILIKE '%SDVOSB%'
  AND (a.socioeconomic IS NULL OR array_length(a.socioeconomic, 1) IS NULL);

UPDATE public.vehicle_awardees a
SET socioeconomic = ARRAY['8(a)'], small_business = true
FROM public.vehicle_registry v
WHERE v.id = a.vehicle_id
  AND v.vehicle_name ILIKE '%8(a)%'
  AND (a.socioeconomic IS NULL OR array_length(a.socioeconomic, 1) IS NULL);

UPDATE public.vehicle_awardees a
SET socioeconomic = ARRAY['WOSB'], small_business = true
FROM public.vehicle_registry v
WHERE v.id = a.vehicle_id
  AND v.vehicle_name ILIKE '%WOSB%'
  AND (a.socioeconomic IS NULL OR array_length(a.socioeconomic, 1) IS NULL);

UPDATE public.vehicle_awardees a
SET socioeconomic = ARRAY['HUBZone'], small_business = true
FROM public.vehicle_registry v
WHERE v.id = a.vehicle_id
  AND v.vehicle_name ILIKE '%HUBZone%'
  AND (a.socioeconomic IS NULL OR array_length(a.socioeconomic, 1) IS NULL);