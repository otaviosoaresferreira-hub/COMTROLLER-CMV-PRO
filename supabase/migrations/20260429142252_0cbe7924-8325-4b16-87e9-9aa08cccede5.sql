-- Tabela para vincular nomes de produtos do CSV de vendas (ConnectPlug etc)
-- a fichas técnicas (recipes), permitindo reuso futuro do mapeamento.
CREATE TABLE public.sales_item_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  source_name text NOT NULL,
  recipe_id uuid NOT NULL,
  multiplier numeric NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_name)
);

ALTER TABLE public.sales_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read sales_item_mappings"
ON public.sales_item_mappings FOR SELECT
TO authenticated
USING (is_org_member(org_id));

CREATE POLICY "org members write sales_item_mappings"
ON public.sales_item_mappings FOR ALL
TO authenticated
USING (is_org_member(org_id))
WITH CHECK (is_org_member(org_id));

CREATE TRIGGER set_updated_at_sales_item_mappings
BEFORE UPDATE ON public.sales_item_mappings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_sales_item_mappings_org_name ON public.sales_item_mappings (org_id, lower(source_name));