-- Insert/protect additional fixed system categories
INSERT INTO public.categories (name, is_system, org_id)
SELECT v.name, true, '00000000-0000-0000-0000-000000000001'::uuid
FROM (VALUES ('Estoque Seco'), ('Limpeza'), ('Sub-receitas')) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c
  WHERE lower(trim(c.name)) = lower(trim(v.name))
);

-- Mark all base categories as system (immutable)
UPDATE public.categories
SET is_system = true
WHERE lower(trim(name)) IN (
  'proteínas','laticínios','hortifruti','estoque seco',
  'bebidas','descartáveis','limpeza','sub-receitas'
);

-- Reinforce Água as a system item with zero cost and active
UPDATE public.items
SET is_system = true,
    cost_price = 0,
    sale_price = 0,
    is_active = true,
    is_operational = false
WHERE lower(trim(name)) = 'água' OR lower(trim(name)) = 'agua';

-- Ensure Água exists if it was deleted
INSERT INTO public.items (name, unit, is_system, cost_price, sale_price, is_active, org_id)
SELECT 'Água', 'L', true, 0, 0, true, '00000000-0000-0000-0000-000000000001'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM public.items WHERE lower(trim(name)) IN ('água','agua')
);

-- Trigger to block updates to system items (except by service role)
CREATE OR REPLACE FUNCTION public.prevent_system_item_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_system AND (
    OLD.name IS DISTINCT FROM NEW.name OR
    OLD.cost_price IS DISTINCT FROM NEW.cost_price OR
    OLD.sale_price IS DISTINCT FROM NEW.sale_price OR
    OLD.is_active IS DISTINCT FROM NEW.is_active OR
    OLD.is_system IS DISTINCT FROM NEW.is_system
  ) THEN
    RAISE EXCEPTION 'Itens do sistema não podem ser editados';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_item_update ON public.items;
CREATE TRIGGER trg_prevent_system_item_update
BEFORE UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_item_update();

-- Trigger to block updates to system categories
CREATE OR REPLACE FUNCTION public.prevent_system_category_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_system AND (
    OLD.name IS DISTINCT FROM NEW.name OR
    OLD.is_system IS DISTINCT FROM NEW.is_system
  ) THEN
    RAISE EXCEPTION 'Categorias do sistema não podem ser editadas';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_category_update ON public.categories;
CREATE TRIGGER trg_prevent_system_category_update
BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_category_update();

-- Ensure delete-protection triggers are attached
DROP TRIGGER IF EXISTS trg_prevent_system_item_delete ON public.items;
CREATE TRIGGER trg_prevent_system_item_delete
BEFORE DELETE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_item_delete();

DROP TRIGGER IF EXISTS trg_prevent_system_category_delete ON public.categories;
CREATE TRIGGER trg_prevent_system_category_delete
BEFORE DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_category_delete();

DROP TRIGGER IF EXISTS trg_prevent_system_location_delete ON public.locations;
CREATE TRIGGER trg_prevent_system_location_delete
BEFORE DELETE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_location_delete();