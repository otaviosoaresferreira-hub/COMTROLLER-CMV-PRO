-- Remove possíveis duplicatas mantendo a entrada mais recente
DELETE FROM public.xml_item_mappings a
USING public.xml_item_mappings b
WHERE a.id <> b.id
  AND lower(trim(a.xml_name)) = lower(trim(b.xml_name))
  AND a.updated_at < b.updated_at;

-- Índice único case-insensitive em xml_name para suportar upsert
CREATE UNIQUE INDEX IF NOT EXISTS xml_item_mappings_xml_name_unique
  ON public.xml_item_mappings (lower(trim(xml_name)));