ALTER TABLE public.items RENAME TO ingredients;

-- Rename FK columns that reference items.id to ingredient_id for consistency
ALTER TABLE public.stock_levels RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.movements RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.inventory_count_items RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.invoice_items RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.item_batches RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.item_batches RENAME TO ingredient_batches;
ALTER TABLE public.location_item_factors RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.location_item_factors RENAME TO location_ingredient_factors;
ALTER TABLE public.recipe_ingredients RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.shift_audit_entries RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.xml_item_mappings RENAME COLUMN item_id TO ingredient_id;
ALTER TABLE public.xml_item_mappings RENAME TO xml_ingredient_mappings;