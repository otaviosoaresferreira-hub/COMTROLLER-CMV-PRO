-- 1) is_subproduct
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_subproduct boolean NOT NULL DEFAULT false;

-- 2) Função de reorganização (sem desabilitar triggers internamente — feito fora)
CREATE OR REPLACE FUNCTION public.reorganize_org_categories(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official text[] := ARRAY[
    'Proteínas','Estoque Seco','Hortifruti','Bebidas',
    'Laticínios','Limpeza','Produções Internas','Sem Categoria',
    'Sistema','Sub-receitas'
  ];
  cat_name text;
  sem_cat_id uuid;
  rename_map text[][] := ARRAY[
    ARRAY['Carnes','Proteínas'],
    ARRAY['Secos','Estoque Seco']
  ];
  pair text[];
  src_id uuid;
  dst_id uuid;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY rename_map LOOP
    SELECT id INTO src_id FROM public.categories
      WHERE org_id = _org_id AND name = pair[1] LIMIT 1;
    IF src_id IS NOT NULL THEN
      SELECT id INTO dst_id FROM public.categories
        WHERE org_id = _org_id AND name = pair[2] LIMIT 1;
      IF dst_id IS NULL THEN
        UPDATE public.categories SET name = pair[2] WHERE id = src_id;
      ELSE
        UPDATE public.items SET category_id = dst_id
          WHERE org_id = _org_id AND category_id = src_id;
        DELETE FROM public.categories WHERE id = src_id;
      END IF;
    END IF;
  END LOOP;

  FOREACH cat_name IN ARRAY official LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND name = cat_name
    );
  END LOOP;

  SELECT id INTO sem_cat_id FROM public.categories
    WHERE org_id = _org_id AND name = 'Sem Categoria' LIMIT 1;

  UPDATE public.items i
     SET category_id = sem_cat_id
   WHERE i.org_id = _org_id
     AND i.category_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.categories c
        WHERE c.id = i.category_id
          AND c.org_id = _org_id
          AND c.name <> ALL(official)
     );

  DELETE FROM public.categories c
   WHERE c.org_id = _org_id
     AND c.name <> ALL(official)
     AND NOT EXISTS (SELECT 1 FROM public.items i WHERE i.category_id = c.id);
END;
$$;

-- 3) Backfill com triggers desabilitados temporariamente
ALTER TABLE public.categories DISABLE TRIGGER USER;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.reorganize_org_categories(r.id);
  END LOOP;
END $$;
ALTER TABLE public.categories ENABLE TRIGGER USER;

-- 4) setup_new_organization atualizado
CREATE OR REPLACE FUNCTION public.setup_new_organization(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  factory_names text[] := ARRAY[
    'Proteínas','Estoque Seco','Hortifruti','Bebidas',
    'Laticínios','Limpeza','Produções Internas','Sem Categoria'
  ];
  cat_name text;
  sistema_cat_id uuid;
  water_exists boolean;
  central_exists boolean;
BEGIN
  FOREACH cat_name IN ARRAY factory_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND name = cat_name
    );
  END LOOP;

  INSERT INTO public.categories (org_id, name, is_system)
  SELECT _org_id, 'Sistema', true
  WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id = _org_id AND name = 'Sistema');

  SELECT id INTO sistema_cat_id FROM public.categories
    WHERE org_id = _org_id AND name = 'Sistema' LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.locations
    WHERE org_id = _org_id AND lower(trim(name)) = 'estoque central'
  ) INTO central_exists;

  IF NOT central_exists THEN
    INSERT INTO public.locations (org_id, name, is_system, operation_type)
    VALUES (_org_id, 'Estoque Central', true, 'a_la_carte');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.items
    WHERE org_id = _org_id
      AND lower(name) IN ('água (produção)','agua (producao)','água','agua')
  ) INTO water_exists;

  IF NOT water_exists THEN
    INSERT INTO public.items (
      org_id, name, unit, category_id,
      cost_price, sale_price, min_stock,
      is_active, is_system, is_free
    )
    VALUES (
      _org_id, 'Água (Produção)', 'kg', sistema_cat_id,
      0, 0, 0, true, true, true
    );
  END IF;
END;
$$;