-- Garante coluna category_id em items (já existe; mantém)
-- Cria tabelas de Notas Fiscais

CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  number TEXT,
  series TEXT,
  supplier_name TEXT,
  supplier_doc TEXT,
  access_key TEXT UNIQUE,
  issue_date DATE,
  total_value NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'processed'
  source TEXT NOT NULL DEFAULT 'xml',   -- 'xml' | 'manual'
  xml_raw TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  xml_name TEXT NOT NULL,
  xml_unit TEXT,
  xml_quantity NUMERIC NOT NULL DEFAULT 0,
  xml_unit_price NUMERIC NOT NULL DEFAULT 0,
  xml_total_price NUMERIC NOT NULL DEFAULT 0,
  multiplier NUMERIC NOT NULL DEFAULT 1, -- ex: 1 fardo = 12 un
  stock_quantity NUMERIC NOT NULL DEFAULT 0, -- xml_quantity * multiplier
  stock_unit_cost NUMERIC NOT NULL DEFAULT 0, -- xml_total_price / stock_quantity
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_item ON public.invoice_items(item_id);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read invoices" ON public.invoices FOR SELECT USING (true);
CREATE POLICY "public write invoices" ON public.invoices FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "public read invoice_items" ON public.invoice_items FOR SELECT USING (true);
CREATE POLICY "public write invoice_items" ON public.invoice_items FOR ALL USING (true) WITH CHECK (true);

-- Trigger updated_at em invoices
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed das categorias padrão
INSERT INTO public.categories (name)
SELECT v FROM (VALUES ('Proteínas'), ('Secos'), ('Hortifruti'), ('Laticínios'), ('Limpeza'), ('Produção Própria')) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE lower(c.name) = lower(v));