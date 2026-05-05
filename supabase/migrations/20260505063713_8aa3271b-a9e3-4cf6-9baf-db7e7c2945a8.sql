
-- TYPES
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('gestor','operacional');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='org_role') THEN
    CREATE TYPE public.org_role AS ENUM ('owner','manager','staff');
  END IF;
END $$;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS buyer_name text,
  ADD COLUMN IF NOT EXISTS whatsapp_greeting text,
  ADD COLUMN IF NOT EXISTS target_coverage_days integer NOT NULL DEFAULT 7;

DROP POLICY IF EXISTS "invoices_select_own_org" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_own_org" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_own_org" ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete_own_org" ON public.invoices;
DROP POLICY IF EXISTS "invoice_items_select_own_org" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_insert_own_org" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_update_own_org" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_delete_own_org" ON public.invoice_items;

-- TABELAS NOVAS
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  name text NOT NULL,
  document text, whatsapp_phone text, contact_name text, notes text,
  lead_time_days integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS public.adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  requested_by uuid NOT NULL, requester_email text,
  kind text NOT NULL,
  item_id uuid, batch_id uuid, location_id uuid,
  current_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  justification text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid, reviewer_email text, review_note text,
  reviewed_at timestamptz, applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  user_id uuid, user_email text,
  module text NOT NULL, entity_type text NOT NULL, entity_id uuid,
  action text NOT NULL, reason text,
  old_value jsonb, new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  confirmed_at timestamptz,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL, item_id uuid NOT NULL,
  counted_quantity numeric NOT NULL DEFAULT 0,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.item_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  item_id uuid NOT NULL, supplier_id uuid NOT NULL,
  is_preferred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, item_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS public.location_item_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL, item_id uuid NOT NULL,
  factor numeric NOT NULL DEFAULT 1.0 CHECK (factor > 0),
  note text,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.location_item_stock_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  location_id uuid NOT NULL, item_id uuid NOT NULL,
  skip_auto_deduction boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.movement_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  movement_id uuid, location_id uuid NOT NULL, item_id uuid NOT NULL,
  missing_qty numeric NOT NULL DEFAULT 0,
  resulting_balance numeric NOT NULL DEFAULT 0,
  movement_type text, reason_category text, note text,
  resolved_at timestamptz, resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  email text NOT NULL,
  role public.org_role NOT NULL DEFAULT 'staff'::public.org_role,
  invited_by uuid NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE TABLE IF NOT EXISTS public.recipe_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  parent_id uuid,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'final',
  yield_quantity numeric NOT NULL DEFAULT 1,
  yield_unit text NOT NULL DEFAULT 'UN',
  portions integer NOT NULL DEFAULT 1,
  sale_price numeric NOT NULL DEFAULT 0,
  notes text, category_id uuid,
  unit_weight_g numeric, unit_name text,
  is_active boolean NOT NULL DEFAULT true,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  produced_item_id uuid,
  explode_on_consume boolean NOT NULL DEFAULT false,
  unit_location_id uuid, operation_location_id uuid,
  parent_recipe_id uuid, fraction numeric,
  customize_composition boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL,
  item_id uuid, sub_recipe_id uuid,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'UN',
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipe_unit_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  recipe_id uuid NOT NULL, location_id uuid NOT NULL,
  sale_price numeric NOT NULL DEFAULT 0,
  cost_override numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.sales_item_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  source_name text NOT NULL,
  recipe_id uuid NOT NULL,
  multiplier numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_name)
);

CREATE TABLE IF NOT EXISTS public.shift_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_date date NOT NULL DEFAULT CURRENT_DATE,
  location_id uuid NOT NULL,
  shift_label text, notes text,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shift_audit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL, item_id uuid NOT NULL,
  opening_qty numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0,
  sales_qty numeric NOT NULL DEFAULT 0,
  staff_qty numeric NOT NULL DEFAULT 0,
  waste_qty numeric NOT NULL DEFAULT 0,
  final_count_qty numeric NOT NULL DEFAULT 0,
  variance_qty numeric NOT NULL DEFAULT 0,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.xml_item_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  xml_name text NOT NULL,
  item_id uuid NOT NULL,
  multiplier numeric NOT NULL DEFAULT 1,
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- FUNÇÕES
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id=_org_id AND user_id=auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org_id uuid, _role public.org_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id=_org_id AND user_id=auth.uid() AND role=_role);
$$;

CREATE OR REPLACE FUNCTION public.has_app_role(_org_id uuid, _user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_user_roles WHERE org_id=_org_id AND user_id=_user_id AND role=_role);
$$;

CREATE OR REPLACE FUNCTION public.is_gestor(_org_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_org_role(_org_id,'owner'::org_role)
      OR public.has_app_role(_org_id, auth.uid(), 'gestor'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT org_id FROM public.organization_members WHERE user_id=auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.ensure_uncategorized_category(_org_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.categories WHERE org_id=_org_id AND name='Sem Categoria' LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.categories(org_id,name,is_system) VALUES (_org_id,'Sem Categoria',true) RETURNING id INTO _id;
  END IF;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.assign_default_category() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.category_id IS NULL THEN NEW.category_id := public.ensure_uncategorized_category(NEW.org_id); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_category_two_levels() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE parent_has_parent boolean; is_currently_parent boolean;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Categoria não pode ser pai de si mesma'; END IF;
    SELECT (parent_id IS NOT NULL) INTO parent_has_parent FROM public.categories WHERE id=NEW.parent_id;
    IF parent_has_parent THEN RAISE EXCEPTION 'Apenas 2 níveis de categoria são permitidos'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.categories WHERE parent_id=NEW.id) INTO is_currently_parent;
    IF is_currently_parent THEN RAISE EXCEPTION 'Esta categoria já possui subcategorias'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_recipe_category_two_levels() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE parent_has_parent boolean; is_currently_parent boolean;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Categoria não pode ser pai de si mesma'; END IF;
    SELECT (parent_id IS NOT NULL) INTO parent_has_parent FROM public.recipe_categories WHERE id=NEW.parent_id;
    IF parent_has_parent THEN RAISE EXCEPTION 'Apenas 2 níveis'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.recipe_categories WHERE parent_id=NEW.id) INTO is_currently_parent;
    IF is_currently_parent THEN RAISE EXCEPTION 'Já possui subcategorias'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_location_hierarchy() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE parent_type text; parent_parent uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Localização não pode ser pai de si mesma'; END IF;
  SELECT location_type, parent_id INTO parent_type, parent_parent FROM public.locations WHERE id=NEW.parent_id;
  IF parent_type IS NULL THEN RAISE EXCEPTION 'Localização pai não encontrada'; END IF;
  IF NEW.location_type='cd' THEN RAISE EXCEPTION 'CD não pode ter pai';
  ELSIF NEW.location_type='unit' AND parent_type<>'cd' THEN RAISE EXCEPTION 'Unidade só pode ter como pai um CD';
  ELSIF NEW.location_type='operation' AND parent_type NOT IN ('cd','unit') THEN RAISE EXCEPTION 'Operação só pode ter como pai um CD ou Unidade';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.prevent_system_category_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF OLD.is_system THEN RAISE EXCEPTION 'Categorias do sistema não podem ser excluídas'; END IF; RETURN OLD; END; $$;

CREATE OR REPLACE FUNCTION public.prevent_system_category_update() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.is_system AND (OLD.name IS DISTINCT FROM NEW.name OR OLD.is_system IS DISTINCT FROM NEW.is_system) THEN
    RAISE EXCEPTION 'Categorias do sistema não podem ser editadas';
  END IF; RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.prevent_system_item_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF OLD.is_system THEN RAISE EXCEPTION 'Itens do sistema não podem ser excluídos'; END IF; RETURN OLD; END; $$;

CREATE OR REPLACE FUNCTION public.prevent_system_item_update() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.is_system THEN
    IF OLD.is_free THEN
      IF (OLD.cost_price IS DISTINCT FROM NEW.cost_price OR OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.is_system IS DISTINCT FROM NEW.is_system OR OLD.is_free IS DISTINCT FROM NEW.is_free) THEN
        RAISE EXCEPTION 'Itens livres não podem ter custo, status ou flags alterados';
      END IF; RETURN NEW;
    END IF;
    IF (OLD.name IS DISTINCT FROM NEW.name OR OLD.cost_price IS DISTINCT FROM NEW.cost_price OR OLD.sale_price IS DISTINCT FROM NEW.sale_price OR OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.is_system IS DISTINCT FROM NEW.is_system) THEN
      RAISE EXCEPTION 'Itens do sistema não podem ser editados';
    END IF;
  END IF; RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.prevent_system_location_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF OLD.is_system THEN RAISE EXCEPTION 'Localizações do sistema não podem ser excluídas'; END IF; RETURN OLD; END; $$;

CREATE OR REPLACE FUNCTION public.on_organization_created() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.setup_new_organization(NEW.id); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE invite_count integer := 0; new_org_id uuid; inv record;
BEGIN
  IF NEW.email IS NOT NULL THEN
    FOR inv IN SELECT id, org_id, role FROM public.organization_invites WHERE lower(email)=lower(NEW.email) AND accepted_at IS NULL
    LOOP
      INSERT INTO public.organization_members(org_id,user_id,role) VALUES (inv.org_id, NEW.id, inv.role) ON CONFLICT DO NOTHING;
      PERFORM public.setup_new_organization(inv.org_id);
      UPDATE public.organization_invites SET accepted_at=now() WHERE id=inv.id;
      invite_count := invite_count + 1;
    END LOOP;
  END IF;
  IF invite_count = 0 THEN
    new_org_id := public.ensure_user_primary_organization(NEW.id, NEW.email, NEW.raw_user_meta_data->>'restaurant_name');
  END IF;
  RETURN NEW;
END $$;

-- FOREIGN KEYS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_count_items_count_id_fkey') THEN
    ALTER TABLE public.inventory_count_items ADD CONSTRAINT inventory_count_items_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_count_items_item_id_fkey') THEN
    ALTER TABLE public.inventory_count_items ADD CONSTRAINT inventory_count_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_counts_location_id_fkey') THEN
    ALTER TABLE public.inventory_counts ADD CONSTRAINT inventory_counts_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoice_items_item_id_fkey') THEN
    ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_supplier_id_fkey') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='item_batches_invoice_id_fkey') THEN
    ALTER TABLE public.item_batches ADD CONSTRAINT item_batches_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='item_batches_item_id_fkey') THEN
    ALTER TABLE public.item_batches ADD CONSTRAINT item_batches_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='item_batches_movement_id_fkey') THEN
    ALTER TABLE public.item_batches ADD CONSTRAINT item_batches_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES public.movements(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='item_suppliers_supplier_id_fkey') THEN
    ALTER TABLE public.item_suppliers ADD CONSTRAINT item_suppliers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='items_category_id_fkey') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='categories_parent_id_fkey') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hidden_system_categories_category_id_fkey') THEN
    ALTER TABLE public.hidden_system_categories ADD CONSTRAINT hidden_system_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='location_item_factors_item_id_fkey') THEN
    ALTER TABLE public.location_item_factors ADD CONSTRAINT location_item_factors_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='location_item_factors_location_id_fkey') THEN
    ALTER TABLE public.location_item_factors ADD CONSTRAINT location_item_factors_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='locations_parent_id_fkey') THEN
    ALTER TABLE public.locations ADD CONSTRAINT locations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.locations(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='movements_from_location_id_fkey') THEN
    ALTER TABLE public.movements ADD CONSTRAINT movements_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.locations(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='movements_invoice_id_fkey') THEN
    ALTER TABLE public.movements ADD CONSTRAINT movements_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='movements_item_id_fkey') THEN
    ALTER TABLE public.movements ADD CONSTRAINT movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='movements_to_location_id_fkey') THEN
    ALTER TABLE public.movements ADD CONSTRAINT movements_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.locations(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organization_invites_org_id_fkey') THEN
    ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organization_members_org_id_fkey') THEN
    ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipe_categories_parent_id_fkey') THEN
    ALTER TABLE public.recipe_categories ADD CONSTRAINT recipe_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.recipe_categories(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipe_ingredients_item_id_fkey') THEN
    ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipe_ingredients_recipe_id_fkey') THEN
    ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipe_ingredients_sub_recipe_id_fkey') THEN
    ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_sub_recipe_id_fkey FOREIGN KEY (sub_recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipe_unit_overrides_location_id_fkey') THEN
    ALTER TABLE public.recipe_unit_overrides ADD CONSTRAINT recipe_unit_overrides_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipe_unit_overrides_recipe_id_fkey') THEN
    ALTER TABLE public.recipe_unit_overrides ADD CONSTRAINT recipe_unit_overrides_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipes_category_id_fkey') THEN
    ALTER TABLE public.recipes ADD CONSTRAINT recipes_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.recipe_categories(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipes_operation_location_id_fkey') THEN
    ALTER TABLE public.recipes ADD CONSTRAINT recipes_operation_location_id_fkey FOREIGN KEY (operation_location_id) REFERENCES public.locations(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipes_parent_recipe_id_fkey') THEN
    ALTER TABLE public.recipes ADD CONSTRAINT recipes_parent_recipe_id_fkey FOREIGN KEY (parent_recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recipes_unit_location_id_fkey') THEN
    ALTER TABLE public.recipes ADD CONSTRAINT recipes_unit_location_id_fkey FOREIGN KEY (unit_location_id) REFERENCES public.locations(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shift_audit_entries_audit_id_fkey') THEN
    ALTER TABLE public.shift_audit_entries ADD CONSTRAINT shift_audit_entries_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.shift_audits(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_levels_item_id_fkey') THEN
    ALTER TABLE public.stock_levels ADD CONSTRAINT stock_levels_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_levels_location_id_fkey') THEN
    ALTER TABLE public.stock_levels ADD CONSTRAINT stock_levels_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='xml_item_mappings_item_id_fkey') THEN
    ALTER TABLE public.xml_item_mappings ADD CONSTRAINT xml_item_mappings_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE; END IF;
END $$;

-- ÍNDICES principais
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_item ON public.invoice_items (item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_org ON public.invoice_items (org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON public.invoices (org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON public.invoices (org_id, supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_access_key_unique ON public.invoices (org_id, access_key) WHERE access_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_nfe_key_unique ON public.invoices (org_id, nfe_key) WHERE nfe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_unique ON public.invoices (org_id, COALESCE(supplier_doc,''), COALESCE(series,''), number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_levels_item_location_unique ON public.stock_levels (item_id, location_id);
CREATE UNIQUE INDEX IF NOT EXISTS xml_item_mappings_org_xml_name_unique ON public.xml_item_mappings (org_id, lower(trim(xml_name)));
CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_one_open_per_location ON public.inventory_counts (location_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS idx_categories_org ON public.categories (org_id);
CREATE INDEX IF NOT EXISTS idx_items_org ON public.items (org_id);
CREATE INDEX IF NOT EXISTS idx_locations_org ON public.locations (org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members (org_id);

-- ENABLE RLS
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'adjustment_requests','app_user_roles','audit_logs','categories','hidden_system_categories',
    'inventory_count_items','inventory_counts','invoice_items','invoices','item_batches',
    'item_categories','item_suppliers','items','location_item_factors','location_item_stock_overrides',
    'locations','movement_incidents','movements','operations','organization_invites',
    'organization_members','organizations','recipe_categories','recipe_ingredients','recipe_unit_overrides',
    'recipes','sales_item_mappings','shift_audit_entries','shift_audits','stock_levels',
    'suppliers','xml_item_mappings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- POLICIES
DO $$
DECLARE
  read_tables text[] := ARRAY[
    'adjustment_requests','app_user_roles','audit_logs','categories','hidden_system_categories',
    'inventory_count_items','inventory_counts','invoice_items','invoices','item_batches',
    'item_categories','item_suppliers','items','location_item_factors','location_item_stock_overrides',
    'locations','movement_incidents','movements','operations','recipe_categories','recipe_ingredients',
    'recipe_unit_overrides','recipes','sales_item_mappings','shift_audit_entries','shift_audits',
    'stock_levels','suppliers','xml_item_mappings'
  ];
  write_tables text[] := ARRAY[
    'adjustment_requests','categories','hidden_system_categories','inventory_count_items','inventory_counts',
    'invoice_items','invoices','item_batches','item_categories','item_suppliers','items',
    'location_item_factors','location_item_stock_overrides','locations','movement_incidents','movements',
    'operations','recipe_categories','recipe_ingredients','recipe_unit_overrides','recipes',
    'sales_item_mappings','shift_audit_entries','shift_audits','stock_levels','suppliers','xml_item_mappings'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY read_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org members read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "org members read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.is_org_member(org_id))', t);
  END LOOP;
  FOREACH t IN ARRAY write_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org members write %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "org members write %1$s" ON public.%1$I TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id))', t);
  END LOOP;
  EXECUTE 'DROP POLICY IF EXISTS "org members insert audit_logs" ON public.audit_logs';
  EXECUTE 'CREATE POLICY "org members insert audit_logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id))';
  EXECUTE 'DROP POLICY IF EXISTS "members read own orgs" ON public.organizations';
  EXECUTE 'CREATE POLICY "members read own orgs" ON public.organizations FOR SELECT TO authenticated USING (public.is_org_member(id))';
  EXECUTE 'DROP POLICY IF EXISTS "owners update org" ON public.organizations';
  EXECUTE 'CREATE POLICY "owners update org" ON public.organizations FOR UPDATE TO authenticated USING (public.has_org_role(id, ''owner''::public.org_role))';
  EXECUTE 'DROP POLICY IF EXISTS "members see own membership rows" ON public.organization_members';
  EXECUTE 'CREATE POLICY "members see own membership rows" ON public.organization_members FOR SELECT TO authenticated USING (public.is_org_member(org_id))';
  EXECUTE 'DROP POLICY IF EXISTS "owners manage members" ON public.organization_members';
  EXECUTE 'CREATE POLICY "owners manage members" ON public.organization_members TO authenticated USING (public.has_org_role(org_id, ''owner''::public.org_role)) WITH CHECK (public.has_org_role(org_id, ''owner''::public.org_role))';
  EXECUTE 'DROP POLICY IF EXISTS "owners manage app_user_roles" ON public.app_user_roles';
  EXECUTE 'CREATE POLICY "owners manage app_user_roles" ON public.app_user_roles TO authenticated USING (public.has_org_role(org_id, ''owner''::public.org_role)) WITH CHECK (public.has_org_role(org_id, ''owner''::public.org_role))';
  EXECUTE 'DROP POLICY IF EXISTS "owners manage invites" ON public.organization_invites';
  EXECUTE 'CREATE POLICY "owners manage invites" ON public.organization_invites TO authenticated USING (public.has_org_role(org_id, ''owner''::public.org_role)) WITH CHECK (public.has_org_role(org_id, ''owner''::public.org_role))';
END $$;

-- TRIGGERS
DROP TRIGGER IF EXISTS items_assign_default_category ON public.items;
CREATE TRIGGER items_assign_default_category BEFORE INSERT OR UPDATE OF category_id ON public.items FOR EACH ROW EXECUTE FUNCTION public.assign_default_category();
DROP TRIGGER IF EXISTS trg_enforce_category_two_levels ON public.categories;
CREATE TRIGGER trg_enforce_category_two_levels BEFORE INSERT OR UPDATE OF parent_id ON public.categories FOR EACH ROW EXECUTE FUNCTION public.enforce_category_two_levels();
DROP TRIGGER IF EXISTS recipe_categories_two_levels ON public.recipe_categories;
CREATE TRIGGER recipe_categories_two_levels BEFORE INSERT OR UPDATE ON public.recipe_categories FOR EACH ROW EXECUTE FUNCTION public.enforce_recipe_category_two_levels();
DROP TRIGGER IF EXISTS trg_enforce_location_hierarchy ON public.locations;
CREATE TRIGGER trg_enforce_location_hierarchy BEFORE INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.enforce_location_hierarchy();
DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_loc_item_overrides_updated_at ON public.location_item_stock_overrides;
CREATE TRIGGER trg_loc_item_overrides_updated_at BEFORE UPDATE ON public.location_item_stock_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_on_organization_created ON public.organizations;
CREATE TRIGGER trg_on_organization_created AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.on_organization_created();
DROP TRIGGER IF EXISTS trg_prevent_system_category_delete ON public.categories;
CREATE TRIGGER trg_prevent_system_category_delete BEFORE DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.prevent_system_category_delete();
DROP TRIGGER IF EXISTS trg_prevent_system_category_update ON public.categories;
CREATE TRIGGER trg_prevent_system_category_update BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.prevent_system_category_update();
DROP TRIGGER IF EXISTS trg_prevent_system_item_delete ON public.items;
CREATE TRIGGER trg_prevent_system_item_delete BEFORE DELETE ON public.items FOR EACH ROW EXECUTE FUNCTION public.prevent_system_item_delete();
DROP TRIGGER IF EXISTS trg_prevent_system_item_update ON public.items;
CREATE TRIGGER trg_prevent_system_item_update BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.prevent_system_item_update();
DROP TRIGGER IF EXISTS trg_prevent_system_location_delete ON public.locations;
CREATE TRIGGER trg_prevent_system_location_delete BEFORE DELETE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.prevent_system_location_delete();
DROP TRIGGER IF EXISTS recipe_unit_overrides_updated_at ON public.recipe_unit_overrides;
CREATE TRIGGER recipe_unit_overrides_updated_at BEFORE UPDATE ON public.recipe_unit_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_inventory_count_items_updated_at ON public.inventory_count_items;
CREATE TRIGGER set_inventory_count_items_updated_at BEFORE UPDATE ON public.inventory_count_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_inventory_counts_updated_at ON public.inventory_counts;
CREATE TRIGGER set_inventory_counts_updated_at BEFORE UPDATE ON public.inventory_counts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_shift_audits_updated_at ON public.shift_audits;
CREATE TRIGGER set_shift_audits_updated_at BEFORE UPDATE ON public.shift_audits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_location_item_factors ON public.location_item_factors;
CREATE TRIGGER set_updated_at_location_item_factors BEFORE UPDATE ON public.location_item_factors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_sales_item_mappings ON public.sales_item_mappings;
CREATE TRIGGER set_updated_at_sales_item_mappings BEFORE UPDATE ON public.sales_item_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS suppliers_set_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_adjustment_requests_updated_at ON public.adjustment_requests;
CREATE TRIGGER trg_adjustment_requests_updated_at BEFORE UPDATE ON public.adjustment_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
