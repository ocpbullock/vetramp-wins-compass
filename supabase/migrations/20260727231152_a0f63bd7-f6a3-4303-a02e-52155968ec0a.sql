ALTER TABLE public.vehicle_registry
  ADD COLUMN IF NOT EXISTS predecessor_id uuid NULL REFERENCES public.vehicle_registry(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vehicle_registry_predecessor_idx ON public.vehicle_registry(predecessor_id);

-- Link successor → predecessor for known global pairs. Only updates when both rows exist.
WITH pairs(successor, predecessor) AS (
  VALUES
    ('Alliant 3',       'Alliant 2'),
    ('CIO-SP4',         'CIO-SP3'),
    ('SEWP VI',         'SEWP V'),
    ('OASIS+',          'OASIS (legacy)'),
    ('T4NG2',           'T4NG'),
    ('FirstSource III', 'EAGLE II')
)
UPDATE public.vehicle_registry v
SET predecessor_id = p.id
FROM pairs
JOIN public.vehicle_registry p
  ON p.vehicle_name = pairs.predecessor AND p.team_id IS NULL
WHERE v.vehicle_name = pairs.successor
  AND v.team_id IS NULL
  AND v.predecessor_id IS DISTINCT FROM p.id;