
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_items_is_free ON public.items(is_free) WHERE is_free = true;

-- Permitir editar o nome de itens livres (is_free=true), mas continuar bloqueando
-- alterações de custo, status, etc. para itens de sistema.
CREATE OR REPLACE FUNCTION public.prevent_system_item_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_system THEN
    -- Itens livres podem ter o nome editado pelo usuário.
    IF OLD.is_free THEN
      IF (
        OLD.cost_price IS DISTINCT FROM NEW.cost_price OR
        OLD.is_active IS DISTINCT FROM NEW.is_active OR
        OLD.is_system IS DISTINCT FROM NEW.is_system OR
        OLD.is_free IS DISTINCT FROM NEW.is_free
      ) THEN
        RAISE EXCEPTION 'Itens livres não podem ter custo, status ou flags alterados';
      END IF;
      RETURN NEW;
    END IF;

    IF (
      OLD.name IS DISTINCT FROM NEW.name OR
      OLD.cost_price IS DISTINCT FROM NEW.cost_price OR
      OLD.sale_price IS DISTINCT FROM NEW.sale_price OR
      OLD.is_active IS DISTINCT FROM NEW.is_active OR
      OLD.is_system IS DISTINCT FROM NEW.is_system
    ) THEN
      RAISE EXCEPTION 'Itens do sistema não podem ser editados';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
