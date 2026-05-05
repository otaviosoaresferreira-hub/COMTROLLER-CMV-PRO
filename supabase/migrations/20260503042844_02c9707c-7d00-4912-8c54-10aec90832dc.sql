
CREATE OR REPLACE FUNCTION public.setup_new_organization(_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  factory_names text[] := ARRAY[
    'Proteínas','Estoque Seco','Hortifruti','Bebidas',
    'Laticínios','Limpeza','Produções Internas','Sem Categoria',
    'Produção Interna'
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
$function$;
