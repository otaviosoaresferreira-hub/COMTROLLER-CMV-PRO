-- Add operational flag to items
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_operational boolean NOT NULL DEFAULT false;

-- Seed "Água" as operational item for each organization that doesn't have it yet
INSERT INTO public.items (org_id, name, unit, is_operational, cost_price, is_active)
SELECT o.id, 'Água', 'L', true, 0, true
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.items i
  WHERE i.org_id = o.id AND lower(i.name) = 'água'
);