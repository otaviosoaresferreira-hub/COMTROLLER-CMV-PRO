DROP POLICY IF EXISTS "any auth can create org" ON public.organizations;

REVOKE EXECUTE ON FUNCTION public.setup_new_organization(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_suggested_categories(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_user_primary_organization(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_my_primary_organization() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_org_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_organization_created() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, public.org_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_org_ids() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.seed_suggested_categories(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_primary_organization() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, public.org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated;