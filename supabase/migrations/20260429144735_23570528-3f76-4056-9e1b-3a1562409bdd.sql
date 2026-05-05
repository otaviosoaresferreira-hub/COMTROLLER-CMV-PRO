ALTER TABLE public.items DISABLE TRIGGER trg_prevent_system_item_update;
UPDATE public.items SET unit = 'KG' WHERE lower(name) IN ('água','agua') AND is_system = true;
ALTER TABLE public.items ENABLE TRIGGER trg_prevent_system_item_update;