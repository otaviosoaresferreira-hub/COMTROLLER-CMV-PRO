CREATE OR REPLACE FUNCTION public.list_active_batches(_item_id uuid)
 RETURNS TABLE(id uuid, lot_number text, initial_qty numeric, current_qty numeric, unit_cost numeric, avg_weight_g numeric, expiry_date date, created_at timestamp with time zone, invoice_id uuid, edited_at timestamp with time zone, reverted_at timestamp with time zone, source text, movement_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, lot_number, initial_qty, current_qty, unit_cost, avg_weight_g, expiry_date, created_at, invoice_id, edited_at, reverted_at, source, movement_id
  FROM public.item_batches
  WHERE item_id = _item_id AND public.is_org_member(org_id)
  ORDER BY (expiry_date IS NULL), expiry_date ASC, created_at ASC;
$function$;