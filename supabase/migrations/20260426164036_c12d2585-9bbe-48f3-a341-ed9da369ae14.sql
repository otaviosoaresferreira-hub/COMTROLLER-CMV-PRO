ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_items_is_active ON public.items(is_active);
CREATE INDEX IF NOT EXISTS idx_recipes_is_active ON public.recipes(is_active);