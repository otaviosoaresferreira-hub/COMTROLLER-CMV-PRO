ALTER TABLE public.recipes 
ADD COLUMN IF NOT EXISTS unit_weight_g numeric,
ADD COLUMN IF NOT EXISTS unit_name text;