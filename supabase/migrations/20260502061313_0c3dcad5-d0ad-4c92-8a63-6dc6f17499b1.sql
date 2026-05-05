-- Tabela de tags adicionais de categoria por item (multi-categoria)
CREATE TABLE IF NOT EXISTS public.item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT current_user_org_id(),
  item_id uuid NOT NULL,
  category_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_item_categories_item ON public.item_categories(item_id);
CREATE INDEX IF NOT EXISTS idx_item_categories_category ON public.item_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_item_categories_org ON public.item_categories(org_id);

ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read item_categories"
ON public.item_categories FOR SELECT TO authenticated
USING (is_org_member(org_id));

CREATE POLICY "org members write item_categories"
ON public.item_categories FOR ALL TO authenticated
USING (is_org_member(org_id))
WITH CHECK (is_org_member(org_id));