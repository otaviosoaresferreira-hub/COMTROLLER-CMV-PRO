ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS conversion_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.items.conversion_enabled IS 'Quando ligado, o item possui equivalência KG↔L pré-cadastrada (1 base = conversion_factor alt). Pré-popula a chave Fator de Conversão na entrada manual.';