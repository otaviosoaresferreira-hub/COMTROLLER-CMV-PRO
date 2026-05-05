-- 1) Itens em gramas/ml -> KG/L (com ajuste do custo por unidade base)
UPDATE public.items
SET cost_price = cost_price * 1000,
    unit = 'KG'
WHERE upper(unit) IN ('G','GR','GRAMA');

UPDATE public.items
SET cost_price = cost_price * 1000,
    unit = 'L'
WHERE upper(unit) = 'ML';

-- Normaliza grafia minúscula (ex: 'kg' -> 'KG')
UPDATE public.items SET unit = upper(unit)
WHERE unit IN ('kg','l','un');

-- 2) Ingredientes de receitas em G/ML -> KG/L
UPDATE public.recipe_ingredients
SET quantity = quantity / 1000.0,
    unit = 'KG'
WHERE upper(unit) IN ('G','GR','GRAMA');

UPDATE public.recipe_ingredients
SET quantity = quantity / 1000.0,
    unit = 'L'
WHERE upper(unit) = 'ML';

UPDATE public.recipe_ingredients SET unit = upper(unit)
WHERE unit IN ('kg','l','un');