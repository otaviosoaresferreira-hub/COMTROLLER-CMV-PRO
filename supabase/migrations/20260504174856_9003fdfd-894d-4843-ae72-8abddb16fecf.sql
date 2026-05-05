DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('gestor', 'operacional');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.app_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, role)
);
ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read app_user_roles" ON public.app_user_roles;
CREATE POLICY "org members read app_user_roles" ON public.app_user_roles
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "owners manage app_user_roles" ON public.app_user_roles;
CREATE POLICY "owners manage app_user_roles" ON public.app_user_roles
  FOR ALL TO authenticated
  USING (public.has_org_role(org_id, 'owner'::org_role))
  WITH CHECK (public.has_org_role(org_id, 'owner'::org_role));

CREATE OR REPLACE FUNCTION public.has_app_role(_org_id uuid, _user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_user_roles
    WHERE org_id = _org_id AND user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_gestor(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_org_role(_org_id, 'owner'::org_role)
    OR public.has_app_role(_org_id, auth.uid(), 'gestor'::public.app_role);
$$;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.current_user_org_id(),
  user_id uuid,
  user_email text,
  module text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  reason text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (org_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON public.audit_logs (org_id, module, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read audit_logs" ON public.audit_logs;
CREATE POLICY "org members read audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "org members insert audit_logs" ON public.audit_logs;
CREATE POLICY "org members insert audit_logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));

INSERT INTO public.app_user_roles (org_id, user_id, role)
SELECT org_id, user_id, 'gestor'::public.app_role FROM public.organization_members
WHERE role IN ('owner','manager') ON CONFLICT DO NOTHING;

INSERT INTO public.app_user_roles (org_id, user_id, role)
SELECT org_id, user_id, 'operacional'::public.app_role FROM public.organization_members
WHERE role = 'staff' ON CONFLICT DO NOTHING;