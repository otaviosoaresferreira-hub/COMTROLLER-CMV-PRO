-- Add monitor_daily flag to items
ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS monitor_daily boolean NOT NULL DEFAULT false;

-- Create shift_audits table (audit log only, does NOT affect stock)
CREATE TABLE IF NOT EXISTS public.shift_audits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_date date NOT NULL DEFAULT CURRENT_DATE,
  location_id uuid NOT NULL,
  shift_label text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shift_audit_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id uuid NOT NULL REFERENCES public.shift_audits(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  opening_qty numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0,
  sales_qty numeric NOT NULL DEFAULT 0,
  staff_qty numeric NOT NULL DEFAULT 0,
  waste_qty numeric NOT NULL DEFAULT 0,
  final_count_qty numeric NOT NULL DEFAULT 0,
  variance_qty numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_audits_date ON public.shift_audits(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audits_location ON public.shift_audits(location_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_entries_audit ON public.shift_audit_entries(audit_id);

-- Enable RLS
ALTER TABLE public.shift_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_audit_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read shift_audits" ON public.shift_audits FOR SELECT USING (true);
CREATE POLICY "public write shift_audits" ON public.shift_audits FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "public read shift_audit_entries" ON public.shift_audit_entries FOR SELECT USING (true);
CREATE POLICY "public write shift_audit_entries" ON public.shift_audit_entries FOR ALL USING (true) WITH CHECK (true);

-- Trigger to update updated_at
CREATE TRIGGER set_shift_audits_updated_at
BEFORE UPDATE ON public.shift_audits
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();