ALTER TABLE public.items ADD COLUMN IF NOT EXISTS min_stock numeric NOT NULL DEFAULT 0;
ALTER TABLE public.stock_levels ADD COLUMN IF NOT EXISTS expiry_date date;