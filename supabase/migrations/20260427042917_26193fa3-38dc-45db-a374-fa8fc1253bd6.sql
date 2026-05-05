-- Add nfe_key to invoices (unique 44-digit NFe access key)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS nfe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_nfe_key_unique ON public.invoices(nfe_key) WHERE nfe_key IS NOT NULL;

-- Backfill nfe_key from existing access_key when it looks like a 44-digit chave
UPDATE public.invoices SET nfe_key = access_key WHERE nfe_key IS NULL AND access_key ~ '^[0-9]{44}$';

-- Add cost + invoice + notes fields to movements
ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS total_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS notes text;

-- Restrict type to allowed values
ALTER TABLE public.movements DROP CONSTRAINT IF EXISTS movements_type_check;
ALTER TABLE public.movements ADD CONSTRAINT movements_type_check
  CHECK (type IN ('entry','exit','loss','adjustment','transfer'));

CREATE INDEX IF NOT EXISTS movements_invoice_id_idx ON public.movements(invoice_id);