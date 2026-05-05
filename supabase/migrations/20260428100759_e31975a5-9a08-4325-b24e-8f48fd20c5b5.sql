ALTER TABLE public.movements DROP CONSTRAINT IF EXISTS movements_type_check;
ALTER TABLE public.movements ADD CONSTRAINT movements_type_check
  CHECK (type = ANY (ARRAY['entry'::text, 'exit'::text, 'loss'::text, 'adjustment'::text, 'transfer'::text, 'production_in'::text, 'production_out'::text]));