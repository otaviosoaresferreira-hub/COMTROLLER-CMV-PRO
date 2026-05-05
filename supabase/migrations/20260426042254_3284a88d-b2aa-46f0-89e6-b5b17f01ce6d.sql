-- Unidade Compartilhada (Peso Médio)
-- Adiciona configuração no item para gerir o produto em UN exibindo peso médio do lote
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS shared_unit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS standard_weight_g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_weight_g numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.items.shared_unit_enabled IS 'Quando true, item é gerido em UN com peso médio (ex.: frango congelado).';
COMMENT ON COLUMN public.items.standard_weight_g IS 'Peso padrão por unidade (em gramas) cadastrado pelo gestor.';
COMMENT ON COLUMN public.items.avg_weight_g IS 'Peso médio global ponderado (em gramas), atualizado a cada entrada.';

-- Histórico de lotes para rastrear o peso médio por entrada
CREATE TABLE IF NOT EXISTS public.item_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'entry', -- entry | production_in | transfer | adjustment
  units_qty numeric NOT NULL DEFAULT 0,        -- quantas unidades entraram nesse lote
  total_weight_g numeric NOT NULL DEFAULT 0,   -- peso total em gramas
  avg_weight_g numeric NOT NULL DEFAULT 0,     -- peso médio calculado: total/units
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  movement_id uuid REFERENCES public.movements(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_batches_item_id ON public.item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_item_batches_created_at ON public.item_batches(created_at DESC);

ALTER TABLE public.item_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read item_batches"
  ON public.item_batches FOR SELECT
  USING (true);

CREATE POLICY "public write item_batches"
  ON public.item_batches FOR ALL
  USING (true)
  WITH CHECK (true);
