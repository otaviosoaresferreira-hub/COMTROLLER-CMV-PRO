CREATE TABLE public.xml_item_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  xml_name TEXT NOT NULL,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  multiplier NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX xml_item_mappings_xml_name_key ON public.xml_item_mappings (lower(xml_name));

ALTER TABLE public.xml_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read xml_item_mappings"
ON public.xml_item_mappings FOR SELECT USING (true);

CREATE POLICY "public write xml_item_mappings"
ON public.xml_item_mappings FOR ALL USING (true) WITH CHECK (true);