ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS contabiliza_cmv boolean NOT NULL DEFAULT true;