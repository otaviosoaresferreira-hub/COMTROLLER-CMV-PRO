-- 1) Garante que existe categoria "Estoque Seco" (renomeia "Secos" para Estoque Seco)
DO $$
DECLARE
  estoque_seco_id uuid;
  mercearia_id uuid;
  secos_id uuid;
BEGIN
  SELECT id INTO secos_id FROM public.categories WHERE lower(name) = 'secos' LIMIT 1;
  SELECT id INTO mercearia_id FROM public.categories WHERE lower(name) = 'mercearia' LIMIT 1;

  IF secos_id IS NOT NULL THEN
    UPDATE public.categories SET name = 'Estoque Seco' WHERE id = secos_id;
    estoque_seco_id := secos_id;
  ELSE
    INSERT INTO public.categories (name) VALUES ('Estoque Seco') RETURNING id INTO estoque_seco_id;
  END IF;

  -- Move itens de Mercearia para Estoque Seco e remove a categoria antiga
  IF mercearia_id IS NOT NULL THEN
    UPDATE public.items SET category_id = estoque_seco_id WHERE category_id = mercearia_id;
    DELETE FROM public.categories WHERE id = mercearia_id;
  END IF;
END $$;

-- 2) Cria categoria "Descartáveis e Embalagens" se não existir
INSERT INTO public.categories (name)
SELECT 'Descartáveis e Embalagens'
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE lower(name) = 'descartáveis e embalagens'
);