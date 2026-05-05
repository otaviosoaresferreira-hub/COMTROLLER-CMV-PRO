ALTER TABLE public.item_batches
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_item_batches_movement_id ON public.item_batches(movement_id);