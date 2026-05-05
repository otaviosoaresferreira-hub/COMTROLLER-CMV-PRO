import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { useOrgId } from "./use-org-id";
import { useManagerMode } from "./manager-mode";

export type AppRole = "gestor" | "operacional";

/**
 * Determina o papel efetivo do usuário na organização atual.
 * Regra:
 *   - Se o "Modo Gestor" (PIN) estiver ativo → 'gestor'.
 *   - Se houver linha em app_user_roles com role='gestor' → 'gestor'.
 *   - Se for owner/manager em organization_members → 'gestor'.
 *   - Caso contrário → 'operacional'.
 */
export function useAppRole(): {
  role: AppRole;
  isGestor: boolean;
  isOperacional: boolean;
  loading: boolean;
} {
  const { user } = useAuth();
  const orgId = useOrgId();
  const { isManager } = useManagerMode();

  const { data, isLoading } = useQuery({
    queryKey: ["app-role", user?.id, orgId],
    enabled: !!user && !!orgId,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: roles }, { data: member }] = await Promise.all([
        supabase
          .from("app_user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("org_id", orgId!),
        supabase
          .from("organization_members")
          .select("role")
          .eq("user_id", user!.id)
          .eq("org_id", orgId!)
          .maybeSingle(),
      ]);
      const isGestorByRole = (roles ?? []).some((r) => r.role === "gestor");
      const isGestorByOrg =
        member?.role === "owner" || member?.role === "manager";
      return isGestorByRole || isGestorByOrg ? "gestor" : "operacional";
    },
  });

  const baseRole: AppRole = data ?? "operacional";
  const role: AppRole = isManager ? "gestor" : baseRole;
  return {
    role,
    isGestor: role === "gestor",
    isOperacional: role === "operacional",
    loading: isLoading,
  };
}
