-- 1) Estender item_batches com campos de lote rastreável
ALTER TABLE public.item_batches
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS initial_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiry_date date;

-- Backfill para lotes legados: usa units_qty como referência inicial
UPDATE public.item_batches
   SET initial_qty = COALESCE(NULLIF(initial_qty,0), units_qty),
       current_qty = COALESCE(NULLIF(current_qty,0), units_qty)
 WHERE initial_qty = 0 OR current_qty = 0;

-- Índices para FEFO
CREATE INDEX IF NOT EXISTS idx_item_batches_fefo
  ON public.item_batches (org_id, item_id, expiry_date NULLS LAST, created_at)
  WHERE current_qty > 0;

-- 2) RPC FEFO: consome qty de um item priorizando validade mais próxima.
-- Retorna detalhe das baixas para que o caller possa registrar custo médio do consumo se quiser.
CREATE OR REPLACE FUNCTION public.consume_stock_fefo(
  _item_id uuid,
  _qty numeric
) RETURNS TABLE(batch_id uuid, taken numeric, unit_cost numeric, expiry_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining numeric := COALESCE(_qty, 0);
  rec record;
  take numeric;
BEGIN
  IF remaining <= 0 THEN RETURN; END IF;

  FOR rec IN
    SELECT b.id, b.current_qty, b.unit_cost, b.expiry_date
      FROM public.item_batches b
     WHERE b.item_id = _item_id
       AND b.current_qty > 0
       AND public.is_org_member(b.org_id)
     ORDER BY (b.expiry_date IS NULL), b.expiry_date ASC, b.created_at ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(rec.current_qty, remaining);
    UPDATE public.item_batches
       SET current_qty = current_qty - take
     WHERE id = rec.id;
    batch_id := rec.id;
    taken := take;
    unit_cost := rec.unit_cost;
    expiry_date := rec.expiry_date;
    RETURN NEXT;
    remaining := remaining - take;
  END LOOP;
  -- Se sobrar (estoque insuficiente em lotes), o saldo "extra" é simplesmente ignorado
  -- aqui — a baixa em stock_levels já foi feita pelo caller.
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_stock_fefo(uuid, numeric) TO authenticated;

-- 3) RPC para devolver lotes ativos de um item (para a UI de histórico)
CREATE OR REPLACE FUNCTION public.list_active_batches(_item_id uuid)
RETURNS TABLE(
  id uuid,
  lot_number text,
  initial_qty numeric,
  current_qty numeric,
  unit_cost numeric,
  avg_weight_g numeric,
  expiry_date date,
  created_at timestamptz,
  invoice_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, lot_number, initial_qty, current_qty, unit_cost,
         avg_weight_g, expiry_date, created_at, invoice_id
    FROM public.item_batches
   WHERE item_id = _item_id
     AND public.is_org_member(org_id)
   ORDER BY (expiry_date IS NULL), expiry_date ASC, created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_active_batches(uuid) TO authenticated;