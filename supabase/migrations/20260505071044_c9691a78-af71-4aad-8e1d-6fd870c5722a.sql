
-- =========================================
-- DRE: Channels, Revenue, Expenses
-- =========================================

CREATE TABLE public.revenue_channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  name TEXT NOT NULL,
  fee_percent NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.revenue_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read revenue_channels" ON public.revenue_channels
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write revenue_channels" ON public.revenue_channels
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TABLE public.revenue_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  channel_id UUID NOT NULL REFERENCES public.revenue_channels(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.revenue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read revenue_entries" ON public.revenue_entries
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write revenue_entries" ON public.revenue_entries
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE INDEX idx_revenue_entries_org_date ON public.revenue_entries(org_id, entry_date);

CREATE TABLE public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed','variable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read expense_categories" ON public.expense_categories
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write expense_categories" ON public.expense_categories
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed','variable')),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read expenses" ON public.expenses
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write expenses" ON public.expenses
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE INDEX idx_expenses_org_date ON public.expenses(org_id, expense_date);

-- =========================================
-- Checklists
-- =========================================

CREATE TABLE public.checklist_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  name TEXT NOT NULL,
  description TEXT,
  recurrence TEXT NOT NULL DEFAULT 'daily' CHECK (recurrence IN ('daily','weekly','monthly','one_off')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read checklist_templates" ON public.checklist_templates
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write checklist_templates" ON public.checklist_templates
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TABLE public.checklist_template_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read checklist_template_items" ON public.checklist_template_items
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write checklist_template_items" ON public.checklist_template_items
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE INDEX idx_checklist_template_items_template ON public.checklist_template_items(template_id, position);

CREATE TABLE public.checklist_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  assignee UUID,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read checklist_runs" ON public.checklist_runs
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write checklist_runs" ON public.checklist_runs
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE INDEX idx_checklist_runs_org_date ON public.checklist_runs(org_id, run_date);

CREATE TABLE public.checklist_run_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL DEFAULT current_user_org_id(),
  run_id UUID NOT NULL REFERENCES public.checklist_runs(id) ON DELETE CASCADE,
  template_item_id UUID REFERENCES public.checklist_template_items(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  is_done BOOLEAN NOT NULL DEFAULT false,
  done_at TIMESTAMPTZ,
  done_by UUID,
  photo_path TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_run_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read checklist_run_items" ON public.checklist_run_items
  FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "org members write checklist_run_items" ON public.checklist_run_items
  FOR ALL TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE INDEX idx_checklist_run_items_run ON public.checklist_run_items(run_id, position);

-- =========================================
-- Storage bucket for checklist photos
-- =========================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('checklist-photos', 'checklist-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {org_id}/{run_id}/{item_id}.jpg
CREATE POLICY "org members read checklist photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'checklist-photos'
  AND is_org_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "org members upload checklist photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'checklist-photos'
  AND is_org_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "org members update checklist photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'checklist-photos'
  AND is_org_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "org members delete checklist photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'checklist-photos'
  AND is_org_member(((storage.foldername(name))[1])::uuid)
);
