
-- Categorias de fichas técnicas (pratos de venda)
CREATE TABLE public.recipe_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.recipe_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read recipe_categories" ON public.recipe_categories FOR SELECT USING (true);
CREATE POLICY "public write recipe_categories" ON public.recipe_categories FOR ALL USING (true) WITH CHECK (true);

-- Vincula receita a categoria
ALTER TABLE public.recipes ADD COLUMN category_id UUID REFERENCES public.recipe_categories(id) ON DELETE SET NULL;

-- Categorias padrão
INSERT INTO public.recipe_categories (name) VALUES ('Burgers'), ('Pizzas'), ('Porções'), ('Bebidas'), ('Sobremesas');
