CREATE OR REPLACE FUNCTION public.setup_new_organization(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  suggested_names text[] := ARRAY[
    'Proteínas','Laticínios','Estoque Seco','Hortifrúti',
    'Limpeza','Descartáveis','Bebidas'
  ];
  protected_names text[] := ARRAY['Produções Internas','Sem Categoria','Sistema'];
  cat_name text;
  sistema_cat_id uuid;
  water_exists boolean;
  central_exists boolean;
BEGIN
  FOREACH cat_name IN ARRAY suggested_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND lower(trim(name)) = lower(trim(cat_name))
    );
  END LOOP;

  FOREACH cat_name IN ARRAY protected_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND lower(trim(name)) = lower(trim(cat_name))
    );
  END LOOP;

  SELECT id INTO sistema_cat_id FROM public.categories
    WHERE org_id = _org_id AND name = 'Sistema' LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.locations
    WHERE org_id = _org_id AND lower(trim(name)) = 'estoque central'
  ) INTO central_exists;

  IF NOT central_exists THEN
    INSERT INTO public.locations (org_id, name, is_system, operation_type)
    VALUES (_org_id, 'Estoque Central', true, 'a_la_carte');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.items
    WHERE org_id = _org_id
      AND lower(name) IN ('água (produção)','agua (producao)','água','agua')
  ) INTO water_exists;

  IF NOT water_exists THEN
    INSERT INTO public.items (
      org_id, name, unit, category_id,
      cost_price, sale_price, min_stock,
      is_active, is_system, is_free
    )
    VALUES (
      _org_id, 'Água (Produção)', 'kg', sistema_cat_id,
      0, 0, 0, true, true, true
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_suggested_categories(_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  suggested_names text[] := ARRAY[
    'Proteínas','Laticínios','Estoque Seco','Hortifrúti',
    'Limpeza','Descartáveis','Bebidas'
  ];
  cat_name text;
  inserted_count integer := 0;
BEGIN
  IF NOT public.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  FOREACH cat_name IN ARRAY suggested_names LOOP
    INSERT INTO public.categories (org_id, name, is_system)
    SELECT _org_id, cat_name, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories WHERE org_id = _org_id AND lower(trim(name)) = lower(trim(cat_name))
    );
    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_user_primary_organization(
  _user_id uuid,
  _email text DEFAULT NULL,
  _restaurant_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_org_id uuid;
  new_org_id uuid;
  org_name text;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido';
  END IF;

  SELECT org_id INTO existing_org_id
  FROM public.organization_members
  WHERE user_id = _user_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF existing_org_id IS NOT NULL THEN
    PERFORM public.setup_new_organization(existing_org_id);
    RETURN existing_org_id;
  END IF;

  org_name := COALESCE(NULLIF(trim(_restaurant_name), ''), NULLIF(trim(_email), ''), 'Meu Restaurante');

  INSERT INTO public.organizations(name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members(org_id, user_id, role)
  VALUES (new_org_id, _user_id, 'owner')
  ON CONFLICT DO NOTHING;

  PERFORM public.setup_new_organization(new_org_id);
  RETURN new_org_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_my_primary_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _org_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  _org_id := public.ensure_user_primary_organization(_uid, _email, NULL);
  RETURN _org_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.ensure_my_primary_organization()
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  invite_count integer := 0;
  new_org_id uuid;
  inv record;
BEGIN
  IF NEW.email IS NOT NULL THEN
    FOR inv IN
      SELECT id, org_id, role
      FROM public.organization_invites
      WHERE lower(email) = lower(NEW.email)
        AND accepted_at IS NULL
    LOOP
      INSERT INTO public.organization_members(org_id, user_id, role)
      VALUES (inv.org_id, NEW.id, inv.role)
      ON CONFLICT DO NOTHING;

      PERFORM public.setup_new_organization(inv.org_id);

      UPDATE public.organization_invites
      SET accepted_at = now()
      WHERE id = inv.id;

      invite_count := invite_count + 1;
    END LOOP;
  END IF;

  IF invite_count = 0 THEN
    new_org_id := public.ensure_user_primary_organization(
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'restaurant_name'
    );
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.on_organization_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.setup_new_organization(NEW.id);
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_on_organization_created'
  ) THEN
    CREATE TRIGGER trg_on_organization_created
    AFTER INSERT ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.on_organization_created();
  END IF;
END $$;