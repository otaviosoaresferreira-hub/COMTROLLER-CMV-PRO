import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgId } from "@/lib/use-org-id";

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  is_system: boolean;
};

export type VisibleCategory = Category & { hidden: boolean };

/** Carrega categorias da org + IDs ocultas. */
export function useCategoriesWithHidden() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ["categories-full", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [catRes, hidRes] = await Promise.all([
        supabase
          .from("categories")
          .select("id,name,parent_id,is_system")
          .eq("org_id", orgId!)
          .order("name"),
        supabase
          .from("hidden_system_categories")
          .select("category_id")
          .eq("org_id", orgId!),
      ]);
      if (catRes.error) throw catRes.error;
      if (hidRes.error) throw hidRes.error;
      const hiddenIds = new Set(
        (hidRes.data ?? []).map((r) => r.category_id as string),
      );
      const all = (catRes.data ?? []) as Category[];
      return {
        all,
        hiddenIds,
        visible: all.filter((c) => !hiddenIds.has(c.id)),
      };
    },
  });
}

/** Constrói o caminho "Pai > Filha" a partir de uma categoria. */
export function categoryPath(
  categoryId: string | null | undefined,
  all: Pick<Category, "id" | "name" | "parent_id">[],
): string {
  if (!categoryId) return "";
  const map = new Map(all.map((c) => [c.id, c]));
  const node = map.get(categoryId);
  if (!node) return "";
  if (!node.parent_id) return node.name;
  const parent = map.get(node.parent_id);
  return parent ? `${parent.name} > ${node.name}` : node.name;
}

/** Separa pais e filhas a partir de uma lista de categorias visíveis. */
export function splitParentsChildren<T extends Pick<Category, "id" | "parent_id">>(
  list: T[],
) {
  const parents = list.filter((c) => !c.parent_id);
  const childrenByParent = new Map<string, T[]>();
  list.forEach((c) => {
    if (c.parent_id) {
      const arr = childrenByParent.get(c.parent_id) ?? [];
      arr.push(c);
      childrenByParent.set(c.parent_id, arr);
    }
  });
  return { parents, childrenByParent };
}
