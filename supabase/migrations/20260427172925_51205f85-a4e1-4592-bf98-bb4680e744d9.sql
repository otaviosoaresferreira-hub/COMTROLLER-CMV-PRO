ALTER TABLE public.ingredients RENAME TO items;
ALTER TABLE public.ingredient_batches RENAME TO item_batches;
ALTER TABLE public.location_ingredient_factors RENAME TO location_item_factors;
ALTER TABLE public.xml_ingredient_mappings RENAME TO xml_item_mappings;

ALTER TABLE public.stock_levels RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.movements RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.inventory_count_items RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.invoice_items RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.recipe_ingredients RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.shift_audit_entries RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.item_batches RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.location_item_factors RENAME COLUMN ingredient_id TO item_id;
ALTER TABLE public.xml_item_mappings RENAME COLUMN ingredient_id TO item_id;