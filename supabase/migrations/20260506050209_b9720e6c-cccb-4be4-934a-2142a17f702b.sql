-- 1. Add is_shared flag to locations
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_locations_is_shared
  ON public.locations(org_id, parent_id) WHERE is_shared = true;

-- 2. Allow shared locations to live under a unit (operation_type respected)
-- The existing enforce_location_hierarchy trigger already accepts location_type='operation' under a unit, so no change there.

-- 3. Function to ensure a "Uso Comum" exists for a given unit
CREATE OR REPLACE FUNCTION public.ensure_shared_location_for_unit(_unit_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org_id uuid;
  _unit_type text;
  _shared_id uuid;
BEGIN
  SELECT org_id, location_type INTO _org_id, _unit_type
  FROM public.locations WHERE id = _unit_id;

  IF _org_id IS NULL OR _unit_type <> 'unit' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _shared_id
  FROM public.locations
  WHERE org_id = _org_id AND parent_id = _unit_id AND is_shared = true
  LIMIT 1;

  IF _shared_id IS NOT NULL THEN
    RETURN _shared_id;
  END IF;

  INSERT INTO public.locations(
    org_id, name, parent_id, location_type,
    operation_type, stock_mode, is_system, is_shared
  )
  VALUES (
    _org_id, 'Uso Comum', _unit_id, 'operation',
    'a_la_carte', 'traditional', true, true
  )
  RETURNING id INTO _shared_id;

  RETURN _shared_id;
END;
$$;

-- 4. Trigger: auto-create Uso Comum after a unit is inserted
CREATE OR REPLACE FUNCTION public.on_unit_created_create_shared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.location_type = 'unit' THEN
    PERFORM public.ensure_shared_location_for_unit(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_unit_created_create_shared ON public.locations;
CREATE TRIGGER trg_on_unit_created_create_shared
  AFTER INSERT ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.on_unit_created_create_shared();

-- 5. Backfill: create Uso Comum for every existing unit that lacks one
DO $$
DECLARE u record;
BEGIN
  FOR u IN
    SELECT id FROM public.locations WHERE location_type = 'unit'
  LOOP
    PERFORM public.ensure_shared_location_for_unit(u.id);
  END LOOP;
END $$;