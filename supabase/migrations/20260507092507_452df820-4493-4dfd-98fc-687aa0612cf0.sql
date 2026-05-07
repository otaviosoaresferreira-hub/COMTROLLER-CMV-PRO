ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS conversion_factor numeric NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.items.conversion_factor IS 'Fator multiplicativo aplicado sobre o Peso Base (standard_weight_g) para chegar no peso/volume real registrado no estoque. Ex.: óleo 0,9 L * 0,92 = 0,828 KG.';