
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'un',
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(item_id, location_id)
);

CREATE TABLE public.movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  from_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  quantity NUMERIC(12,3) NOT NULL,
  type TEXT NOT NULL DEFAULT 'transfer',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "public write categories" ON public.categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public read locations" ON public.locations FOR SELECT USING (true);
CREATE POLICY "public write locations" ON public.locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public read items" ON public.items FOR SELECT USING (true);
CREATE POLICY "public write items" ON public.items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public read stock" ON public.stock_levels FOR SELECT USING (true);
CREATE POLICY "public write stock" ON public.stock_levels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public read movements" ON public.movements FOR SELECT USING (true);
CREATE POLICY "public write movements" ON public.movements FOR ALL USING (true) WITH CHECK (true);

-- Seed
INSERT INTO public.locations (name) VALUES ('Estoque Central'), ('Cozinha'), ('Bar');
INSERT INTO public.categories (name) VALUES ('Carnes'), ('Bebidas'), ('Hortifruti'), ('Mercearia');

WITH cat AS (SELECT id, name FROM public.categories)
INSERT INTO public.items (name, unit, category_id, cost_price, sale_price)
SELECT * FROM (VALUES
  ('Picanha', 'kg', (SELECT id FROM cat WHERE name='Carnes'), 65.00, 120.00),
  ('Frango', 'kg', (SELECT id FROM cat WHERE name='Carnes'), 18.00, 35.00),
  ('Coca-Cola 350ml', 'un', (SELECT id FROM cat WHERE name='Bebidas'), 3.50, 8.00),
  ('Cerveja Long Neck', 'un', (SELECT id FROM cat WHERE name='Bebidas'), 4.20, 12.00),
  ('Tomate', 'kg', (SELECT id FROM cat WHERE name='Hortifruti'), 6.00, 0),
  ('Cebola', 'kg', (SELECT id FROM cat WHERE name='Hortifruti'), 4.50, 0),
  ('Arroz 5kg', 'un', (SELECT id FROM cat WHERE name='Mercearia'), 28.00, 0),
  ('Óleo de Soja', 'un', (SELECT id FROM cat WHERE name='Mercearia'), 7.50, 0)
) AS v(name, unit, category_id, cost_price, sale_price);

INSERT INTO public.stock_levels (item_id, location_id, quantity)
SELECT i.id, l.id,
  CASE WHEN l.name='Estoque Central' THEN 50 WHEN l.name='Cozinha' THEN 10 ELSE 5 END
FROM public.items i CROSS JOIN public.locations l;
