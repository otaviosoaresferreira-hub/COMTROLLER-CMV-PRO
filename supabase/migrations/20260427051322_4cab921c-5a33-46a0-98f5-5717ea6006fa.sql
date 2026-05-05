CREATE TABLE IF NOT EXISTS public.location_item_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  factor numeric NOT NULL DEFAULT 1.0 CHECK (factor > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, item_id)
);

ALTER TABLE public.location_item_factors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read location_item_factors"
  ON public.location_item_factors FOR SELECT USING (true);

CREATE POLICY "public write location_item_factors"
  ON public.location_item_factors FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS set_updated_at_location_item_factors ON public.location_item_factors;
CREATE TRIGGER set_updated_at_location_item_factors
  BEFORE UPDATE ON public.location_item_factors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS location_item_factors_location_idx
  ON public.location_item_factors(location_id);

ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS correction_factor numeric;