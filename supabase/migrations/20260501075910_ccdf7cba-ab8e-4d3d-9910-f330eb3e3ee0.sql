
-- 1. invoices.access_key
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_access_key_key;
DROP INDEX IF EXISTS public.invoices_access_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_access_key_unique
  ON public.invoices(org_id, access_key) WHERE access_key IS NOT NULL;

-- 2. invoices.nfe_key
DROP INDEX IF EXISTS public.invoices_nfe_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_nfe_key_unique
  ON public.invoices(org_id, nfe_key) WHERE nfe_key IS NOT NULL;

-- 3. invoices: número
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_unique
  ON public.invoices(org_id, COALESCE(supplier_doc,''), COALESCE(series,''), number)
  WHERE number IS NOT NULL;

-- 4. xml_item_mappings escopado por org
DROP INDEX IF EXISTS public.xml_item_mappings_xml_name_key;
DROP INDEX IF EXISTS public.xml_item_mappings_xml_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS xml_item_mappings_org_xml_name_unique
  ON public.xml_item_mappings(org_id, lower(trim(xml_name)));

-- 5. Limpar dados órfãos da org fictícia (desabilitando triggers de proteção)
ALTER TABLE public.items       DISABLE TRIGGER USER;
ALTER TABLE public.categories  DISABLE TRIGGER USER;
ALTER TABLE public.locations   DISABLE TRIGGER USER;

DELETE FROM public.stock_levels         WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.item_batches         WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.invoice_items        WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.invoices             WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.xml_item_mappings    WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.location_item_factors WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.movements            WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.recipe_ingredients   WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.recipes              WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.items                WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.categories           WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.locations            WHERE org_id='00000000-0000-0000-0000-000000000001';
DELETE FROM public.organizations        WHERE id='00000000-0000-0000-0000-000000000001';

ALTER TABLE public.items       ENABLE TRIGGER USER;
ALTER TABLE public.categories  ENABLE TRIGGER USER;
ALTER TABLE public.locations   ENABLE TRIGGER USER;

-- 6. Remover defaults de org_id
ALTER TABLE public.items                  ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.invoices               ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.invoice_items          ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.stock_levels           ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.item_batches           ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.movements              ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.xml_item_mappings      ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.categories             ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.locations              ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.recipes                ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.recipe_ingredients     ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.recipe_categories      ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.location_item_factors  ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.inventory_counts       ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.inventory_count_items  ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.shift_audits           ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.shift_audit_entries    ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.sales_item_mappings    ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.operations             ALTER COLUMN org_id DROP DEFAULT;
