ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS weight_variable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.items.weight_variable IS
  'Para itens com unidade compartilhada: TRUE quando o peso por unidade varia entre lotes (ex: peça de picanha). FALSE quando é fixo (ex: balde 3kg).';