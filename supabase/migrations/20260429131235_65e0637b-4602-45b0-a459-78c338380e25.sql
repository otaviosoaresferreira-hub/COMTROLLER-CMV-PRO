-- 1. Inserir categoria "Sem Categoria" como categoria de sistema para cada org
INSERT INTO public.categories (org_id, name, is_system)
SELECT o.id, 'Sem Categoria', true
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c
  WHERE c.org_id = o.id AND c.name = 'Sem Categoria'
);

-- Garantir que a org default também tenha (caso não exista em organizations)
INSERT INTO public.categories (org_id, name, is_system)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Sem Categoria', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories
  WHERE org_id = '00000000-0000-0000-0000-000000000001'::uuid
    AND name = 'Sem Categoria'
);

-- 2. Função para resolver/criar a categoria "Sem Categoria" da org
CREATE OR REPLACE FUNCTION public.ensure_uncategorized_category(_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  SELECT id INTO _id
  FROM public.categories
  WHERE org_id = _org_id AND name = 'Sem Categoria'
  LIMIT 1;

  IF _id IS NULL THEN
    INSERT INTO public.categories (org_id, name, is_system)
    VALUES (_org_id, 'Sem Categoria', true)
    RETURNING id INTO _id;
  END IF;

  RETURN _id;
END;
$$;

-- 3. Trigger: ao inserir/atualizar item sem categoria, atribui "Sem Categoria"
CREATE OR REPLACE FUNCTION public.assign_default_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    NEW.category_id := public.ensure_uncategorized_category(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_assign_default_category ON public.items;
CREATE TRIGGER items_assign_default_category
BEFORE INSERT OR UPDATE OF category_id ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_category();

-- 4. Backfill: itens existentes sem categoria
UPDATE public.items i
SET category_id = public.ensure_uncategorized_category(i.org_id)
WHERE i.category_id IS NULL;