// Helpers para a hierarquia de Localizações (CD → Unidade → Operação).
//
// Backend mantém duas colunas: location_type ∈ {cd|unit|operation} e
// parent_id (auto-FK). Esta camada centraliza nomenclatura e regras
// de aninhamento usadas pela UI para evitar divergência entre telas.

import { Warehouse, Building2, MapPin, Soup, type LucideIcon } from "lucide-react";

export type LocationType = "cd" | "unit" | "operation";

export type LocationNode = {
  id: string;
  name: string;
  parent_id: string | null;
  location_type: LocationType;
  is_shared?: boolean | null;
  // Demais campos passam adiante intactos.
  // Tipado como Record<string, unknown> para não acoplar à shape exata.
  [key: string]: unknown;
};

export const LOCATION_TYPE_META: Record<
  LocationType,
  { label: string; short: string; icon: LucideIcon; tone: string }
> = {
  cd: {
    label: "Centro de Distribuição",
    short: "CD",
    icon: Warehouse,
    tone:
      "border-primary/40 bg-primary/10 text-primary",
  },
  unit: {
    label: "Unidade / Franquia",
    short: "Unidade",
    icon: Building2,
    tone:
      "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  operation: {
    label: "Operação / Setor",
    short: "Operação",
    icon: MapPin,
    tone:
      "border-accent/40 bg-accent/40 text-accent-foreground",
  },
};

/** True quando `parentType` é um pai válido para `childType`. */
export function isValidParent(
  childType: LocationType,
  parentType: LocationType | null,
): boolean {
  if (childType === "cd") return parentType === null;
  if (childType === "unit") return parentType === "cd";
  // operation
  return parentType === "cd" || parentType === "unit";
}

/** Lista os tipos que PODEM ser pai de um filho do tipo informado. */
export function allowedParentTypes(childType: LocationType): LocationType[] {
  if (childType === "cd") return [];
  if (childType === "unit") return ["cd"];
  return ["cd", "unit"];
}

/** Devolve a cadeia de ancestrais (do mais próximo ao mais distante). */
export function getAncestors<T extends Pick<LocationNode, "id" | "parent_id">>(
  node: T | null | undefined,
  all: readonly T[],
): T[] {
  if (!node) return [];
  const byId = new Map(all.map((n) => [n.id, n] as const));
  const out: T[] = [];
  let current: T | undefined = node;
  const seen = new Set<string>();
  while (current?.parent_id) {
    if (seen.has(current.parent_id)) break; // proteção contra ciclo
    seen.add(current.parent_id);
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

/** Devolve o caminho do nó (raiz → ele mesmo) como array. */
export function getBreadcrumb<T extends Pick<LocationNode, "id" | "parent_id" | "name">>(
  node: T | null | undefined,
  all: readonly T[],
): T[] {
  if (!node) return [];
  return [...getAncestors(node, all).reverse(), node];
}

export type LocationTreeNode<T extends LocationNode = LocationNode> = T & {
  children: LocationTreeNode<T>[];
};

/**
 * Monta árvore aninhada (raízes = nós sem pai). Estável: ordena por nome.
 * Nós órfãos (parent_id apontando para id inexistente) viram raízes para
 * não desaparecerem da UI.
 */
export function buildLocationTree<T extends LocationNode>(
  locations: readonly T[],
): LocationTreeNode<T>[] {
  const byId = new Map<string, LocationTreeNode<T>>();
  locations.forEach((l) => {
    byId.set(l.id, { ...(l as T), children: [] });
  });
  const roots: LocationTreeNode<T>[] = [];
  byId.forEach((node) => {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortRec = (nodes: LocationTreeNode<T>[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
