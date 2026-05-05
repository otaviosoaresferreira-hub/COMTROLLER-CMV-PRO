
-- Função auxiliar que retorna a primeira (mais antiga) organização do usuário logado.
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
  ORDER BY created_at ASC
  LIMIT 1
$$;

-- Aplicar como default em todas as tabelas multi-tenant.
ALTER TABLE public.items                  ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.invoices               ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.invoice_items          ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.stock_levels           ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.item_batches           ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.movements              ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.xml_item_mappings      ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.categories             ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.locations              ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.recipes                ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.recipe_ingredients     ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.recipe_categories      ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.location_item_factors  ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.inventory_counts       ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.inventory_count_items  ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.shift_audits           ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.shift_audit_entries    ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.sales_item_mappings    ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
ALTER TABLE public.operations             ALTER COLUMN org_id SET DEFAULT public.current_user_org_id();
