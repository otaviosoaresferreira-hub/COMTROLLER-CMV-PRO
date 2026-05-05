CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.ensure_my_primary_organization()
$function$;

REVOKE EXECUTE ON FUNCTION public.current_user_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;