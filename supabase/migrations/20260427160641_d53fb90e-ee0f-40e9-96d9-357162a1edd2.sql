-- Rename stock_levels.quantity to current_stock
ALTER TABLE public.stock_levels RENAME COLUMN quantity TO current_stock;

-- Ensure unique constraint on (item_id, location_id) for UPSERT operations
CREATE UNIQUE INDEX IF NOT EXISTS stock_levels_item_location_unique
  ON public.stock_levels (item_id, location_id);