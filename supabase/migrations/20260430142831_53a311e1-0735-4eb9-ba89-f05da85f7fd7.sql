
-- =========================================================
-- 1) Função de Setup Inicial para uma organização
-- =========================================================
CREATE OR REPLACE FUNCTION public.setup_new_organization(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  factory_names text[] := ARRAY['Carnes','Bebidas','Hortifruti','Limpeza','Secos','Outros'];
  cat_name text;
  sistema_cat_id uuid;
  water_exists boolean;
BEGIN
  -- Categorias de fábrica fixas (6)
  FOREACH cat_name IN ARRAY factory_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories
      WHERE org_id = _org_id AND name = cat_name
    );
  END LOOP;

  -- Categoria "Sem Categoria" (fallback)
  INSERT INTO public.categories (org_id, name, is_system)
  SELECT _org_id, 'Sem Categoria', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE org_id = _org_id AND name = 'Sem Categoria'
  );

  -- Categoria "Sistema" (oculta na navegação)
  INSERT INTO public.categories (org_id, name, is_system)
  SELECT _org_id, 'Sistema', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE org_id = _org_id AND name = 'Sistema'
  );

  SELECT id INTO sistema_cat_id
  FROM public.categories
  WHERE org_id = _org_id AND name = 'Sistema'
  LIMIT 1;

  -- Item "Água (Produção)" — livre, sistema, kg
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
      0, 0, 0,
      true, true, true
    );
  END IF;
END;
$$;

-- =========================================================
-- 2) Trigger AFTER INSERT em organizations
-- =========================================================
CREATE OR REPLACE FUNCTION public.on_organization_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.setup_new_organization(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_organization_created ON public.organizations;
CREATE TRIGGER trg_on_organization_created
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.on_organization_created();

-- =========================================================
-- 3) Backfill em organizações já existentes
-- =========================================================
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    PERFORM public.setup_new_organization(org.id);
  END LOOP;
END;
$$;

-- =========================================================
-- 4) Reforçar trigger de proteção em items (delete)
-- =========================================================
DROP TRIGGER IF EXISTS trg_prevent_system_item_delete ON public.items;
CREATE TRIGGER trg_prevent_system_item_delete
BEFORE DELETE ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_item_delete();

DROP TRIGGER IF EXISTS trg_prevent_system_item_update ON public.items;
CREATE TRIGGER trg_prevent_system_item_update
BEFORE UPDATE ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_item_update();

-- Categorias
DROP TRIGGER IF EXISTS trg_prevent_system_category_delete ON public.categories;
CREATE TRIGGER trg_prevent_system_category_delete
BEFORE DELETE ON public.categories
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_category_delete();

DROP TRIGGER IF EXISTS trg_prevent_system_category_update ON public.categories;
CREATE TRIGGER trg_prevent_system_category_update
BEFORE UPDATE ON public.categories
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_category_update();

-- Locations
DROP TRIGGER IF EXISTS trg_prevent_system_location_delete ON public.locations;
CREATE TRIGGER trg_prevent_system_location_delete
BEFORE DELETE ON public.locations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_location_delete();

-- Trigger de categoria padrão em items
DROP TRIGGER IF EXISTS trg_assign_default_category ON public.items;
CREATE TRIGGER trg_assign_default_category
BEFORE INSERT ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_category();
