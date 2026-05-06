import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, ArrowRight, Package, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildLocationTree,
  LOCATION_TYPE_META,
  SHARED_LOCATION_META,
  isSharedLocation,
  type LocationNode,
  type LocationTreeNode,
} from "@/lib/location-hierarchy";
import { cn } from "@/lib/utils";
import { DiscrepancyPanel } from "@/components/discrepancy-panel";

export const Route = createFileRoute("/inventario")({
  head: () => ({
    meta: [
      { title: "Inventário — Controller CMV Pro" },
      { name: "description", content: "Contagens de inventário cego por local, com seleção em qualquer nível da hierarquia." },
    ],
  }),
  component: InventarioHub,
});

function InventarioHub() {
  const matchRoute = useMatchRoute();
  const isChildActive = !!matchRoute({ to: "/inventario/$locationId" });

  if (isChildActive) {
    return <Outlet />;
  }

  return <InventarioHubContent />;
}

function InventarioHubContent() {
  const { data: locations, isLoading: isLoadingLoc } = useQuery({
    queryKey: ["inventario-locations-tree"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,operation_type,parent_id,location_type,stock_mode,is_shared")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationNode[];
    },
  });

  const { data: itemsCount, isLoading: isLoadingItems } = useQuery({
    queryKey: ["inventario-items-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_free", false);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const tree = useMemo(() => buildLocationTree(locations ?? []), [locations]);
  const isLoading = isLoadingLoc || isLoadingItems;
  const hasItems = (itemsCount ?? 0) > 0;
  const hasLocations = (locations?.length ?? 0) > 0;
  const setupIncomplete = !isLoading && (!hasItems || !hasLocations);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventário Global</h1>
          <p className="text-sm text-muted-foreground">
            Selecione qualquer nível da hierarquia. Todos os itens vinculados ao escopo
            serão exibidos — inclusive com saldo zero.
          </p>
        </div>
      </header>

      <div className="mb-6">
        <DiscrepancyPanel />
      </div>

      {setupIncomplete && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Configuração inicial pendente</CardTitle>
            <CardDescription>
              Antes de realizar inventários, complete o cadastro básico da sua organização.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasItems && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <Package className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Cadastre seus itens</p>
                    <p className="text-xs text-muted-foreground">
                      Importe uma nota fiscal (XML) ou cadastre manualmente no Estoque Central.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" variant="default">
                  <Link to="/central" search={{} as never}>Ir ao Estoque</Link>
                </Button>
              </div>
            )}
            {!hasLocations && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Crie suas localizações</p>
                    <p className="text-xs text-muted-foreground">
                      Centro de Distribuição, Unidades e Operações onde haverá contagem.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" variant="default">
                  <Link to="/configuracoes">Cadastrar localizações</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando locais...</p>
      ) : tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma localização cadastrada.</p>
      ) : (
        <div className="space-y-2">
          {tree.map((node) => (
            <LocationTreeRow key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Inventário cego: você digita apenas o que contou. A comparação com o saldo teórico aparece
        somente após confirmar.
      </p>
    </div>
  );
}

function LocationTreeRow({
  node,
  depth,
}: {
  node: LocationTreeNode<LocationNode>;
  depth: number;
}) {
  const meta = LOCATION_TYPE_META[node.location_type];
  const Icon = meta.icon;
  const childCount = node.children.length;

  return (
    <div className="space-y-2">
      <Link
        to="/inventario/$locationId"
        params={{ locationId: node.id }}
        className={cn(
          "flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent",
        )}
        style={{ marginLeft: depth * 20 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
              meta.tone,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium capitalize">{node.name}</p>
            <p className="text-xs text-muted-foreground">{meta.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {childCount > 0 && (
            <Badge variant="secondary" className="font-normal">
              {childCount} sub-local{childCount === 1 ? "" : "is"}
            </Badge>
          )}
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Link>
      {childCount > 0 && (
        <div className="space-y-2">
          {node.children.map((child) => (
            <LocationTreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
