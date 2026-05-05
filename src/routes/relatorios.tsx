import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useManagerMode } from "@/lib/manager-mode";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";
import { convertToBase, normalizeUnit } from "@/lib/recipe-cost";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios")({
  component: RelatoriosPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

function RelatoriosPage() {
  const { isManager } = useManagerMode();
  const [unitId, setUnitId] = useState<string>("__all__");

  const { data, isLoading } = useQuery({
    queryKey: ["relatorios"],
    queryFn: async () => {
      const [recipes, ingredients, items, stock, locations, overrides] = await Promise.all([
        supabase.from("recipes").select("*"),
        supabase.from("recipe_ingredients").select("*"),
        supabase.from("items").select("id,name,unit,cost_price,is_free,contabiliza_cmv").eq("is_free", false),
        supabase.from("stock_levels").select("*"),
        supabase
          .from("locations")
          .select("id,name,location_type")
          .eq("location_type", "unit")
          .order("name"),
        supabase
          .from("recipe_unit_overrides")
          .select("recipe_id,location_id,sale_price,cost_override"),
      ]);
      if (recipes.error) throw recipes.error;
      if (ingredients.error) throw ingredients.error;
      if (items.error) throw items.error;
      if (stock.error) throw stock.error;
      if (locations.error) throw locations.error;
      if (overrides.error) throw overrides.error;
      return {
        recipes: recipes.data,
        ingredients: ingredients.data,
        items: items.data,
        stock: stock.data,
        locations: locations.data ?? [],
        overrides: overrides.data ?? [],
      };
    },
  });

  const stats = useMemo(() => {
    if (!data) return null;
    // valor total em estoque (apenas itens que contabilizam CMV)
    const totalStockValue = data.stock.reduce((acc, s) => {
      const item = data.items.find((i) => i.id === s.item_id);
      if (!item) return acc;
      if ((item as { contabiliza_cmv?: boolean }).contabiliza_cmv === false) return acc;
      return acc + Number(s.current_stock) * Number(item.cost_price ?? 0);
    }, 0);

    // custo das receitas
    const cache = new Map<string, number>();
    const compute = (rid: string, stack: Set<string>): number => {
      if (cache.has(rid)) return cache.get(rid)!;
      if (stack.has(rid)) return 0;
      stack.add(rid);
      const ings = data.ingredients.filter((i) => i.recipe_id === rid);
      let total = 0;
      for (const ing of ings) {
        if (ing.item_id) {
          const item = data.items.find((i) => i.id === ing.item_id);
          if (!item) continue;
          // Itens marcados como "não contabilizar no CMV" são ignorados na soma
          if ((item as { contabiliza_cmv?: boolean }).contabiliza_cmv === false) continue;
          const baseUnit = normalizeUnit(item.unit);
          const qtyBase = convertToBase(
            Number(ing.quantity),
            normalizeUnit(ing.unit),
            baseUnit,
          );
          total += qtyBase * Number(item.cost_price ?? 0);
        } else if (ing.sub_recipe_id) {
          const sub = data.recipes.find((r) => r.id === ing.sub_recipe_id);
          if (!sub) continue;
          const subTotal = compute(sub.id, stack);
          const subYield = Number(sub.yield_quantity) || 1;
          total += Number(ing.quantity) * (subTotal / subYield);
        }
      }
      stack.delete(rid);
      cache.set(rid, total);
      return total;
    };

    // Mapa de overrides por ficha p/ unidade ativa.
    const overrideByRecipe = new Map<
      string,
      { sale_price: number | null; cost_override: number | null }
    >();
    if (unitId !== "__all__") {
      for (const o of data.overrides as Array<{
        recipe_id: string;
        location_id: string;
        sale_price: number | null;
        cost_override: number | null;
      }>) {
        if (o.location_id === unitId) {
          overrideByRecipe.set(o.recipe_id, {
            sale_price: o.sale_price,
            cost_override: o.cost_override,
          });
        }
      }
    }

    const finals = data.recipes.filter((r) => r.type === "final");
    const rows = finals.map((r) => {
      const total = compute(r.id, new Set());
      const ov = overrideByRecipe.get(r.id);
      const baseCost = total / Math.max(1, r.portions);
      const portionCost =
        ov?.cost_override != null && Number(ov.cost_override) > 0
          ? Number(ov.cost_override)
          : baseCost;
      const sale =
        ov?.sale_price != null && Number(ov.sale_price) > 0
          ? Number(ov.sale_price)
          : Number(r.sale_price) || 0;
      const cmv = sale > 0 ? (portionCost / sale) * 100 : 0;
      const margin = sale > 0 ? sale - portionCost : 0;
      return {
        id: r.id,
        name: r.name,
        portionCost,
        sale,
        cmv,
        margin,
        hasOverride: !!ov,
      };
    });

    const avgCmv =
      rows.filter((r) => r.sale > 0).reduce((a, r) => a + r.cmv, 0) /
      Math.max(1, rows.filter((r) => r.sale > 0).length);

    return { totalStockValue, rows, avgCmv };
  }, [data, unitId]);

  if (!isManager) return <Navigate to="/" />;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="h-10 w-10">
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight">Relatórios CMV</h1>
          <p className="text-sm text-muted-foreground">
            Custo de mercadoria vendida e margens
          </p>
        </div>
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Preço padrão (todas)</SelectItem>
            {(data?.locations ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isLoading || !stats ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Kpi
              label="Valor em Estoque"
              value={fmtBRL(stats.totalStockValue)}
              icon={<DollarSign className="h-4 w-4" />}
            />
            <Kpi
              label="CMV Médio"
              value={`${(isFinite(stats.avgCmv) ? stats.avgCmv : 0).toFixed(1)}%`}
              icon={
                stats.avgCmv > 32 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )
              }
              tone={
                stats.avgCmv > 35
                  ? "danger"
                  : stats.avgCmv > 30
                    ? "warn"
                    : "ok"
              }
            />
            <Kpi
              label="Pratos Cadastrados"
              value={`${stats.rows.length}`}
              icon={<BarChart3 className="h-4 w-4" />}
            />
          </div>

          {/* Tabela */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">CMV por prato</h2>
            </div>
            {stats.rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Cadastre fichas técnicas para ver o CMV.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Prato</TableHead>
                    <TableHead className="text-right">Custo / porção</TableHead>
                    <TableHead className="text-right">Preço venda</TableHead>
                    <TableHead className="text-right">Margem (R$)</TableHead>
                    <TableHead className="pr-4 text-right">CMV %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4 font-medium">
                        <div className="flex items-center gap-2">
                          <span>{r.name}</span>
                          {r.hasOverride && (
                            <Badge variant="outline" className="text-[9px] uppercase">
                              override
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtBRL(r.portionCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.sale > 0 ? fmtBRL(r.sale) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          r.margin < 0 && "text-destructive",
                        )}
                      >
                        {r.sale > 0 ? fmtBRL(r.margin) : "—"}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {r.sale > 0 ? (
                          <Badge
                            variant={
                              r.cmv > 35
                                ? "destructive"
                                : r.cmv > 30
                                  ? "secondary"
                                  : "default"
                            }
                          >
                            {r.cmv.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-lg",
            tone === "ok" && "bg-emerald-500/15 text-emerald-600",
            tone === "warn" && "bg-amber-500/15 text-amber-600",
            tone === "danger" && "bg-destructive/15 text-destructive",
            tone === "default" && "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </span>
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums",
          tone === "ok" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
