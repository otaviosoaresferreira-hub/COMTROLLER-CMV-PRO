
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS original_payload jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movements_status_check'
  ) THEN
    ALTER TABLE public.movements
      ADD CONSTRAINT movements_status_check
      CHECK (status IN ('completed','edited','reverted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS movements_status_idx ON public.movements(status);
