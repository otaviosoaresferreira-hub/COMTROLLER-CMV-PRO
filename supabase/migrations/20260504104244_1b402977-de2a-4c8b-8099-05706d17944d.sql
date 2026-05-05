-- 1) Modo de estoque por operação (Tradicional vs Venda Direta)
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS stock_mode text NOT NULL DEFAULT 'traditional'
  CHECK (stock_mode IN ('traditional', 'direct'));

COMMENT ON COLUMN public.locations.stock_mode IS
  'traditional = baixa no saldo local da operação; direct = baixa direta no Estoque Central';

-- 2) Overrides por (operação, item) para desativar a baixa automática
--    (ex.: trocas, bebidas que não devem sair do Central automaticamente)
CREATE TABLE IF NOT EXISTS public.location_item_stock_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL DEFAULT current_user_org_id(),
  location_id  uuid NOT NULL,
  item_id      uuid NOT NULL,
  skip_auto_deduction boolean NOT NULL DEFAULT true,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, item_id)
);

ALTER TABLE public.location_item_stock_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read location_item_stock_overrides"
  ON public.location_item_stock_overrides FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY "org members write location_item_stock_overrides"
  ON public.location_item_stock_overrides FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE TRIGGER trg_loc_item_overrides_updated_at
  BEFORE UPDATE ON public.location_item_stock_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_loc_item_overrides_loc
  ON public.location_item_stock_overrides (location_id);
CREATE INDEX IF NOT EXISTS idx_loc_item_overrides_item
  ON public.location_item_stock_overrides (item_id);