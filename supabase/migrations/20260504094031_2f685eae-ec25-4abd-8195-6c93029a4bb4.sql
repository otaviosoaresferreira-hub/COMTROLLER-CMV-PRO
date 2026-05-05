-- Adiciona flag "Baixa Direta de Insumos" às fichas técnicas.
-- Quando true, o consumo desta ficha (venda, descarte, produção como sub-ficha)
-- deve "explodir" a receita e baixar diretamente dos insumos brutos via FEFO,
-- ignorando o saldo do produto pronto.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS explode_on_consume boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recipes.explode_on_consume IS
  'Se true, o consumo desta ficha baixa direto dos insumos brutos (recursivamente) em vez de buscar saldo do produto pronto. Sub-fichas que contêm sub-fichas também são explodidas.';