
-- Tabela de solicitações de ajuste manual (operacional -> gestor)
CREATE TABLE public.adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  requested_by uuid NOT NULL,
  requester_email text,
  kind text NOT NULL, -- 'stock_adjustment' | 'batch_edit' | 'expiry' | 'batch_expiry'
  item_id uuid,
  batch_id uuid,
  location_id uuid,
  current_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  justification text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by uuid,
  reviewer_email text,
  review_note text,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX adjustment_requests_org_status_idx
  ON public.adjustment_requests (org_id, status, created_at DESC);

ALTER TABLE public.adjustment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read adjustment_requests"
  ON public.adjustment_requests FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY "org members write adjustment_requests"
  ON public.adjustment_requests FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE TRIGGER trg_adjustment_requests_updated_at
  BEFORE UPDATE ON public.adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
