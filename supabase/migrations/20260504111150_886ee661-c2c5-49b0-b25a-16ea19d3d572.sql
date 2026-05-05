-- ==========================================================================
-- FASE: Hierarquia de Locais + Categorias de Saída + Incidentes de Estoque
-- ==========================================================================

-- 1) HIERARQUIA DE LOCAIS ---------------------------------------------------
-- Adiciona parent_id (auto-referência) e location_type (CD | unit | operation)
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS parent_id uuid NULL,
  ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'operation';

-- Constraint de tipos válidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_location_type_check'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_location_type_check
      CHECK (location_type IN ('cd','unit','operation'));
  END IF;
END$$;

-- FK auto-referencial (sem ON DELETE CASCADE para preservar histórico)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_parent_id_fkey'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.locations(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS locations_parent_id_idx ON public.locations(parent_id);
CREATE INDEX IF NOT EXISTS locations_org_type_idx ON public.locations(org_id, location_type);

-- Backfill: marca o "Estoque Central" existente como CD por organização
UPDATE public.locations
   SET location_type = 'cd'
 WHERE lower(trim(name)) = 'estoque central'
   AND location_type = 'operation';

-- Trigger anti-ciclo + dois níveis máximos por enquanto (CD -> unit -> operation)
CREATE OR REPLACE FUNCTION public.enforce_location_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  parent_type text;
  parent_parent uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Localização não pode ser pai de si mesma';
  END IF;

  SELECT location_type, parent_id INTO parent_type, parent_parent
    FROM public.locations WHERE id = NEW.parent_id;

  IF parent_type IS NULL THEN
    RAISE EXCEPTION 'Localização pai não encontrada';
  END IF;

  -- Regras de aninhamento: CD -> unit -> operation
  IF NEW.location_type = 'cd' THEN
    RAISE EXCEPTION 'CD não pode ter localização pai';
  ELSIF NEW.location_type = 'unit' AND parent_type <> 'cd' THEN
    RAISE EXCEPTION 'Unidade só pode ter como pai uma localização do tipo CD';
  ELSIF NEW.location_type = 'operation' AND parent_type NOT IN ('cd','unit') THEN
    RAISE EXCEPTION 'Operação só pode ter como pai um CD ou Unidade';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_location_hierarchy ON public.locations;
CREATE TRIGGER trg_enforce_location_hierarchy
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_location_hierarchy();


-- 2) CATEGORIAS DE SAÍDA EM MOVEMENTS --------------------------------------
-- Novos tipos: 'staff_meal' (alimentação) já existem como 'waste' parcialmente.
-- Adicionamos reason_category para detalhar:
--   process_loss | expired | staff (compatível com 'staff_meal')
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS reason_category text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movements_reason_category_check'
  ) THEN
    ALTER TABLE public.movements
      ADD CONSTRAINT movements_reason_category_check
      CHECK (
        reason_category IS NULL
        OR reason_category IN ('process_loss','expired','staff','other')
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS movements_type_reason_idx
  ON public.movements(type, reason_category);
CREATE INDEX IF NOT EXISTS movements_from_loc_created_idx
  ON public.movements(from_location_id, created_at DESC);


-- 3) INCIDENTES DE ESTOQUE (baixa sem saldo) -------------------------------
CREATE TABLE IF NOT EXISTS public.movement_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  movement_id uuid NULL,
  location_id uuid NOT NULL,
  item_id uuid NOT NULL,
  missing_qty numeric NOT NULL DEFAULT 0,
  resulting_balance numeric NOT NULL DEFAULT 0,
  movement_type text NULL,
  reason_category text NULL,
  note text NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS movement_incidents_org_idx ON public.movement_incidents(org_id);
CREATE INDEX IF NOT EXISTS movement_incidents_loc_item_idx ON public.movement_incidents(location_id, item_id);
CREATE INDEX IF NOT EXISTS movement_incidents_unresolved_idx ON public.movement_incidents(org_id) WHERE resolved_at IS NULL;

ALTER TABLE public.movement_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read movement_incidents" ON public.movement_incidents;
CREATE POLICY "org members read movement_incidents"
  ON public.movement_incidents
  FOR SELECT TO authenticated
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS "org members write movement_incidents" ON public.movement_incidents;
CREATE POLICY "org members write movement_incidents"
  ON public.movement_incidents
  FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));
