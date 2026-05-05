-- Recipes (Fichas Técnicas)
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'final', -- 'final' (Venda/Prato) | 'sub' (Produção/Sub-receita)
  yield_quantity numeric NOT NULL DEFAULT 1, -- rendimento total
  yield_unit text NOT NULL DEFAULT 'UN', -- UN | KG | L | PORCAO
  portions integer NOT NULL DEFAULT 1, -- nº de porções (para final)
  sale_price numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read recipes" ON public.recipes FOR SELECT USING (true);
CREATE POLICY "public write recipes" ON public.recipes FOR ALL USING (true) WITH CHECK (true);

-- Recipe ingredients
CREATE TABLE public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  sub_recipe_id uuid REFERENCES public.recipes(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'UN',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read recipe_ingredients" ON public.recipe_ingredients FOR SELECT USING (true);
CREATE POLICY "public write recipe_ingredients" ON public.recipe_ingredients FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);