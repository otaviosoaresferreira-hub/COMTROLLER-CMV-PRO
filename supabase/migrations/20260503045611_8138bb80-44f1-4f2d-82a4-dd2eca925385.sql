
ALTER TABLE public.categories DISABLE TRIGGER USER;

UPDATE public.categories
   SET is_system = false
 WHERE is_system = true
   AND name NOT IN ('Sem Categoria','Sistema','Produções Internas');

ALTER TABLE public.categories ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION public.setup_new_organization(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  suggested_names text[] := ARRAY[
    'Proteínas','Laticínios','Estoque Seco','Hortifruti',
    'Limpeza','Descartáveis','Bebidas'
  ];
  protected_names text[] := ARRAY['Produções Internas','Sem Categoria','Sistema'];
  cat_name text;
  sistema_cat_id uuid;
  water_exists boolean;
  central_exists boolean;
BEGIN
  FOREACH cat_name IN ARRAY suggested_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND name = cat_name
    );
  END LOOP;

  FOREACH cat_name IN ARRAY protected_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND name = cat_name
    );
  END LOOP;

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

CREATE OR REPLACE FUNCTION public.seed_suggested_categories(_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  suggested_names text[] := ARRAY[
    'Proteínas','Laticínios','Estoque Seco','Hortifruti',
    'Limpeza','Descartáveis','Bebidas'
  ];
  cat_name text;
  inserted_count integer := 0;
BEGIN
  IF NOT public.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  FOREACH cat_name IN ARRAY suggested_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND name = cat_name
    );
    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;

  RETURN inserted_count;
END;
$function$;
