import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";

/**
 * Recupera o org_id da organização principal do usuário autenticado.
 * Retorna `null` enquanto carrega ou se o usuário não tem organização.
 *
 * Use este hook sempre que precisar inserir registros em tabelas com RLS
 * baseada em `is_org_member(org_id)` — passar o org_id explicitamente
 * evita que o default da coluna (org "fictícia" `00000000-…-001`) viole a
 * política e dispare "new row violates row-level security policy".
 */
export function useOrgId(): string | null {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["current-org-id", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("org_id, created_at")
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw error;
      const existingOrgId = (data?.[0]?.org_id as string | undefined) ?? null;
      if (existingOrgId) return existingOrgId;

      const { data: orgId, error: ensureError } = await supabase.rpc(
        "ensure_my_primary_organization",
      );
      if (ensureError) throw ensureError;
      return (orgId as string | null) ?? null;
    },
  });
  return data ?? null;
}
