-- Operations table
CREATE TABLE public.operations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read operations" ON public.operations FOR SELECT USING (true);
CREATE POLICY "public write operations" ON public.operations FOR ALL USING (true) WITH CHECK (true);

-- Link movements to an operation (optional)
ALTER TABLE public.movements ADD COLUMN operation_id UUID;
CREATE INDEX idx_movements_operation ON public.movements(operation_id);