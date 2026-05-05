
CREATE TABLE public.inventory_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  count_id uuid NOT NULL,
  item_id uuid NOT NULL,
  central_location_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('shortage','surplus')),
  expected_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric NOT NULL DEFAULT 0,
  delta_qty numeric NOT NULL DEFAULT 0,
  display_unit text NOT NULL DEFAULT 'KG',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','loss','identified')),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_disc_org_status ON public.inventory_discrepancies(org_id, status);
CREATE INDEX idx_inv_disc_item ON public.inventory_discrepancies(item_id);

ALTER TABLE public.inventory_discrepancies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read inv_disc" ON public.inventory_discrepancies
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write inv_disc" ON public.inventory_discrepancies
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TRIGGER trg_inv_disc_updated BEFORE UPDATE ON public.inventory_discrepancies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.inventory_discrepancy_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  discrepancy_id uuid NOT NULL REFERENCES public.inventory_discrepancies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','counted','not_found')),
  counted_qty numeric,
  counted_at timestamptz,
  counted_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(discrepancy_id, location_id)
);

CREATE INDEX idx_inv_disc_audit_loc_status ON public.inventory_discrepancy_audits(location_id, status);
CREATE INDEX idx_inv_disc_audit_disc ON public.inventory_discrepancy_audits(discrepancy_id);

ALTER TABLE public.inventory_discrepancy_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read inv_disc_audits" ON public.inventory_discrepancy_audits
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write inv_disc_audits" ON public.inventory_discrepancy_audits
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TRIGGER trg_inv_disc_audit_updated BEFORE UPDATE ON public.inventory_discrepancy_audits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
