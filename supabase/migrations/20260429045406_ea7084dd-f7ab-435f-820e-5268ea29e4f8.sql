-- Add is_system flag to categories and items to protect base records
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Prevent deletion of system categories
CREATE OR REPLACE FUNCTION public.prevent_system_category_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Categorias do sistema não podem ser excluídas';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_category_delete ON public.categories;
CREATE TRIGGER trg_prevent_system_category_delete
BEFORE DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_category_delete();

-- Prevent deletion of system items (Água)
CREATE OR REPLACE FUNCTION public.prevent_system_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Itens do sistema não podem ser excluídos';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_item_delete ON public.items;
CREATE TRIGGER trg_prevent_system_item_delete
BEFORE DELETE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_item_delete();

-- Prevent deletion of system locations (Estoque Central)
CREATE OR REPLACE FUNCTION public.prevent_system_location_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Localizações do sistema não podem ser excluídas';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_location_delete ON public.locations;
CREATE TRIGGER trg_prevent_system_location_delete
BEFORE DELETE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_location_delete();