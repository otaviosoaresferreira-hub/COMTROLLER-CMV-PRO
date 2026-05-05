import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useManagerMode } from "@/lib/manager-mode";
import { NewDestinationDialog } from "@/components/new-destination-dialog";
import { ProductionDialog } from "@/components/production-dialog";
import { Badge } from "@/components/ui/badge";
import { Warehouse, MapPin, ClipboardList, AlertTriangle, ChefHat, Zap, Building2 } from "lucide-react";
import {
  buildLocationTree,
  LOCATION_TYPE_META,
  type LocationType,
  type LocationNode,
} from "@/lib/location-hierarchy";

export const Route = createFileRoute("/")({
  component: Index,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function Index() {
  const { isManager } = useManagerMode();

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [items, locations, stock] = await Promise.all([
        supabase.from("items").select("*"),
        supabase.from("locations").select("*").order("name"),
        supabase.from("stock_levels").select("*"),
      ]);
      if (items.error) throw items.error;
      if (locations.error) throw locations.error;
      if (stock.error) throw stock.error;
      return {
        items: items.data,
        locations: locations.data,
        stock: stock.data,
      };
    },
  });

  // Estoque Central: prioriza nome (legado), com fallback para o primeiro CD.
  const central = useMemo(() => {
    if (!data) return undefined;
    return (
      data.locations.find((l) => l.name.toLowerCase().includes("central")) ??
      data.locations.find((l) => l.location_type === "cd")
    );
  }, [data]);

  const destinations = useMemo(
    () => data?.locations.filter((l) => l.id !== central?.id) ?? [],
    [data, central],
  );

  // Árvore hierárquica dos demais locais (Unidades, Operações, e CDs adicionais).
  const tree = useMemo(
    () => buildLocationTree(destinations as LocationNode[]),
    [destinations],
  );

  const centralStats = useMemo(() => {
    if (!data || !central)
      return { totalItems: 0, totalUnits: 0, totalValue: 0, lowStock: 0 };
    const levels = data.stock.filter((s) => s.location_id === central.id);
    const totalUnits = levels.reduce((acc, l) => acc + Number(l.current_stock), 0);
    const totalItems = levels.filter((l) => Number(l.current_stock) > 0).length;
    const lowStock = levels.filter(
      (l) => Number(l.current_stock) > 0 && Number(l.current_stock) <= 5,
    ).length;
    const totalValue = levels.reduce((acc, l) => {
      const item = data.items.find((i) => i.id === l.item_id);
      return acc + Number(l.current_stock) * Number(item?.cost_price ?? 0);
    }, 0);
    return { totalItems, totalUnits, totalValue, lowStock };
  }, [data, central]);

  // Itens abaixo do estoque mínimo (considerando APENAS o Estoque Central)
  const itemsToBuy = useMemo(() => {
    if (!data) return [] as { id: string; name: string; quantity: number; minStock: number; unit: string }[];
    if (!central) return [];
    return data.items
      .filter((i) => Number(i.min_stock ?? 0) > 0)
      .map((i) => {
        const centralQty = data.stock
          .filter((s) => s.item_id === i.id && s.location_id === central.id)
          .reduce((acc, s) => acc + Number(s.current_stock), 0);
        return {
          id: i.id,
          name: i.name,
          quantity: centralQty,
          minStock: Number(i.min_stock ?? 0),
          unit: i.unit,
        };
      })
      .filter((r) => r.quantity <= r.minStock)
      .sort((a, b) => a.quantity - b.quantity);
  }, [data, central]);

  const destinationStats = (loc: { id: string; stock_mode?: string | null }) => {
    if (!data) return { items: 0, units: 0, value: 0, mirrorsCentral: false };
    // Venda Direta: o saldo "real" desta operação é o do Central — exibimos
    // espelhado para evitar confusão (a operação local fica sempre zerada).
    const isDirect = (loc.stock_mode ?? "traditional") === "direct";
    const sourceId = isDirect && central ? central.id : loc.id;
    const levels = data.stock.filter(
      (s) => s.location_id === sourceId && Number(s.current_stock) > 0,
    );
    const value = levels.reduce((acc, l) => {
      const item = data.items.find((i) => i.id === l.item_id);
      return acc + Number(l.current_stock) * Number(item?.cost_price ?? 0);
    }, 0);
    return {
      items: levels.length,
      units: levels.reduce((acc, l) => acc + Number(l.current_stock), 0),
      value,
      mirrorsCentral: isDirect,
    };
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                Controller CMV Pro
              </h1>
              <p className="text-xs leading-tight text-muted-foreground">
                Gestão de operações
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-4">
        {/* ESTOQUE CENTRAL — card de destaque */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ponto de partida
            </h2>
          </div>

          <Link
            to="/central" search={{ cat: undefined } as never}
            className="block overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground shadow-lg transition active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
                  <Warehouse className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide opacity-80">
                    Estoque Principal
                  </p>
                  <h3 className="text-xl font-bold leading-tight">
                    {central?.name ?? "Estoque Central"}
                  </h3>
                </div>
              </div>
              <Badge className="border-white/20 bg-white/15 text-white hover:bg-white/20">
                Entradas
              </Badge>
            </div>

            <p className="mt-3 text-xs opacity-80">
              Todas as mercadorias entram aqui antes de serem distribuídas.
            </p>

            <div className={`mt-4 grid gap-3 border-t border-white/15 pt-4 ${isManager ? "grid-cols-3" : "grid-cols-2"}`}>
              <div>
                <p className="text-[10px] uppercase tracking-wide opacity-75">
                  Itens
                </p>
                <p className="text-lg font-bold tabular-nums">
                  {centralStats.totalItems}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide opacity-75">
                  Alertas
                </p>
                <p className="text-lg font-bold tabular-nums">
                  {centralStats.lowStock}
                </p>
              </div>
              {isManager && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide opacity-75">
                    Valor Total
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {fmtBRL(centralStats.totalValue)}
                  </p>
                </div>
              )}
            </div>
          </Link>
        </section>

        {/* REGISTRAR PRODUÇÃO — destaque logo após Estoque Central */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Módulo de Produção
            </h2>
            <Link
              to="/producao"
              className="text-[11px] uppercase tracking-wide text-primary hover:underline"
            >
              ver histórico
            </Link>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <ChefHat className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Ficha técnica → estoque
                </p>
                <h3 className="text-base font-semibold leading-tight">
                  Registrar Produção
                </h3>
                <p className="text-xs text-muted-foreground">
                  Baixa proporcional dos insumos e entrada do item pronto.
                </p>
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <ProductionDialog triggerClassName="w-full h-11" />
            </div>
          </div>
        </section>

        {/* ITENS PARA COMPRA */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Itens para Compra
            </h2>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Abaixo do mínimo
            </span>
          </div>

          <Link
            to="/central" search={{ cat: undefined } as never}
            className="block rounded-2xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={
                    itemsToBuy.length > 0
                      ? "grid h-12 w-12 place-items-center rounded-xl bg-warning/15 text-warning-foreground"
                      : "grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"
                  }
                >
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Reposição necessária
                  </p>
                  <h3 className="text-base font-semibold leading-tight">
                    {itemsToBuy.length === 0
                      ? "Tudo em dia"
                      : `${itemsToBuy.length} ${itemsToBuy.length === 1 ? "item" : "itens"}`}
                  </h3>
                </div>
              </div>
              <div className="text-3xl font-bold tabular-nums">
                {itemsToBuy.length}
              </div>
            </div>

            {itemsToBuy.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                {itemsToBuy.slice(0, 3).map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-medium">{it.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {it.quantity.toLocaleString("pt-BR", {
                        maximumFractionDigits: 3,
                      })}{" "}
                      / {it.minStock}{" "}
                      <span className="uppercase">{it.unit || "un"}</span>
                    </span>
                  </li>
                ))}
                {itemsToBuy.length > 3 && (
                  <li className="pt-1 text-center text-xs text-muted-foreground">
                    +{itemsToBuy.length - 3} outros
                  </li>
                )}
              </ul>
            )}
          </Link>
        </section>

        {/* DESTINOS — agrupados por hierarquia (CD → Unidade → Operação) */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Localizações
          </h2>

          <div className="space-y-4">
            {tree.length > 0 && (
              <div className="space-y-4">
                {tree.map((node) => (
                  <LocationBranch
                    key={node.id}
                    node={node}
                    depth={0}
                    destinationStats={destinationStats}
                    isManager={isManager}
                  />
                ))}
              </div>
            )}

            <NewDestinationDialog />
          </div>
        </section>
      </main>
    </div>
  );
}

// ───────────────────────── Subcomponentes de hierarquia ─────────────────────

type StatsFn = (loc: { id: string; stock_mode?: string | null }) => {
  items: number;
  units: number;
  value: number;
  mirrorsCentral: boolean;
};

type Branch = LocationNode & {
  children: Branch[];
  operation_type?: string | null;
  stock_mode?: string | null;
};

function LocationBranch({
  node,
  depth,
  destinationStats,
  isManager,
}: {
  node: Branch;
  depth: number;
  destinationStats: StatsFn;
  isManager: boolean;
}) {
  // CDs e Unidades viram cabeçalhos de seção (cards mais largos);
  // Operações ficam no grid 2x.
  const meta = LOCATION_TYPE_META[node.location_type as LocationType];
  const isContainer = node.location_type !== "operation";

  // Separa filhos por tipo para layout: operações em grade, demais em pilha.
  const opChildren = node.children.filter((c) => c.location_type === "operation");
  const otherChildren = node.children.filter((c) => c.location_type !== "operation");

  return (
    <div
      className={depth === 0 ? "" : "border-l-2 border-border/60 pl-3"}
      style={depth > 0 ? { marginLeft: 4 } : undefined}
    >
      {isContainer ? (
        <ContainerCard node={node} meta={meta} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <LocationCard loc={node} destinationStats={destinationStats} isManager={isManager} />
        </div>
      )}

      {/* Filhos de operação em grade 2x logo abaixo do contêiner */}
      {isContainer && opChildren.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 pl-3">
          {opChildren.map((c) => (
            <LocationCard
              key={c.id}
              loc={c}
              destinationStats={destinationStats}
              isManager={isManager}
            />
          ))}
        </div>
      )}

      {/* Outros descendentes (Unidades dentro de CD) recursivos */}
      {otherChildren.length > 0 && (
        <div className="mt-3 space-y-3">
          {otherChildren.map((c) => (
            <LocationBranch
              key={c.id}
              node={c}
              depth={depth + 1}
              destinationStats={destinationStats}
              isManager={isManager}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContainerCard({
  node,
  meta,
}: {
  node: Branch;
  meta: (typeof LOCATION_TYPE_META)[LocationType];
}) {
  const Icon = meta.icon;
  const childrenCount = node.children.length;
  return (
    <Link
      to="/local/$locationId"
      params={{ locationId: node.id }}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition active:scale-[0.99] hover:border-primary/30"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${meta.tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{node.name}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {meta.label}
          </p>
        </div>
      </div>
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
        {childrenCount} {childrenCount === 1 ? "filho" : "filhos"}
      </Badge>
    </Link>
  );
}

function LocationCard({
  loc,
  destinationStats,
  isManager,
}: {
  loc: Branch;
  destinationStats: StatsFn;
  isManager: boolean;
}) {
  const stats = destinationStats(loc);
  return (
    <Link
      to="/local/$locationId"
      params={{ locationId: loc.id }}
      className="block rounded-xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.99] hover:border-primary/30"
    >
      <div className="flex items-center gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
          <MapPin className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{loc.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              variant="secondary"
              className="h-4 px-1.5 text-[9px] font-medium uppercase tracking-wide"
            >
              {loc.operation_type === "self_service"
                ? "Operação de Quilo"
                : "Operação de Cardápio"}
            </Badge>
            {stats.mirrorsCentral && (
              <Badge
                className="h-4 gap-0.5 border-amber-500/40 bg-amber-500/15 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                variant="outline"
                title="Saldo espelhado do Estoque Central — Venda Direta ativa"
              >
                <Zap className="h-2.5 w-2.5" />
                Venda Direta
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Itens
          </p>
          <p className="text-lg font-bold tabular-nums">{stats.items}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {isManager ? "Valor Total" : "Unidades"}
          </p>
          <p className="text-lg font-bold tabular-nums">
            {isManager ? fmtBRL(stats.value) : stats.units.toLocaleString("pt-BR")}
          </p>
        </div>
      </div>
    </Link>
  );
}
