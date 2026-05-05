-- Adiciona vínculo persistente entre uma ficha técnica (recipe) e o item de estoque
-- de Produção Própria correspondente. Isso evita duplicidades por nome e permite
-- que o usuário escolha manualmente qual item representa a receita produzida.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS produced_item_id uuid;

CREATE INDEX IF NOT EXISTS idx_recipes_produced_item_id
  ON public.recipes(produced_item_id);
