-- 1. Snapshot da regra Fixo/Variável no momento da entrada do lote
ALTER TABLE public.item_batches
  ADD COLUMN IF NOT EXISTS weight_variable_at_entry boolean;

-- Backfill: usar o valor atual do item para lotes existentes
UPDATE public.item_batches b
SET weight_variable_at_entry = COALESCE(i.weight_variable, false)
FROM public.items i
WHERE b.item_id = i.id
  AND b.weight_variable_at_entry IS NULL;

-- A partir de agora, novos lotes devem vir com snapshot. Default false p/ segurança.
ALTER TABLE public.item_batches
  ALTER COLUMN weight_variable_at_entry SET DEFAULT false;

-- 2. Reconciliação: stock_levels = SUM(item_batches.current_qty) por item/local
-- Observação: item_batches NÃO tem location_id hoje; estoque rastreado por lote
-- existe no Estoque Central. Para outros locais, mantemos os saldos atuais.
-- Estratégia: para cada item COM lotes ativos, reescrevemos o saldo do
-- Estoque Central como SUM(current_qty). Demais locais permanecem iguais.

DO $$
DECLARE
  central_loc record;
  item_rec record;
  total numeric;
BEGIN
  FOR central_loc IN
    SELECT id, org_id FROM public.locations
    WHERE lower(trim(name)) = 'estoque central'
  LOOP
    FOR item_rec IN
      SELECT DISTINCT b.item_id
      FROM public.item_batches b
      JOIN public.items i ON i.id = b.item_id
      WHERE b.org_id = central_loc.org_id
        AND COALESCE(i.is_free, false) = false
    LOOP
      SELECT COALESCE(SUM(current_qty), 0) INTO total
      FROM public.item_batches
      WHERE item_id = item_rec.item_id
        AND org_id = central_loc.org_id
        AND current_qty > 0;

      INSERT INTO public.stock_levels (org_id, item_id, location_id, current_stock, updated_at)
      VALUES (central_loc.org_id, item_rec.item_id, central_loc.id, total, now())
      ON CONFLICT (item_id, location_id)
      DO UPDATE SET current_stock = EXCLUDED.current_stock, updated_at = now();
    END LOOP;
  END LOOP;
END $$;

-- 3. Índice para acelerar consumo FEFO (validade -> data entrada)
CREATE INDEX IF NOT EXISTS idx_item_batches_fefo
  ON public.item_batches (item_id, expiry_date NULLS LAST, created_at)
  WHERE current_qty > 0;