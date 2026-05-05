
-- Ensure primary keys exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoices'::regclass AND contype='p') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_items'::regclass AND contype='p') THEN
    ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);
  END IF;
END $$;

ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_org_id ON public.invoice_items(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON public.invoices(org_id);

CREATE POLICY "invoices_select_own_org" ON public.invoices
  FOR SELECT USING (org_id = public.current_user_org_id());
CREATE POLICY "invoices_insert_own_org" ON public.invoices
  FOR INSERT WITH CHECK (org_id = public.current_user_org_id());
CREATE POLICY "invoices_update_own_org" ON public.invoices
  FOR UPDATE USING (org_id = public.current_user_org_id())
  WITH CHECK (org_id = public.current_user_org_id());
CREATE POLICY "invoices_delete_own_org" ON public.invoices
  FOR DELETE USING (org_id = public.current_user_org_id());

CREATE POLICY "invoice_items_select_own_org" ON public.invoice_items
  FOR SELECT USING (org_id = public.current_user_org_id());
CREATE POLICY "invoice_items_insert_own_org" ON public.invoice_items
  FOR INSERT WITH CHECK (org_id = public.current_user_org_id());
CREATE POLICY "invoice_items_update_own_org" ON public.invoice_items
  FOR UPDATE USING (org_id = public.current_user_org_id())
  WITH CHECK (org_id = public.current_user_org_id());
CREATE POLICY "invoice_items_delete_own_org" ON public.invoice_items
  FOR DELETE USING (org_id = public.current_user_org_id());
