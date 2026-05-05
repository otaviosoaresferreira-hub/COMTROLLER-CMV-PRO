
-- Desabilita temporariamente o trigger que impede edição de categorias do sistema
ALTER TABLE public.categories DISABLE TRIGGER USER;

-- Renomeia categorias existentes
UPDATE public.categories
SET name = 'Produção Interna'
WHERE name = 'Sub-receitas';

ALTER TABLE public.categories ENABLE TRIGGER USER;

-- Atualiza função reorganize_org_categories
CREATE OR REPLACE FUNCTION public.reorganize_org_categories(_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  official text[] := ARRAY[
    'Proteínas','Estoque Seco','Hortifruti','Bebidas',
    'Laticínios','Limpeza','Produções Internas','Sem Categoria',
    'Sistema','Produção Interna'
  ];
  cat_name text;
  sem_cat_id uuid;
  rename_map text[][] := ARRAY[
    ARRAY['Carnes','Proteínas'],
    ARRAY['Secos','Estoque Seco'],
    ARRAY['Sub-receitas','Produção Interna']
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
$function$;
