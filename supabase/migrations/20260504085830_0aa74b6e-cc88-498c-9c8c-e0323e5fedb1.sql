-- ============================================================
-- Fase 3 — FEFO por unidade real (peso do lote consumido)
-- ============================================================

-- 1. Nova RPC: consome N UNIDADES do estoque, calculando o KG real
--    a partir do avg_weight_g de cada lote FEFO. Retorna a quebra
--    por lote (qtd em UN, KG real consumido, custo).
CREATE OR REPLACE FUNCTION public.consume_stock_fefo_units(
  _item_id uuid,
  _units numeric
)
RETURNS TABLE(
  batch_id uuid,
  units_taken numeric,
  kg_taken numeric,
  unit_cost numeric,
  expiry_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  remaining_units numeric := COALESCE(_units, 0);
  rec record;
  take_units numeric;
  batch_kg_per_unit numeric;
  take_kg numeric;
BEGIN
  IF remaining_units <= 0 THEN RETURN; END IF;

  FOR rec IN
    SELECT b.id, b.current_qty, b.units_qty, b.initial_qty,
           b.avg_weight_g, b.unit_cost, b.expiry_date
      FROM public.item_batches b
     WHERE b.item_id = _item_id
       AND b.current_qty > 0
       AND b.units_qty > 0
       AND b.avg_weight_g > 0
       AND public.is_org_member(b.org_id)
     ORDER BY (b.expiry_date IS NULL), b.expiry_date ASC, b.created_at ASC
  LOOP
    EXIT WHEN remaining_units <= 0;

    -- Quantas UNIDADES ainda existem fisicamente neste lote?
    -- units_remaining = units_qty * (current_qty / initial_qty)
    DECLARE
      remaining_in_batch_units numeric;
    BEGIN
      IF rec.initial_qty > 0 THEN
        remaining_in_batch_units := rec.units_qty * (rec.current_qty / rec.initial_qty);
      ELSE
        remaining_in_batch_units := rec.units_qty;
      END IF;

      take_units := LEAST(remaining_in_batch_units, remaining_units);
      IF take_units <= 0 THEN CONTINUE; END IF;

      batch_kg_per_unit := rec.avg_weight_g / 1000.0;
      take_kg := take_units * batch_kg_per_unit;

      -- Baixa proporcional no current_qty (que está na mesma unidade que initial_qty)
      UPDATE public.item_batches
         SET current_qty = GREATEST(0, current_qty - (take_units / NULLIF(remaining_in_batch_units, 0)) * rec.current_qty)
       WHERE id = rec.id;

      batch_id   := rec.id;
      units_taken := take_units;
      kg_taken   := take_kg;
      unit_cost  := rec.unit_cost;
      expiry_date := rec.expiry_date;
      RETURN NEXT;

      remaining_units := remaining_units - take_units;
    END;
  END LOOP;
END;
$$;

-- ============================================================
-- 2. Migração de dados — itens flexíveis
--    Para cada item que tem peso conhecido (standard_weight_g > 0
--    OU avg_weight_g > 0), liga shared_unit_enabled = true.
--    O peso passa a ser tratado como SUGERIDO (não trava conversões).
-- ============================================================
UPDATE public.items
   SET shared_unit_enabled = true
 WHERE shared_unit_enabled = false
   AND (
     COALESCE(standard_weight_g, 0) > 0
     OR COALESCE(avg_weight_g, 0) > 0
   )
   AND COALESCE(is_system, false) = false;
