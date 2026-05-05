-- 1) Subcategorias em recipe_categories
ALTER TABLE public.recipe_categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.recipe_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS recipe_categories_parent_idx
  ON public.recipe_categories(parent_id);

-- Trigger: garante apenas 2 níveis (pai > filha) e impede ciclo
CREATE OR REPLACE FUNCTION public.enforce_recipe_category_two_levels()
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
      FROM public.recipe_categories WHERE id = NEW.parent_id;
    IF parent_has_parent THEN
      RAISE EXCEPTION 'Apenas 2 níveis de categoria são permitidos (pai > filha)';
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.recipe_categories WHERE parent_id = NEW.id)
      INTO is_currently_parent;
    IF is_currently_parent THEN
      RAISE EXCEPTION 'Esta categoria já possui subcategorias e não pode virar subcategoria';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipe_categories_two_levels ON public.recipe_categories;
CREATE TRIGGER recipe_categories_two_levels
  BEFORE INSERT OR UPDATE ON public.recipe_categories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_recipe_category_two_levels();

-- 2) Localização/Operação opcionais na ficha técnica
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS unit_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operation_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS recipes_unit_location_idx ON public.recipes(unit_location_id);
CREATE INDEX IF NOT EXISTS recipes_operation_location_idx ON public.recipes(operation_location_id);

-- 3) Fração: vínculo com ficha pai + toggle de personalização
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS parent_recipe_id uuid REFERENCES public.recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fraction numeric,
  ADD COLUMN IF NOT EXISTS customize_composition boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS recipes_parent_recipe_idx ON public.recipes(parent_recipe_id);

-- 4) Override de preço de venda por unidade/local
CREATE TABLE IF NOT EXISTS public.recipe_unit_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  sale_price numeric NOT NULL DEFAULT 0,
  cost_override numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, location_id)
);

ALTER TABLE public.recipe_unit_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read recipe_unit_overrides"
  ON public.recipe_unit_overrides FOR SELECT
  TO authenticated USING (is_org_member(org_id));

CREATE POLICY "org members write recipe_unit_overrides"
  ON public.recipe_unit_overrides FOR ALL
  TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TRIGGER recipe_unit_overrides_updated_at
  BEFORE UPDATE ON public.recipe_unit_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS recipe_unit_overrides_recipe_idx
  ON public.recipe_unit_overrides(recipe_id);