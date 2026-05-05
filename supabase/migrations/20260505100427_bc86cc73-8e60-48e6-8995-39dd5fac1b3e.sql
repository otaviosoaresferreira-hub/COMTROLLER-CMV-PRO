UPDATE public.locations
SET location_type = 'cd'
WHERE lower(trim(name)) = 'estoque central'
  AND location_type IS DISTINCT FROM 'cd';

CREATE OR REPLACE FUNCTION public.enforce_location_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  parent_type text;
  parent_parent uuid;
  parent_name text;
  parent_is_system boolean;
  parent_is_central boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Localização não pode ser pai de si mesma';
  END IF;

  SELECT location_type, parent_id, name, COALESCE(is_system, false)
    INTO parent_type, parent_parent, parent_name, parent_is_system
  FROM public.locations
  WHERE id = NEW.parent_id;

  IF parent_type IS NULL AND parent_name IS NULL THEN
    RAISE EXCEPTION 'Localização pai não encontrada';
  END IF;

  parent_is_central := lower(trim(COALESCE(parent_name, ''))) = 'estoque central' OR parent_is_system;

  IF NEW.location_type = 'cd' THEN
    RAISE EXCEPTION 'CD não pode ter pai';
  ELSIF NEW.location_type = 'unit' AND NOT (parent_type = 'cd' OR parent_is_central) THEN
    RAISE EXCEPTION 'Unidade só pode ter como pai o Estoque Central';
  ELSIF NEW.location_type = 'operation' AND NOT (parent_type IN ('cd', 'unit') OR parent_is_central) THEN
    RAISE EXCEPTION 'Operação só pode ter como pai o Estoque Central ou uma Unidade';
  END IF;

  RETURN NEW;
END;
$$;