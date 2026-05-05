
CREATE OR REPLACE FUNCTION public.list_active_batches(_item_id uuid)
RETURNS TABLE(id uuid, lot_number text, initial_qty numeric, current_qty numeric, unit_cost numeric, avg_weight_g numeric, expiry_date date, created_at timestamptz, invoice_id uuid, edited_at timestamptz, reverted_at timestamptz, source text, movement_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id, lot_number, initial_qty, current_qty, unit_cost, avg_weight_g, expiry_date, created_at, invoice_id, edited_at, reverted_at, source, movement_id
  FROM public.item_batches
  WHERE item_id = _item_id AND public.is_org_member(org_id)
  ORDER BY (expiry_date IS NULL), expiry_date ASC, created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.consume_stock_fefo(_item_id uuid, _qty numeric)
RETURNS TABLE(batch_id uuid, taken numeric, unit_cost numeric, expiry_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE remaining numeric := COALESCE(_qty,0); rec record; take numeric;
BEGIN
  IF remaining <= 0 THEN RETURN; END IF;
  FOR rec IN
    SELECT b.id, b.current_qty, b.unit_cost, b.expiry_date
    FROM public.item_batches b
    WHERE b.item_id=_item_id AND b.current_qty>0 AND public.is_org_member(b.org_id)
    ORDER BY (b.expiry_date IS NULL), b.expiry_date ASC, b.created_at ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(rec.current_qty, remaining);
    UPDATE public.item_batches SET current_qty = current_qty - take WHERE id = rec.id;
    batch_id := rec.id; taken := take; unit_cost := rec.unit_cost; expiry_date := rec.expiry_date;
    RETURN NEXT;
    remaining := remaining - take;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.consume_stock_fefo_units(_item_id uuid, _units numeric)
RETURNS TABLE(batch_id uuid, units_taken numeric, kg_taken numeric, unit_cost numeric, expiry_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE remaining_units numeric := COALESCE(_units,0); rec record; take_units numeric; batch_kg_per_unit numeric; take_kg numeric;
BEGIN
  IF remaining_units <= 0 THEN RETURN; END IF;
  FOR rec IN
    SELECT b.id, b.current_qty, b.units_qty, b.initial_qty, b.avg_weight_g, b.unit_cost, b.expiry_date
    FROM public.item_batches b
    WHERE b.item_id=_item_id AND b.current_qty>0 AND b.units_qty>0 AND b.avg_weight_g>0 AND public.is_org_member(b.org_id)
    ORDER BY (b.expiry_date IS NULL), b.expiry_date ASC, b.created_at ASC
  LOOP
    EXIT WHEN remaining_units <= 0;
    DECLARE remaining_in_batch_units numeric;
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
      UPDATE public.item_batches
        SET current_qty = GREATEST(0, current_qty - (take_units / NULLIF(remaining_in_batch_units,0)) * rec.current_qty)
        WHERE id = rec.id;
      batch_id := rec.id; units_taken := take_units; kg_taken := take_kg; unit_cost := rec.unit_cost; expiry_date := rec.expiry_date;
      RETURN NEXT;
      remaining_units := remaining_units - take_units;
    END;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.seed_suggested_categories(_org_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  suggested_names text[] := ARRAY['Proteínas','Laticínios','Estoque Seco','Hortifrúti','Limpeza','Descartáveis','Bebidas'];
  cat_name text; inserted_count integer := 0;
BEGIN
  IF NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'Sem permissão nesta organização'; END IF;
  FOREACH cat_name IN ARRAY suggested_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, false
    WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id=_org_id AND lower(trim(name))=lower(trim(cat_name)));
    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;
  RETURN inserted_count;
END; $$;

CREATE OR REPLACE FUNCTION public.reorganize_org_categories(_org_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  official text[] := ARRAY['Proteínas','Estoque Seco','Hortifruti','Bebidas','Laticínios','Limpeza','Produções Internas','Sem Categoria','Sistema'];
  cat_name text; sem_cat_id uuid;
  rename_map text[][] := ARRAY[ARRAY['Carnes','Proteínas'],ARRAY['Secos','Estoque Seco'],ARRAY['Sub-receitas','Produções Internas'],ARRAY['Produção Interna','Produções Internas']];
  pair text[]; src_id uuid; dst_id uuid;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY rename_map LOOP
    SELECT id INTO src_id FROM public.categories WHERE org_id=_org_id AND name=pair[1] LIMIT 1;
    IF src_id IS NOT NULL THEN
      SELECT id INTO dst_id FROM public.categories WHERE org_id=_org_id AND name=pair[2] LIMIT 1;
      IF dst_id IS NULL THEN UPDATE public.categories SET name=pair[2] WHERE id=src_id;
      ELSE UPDATE public.items SET category_id=dst_id WHERE org_id=_org_id AND category_id=src_id;
        DELETE FROM public.categories WHERE id=src_id;
      END IF;
    END IF;
  END LOOP;
  FOREACH cat_name IN ARRAY official LOOP
    INSERT INTO public.categories (org_id,name,is_system)
    SELECT _org_id, cat_name, true
    WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id=_org_id AND name=cat_name);
  END LOOP;
  SELECT id INTO sem_cat_id FROM public.categories WHERE org_id=_org_id AND name='Sem Categoria' LIMIT 1;
  UPDATE public.items i SET category_id=sem_cat_id
    WHERE i.org_id=_org_id AND i.category_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.categories c WHERE c.id=i.category_id AND c.org_id=_org_id AND c.name <> ALL(official));
  DELETE FROM public.categories c WHERE c.org_id=_org_id AND c.name <> ALL(official)
    AND NOT EXISTS (SELECT 1 FROM public.items i WHERE i.category_id=c.id);
END; $$;
