-- 1) Hierarquia: parent_id em categories (2 níveis: pai/filha)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_org_id ON public.categories(org_id);

-- Garante 2 níveis máximos: uma subcategoria não pode virar pai
CREATE OR REPLACE FUNCTION public.enforce_category_two_levels()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  parent_has_parent boolean;
  is_currently_parent boolean;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'Categoria não pode ser pai de si mesma';
    END IF;
    SELECT (parent_id IS NOT NULL) INTO parent_has_parent
      FROM public.categories WHERE id = NEW.parent_id;
    IF parent_has_parent THEN
      RAISE EXCEPTION 'Apenas 2 níveis de categoria são permitidos (pai > filha)';
    END IF;
    -- Se esta categoria já é pai de outras, não pode virar filha
    SELECT EXISTS(SELECT 1 FROM public.categories WHERE parent_id = NEW.id)
      INTO is_currently_parent;
    IF is_currently_parent THEN
      RAISE EXCEPTION 'Esta categoria já possui subcategorias e não pode virar subcategoria';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_category_two_levels ON public.categories;
CREATE TRIGGER trg_enforce_category_two_levels
BEFORE INSERT OR UPDATE OF parent_id ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.enforce_category_two_levels();

-- 2) Tabela de categorias de sistema ocultas por organização
CREATE TABLE IF NOT EXISTS public.hidden_system_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, category_id)
);

ALTER TABLE public.hidden_system_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read hidden_system_categories"
  ON public.hidden_system_categories FOR SELECT
  TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "org members write hidden_system_categories"
  ON public.hidden_system_categories FOR ALL
  TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));