
-- 1) suppliers
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  name text NOT NULL,
  document text,
  whatsapp_phone text,
  contact_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read suppliers"
  ON public.suppliers FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY "org members write suppliers"
  ON public.suppliers FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) item_suppliers (vínculo)
CREATE TABLE public.item_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  item_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  is_preferred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, item_id, supplier_id)
);

ALTER TABLE public.item_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read item_suppliers"
  ON public.item_suppliers FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY "org members write item_suppliers"
  ON public.item_suppliers FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE INDEX idx_item_suppliers_item ON public.item_suppliers(org_id, item_id);
CREATE INDEX idx_item_suppliers_supplier ON public.item_suppliers(org_id, supplier_id);

-- 3) supplier_id em invoices
ALTER TABLE public.invoices
  ADD COLUMN supplier_id uuid REFERENCES public.suppliers(id);

CREATE INDEX idx_invoices_supplier ON public.invoices(org_id, supplier_id);

-- 4) Configurações da organização (suprimentos)
ALTER TABLE public.organizations
  ADD COLUMN buyer_name text,
  ADD COLUMN whatsapp_greeting text,
  ADD COLUMN target_coverage_days integer NOT NULL DEFAULT 7;

-- 5) Importa fornecedores existentes a partir das notas processadas
INSERT INTO public.suppliers (org_id, name, document)
SELECT DISTINCT i.org_id, trim(i.supplier_name), i.supplier_doc
  FROM public.invoices i
 WHERE i.supplier_name IS NOT NULL
   AND trim(i.supplier_name) <> ''
ON CONFLICT (org_id, name) DO NOTHING;

-- Conecta as notas existentes ao fornecedor recém-criado
UPDATE public.invoices inv
   SET supplier_id = s.id
  FROM public.suppliers s
 WHERE inv.supplier_id IS NULL
   AND inv.org_id = s.org_id
   AND lower(trim(inv.supplier_name)) = lower(trim(s.name));

-- Vincula automaticamente cada item a fornecedores já presentes em suas NFs
INSERT INTO public.item_suppliers (org_id, item_id, supplier_id)
SELECT DISTINCT ii.org_id, ii.item_id, inv.supplier_id
  FROM public.invoice_items ii
  JOIN public.invoices inv ON inv.id = ii.invoice_id
 WHERE ii.item_id IS NOT NULL
   AND inv.supplier_id IS NOT NULL
ON CONFLICT (org_id, item_id, supplier_id) DO NOTHING;
