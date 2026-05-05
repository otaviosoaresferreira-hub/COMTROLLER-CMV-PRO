REVOKE EXECUTE ON FUNCTION public.ensure_uncategorized_category(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reorganize_org_categories(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_system_category_delete() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_system_category_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_system_item_delete() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_system_item_update() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ensure_uncategorized_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorganize_org_categories(uuid) TO authenticated;