
-- =========================================================
-- 1. TIPOS E TABELAS DE TENANCY
-- =========================================================

CREATE TYPE public.org_role AS ENUM ('owner', 'manager', 'staff');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(org_id);

CREATE TABLE public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.org_role NOT NULL DEFAULT 'staff',
  invited_by uuid NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

-- =========================================================
-- 2. FUNÇÕES SECURITY DEFINER (evitam recursão em RLS)
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = _org_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org_id uuid, _role public.org_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = _org_id AND user_id = auth.uid() AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM public.organization_members WHERE user_id = auth.uid();
$$;

-- =========================================================
-- 3. ORG INICIAL + MIGRAÇÃO DOS DADOS EXISTENTES
-- =========================================================

INSERT INTO public.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Meu Restaurante');

-- Adiciona coluna org_id em todas as tabelas de dados e popula com a org inicial
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'items','categories','stock_levels','locations','movements',
    'invoices','invoice_items','item_batches','recipes','recipe_categories',
    'recipe_ingredients','inventory_counts','inventory_count_items',
    'location_item_factors','operations','shift_audits','shift_audit_entries',
    'xml_item_mappings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id uuid', t);
    EXECUTE format('UPDATE public.%I SET org_id = %L WHERE org_id IS NULL', t, '00000000-0000-0000-0000-000000000001');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id SET DEFAULT %L', t, '00000000-0000-0000-0000-000000000001');
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_org ON public.%I(org_id)', t, t);
  END LOOP;
END $$;

-- =========================================================
-- 4. TRIGGER: primeiro usuário vira owner da org inicial; demais criam a própria
-- =========================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  initial_org uuid := '00000000-0000-0000-0000-000000000001';
  has_owner boolean;
  new_org_id uuid;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.organization_members
    WHERE org_id = initial_org AND role = 'owner'
  ) INTO has_owner;

  IF NOT has_owner THEN
    INSERT INTO public.organization_members(org_id, user_id, role)
    VALUES (initial_org, NEW.id, 'owner');
  ELSE
    INSERT INTO public.organizations(name)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'Meu Restaurante'))
    RETURNING id INTO new_org_id;
    INSERT INTO public.organization_members(org_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- 5. RLS NAS TABELAS DE TENANCY
-- =========================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read own orgs" ON public.organizations
  FOR SELECT TO authenticated USING (public.is_org_member(id));
CREATE POLICY "owners update org" ON public.organizations
  FOR UPDATE TO authenticated USING (public.has_org_role(id, 'owner'));
CREATE POLICY "any auth can create org" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "members see own membership rows" ON public.organization_members
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "owners manage members" ON public.organization_members
  FOR ALL TO authenticated
  USING (public.has_org_role(org_id, 'owner'))
  WITH CHECK (public.has_org_role(org_id, 'owner'));

CREATE POLICY "owners manage invites" ON public.organization_invites
  FOR ALL TO authenticated
  USING (public.has_org_role(org_id, 'owner'))
  WITH CHECK (public.has_org_role(org_id, 'owner'));

-- =========================================================
-- 6. SUBSTITUI RLS PERMISSIVAS DAS TABELAS DE DADOS POR ISOLAMENTO POR ORG
-- =========================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'items','categories','stock_levels','locations','movements',
    'invoices','invoice_items','item_batches','recipes','recipe_categories',
    'recipe_ingredients','inventory_counts','inventory_count_items',
    'location_item_factors','operations','shift_audits','shift_audit_entries',
    'xml_item_mappings'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop todas as policies existentes na tabela
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- Cria policies por organização
    EXECUTE format($f$
      CREATE POLICY "org members read %1$s" ON public.%1$I
      FOR SELECT TO authenticated USING (public.is_org_member(org_id));
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY "org members write %1$s" ON public.%1$I
      FOR ALL TO authenticated
      USING (public.is_org_member(org_id))
      WITH CHECK (public.is_org_member(org_id));
    $f$, t);
  END LOOP;
END $$;
