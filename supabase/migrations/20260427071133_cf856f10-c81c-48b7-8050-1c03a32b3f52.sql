CREATE TABLE public.inventory_counts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_count_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  counted_quantity numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (count_id, item_id)
);

CREATE UNIQUE INDEX inventory_counts_one_open_per_location
ON public.inventory_counts (location_id)
WHERE status = 'open';

CREATE INDEX inventory_counts_location_status_idx
ON public.inventory_counts (location_id, status);

CREATE INDEX inventory_count_items_count_idx
ON public.inventory_count_items (count_id);

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read inventory_counts"
ON public.inventory_counts
FOR SELECT
USING (true);

CREATE POLICY "public write inventory_counts"
ON public.inventory_counts
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "public read inventory_count_items"
ON public.inventory_count_items
FOR SELECT
USING (true);

CREATE POLICY "public write inventory_count_items"
ON public.inventory_count_items
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER set_inventory_counts_updated_at
BEFORE UPDATE ON public.inventory_counts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_inventory_count_items_updated_at
BEFORE UPDATE ON public.inventory_count_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();