import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useManagerMode } from "@/lib/manager-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChefHat,
  Plus,
  Trash2,
  Utensils,
  Soup,
  Calculator,
  Search,
  Check,
  ChevronsUpDown,
  Tag,
  Settings,
  Pencil,
  Power,
  PieChart,
  Pizza,
  ChevronRight,
  MapPin,
  Lock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeUnit } from "@/lib/recipe-cost";
import { cn } from "@/lib/utils";
import { OperationalBadge } from "@/components/operational-badge";
import { useOrgId } from "@/lib/use-org-id";
import { writeAuditLog } from "@/lib/audit-log";
import { ReasonConfirmDialog } from "@/components/reason-confirm-dialog";
import { SaveSubproductDialog } from "@/components/save-subproduct-dialog";

export const Route = createFileRoute("/fichas")({
  component: FichasPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

const FRACTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: "1/2" },
  { value: 1 / 3, label: "1/3" },
  { value: 0.25, label: "1/4" },
  { value: 1 / 6, label: "1/6" },
  { value: 0.125, label: "1/8" },
];

function fractionLabel(f: number): string {
  const found = FRACTIONS.find((x) => Math.abs(x.value - f) < 0.001);
  return found ? found.label : `${(f * 100).toFixed(0)}%`;
}

type Recipe = {
  id: string;
  name: string;
  type: string;
  yield_quantity: number;
  yield_unit: string;
  portions: number;
  sale_price: number;
  notes: string | null;
  category_id: string | null;
  unit_weight_g: number | null;
  unit_name: string | null;
  is_active: boolean;
  produced_item_id: string | null;
  explode_on_consume: boolean;
  parent_recipe_id: string | null;
  fraction: number | null;
  customize_composition: boolean;
  unit_location_id: string | null;
  operation_location_id: string | null;
};

type Ingredient = {
  id: string;
  recipe_id: string;
  item_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
  unit: string;
};

type ItemLite = {
  id: string;
  name: string;
  unit: string;
  cost_price: number;
  shared_unit_enabled?: boolean;
  standard_weight_g?: number;
  avg_weight_g?: number;
  is_operational?: boolean;
  is_free?: boolean;
};

/** Peso da unidade (em KG) usado para conversão UN <-> KG.
 * Prioriza avg_weight_g (peso médio real ponderado dos lotes do estoque)
 * para alinhar custo da ficha com o preço médio exibido no Estoque Central.
 * Cai para standard_weight_g quando ainda não há lotes registrados. */
function itemUnitWeightKg(item: ItemLite | undefined): number {
  if (!item) return 0;
  const avg = Number(item.avg_weight_g ?? 0);
  if (avg > 0) return avg / 1000;
  const std = Number(item.standard_weight_g ?? 0);
  if (std > 0) return std / 1000;
  return 0;
}

/** True quando o item permite alternar entre UN e KG na ficha técnica/produção. */
function canToggleUnit(item: ItemLite | undefined): boolean {
  if (!item) return false;
  if (!item.shared_unit_enabled) return false;
  return itemUnitWeightKg(item) > 0;
}
type RecipeCategory = { id: string; name: string; parent_id: string | null };
type LocationLite = { id: string; name: string; location_type: string };

/** Preço unitário efetivo de um item para a unidade escolhida na ficha.
 *  Espelha a lógica do Estoque Central: quando o item tem Unidade Compartilhada
 *  (toggle KG/UN), `cost_price` é tratado como R$/KG e o preço por UN é
 *  derivado do peso médio (avg_weight_g) — independentemente do `item.unit`
 *  cadastrado. Isso garante que a ficha use o mesmo R$/UN exibido no Central. */
function effectiveUnitPrice(item: ItemLite, chosenUnit: string): number {
  if (item.is_operational || item.is_free) return 0;
  const baseUnit = normalizeUnit(item.unit);
  const chosen = normalizeUnit(chosenUnit || item.unit);
  const cp = Number(item.cost_price ?? 0);
  if (canToggleUnit(item)) {
    const wKg = itemUnitWeightKg(item);
    // Em itens com toggle, cost_price representa R$/KG (mesma regra do Central).
    if (chosen === "KG" || chosen === "G") {
      const perKg = cp;
      return chosen === "G" ? perKg / 1000 : perKg;
    }
    if (chosen === "UN" && wKg > 0) {
      return cp * wKg;
    }
  }
  // Fluxo padrão: cost_price é R$ por unidade base do item (UN, KG ou L).
  if (chosen === baseUnit) return cp;
  if (baseUnit === "KG" && chosen === "G") return cp / 1000;
  if (baseUnit === "L" && chosen === "ML") return cp / 1000;
  if (baseUnit === "G" && chosen === "KG") return cp * 1000;
  if (baseUnit === "ML" && chosen === "L") return cp * 1000;
  return cp;
}

/** Custo de um ingrediente-item considerando unidade escolhida. */
function ingredientItemCost(
  qty: number,
  ingUnitRaw: string,
  item: ItemLite,
): number {
  if (!qty || qty <= 0) return 0;
  if (item.is_operational || item.is_free) return 0;
  return qty * effectiveUnitPrice(item, ingUnitRaw);
}

function FichasPage() {
  const { isManager } = useManagerMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [manageCatsOpen, setManageCatsOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["fichas"],
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const [recipes, ingredients, items, categories, prods, locations] = await Promise.all([
        supabase.from("recipes").select("*").order("name"),
        supabase.from("recipe_ingredients").select("*"),
        supabase
          .from("items")
          .select(
            "id,name,unit,cost_price,shared_unit_enabled,standard_weight_g,avg_weight_g,is_operational,is_free",
          ),
        supabase.from("recipe_categories").select("id,name,parent_id").order("name"),
        supabase
          .from("movements")
          .select("item_id,quantity,note,created_at")
          .eq("type", "production_in")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase.from("locations").select("id,name,location_type").order("name"),
      ]);
      if (recipes.error) throw recipes.error;
      if (ingredients.error) throw ingredients.error;
      if (items.error) throw items.error;
      if (categories.error) throw categories.error;
      if (prods.error) throw prods.error;
      if (locations.error) throw locations.error;
      return {
        recipes: recipes.data as Recipe[],
        ingredients: ingredients.data as Ingredient[],
        items: items.data as ItemLite[],
        categories: categories.data as RecipeCategory[],
        locations: locations.data as LocationLite[],
        productions: prods.data as Array<{
          item_id: string;
          quantity: number;
          note: string | null;
          created_at: string;
        }>,
      };
    },
  });

  // Mapa: recipe.id -> { costPerKg, costPerUn } da última produção registrada
  // dessa produção interna. Usado tanto no resumo quanto no cálculo em tempo real
  // do custo de ingredientes-produções internas.
  const lastProdCostByRecipe = useMemo(() => {
    const map = new Map<string, { costPerKg: number | null; costPerUn: number | null }>();
    if (!data) return map;
    const parseBR = (s: string) =>
      parseFloat(s.replace(/\./g, "").replace(",", "."));
    // Agrupa por item_id pegando o registro mais recente (já vem ordenado desc)
    const seen = new Set<string>();
    for (const m of data.productions) {
      if (seen.has(m.item_id)) continue;
      seen.add(m.item_id);
      const note = m.note ?? "";
      const cpkMatch = note.match(/Custo\/kg\s+R\$\s*([\d.,]+)/i);
      const cpuMatch = note.match(/Custo\/un\s+R\$\s*([\d.,]+)/i);
      const totalMatch = note.match(/Custo total\s+R\$\s*([\d.,]+)/i);
      const cost = totalMatch ? parseBR(totalMatch[1]) : 0;
      const qty = Number(m.quantity) || 0;
      let costPerKg = cpkMatch ? parseBR(cpkMatch[1]) : null;
      const costPerUn = cpuMatch ? parseBR(cpuMatch[1]) : null;
      // Para itens em KG, o quantity já é o peso final → derive cost/kg do total se faltar
      if (costPerKg === null && cost > 0 && qty > 0) costPerKg = cost / qty;
      // Encontra a recipe correspondente pelo nome do item produzido
      const item = data.items.find((i) => i.id === m.item_id);
      if (!item) continue;
      const recipe = data.recipes.find(
        (r) =>
          r.type === "sub" &&
          r.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
      );
      if (!recipe) continue;
      map.set(recipe.id, { costPerKg, costPerUn });
    }
    return map;
  }, [data]);

  const recipeCost = useMemo(() => {
    if (!data) return new Map<string, number>();
    const cache = new Map<string, number>();
    const compute = (recipeId: string, stack: Set<string>): number => {
      if (cache.has(recipeId)) return cache.get(recipeId)!;
      if (stack.has(recipeId)) return 0;
      stack.add(recipeId);
      const r = data.recipes.find((x) => x.id === recipeId);
      // Fração vinculada não-personalizada: deriva do pai
      if (r && r.parent_recipe_id && r.customize_composition !== true && r.fraction) {
        const parentCost = compute(r.parent_recipe_id, stack);
        const v = parentCost * Number(r.fraction);
        stack.delete(recipeId);
        cache.set(recipeId, v);
        return v;
      }
      const ings = data.ingredients.filter((i) => i.recipe_id === recipeId);
      let total = 0;
      for (const ing of ings) {
        if (ing.item_id) {
          const item = data.items.find((i) => i.id === ing.item_id);
          if (!item) continue;
          total += ingredientItemCost(Number(ing.quantity), ing.unit, item);
        } else if (ing.sub_recipe_id) {
          const sub = data.recipes.find((r) => r.id === ing.sub_recipe_id);
          if (!sub) continue;
          // Prioriza custo da última produção (real); fallback para teórico
          const last = lastProdCostByRecipe.get(sub.id);
          const ingUnit = (ing.unit ?? "").toUpperCase();
          const subWKg = Number(sub.unit_weight_g ?? 0) / 1000;
          let perUnitCost = 0;
          if (ingUnit === "UN") {
            if (last?.costPerUn && last.costPerUn > 0) {
              perUnitCost = last.costPerUn;
            } else if (last?.costPerKg && last.costPerKg > 0 && subWKg > 0) {
              perUnitCost = last.costPerKg * subWKg;
            } else {
              const subTotal = compute(sub.id, stack);
              const subYield = Number(sub.yield_quantity) || 1;
              const cpKg = subYield > 0 ? subTotal / subYield : 0;
              perUnitCost = subWKg > 0 ? cpKg * subWKg : subTotal;
            }
          } else {
            // KG (ou qualquer outra unidade peso)
            if (last?.costPerKg && last.costPerKg > 0) {
              perUnitCost = last.costPerKg;
            } else {
              const subTotal = compute(sub.id, stack);
              const subYield = Number(sub.yield_quantity) || 1;
              perUnitCost = subYield > 0 ? subTotal / subYield : 0;
            }
          }
          total += Number(ing.quantity) * perUnitCost;
        }
      }
      stack.delete(recipeId);
      cache.set(recipeId, total);
      return total;
    };
    for (const r of data.recipes) compute(r.id, new Set());
    return cache;
  }, [data, lastProdCostByRecipe]);

  const selected = data?.recipes.find((r) => r.id === selectedId) ?? null;

  if (!isManager) return <Navigate to="/" />;

  return (
    <div className="min-h-screen bg-background">
      {/* Header com voltar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ChefHat className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Engenharia de Produtos
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">
              Fichas Técnicas
            </h1>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Nova
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[320px_1fr] md:p-6">
        {/* Lista */}
        <div className="space-y-3">
          {/* Busca */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar ficha…"
              className="pl-9"
            />
          </div>

          {/* Filtro por categoria (chips com pai > filha) */}
          {(() => {
            if (!data) return null;
            const childrenByParent = new Map<string, RecipeCategory[]>();
            for (const c of data.categories) {
              if (c.parent_id) {
                const arr = childrenByParent.get(c.parent_id) ?? [];
                arr.push(c);
                childrenByParent.set(c.parent_id, arr);
              }
            }
            const recipeMatchesCat = (catId: string, recipeCatId: string | null) => {
              if (!recipeCatId) return false;
              if (recipeCatId === catId) return true;
              const subs = childrenByParent.get(catId) ?? [];
              return subs.some((s) => s.id === recipeCatId);
            };
            const usedTopCats = data.categories.filter(
              (c) =>
                !c.parent_id &&
                data.recipes.some(
                  (r) => r.type === "final" && recipeMatchesCat(c.id, r.category_id),
                ),
            );
            const hasNoCat = data.recipes.some(
              (r) => r.type === "final" && !r.category_id,
            );
            const hasSubs = data.recipes.some((r) => r.type === "sub");
            if (usedTopCats.length === 0 && !hasNoCat && !hasSubs) {
              return (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setManageCatsOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-primary"
                  >
                    <Settings className="h-3 w-3" /> Editar categorias
                  </button>
                </div>
              );
            }
            // Subcategorias visíveis: depende do pai ativo
            const activeParent = (() => {
              const cat = data.categories.find((c) => c.id === categoryFilter);
              if (!cat) return null;
              if (!cat.parent_id) return cat;
              return data.categories.find((c) => c.id === cat.parent_id) ?? null;
            })();
            const subChips = activeParent
              ? (childrenByParent.get(activeParent.id) ?? []).filter((s) =>
                  data.recipes.some(
                    (r) => r.type === "final" && r.category_id === s.id,
                  ),
                )
              : [];
            return (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CategoryChip
                    label="Todas"
                    active={categoryFilter === "all"}
                    onClick={() => setCategoryFilter("all")}
                  />
                  {hasSubs && (
                    <CategoryChip
                      label="Produção Interna"
                      active={categoryFilter === "sub"}
                      onClick={() => setCategoryFilter("sub")}
                    />
                  )}
                  {hasNoCat && (
                    <CategoryChip
                      label="Sem categoria"
                      active={categoryFilter === "none"}
                      onClick={() => setCategoryFilter("none")}
                    />
                  )}
                  {usedTopCats.map((c) => (
                    <CategoryChip
                      key={c.id}
                      label={c.name}
                      active={
                        categoryFilter === c.id ||
                        (activeParent?.id === c.id)
                      }
                      onClick={() => setCategoryFilter(c.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setManageCatsOpen(true)}
                    className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary"
                    title="Gerenciar categorias"
                    aria-label="Gerenciar categorias"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                </div>
                {subChips.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-2">
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    {subChips.map((s) => (
                      <CategoryChip
                        key={s.id}
                        label={s.name}
                        active={categoryFilter === s.id}
                        onClick={() => setCategoryFilter(s.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {isLoading && (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}

          {(() => {
            if (!data) return null;
            const term = search.trim().toLowerCase();
            const childrenByParent = new Map<string, RecipeCategory[]>();
            for (const c of data.categories) {
              if (c.parent_id) {
                const arr = childrenByParent.get(c.parent_id) ?? [];
                arr.push(c);
                childrenByParent.set(c.parent_id, arr);
              }
            }
            const matchesCategoryFilter = (r: Recipe): boolean => {
              if (categoryFilter === "all") return true;
              if (categoryFilter === "sub") return r.type === "sub";
              if (categoryFilter === "none")
                return r.type === "final" && !r.category_id;
              if (r.type !== "final" || !r.category_id) return false;
              if (r.category_id === categoryFilter) return true;
              const subs = childrenByParent.get(categoryFilter) ?? [];
              return subs.some((s) => s.id === r.category_id);
            };
            const filtered = data.recipes.filter((r) => {
              if (term && !r.name.toLowerCase().includes(term)) return false;
              return matchesCategoryFilter(r);
            });

            if (filtered.length === 0) {
              return (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Nenhuma ficha encontrada.
                </div>
              );
            }

            // Agrupa: Produção Interna + cada categoria pai (com filhas) + Sem categoria
            const groups: { key: string; label: string; recipes: Recipe[] }[] = [];
            const subs = filtered.filter((r) => r.type === "sub");
            if (subs.length)
              groups.push({ key: "sub", label: "Produção Interna", recipes: subs });
            const topCats = data.categories.filter((c) => !c.parent_id);
            for (const c of topCats) {
              const childIds = (childrenByParent.get(c.id) ?? []).map((s) => s.id);
              const rs = filtered.filter(
                (r) =>
                  r.type === "final" &&
                  (r.category_id === c.id || (r.category_id && childIds.includes(r.category_id))),
              );
              if (rs.length) groups.push({ key: c.id, label: c.name, recipes: rs });
            }
            const noCat = filtered.filter(
              (r) => r.type === "final" && !r.category_id,
            );
            if (noCat.length)
              groups.push({ key: "none", label: "Sem categoria", recipes: noCat });

            return groups.map((g) => (
              <div key={g.key} className="space-y-1.5">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label} · {g.recipes.length}
                </p>
                {g.recipes.map((r) => {
                  const cost = recipeCost.get(r.id) ?? 0;
                  const isFinal = r.type === "final";
                  const isInactive = r.is_active === false;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId((prev) => (prev === r.id ? null : r.id))}
                      className={cn(
                        "w-full rounded-xl border bg-card p-3 text-left shadow-sm transition hover:border-primary",
                        selectedId === r.id
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-border",
                        isInactive && "opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate font-semibold">{r.name}</p>
                            {r.parent_recipe_id && r.fraction && (
                              <Badge variant="outline" className="gap-0.5 text-[10px]">
                                <PieChart className="h-2.5 w-2.5" />
                                {fractionLabel(r.fraction)}
                              </Badge>
                            )}
                            {isInactive && (
                              <Badge variant="outline" className="text-[10px]">
                                Inativo
                              </Badge>
                            )}
                          </div>
                          {(() => {
                            const cat = r.category_id
                              ? data.categories.find((c) => c.id === r.category_id)
                              : null;
                            if (!cat) return null;
                            const parent = cat.parent_id
                              ? data.categories.find((c) => c.id === cat.parent_id)
                              : null;
                            return (
                              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {parent ? `${parent.name} › ${cat.name}` : cat.name}
                              </p>
                            );
                          })()}
                          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Custo: {fmtBRL(cost)}
                          </p>
                        </div>
                        <Badge
                          variant={isFinal ? "default" : "secondary"}
                          className="gap-1 text-[10px]"
                        >
                          {isFinal ? (
                            <Utensils className="h-3 w-3" />
                          ) : (
                            <Soup className="h-3 w-3" />
                          )}
                          {isFinal ? "Prato" : "Sub"}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>

        {/* Detalhe */}
        <div>
          {selected && data ? (
            <RecipeDetail
              key={selected.id}
              recipe={selected}
              allRecipes={data.recipes}
              allItems={data.items}
              categories={data.categories}
              locations={data.locations}
              allIngredients={data.ingredients}
              lastProdCostByRecipe={lastProdCostByRecipe}
              ingredients={data.ingredients.filter(
                (i) => i.recipe_id === selected.id,
              )}
              onChanged={() => qc.invalidateQueries({ queryKey: ["fichas"] })}
              onDeleted={() => {
                setSelectedId(null);
                qc.invalidateQueries({ queryKey: ["fichas"] });
              }}
            />
          ) : (
            <div className="grid h-full min-h-[300px] place-items-center rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <div>
                <Calculator className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Selecione uma ficha</p>
                <p className="text-xs text-muted-foreground">
                  Ou crie uma nova para começar.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateRecipeDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ManageCategoriesDialog
        open={manageCatsOpen}
        onOpenChange={setManageCatsOpen}
        categories={data?.categories ?? []}
      />
    </div>
  );
}

function CreateRecipeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"final" | "sub">("final");
  const [categoryId, setCategoryId] = useState<string>("none");
  const qc = useQueryClient();
  const orgId = useOrgId();

  const { data: categories } = useQuery({
    queryKey: ["recipe_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_categories")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return data as RecipeCategory[];
    },
    enabled: open,
  });

  const m = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Informe um nome");
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");
      const { error } = await supabase.from("recipes").insert({
        org_id: orgId,
        name: name.trim(),
        type,
        yield_quantity: 1,
        yield_unit: type === "sub" ? "KG" : "UN",
        portions: 1,
        sale_price: 0,
        category_id: type === "final" && categoryId !== "none" ? categoryId : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ficha criada");
      qc.invalidateQueries({ queryKey: ["fichas"] });
      onOpenChange(false);
      setName("");
      setType("final");
      setCategoryId("none");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Ficha Técnica</DialogTitle>
          <DialogDescription>
            Informe nome e tipo. Detalhes vêm depois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Hambúrguer Artesanal"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as never)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="final">Venda / Prato Final</SelectItem>
                <SelectItem value="sub">Produção / Produção Interna</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {type === "sub"
                ? "Rendimento será definido pelo Peso Final Real após preparo."
                : "Rendimento fixo de 1 unidade. Preço e CMV definidos na ficha."}
            </p>
          </div>
          {type === "final" && (
            <div className="space-y-2">
              <Label>Categoria</Label>
              <CategoryCombobox
                value={categoryId === "none" ? null : categoryId}
                categories={categories ?? []}
                onChange={(id) => setCategoryId(id ?? "none")}
              />
              <p className="text-[11px] text-muted-foreground">
                Selecione uma existente ou digite para criar uma nova.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => m.mutate()}
            disabled={m.isPending}
            className="w-full"
          >
            {m.isPending ? "Criando…" : "Criar ficha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ============ Detalhe com grid dinâmico ============

type DraftRow = {
  // chave estável local; se persistido, dbId terá o id da linha no banco
  key: string;
  dbId: string | null;
  sourceType: "item" | "sub";
  sourceId: string;
  quantity: string; // string para edição livre
  /** Unidade escolhida pelo usuário ("UN" ou "KG"). Se vazia, usa a unidade base do item. */
  unitOverride: string;
};

function rowFromIngredient(ing: Ingredient): DraftRow {
  return {
    key: ing.id,
    dbId: ing.id,
    sourceType: ing.item_id ? "item" : "sub",
    sourceId: (ing.item_id ?? ing.sub_recipe_id ?? "") as string,
    quantity: String(ing.quantity ?? ""),
    unitOverride: (ing.unit ?? "").toUpperCase(),
  };
}

function emptyRow(): DraftRow {
  return {
    key: `new-${Math.random().toString(36).slice(2)}`,
    dbId: null,
    sourceType: "item",
    sourceId: "",
    quantity: "",
    unitOverride: "",
  };
}

function RecipeDetail({
  recipe,
  allRecipes,
  allItems,
  categories,
  locations,
  ingredients,
  allIngredients,
  lastProdCostByRecipe,
  onChanged,
  onDeleted,
}: {
  recipe: Recipe;
  allRecipes: Recipe[];
  allItems: ItemLite[];
  categories: RecipeCategory[];
  locations: LocationLite[];
  ingredients: Ingredient[];
  allIngredients: Ingredient[];
  lastProdCostByRecipe: Map<string, { costPerKg: number | null; costPerUn: number | null }>;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const isFinal = recipe.type === "final";
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [subproductOpen, setSubproductOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fractionOpen, setFractionOpen] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);

  // Estado local: rows derivadas dos ingredientes do banco + 1 linha vazia ao final
  const [rows, setRows] = useState<DraftRow[]>(() => [
    ...ingredients.map(rowFromIngredient),
    emptyRow(),
  ]);

  // Sincroniza quando os ingredientes do banco mudam (ex: após remover)
  // mas preserva linhas em edição não-salvas.
  const lastDbIdsRef = useRef<string>("");
  useEffect(() => {
    const dbIds = ingredients.map((i) => i.id).sort().join(",");
    if (dbIds === lastDbIdsRef.current) return;
    lastDbIdsRef.current = dbIds;
    setRows((prev) => {
      const unsaved = prev.filter((r) => r.dbId === null && (r.sourceId || r.quantity));
      const persisted = ingredients.map(rowFromIngredient);
      return [...persisted, ...unsaved, emptyRow()];
    });
  }, [ingredients]);

  // True quando a produção interna pode alternar entre KG e UN (tem peso da porção definido)
  const canToggleSub = (sub: Recipe | undefined): boolean => {
    if (!sub) return false;
    const wG = Number(sub.unit_weight_g ?? 0);
    return wG > 0;
  };

  // Custo por KG da produção interna: prioriza última produção, fallback para o teórico
  const subCostPerKg = (sub: Recipe): number => {
    const last = lastProdCostByRecipe.get(sub.id);
    if (last?.costPerKg && last.costPerKg > 0) return last.costPerKg;
    // Teórico: custo total dos ingredientes / peso final declarado (yield_quantity em KG)
    const subTotal = computeSubCost(sub.id, allRecipes, allItems, allIngredients);
    const subYield = Number(sub.yield_quantity) || 1;
    return subYield > 0 ? subTotal / subYield : 0;
  };

  // Custo por unidade da produção interna: prioriza última produção, fallback para teórico (peso porção × custo/kg)
  const subCostPerUn = (sub: Recipe): number => {
    const last = lastProdCostByRecipe.get(sub.id);
    if (last?.costPerUn && last.costPerUn > 0) return last.costPerUn;
    const wKg = Number(sub.unit_weight_g ?? 0) / 1000;
    if (wKg <= 0) return 0;
    return subCostPerKg(sub) * wKg;
  };

  // Resolução de unidade automática (KG/L/UN) a partir do item ou produção interna
  const unitFor = (row: DraftRow): string => {
    if (!row.sourceId) return "—";
    if (row.sourceType === "item") {
      const item = allItems.find((i) => i.id === row.sourceId);
      if (!item) return "—";
      const base = normalizeUnit(item.unit);
      const override = row.unitOverride?.toUpperCase();
      if (override && canToggleUnit(item)) {
        if (override === "UN" || override === "KG") return override;
      }
      return base;
    }
    const sub = allRecipes.find((r) => r.id === row.sourceId);
    if (!sub) return "—";
    const base = normalizeUnit(sub.yield_unit);
    const override = row.unitOverride?.toUpperCase();
    if (override && canToggleSub(sub)) {
      if (override === "UN" || override === "KG") return override;
    }
    return base;
  };

  // Custo de uma row (em tempo real)
  const rowCost = (row: DraftRow): number => {
    const qty = Number(row.quantity);
    if (!row.sourceId || !qty || qty <= 0) return 0;
    if (row.sourceType === "item") {
      const item = allItems.find((i) => i.id === row.sourceId);
      if (!item) return 0;
      return ingredientItemCost(qty, unitFor(row), item);
    }
    // Produção Interna: usa último custo de produção quando disponível
    const sub = allRecipes.find((r) => r.id === row.sourceId);
    if (!sub) return 0;
    const chosen = unitFor(row);
    if (chosen === "UN") return qty * subCostPerUn(sub);
    // Padrão (KG ou L): aplica custo/kg da última produção
    return qty * subCostPerKg(sub);
  };

  const totalCost = useMemo(
    () => rows.reduce((acc, r) => acc + rowCost(r), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, allItems, allRecipes, lastProdCostByRecipe, allIngredients],
  );

  // ===== Produção Interna: Peso Final Real (yield_quantity em KG) =====
  const [pesoFinal, setPesoFinal] = useState<string>(
    String(recipe.yield_quantity ?? 1),
  );
  useEffect(() => {
    setPesoFinal(String(recipe.yield_quantity ?? 1));
  }, [recipe.id, recipe.yield_quantity]);

  const persistPesoFinal = async () => {
    const v = Number(pesoFinal);
    if (!isFinite(v) || v <= 0) {
      toast.error("Peso final deve ser maior que zero");
      return;
    }
    const { error } = await supabase
      .from("recipes")
      .update({ yield_quantity: v, yield_unit: "KG" })
      .eq("id", recipe.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged();
  };

  const custoPorKg = isFinal ? 0 : totalCost / Math.max(0.0001, Number(pesoFinal) || 1);

  // Peso Bruto Total (KG): soma das quantidades dos ingredientes convertidas a KG.
  // - KG/L são tratados como peso (1L ≈ 1KG p/ aproximação culinária)
  // - UN com peso padrão definido contribui qty * pesoPadrão (kg)
  // - Produção Interna usam o yield_quantity em KG da sub
  const pesoBrutoKg = useMemo(() => {
    let total = 0;
    for (const row of rows) {
      const qty = Number(row.quantity);
      if (!row.sourceId || !qty || qty <= 0) continue;
      if (row.sourceType === "item") {
        const item = allItems.find((i) => i.id === row.sourceId);
        if (!item) continue;
        const chosen = unitFor(row);
        if (chosen === "KG" || chosen === "L") {
          total += qty;
        } else if (chosen === "UN") {
          // Se o item tem peso padrão, contabiliza
          const wKg = itemUnitWeightKg(item);
          if (wKg > 0) total += qty * wKg;
        }
      } else {
        const sub = allRecipes.find((r) => r.id === row.sourceId);
        if (!sub) continue;
        const subUnit = normalizeUnit(sub.yield_unit);
        if (subUnit === "KG" || subUnit === "L") total += qty;
      }
    }
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allItems, allRecipes]);

  const pesoFinalNum = Number(pesoFinal) || 0;
  // Fator de Correção: variação % entre peso final e peso bruto
  // Negativo = perda (evaporação/cocção), Positivo = ganho (hidratação)
  const fatorCorrecao =
    pesoBrutoKg > 0 && pesoFinalNum > 0
      ? ((pesoFinalNum - pesoBrutoKg) / pesoBrutoKg) * 100
      : 0;

  // ===== Peso da Porção Individual (KG) =====
  // Persistido em gramas no banco (unit_weight_g) por compatibilidade,
  // mas exibido em KG com 3 casas decimais na UI.
  const [pesoPorcaoKg, setPesoPorcaoKg] = useState<string>(
    recipe.unit_weight_g != null && Number(recipe.unit_weight_g) > 0
      ? (Number(recipe.unit_weight_g) / 1000).toString()
      : "",
  );
  useEffect(() => {
    setPesoPorcaoKg(
      recipe.unit_weight_g != null && Number(recipe.unit_weight_g) > 0
        ? (Number(recipe.unit_weight_g) / 1000).toString()
        : "",
    );
  }, [recipe.id, recipe.unit_weight_g]);

  const persistUnitConfig = async (nextWeightKg: string) => {
    const kg = nextWeightKg === "" ? null : Number(nextWeightKg);
    const grams = kg != null && isFinite(kg) && kg > 0 ? kg * 1000 : null;
    const { error } = await supabase
      .from("recipes")
      .update({ unit_weight_g: grams })
      .eq("id", recipe.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged();
  };

  const pesoPorcaoKgNum = Number(pesoPorcaoKg) || 0;
  const rendimentoUnidades =
    pesoFinalNum > 0 && pesoPorcaoKgNum > 0
      ? pesoFinalNum / pesoPorcaoKgNum
      : 0;
  const custoPorUnidade =
    rendimentoUnidades > 0 ? totalCost / rendimentoUnidades : 0;

  // ===== Prato Final: CMV alvo, Preço sugerido, Preço real =====
  const [cmvAlvo, setCmvAlvo] = useState<string>("30");
  const [precoReal, setPrecoReal] = useState<string>(
    String(recipe.sale_price ?? 0),
  );

  // Busca overrides de preço por unidade/operação para esta ficha.
  const { data: priceOverrides } = useQuery({
    queryKey: ["recipe-overrides", recipe.id],
    enabled: !!recipe.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_unit_overrides")
        .select("location_id,sale_price")
        .eq("recipe_id", recipe.id);
      if (error) throw error;
      return (data ?? []) as Array<{ location_id: string; sale_price: number | null }>;
    },
  });

  /** Local ativo no cabeçalho (operação tem prioridade sobre unidade). */
  const activeLocId =
    recipe.operation_location_id ?? recipe.unit_location_id ?? null;
  /** Preço efetivo para o filtro ativo (override > sale_price padrão). */
  const effectivePrice = useMemo(() => {
    if (activeLocId && priceOverrides) {
      const ov = priceOverrides.find((o) => o.location_id === activeLocId);
      if (ov && ov.sale_price != null && Number(ov.sale_price) > 0) {
        return Number(ov.sale_price);
      }
    }
    return Number(recipe.sale_price ?? 0);
  }, [activeLocId, priceOverrides, recipe.sale_price]);

  useEffect(() => {
    setPrecoReal(String(effectivePrice));
  }, [recipe.id, effectivePrice]);

  const persistPrecoReal = async () => {
    const v = Number(precoReal);
    if (!isFinite(v) || v < 0) return;
    // Se há unidade/operação ativa, salva no override; senão, no preço padrão.
    if (activeLocId) {
      const { error } = await supabase
        .from("recipe_unit_overrides")
        .upsert(
          {
            recipe_id: recipe.id,
            location_id: activeLocId,
            sale_price: v,
          },
          { onConflict: "recipe_id,location_id" },
        );
      if (error) {
        toast.error(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("recipes")
        .update({ sale_price: v })
        .eq("id", recipe.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    qc.invalidateQueries({ queryKey: ["recipe-overrides", recipe.id] });
    onChanged();
  };

  const custoProducao = totalCost; // rendimento fixo = 1 para Prato Final
  const cmvAlvoNum = Number(cmvAlvo);
  const precoSugerido =
    isFinal && cmvAlvoNum > 0 && cmvAlvoNum < 100
      ? custoProducao / (cmvAlvoNum / 100)
      : 0;
  const precoRealNum = Number(precoReal);
  const cmvReal =
    isFinal && precoRealNum > 0 ? (custoProducao / precoRealNum) * 100 : 0;
  const margemReal =
    isFinal && precoRealNum > 0
      ? ((precoRealNum - custoProducao) / precoRealNum) * 100
      : 0;

  // Persistência por linha (insert / update)
  const upsertRow = async (row: DraftRow) => {
    const qty = Number(row.quantity);
    if (!row.sourceId || !qty || qty <= 0) return;
    const unit = unitFor(row);
    const basePayload =
      row.sourceType === "item"
        ? {
            recipe_id: recipe.id,
            item_id: row.sourceId,
            sub_recipe_id: null,
            quantity: qty,
            unit,
          }
        : {
            recipe_id: recipe.id,
            item_id: null,
            sub_recipe_id: row.sourceId,
            quantity: qty,
            unit,
          };

    if (row.dbId) {
      const { error } = await supabase
        .from("recipe_ingredients")
        .update(basePayload)
        .eq("id", row.dbId);
      if (error) throw error;
    } else {
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");
      const { data, error } = await supabase
        .from("recipe_ingredients")
        .insert({ ...basePayload, org_id: orgId })
        .select("id")
        .single();
      if (error) throw error;
      // marca como persistido localmente para próximos blurs virarem update
      setRows((prev) => {
        const next = prev.map((r) =>
          r.key === row.key ? { ...r, dbId: data.id } : r,
        );
        // garante uma linha vazia ao final
        if (!next.some((r) => r.dbId === null && !r.sourceId && !r.quantity)) {
          next.push(emptyRow());
        }
        return next;
      });
    }
  };

  const persistRow = async (row: DraftRow) => {
    try {
      await upsertRow(row);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeRow = async (row: DraftRow) => {
    if (row.dbId) {
      const { error } = await supabase
        .from("recipe_ingredients")
        .delete()
        .eq("id", row.dbId);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setRows((prev) => prev.filter((r) => r.key !== row.key));
    onChanged();
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.key === key ? { ...r, ...patch } : r));
      // garante sempre uma linha vazia no fim
      if (!next.some((r) => r.dbId === null && !r.sourceId && !r.quantity)) {
        next.push(emptyRow());
      }
      return next;
    });
  };

  const removeRecipe = useMutation({
    mutationFn: async (reason: string) => {
      const { data: refs, error: refErr } = await supabase
        .from("recipe_ingredients")
        .select("id")
        .eq("sub_recipe_id", recipe.id)
        .limit(1);
      if (refErr) throw refErr;
      if (refs && refs.length > 0) {
        throw new Error(
          "Esta ficha é usada como produção interna em outra. Inative-a em vez de excluir.",
        );
      }
      const { error: delIngErr } = await supabase
        .from("recipe_ingredients")
        .delete()
        .eq("recipe_id", recipe.id);
      if (delIngErr) throw delIngErr;
      const { error } = await supabase.from("recipes").delete().eq("id", recipe.id);
      if (error) throw error;
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "recipes",
          entityType: "recipe",
          entityId: recipe.id,
          action: "delete",
          reason,
          oldValue: { name: recipe.name, type: recipe.type, is_active: recipe.is_active },
        });
      }
    },
    onSuccess: () => {
      toast.success("Ficha removida");
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("recipes")
        .update({ is_active: !recipe.is_active })
        .eq("id", recipe.id);
      if (error) throw error;
      return !recipe.is_active;
    },
    onSuccess: (newState) => {
      toast.success(newState ? "Ficha reativada" : "Ficha inativada");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleExplode = useMutation({
    mutationFn: async () => {
      const next = !(recipe.explode_on_consume === true);
      const { error } = await supabase
        .from("recipes")
        .update({ explode_on_consume: next })
        .eq("id", recipe.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(
        next
          ? "Baixa direta de insumos ativada"
          : "Baixa direta de insumos desativada",
      );
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCustomize = useMutation({
    mutationFn: async () => {
      const next = !(recipe.customize_composition === true);
      if (next) {
        // Ligando: snapshot dos ingredientes do pai × fraction para esta fração.
        if (!orgId) throw new Error("Organização não identificada");
        if (!recipe.parent_recipe_id) throw new Error("Sem ficha pai vinculada");
        const fr = Number(recipe.fraction) || 1;
        const baseIngs = allIngredients.filter(
          (i) => i.recipe_id === recipe.parent_recipe_id,
        );
        // Limpa qualquer linha existente (segurança) e insere snapshot.
        await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipe.id);
        if (baseIngs.length > 0) {
          const payload = baseIngs.map((i) => ({
            org_id: orgId,
            recipe_id: recipe.id,
            item_id: i.item_id,
            sub_recipe_id: i.sub_recipe_id,
            quantity: Number((Number(i.quantity) * fr).toFixed(4)),
            unit: i.unit,
          }));
          const { error: insErr } = await supabase
            .from("recipe_ingredients")
            .insert(payload);
          if (insErr) throw insErr;
        }
      } else {
        // Desligando: remove ingredientes próprios — passam a derivar do pai.
        await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipe.id);
      }
      const { error } = await supabase
        .from("recipes")
        .update({ customize_composition: next })
        .eq("id", recipe.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(
        next
          ? "Composição personalizada — edições não afetam a ficha original"
          : "Voltou a seguir a ficha original automaticamente",
      );
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createFraction = useMutation({
    mutationFn: async (fraction: number) => {
      if (!orgId) throw new Error("Organização não identificada");
      const baseName = `${recipe.name} (${fractionLabel(fraction)})`;
      const { data: newRec, error: recErr } = await supabase
        .from("recipes")
        .insert({
          org_id: orgId,
          name: baseName,
          type: "final",
          yield_quantity: recipe.yield_quantity,
          yield_unit: recipe.yield_unit,
          portions: recipe.portions,
          sale_price: Number((recipe.sale_price * fraction).toFixed(2)),
          category_id: recipe.category_id,
          parent_recipe_id: recipe.id,
          fraction,
          customize_composition: false,
        })
        .select("id")
        .single();
      if (recErr) throw recErr;
      // Não clona ingredientes: por padrão a fração SEGUE a ficha original
      // (auto-sync). Ao ligar "Personalizar Composição" depois, fazemos o snapshot.
      return newRec.id;
    },
    onSuccess: () => {
      toast.success("Fração criada");
      setFractionOpen(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={isFinal ? "default" : "secondary"} className="gap-1">
              {isFinal ? <Utensils className="h-3 w-3" /> : <Soup className="h-3 w-3" />}
              {isFinal ? "Prato Final" : "Produção Interna"}
            </Badge>
            {recipe.is_active === false && (
              <Badge variant="outline" className="text-[10px]">
                Inativo
              </Badge>
            )}
          </div>
          <h2 className="mt-1 text-2xl font-bold leading-tight">{recipe.name}</h2>
          <p className="text-xs text-muted-foreground">
            {isFinal
              ? "Rendimento: 1 unidade"
              : `Peso final real: ${Number(pesoFinal) || 0} KG`}
          </p>
          {isFinal && (
            <div className="mt-2 flex items-center gap-1.5">
              <Tag className="h-3 w-3 text-muted-foreground" />
              <CategoryCombobox
                compact
                value={recipe.category_id}
                categories={categories}
                onChange={async (id) => {
                  const { error } = await supabase
                    .from("recipes")
                    .update({ category_id: id })
                    .eq("id", recipe.id);
                  if (error) {
                    toast.error(error.message);
                    return;
                  }
                  onChanged();
                }}
              />
            </div>
          )}
          {isFinal && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                <Select
                  value={recipe.unit_location_id ?? "none"}
                  onValueChange={async (v) => {
                    const id = v === "none" ? null : v;
                    const { error } = await supabase
                      .from("recipes")
                      .update({ unit_location_id: id })
                      .eq("id", recipe.id);
                    if (error) return toast.error(error.message);
                    onChanged();
                  }}
                >
                  <SelectTrigger className="h-7 w-[170px] text-xs">
                    <SelectValue placeholder="Unidade (opc.)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sem unidade —</SelectItem>
                    {locations
                      .filter((l) => l.location_type === "cd" || l.location_type === "unit")
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                <Select
                  value={recipe.operation_location_id ?? "none"}
                  onValueChange={async (v) => {
                    const id = v === "none" ? null : v;
                    const { error } = await supabase
                      .from("recipes")
                      .update({ operation_location_id: id })
                      .eq("id", recipe.id);
                    if (error) return toast.error(error.message);
                    onChanged();
                  }}
                >
                  <SelectTrigger className="h-7 w-[170px] text-xs">
                    <SelectValue placeholder="Operação (opc.)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sem operação —</SelectItem>
                    {locations
                      .filter((l) => l.location_type === "operation")
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => setOverridesOpen(true)}
                title="Definir preço de venda específico por unidade"
              >
                <Tag className="h-3 w-3" /> Preços por unidade
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div
            className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1"
            title={recipe.is_active === false ? "Ficha inativa" : "Ficha ativa"}
          >
            <Power className="h-3.5 w-3.5 text-muted-foreground" />
            <Switch
              checked={recipe.is_active !== false}
              onCheckedChange={() => toggleActive.mutate()}
              disabled={toggleActive.isPending}
            />
          </div>
          {!isFinal && (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px]"
              title="Quando ligado, o consumo desta produção interna baixa direto dos insumos brutos (recursivo, FEFO por lote). Quando desligado, baixa o saldo da produção previamente registrada."
            >
              <Switch
                checked={recipe.explode_on_consume === true}
                onCheckedChange={() => toggleExplode.mutate()}
                disabled={toggleExplode.isPending}
              />
              <span className="text-muted-foreground">Baixa direta de insumos</span>
            </label>
          )}
          {isFinal && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setFractionOpen(true)}
              title="Criar uma fração desta ficha (1/2, 1/3, etc.)"
            >
              <PieChart className="h-3.5 w-3.5" /> Criar Fração
            </Button>
          )}
          {recipe.parent_recipe_id && (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px]"
              title="Quando desligado, esta fração segue automaticamente os ingredientes da ficha original. Quando ligado, você pode personalizar."
            >
              <Switch
                checked={recipe.customize_composition === true}
                onCheckedChange={() => toggleCustomize.mutate()}
                disabled={toggleCustomize.isPending}
              />
              <span className="text-muted-foreground">Personalizar composição</span>
            </label>
          )}
          {!isFinal && recipe.explode_on_consume !== true && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setSubproductOpen(true)}
              title="Configurar esta produção interna como item no estoque (cadastro)"
            >
              <Plus className="h-3.5 w-3.5" />
              {recipe.produced_item_id ? "Atualizar produção interna" : "Salvar produção interna"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={removeRecipe.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <Dialog open={fractionOpen} onOpenChange={setFractionOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Criar fração de "{recipe.name}"</DialogTitle>
            <DialogDescription>
              Será criada uma nova ficha vinculada, com ingredientes e preço proporcionais. Você pode personalizar depois.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {FRACTIONS.map((f) => (
              <Button
                key={f.label}
                variant="outline"
                disabled={createFraction.isPending}
                onClick={() => createFraction.mutate(f.value)}
                className="h-16 flex-col gap-1"
              >
                <PieChart className="h-4 w-4" />
                <span className="text-base font-bold">{f.label}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <RecipeOverridesDialog
        open={overridesOpen}
        onOpenChange={setOverridesOpen}
        recipe={recipe}
        locations={locations}
        baseCost={totalCost}
        onChanged={onChanged}
      />

      <ReasonConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir ficha "${recipe.name}"?`}
        description="A ficha e seus ingredientes serão removidos. Esta ação será registrada no log de auditoria."
        confirmLabel="Excluir ficha"
        destructive
        pending={removeRecipe.isPending}
        onConfirm={async (reason) => {
          await removeRecipe.mutateAsync(reason);
          setDeleteOpen(false);
        }}
      />

      <SaveSubproductDialog
        open={subproductOpen}
        onOpenChange={setSubproductOpen}
        recipeId={recipe.id}
        recipeName={recipe.name}
        totalCost={totalCost}
        yieldQuantity={Number(recipe.yield_quantity) || 1}
        yieldUnit={recipe.yield_unit || "UN"}
        producedItemId={recipe.produced_item_id ?? null}
      />

      {/* Resumo de custo em tempo real */}
      {isFinal ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Custo de produção" value={fmtBRL(custoProducao)} />
            <Stat
              label="Preço sugerido"
              value={fmtBRL(precoSugerido)}
              hint={`p/ CMV ${cmvAlvoNum || 0}%`}
            />
            <Stat
              label="CMV real"
              value={precoRealNum > 0 ? `${cmvReal.toFixed(1)}%` : "—"}
              tone={
                precoRealNum === 0
                  ? "default"
                  : cmvReal > 35
                    ? "danger"
                    : cmvReal > 30
                      ? "warn"
                      : "ok"
              }
              hint={
                precoRealNum > 0 ? `Margem ${margemReal.toFixed(1)}%` : undefined
              }
            />
            <Stat
              label="Preço de venda"
              value={fmtBRL(precoRealNum)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">CMV Alvo (%)</Label>
              <Input
                type="number"
                step="0.1"
                min="1"
                max="99"
                value={cmvAlvo}
                onChange={(e) => setCmvAlvo(e.target.value)}
                placeholder="30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Preço de Venda Real (R$)
                {activeLocId && (
                  <span className="ml-1 text-[10px] uppercase text-primary">
                    · override ativo
                  </span>
                )}
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={precoReal}
                onChange={(e) => setPrecoReal(e.target.value)}
                onBlur={() => void persistPrecoReal()}
                placeholder="0,00"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <Soup className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold">Insumo Processado</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Esta ficha gera um insumo que poderá ser selecionado em outras
                  fichas técnicas (produção interna ou pratos finais).
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Custo total ingredientes" value={fmtBRL(totalCost)} />
            <Stat
              label="Peso bruto total"
              value={`${pesoBrutoKg.toFixed(3)} KG`}
              hint="Soma dos ingredientes pesáveis"
            />
          </div>
        </div>
      )}

      {/* Grid dinâmico de ingredientes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ingredientes
          </h3>
          <p className="text-[10px] text-muted-foreground">
            {recipe.parent_recipe_id && recipe.customize_composition !== true
              ? "Sincronizado automaticamente com a ficha original"
              : "Selecione → digite a quantidade → próximo"}
          </p>
        </div>

        {recipe.parent_recipe_id && recipe.customize_composition !== true ? (
          (() => {
            const fr = Number(recipe.fraction) || 1;
            const parentIngs = allIngredients.filter(
              (i) => i.recipe_id === recipe.parent_recipe_id,
            );
            const parentName =
              allRecipes.find((r) => r.id === recipe.parent_recipe_id)?.name ?? "ficha original";
            return (
              <div className="overflow-hidden rounded-lg border border-dashed border-primary/40 bg-primary/5">
                <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                  <Lock className="h-3.5 w-3.5" />
                  <span>
                    Esta fração ({fractionLabel(fr)}) segue automaticamente a composição de
                    <span className="ml-1 font-semibold">{parentName}</span>. Ative
                    "Personalizar Composição" no topo para editar.
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_110px_70px_110px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Ingrediente</span>
                  <span className="text-right">Qtd. (× {fr})</span>
                  <span className="text-center">Un.</span>
                  <span className="text-right">Custo</span>
                </div>
                {parentIngs.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    A ficha original ainda não tem ingredientes.
                  </p>
                )}
                {parentIngs.map((ing) => {
                  const qty = Number(ing.quantity) * fr;
                  const u = (ing.unit || "UN").toUpperCase();
                  let name = "—";
                  let cost = 0;
                  if (ing.item_id) {
                    const item = allItems.find((i) => i.id === ing.item_id);
                    if (item) {
                      name = item.name;
                      cost = ingredientItemCost(qty, u, item);
                    }
                  } else if (ing.sub_recipe_id) {
                    const sub = allRecipes.find((r) => r.id === ing.sub_recipe_id);
                    if (sub) {
                      name = sub.name;
                      if (u === "UN") cost = qty * subCostPerUn(sub);
                      else cost = qty * subCostPerKg(sub);
                    }
                  }
                  return (
                    <div
                      key={ing.id}
                      className="grid grid-cols-[1fr_110px_70px_110px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <span className="truncate text-sm">{name}</span>
                      <span className="text-right text-sm tabular-nums">
                        {qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                      </span>
                      <span className="text-center text-xs font-medium uppercase text-muted-foreground">
                        {u}
                      </span>
                      <span className="text-right text-sm font-semibold tabular-nums">
                        {cost > 0 ? fmtBRL(cost) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : (
          <>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_110px_70px_110px_36px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Ingrediente</span>
            <span className="text-right">Qtd.</span>
            <span className="text-center">Un.</span>
            <span className="text-right">Custo</span>
            <span></span>
          </div>

          {rows.map((row) => {
            const unit = unitFor(row);
            const cost = rowCost(row);
            const itemRef =
              row.sourceType === "item"
                ? allItems.find((i) => i.id === row.sourceId)
                : undefined;
            const subRef =
              row.sourceType === "sub"
                ? allRecipes.find((r) => r.id === row.sourceId)
                : undefined;
            const subWKg = subRef ? Number(subRef.unit_weight_g ?? 0) / 1000 : 0;
            const allowToggle = row.sourceType === "item"
              ? canToggleUnit(itemRef)
              : !!subRef && subWKg > 0;
            // Permite decimais quando: não é UN OU é alternável
            const allowDecimal = unit !== "UN" || allowToggle;
            return (
              <div
                key={row.key}
                className="grid grid-cols-[1fr_110px_70px_110px_36px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
              >
                <IngredientCombobox
                  value={
                    row.sourceId
                      ? {
                          type: row.sourceType,
                          id: row.sourceId,
                        }
                      : null
                  }
                  items={allItems}
                  subRecipes={allRecipes.filter(
                    (r) => r.type === "sub" && r.id !== recipe.id,
                  )}
                  finalRecipes={allRecipes.filter(
                    (r) => r.type === "final" && r.id !== recipe.id && r.is_active !== false,
                  )}
                  onSelect={(picked) => {
                    updateRow(row.key, {
                      sourceType: picked.type,
                      sourceId: picked.id,
                      unitOverride: "",
                    });
                    const updated = {
                      ...row,
                      sourceType: picked.type,
                      sourceId: picked.id,
                      unitOverride: "",
                    };
                    if (Number(updated.quantity) > 0) {
                      void persistRow(updated);
                    }
                  }}
                />

                <Input
                  type="number"
                  inputMode={allowDecimal ? "decimal" : "numeric"}
                  step={allowDecimal ? "0.001" : "1"}
                  min="0"
                  placeholder={allowDecimal ? "0,000" : "0"}
                  value={row.quantity}
                  onChange={(e) => {
                    const val = allowDecimal
                      ? e.target.value
                      : e.target.value.replace(/[.,]/g, "");
                    updateRow(row.key, { quantity: val });
                  }}
                  onBlur={() => void persistRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.currentTarget as HTMLInputElement).blur();
                      requestAnimationFrame(() => {
                        const next = document.querySelector<HTMLButtonElement>(
                          "[data-empty-row-trigger]",
                        );
                        next?.focus();
                      });
                    }
                  }}
                  className="h-9 text-right text-sm tabular-nums"
                  data-empty-row-trigger={
                    !row.sourceId && !row.quantity ? "true" : undefined
                  }
                />

                {allowToggle ? (
                  <Select
                    value={unit === "KG" ? "KG" : "UN"}
                    onValueChange={(v) => {
                      // Converte qty proporcionalmente ao trocar a unidade
                      const wKg = row.sourceType === "item"
                        ? itemUnitWeightKg(itemRef)
                        : subWKg;
                      const qtyNum = Number(row.quantity) || 0;
                      let newQty = row.quantity;
                      if (qtyNum > 0 && wKg > 0 && unit !== v) {
                        if (unit === "UN" && v === "KG") {
                          newQty = (qtyNum * wKg).toFixed(3);
                        } else if (unit === "KG" && v === "UN") {
                          newQty = (qtyNum / wKg).toFixed(3);
                        }
                      }
                      updateRow(row.key, {
                        unitOverride: v,
                        quantity: newQty,
                      });
                      const updated = {
                        ...row,
                        unitOverride: v,
                        quantity: newQty,
                      };
                      if (Number(updated.quantity) > 0) {
                        void persistRow(updated);
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UN">UN</SelectItem>
                      <SelectItem value="KG">KG</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-center text-xs font-medium uppercase text-muted-foreground">
                    {unit}
                  </div>
                )}

                <div className="text-right text-sm font-semibold tabular-nums">
                  {cost > 0 ? (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted underline-offset-2">
                            {fmtBRL(cost)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs">
                          {(() => {
                            if (row.sourceType !== "item" || !itemRef) {
                              return <span>Custo da produção interna proporcional ao rendimento.</span>;
                            }
                            const baseUnit = normalizeUnit(itemRef.unit);
                            const chosen = unit === "KG" || unit === "UN" ? unit : baseUnit;
                            const cp = Number(itemRef.cost_price ?? 0);
                            const qty = Number(row.quantity) || 0;
                            const wKg = itemUnitWeightKg(itemRef);
                            const avgG = Number(itemRef.avg_weight_g ?? 0);
                            const stdG = Number(itemRef.standard_weight_g ?? 0);
                            const weightSource = avgG > 0 ? "média real do estoque" : stdG > 0 ? "peso padrão cadastrado" : "—";
                            const toggle = canToggleUnit(itemRef);
                            // No modo toggle (Unidade Compartilhada), cost_price é R$/KG.
                            const storedLabel = toggle ? "KG" : baseUnit;
                            const perKg = toggle ? cp : (baseUnit === "UN" && wKg > 0 ? cp / wKg : baseUnit === "KG" ? cp : null);
                            const perUn = toggle && wKg > 0 ? cp * wKg : (baseUnit === "UN" ? cp : null);
                            const eff = effectiveUnitPrice(itemRef, chosen);
                            let line2 = "";
                            if (toggle && chosen === "UN" && wKg > 0) {
                              line2 = `${qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} UN × ${wKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg/UN = ${(qty * wKg).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
                            } else if (toggle && chosen === "KG" && wKg > 0) {
                              line2 = `${qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg ÷ ${wKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg/UN = ${(qty / wKg).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} UN`;
                            }
                            return (
                              <div className="space-y-1 text-xs">
                                <div className="font-semibold">{itemRef.name}</div>
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Preço Médio Estoque (tempo real)</div>
                                <div>
                                  {fmtBRL(cp)}/{storedLabel}
                                  {toggle && perUn !== null ? ` (≈ ${fmtBRL(perUn)}/UN)` : (perKg !== null && baseUnit === "UN" ? ` (≈ ${fmtBRL(perKg)}/kg)` : "")}
                                </div>
                                {line2 && <div className="text-muted-foreground">Conversão: {line2}</div>}
                                {line2 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    Peso usado: {wKg > 0 ? `${(wKg * 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g (${weightSource})` : "—"}
                                  </div>
                                )}
                                <div className="text-muted-foreground">
                                  {qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {chosen} × {fmtBRL(eff)}/{chosen}
                                </div>
                                <div className="border-t border-border/50 pt-1 font-medium">
                                  Custo: {fmtBRL(cost)}
                                </div>
                              </div>
                            );
                          })()}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    "—"
                  )}
                </div>

                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  onClick={() => void removeRow(row)}
                  disabled={!row.dbId && !row.sourceId && !row.quantity}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>

        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
        >
          <Plus className="h-4 w-4" /> Nova linha
        </Button>
          </>
        )}
      </div>

      {/* Rendimento Final (apenas Produção Interna) */}
      {!isFinal && (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Rendimento após preparo
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5 rounded-lg border border-border bg-background p-3">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Rendimento Total da Receita (KG)
              </Label>
              <Input
                type="number"
                step="0.001"
                min="0.001"
                value={pesoFinal}
                onChange={(e) => setPesoFinal(e.target.value)}
                onBlur={() => void persistPesoFinal()}
                placeholder="Ex: 4,800"
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                Peso real após cocção/preparo
              </p>
            </div>
            <Stat
              label="Fator de Correção"
              value={
                pesoBrutoKg > 0 && pesoFinalNum > 0
                  ? `${fatorCorrecao >= 0 ? "+" : ""}${fatorCorrecao.toFixed(1)}%`
                  : "—"
              }
              tone={
                pesoBrutoKg === 0 || pesoFinalNum === 0
                  ? "default"
                  : fatorCorrecao < -10
                    ? "warn"
                    : fatorCorrecao > 10
                      ? "ok"
                      : "default"
              }
              hint={
                pesoBrutoKg > 0 && pesoFinalNum > 0
                  ? fatorCorrecao < 0
                    ? `Perda de ${Math.abs(fatorCorrecao).toFixed(1)}%`
                    : `Ganho de ${fatorCorrecao.toFixed(1)}%`
                  : "Bruto vs. final"
              }
            />
            <Stat
              label="Custo por KG Final"
              value={fmtBRL(custoPorKg)}
              tone="ok"
              hint="Usado em outras fichas"
            />
          </div>

          {/* Peso da Porção Individual (KG) — opcional */}
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5 rounded-lg border border-dashed border-border bg-background p-3">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Peso da Porção Individual (KG) — opcional
              </Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={pesoPorcaoKg}
                onChange={(e) => setPesoPorcaoKg(e.target.value)}
                onBlur={() => persistUnitConfig(pesoPorcaoKg)}
                placeholder="Ex: 0,150"
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                Calcula automaticamente quantas porções a receita rende
              </p>
            </div>
            <Stat
              label="Rendimento estimado"
              value={
                rendimentoUnidades > 0
                  ? `${rendimentoUnidades.toFixed(rendimentoUnidades >= 10 ? 0 : 1)} Porções`
                  : "—"
              }
              tone={rendimentoUnidades > 0 ? "ok" : "default"}
              hint={
                pesoPorcaoKgNum > 0 && pesoFinalNum > 0
                  ? `${pesoFinalNum.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg ÷ ${pesoPorcaoKgNum.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`
                  : "Preencha o peso da porção"
              }
            />
            <Stat
              label="Custo por Porção"
              value={custoPorUnidade > 0 ? fmtBRL(custoPorUnidade) : "—"}
              tone={custoPorUnidade > 0 ? "ok" : "default"}
              hint="Referência por porção"
            />
          </div>
        </div>
      )}
      <div className="sticky bottom-0 -mx-5 -mb-5 grid grid-cols-2 items-center gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur md:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Custo total
          </p>
          <p className="text-lg font-bold tabular-nums">{fmtBRL(totalCost)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {isFinal ? "Custo de produção" : "Custo por KG"}
          </p>
          <p className="text-lg font-bold tabular-nums">
            {fmtBRL(isFinal ? custoProducao : custoPorKg)}
          </p>
        </div>
        {isFinal && (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                CMV real
              </p>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums",
                  precoRealNum === 0
                    ? "text-muted-foreground"
                    : cmvReal > 35
                      ? "text-destructive"
                      : cmvReal > 30
                        ? "text-amber-600"
                        : "text-emerald-600",
                )}
              >
                {precoRealNum > 0 ? `${cmvReal.toFixed(1)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Margem
              </p>
              <p className="text-lg font-bold tabular-nums">
                {precoRealNum > 0 ? `${margemReal.toFixed(1)}%` : "—"}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Custo de produção interna (auxiliar p/ rowCost)
function computeSubCost(
  recipeId: string,
  allRecipes: Recipe[],
  allItems: ItemLite[],
  allIngredients: Ingredient[],
): number {
  const cache = new Map<string, number>();
  const compute = (rid: string, stack: Set<string>): number => {
    if (cache.has(rid)) return cache.get(rid)!;
    if (stack.has(rid)) return 0;
    stack.add(rid);
    const ings = allIngredients.filter((i) => i.recipe_id === rid);
    let total = 0;
    for (const ing of ings) {
      if (ing.item_id) {
        const item = allItems.find((i) => i.id === ing.item_id);
        if (!item) continue;
        total += ingredientItemCost(Number(ing.quantity), ing.unit, item);
      } else if (ing.sub_recipe_id) {
        const sub = allRecipes.find((r) => r.id === ing.sub_recipe_id);
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
  return compute(recipeId, new Set());
}

function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "danger";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "ok" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ============ Combobox de ingrediente com autocomplete ============

type Picked = { type: "item" | "sub"; id: string };

function IngredientCombobox({
  value,
  items,
  subRecipes,
  finalRecipes = [],
  onSelect,
}: {
  value: Picked | null;
  items: ItemLite[];
  subRecipes: Recipe[];
  finalRecipes?: Recipe[];
  onSelect: (picked: Picked) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedItem = useMemo(() => {
    if (!value || value.type !== "item") return undefined;
    return items.find((i) => i.id === value.id);
  }, [value, items]);

  const label = useMemo(() => {
    if (!value) return null;
    if (value.type === "item") {
      return selectedItem ? `${selectedItem.name} (${normalizeUnit(selectedItem.unit)})` : null;
    }
    const sub = subRecipes.find((r) => r.id === value.id) ?? finalRecipes.find((r) => r.id === value.id);
    return sub ? sub.name : null;
  }, [value, selectedItem, subRecipes, finalRecipes]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between text-sm font-normal"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={cn("truncate", !label && "text-muted-foreground")}>
              {label ?? "Buscar ingrediente…"}
            </span>
            {selectedItem?.is_operational && <OperationalBadge size={12} />}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command
          filter={(value, search) => {
            const norm = (s: string) =>
              s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            return norm(value).includes(norm(search)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Digite para buscar…" />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            {items.length > 0 && (
              <CommandGroup heading="Insumos">
                {items.map((i) => {
                  const isSelected =
                    value?.type === "item" && value.id === i.id;
                  return (
                    <CommandItem
                      key={`item-${i.id}`}
                      value={`insumo ${i.name} ${normalizeUnit(i.unit)}`}
                      onSelect={() => {
                        onSelect({ type: "item", id: i.id });
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate">{i.name}</span>
                      {i.is_operational && <OperationalBadge size={12} className="ml-1" />}
                      <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                        {normalizeUnit(i.unit)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {subRecipes.length > 0 && (
              <CommandGroup heading="Produção Interna">
                {subRecipes.map((r) => {
                  const isSelected =
                    value?.type === "sub" && value.id === r.id;
                  return (
                    <CommandItem
                      key={`sub-${r.id}`}
                      value={`sub ${r.name}`}
                      onSelect={() => {
                        onSelect({ type: "sub", id: r.id });
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate">{r.name}</span>
                      <Soup className="ml-2 h-3 w-3 text-muted-foreground" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {finalRecipes.length > 0 && (
              <CommandGroup heading="Pratos Finais (combos)">
                {finalRecipes.map((r) => {
                  const isSelected = value?.type === "sub" && value.id === r.id;
                  return (
                    <CommandItem
                      key={`final-${r.id}`}
                      value={`prato ${r.name}`}
                      onSelect={() => {
                        onSelect({ type: "sub", id: r.id });
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate">{r.name}</span>
                      <Pizza className="ml-2 h-3 w-3 text-muted-foreground" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============ Combobox de categoria com criação inline ============

function CategoryCombobox({
  value,
  categories,
  onChange,
  compact = false,
}: {
  value: string | null;
  categories: RecipeCategory[];
  onChange: (id: string | null) => void | Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const orgId = useOrgId();

  const selected = value ? categories.find((c) => c.id === value) : null;
  const term = query.trim();
  const termLower = term.toLowerCase();
  const exactMatch = categories.some(
    (c) => c.name.toLowerCase() === termLower,
  );
  const canCreate = term.length > 0 && !exactMatch;

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");
      const { data, error } = await supabase
        .from("recipe_categories")
        .insert({ name: term, org_id: orgId })
        .select("id,name")
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["fichas"] });
      qc.invalidateQueries({ queryKey: ["recipe_categories"] });
      await onChange(data.id);
      setQuery("");
      setOpen(false);
      toast.success(`Categoria "${data.name}" criada`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "justify-between font-normal",
            compact
              ? "h-7 min-w-[140px] gap-1 border-dashed text-xs"
              : "h-10 w-full text-sm",
          )}
        >
          <span
            className={cn(
              "truncate",
              !selected && "text-muted-foreground",
            )}
          >
            {selected?.name ?? "Sem categoria"}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Buscar ou criar…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {term ? (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className="mx-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Criar "{term}"
                </button>
              ) : (
                "Nenhuma categoria."
              )}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__ sem categoria"
                onSelect={() => {
                  void onChange(null);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="text-muted-foreground">Sem categoria</span>
              </CommandItem>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => {
                    void onChange(c.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === c.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {canCreate && (
              <CommandGroup heading="Criar nova">
                <CommandItem
                  value={`__create__ ${term}`}
                  onSelect={() => void handleCreate()}
                  disabled={creating}
                >
                  <Plus className="mr-2 h-4 w-4 text-primary" />
                  <span className="flex-1 truncate">
                    Criar "<span className="font-semibold">{term}</span>"
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ManageCategoriesDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: RecipeCategory[];
}) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Para criar subcategoria sob um pai específico
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subName, setSubName] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["fichas"] });

  const parents = categories.filter((c) => !c.parent_id);
  const childrenByParent = new Map<string, RecipeCategory[]>();
  for (const c of categories) {
    if (c.parent_id) {
      const arr = childrenByParent.get(c.parent_id) ?? [];
      arr.push(c);
      childrenByParent.set(c.parent_id, arr);
    }
  }

  const createM = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: string | null }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe um nome");
      if (trimmed.toLowerCase() === "produção interna")
        throw new Error("Categoria reservada do sistema");
      const exists = categories.some(
        (c) =>
          c.name.toLowerCase() === trimmed.toLowerCase() &&
          (c.parent_id ?? null) === (parentId ?? null),
      );
      if (exists) throw new Error("Categoria já existe nesse nível");
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");
      const { error } = await supabase
        .from("recipe_categories")
        .insert({ name: trimmed, org_id: orgId, parent_id: parentId });
      if (error) throw error;
    },
    onSuccess: (_v, vars) => {
      toast.success(vars.parentId ? "Subcategoria criada" : "Categoria criada");
      if (vars.parentId) {
        setSubFor(null);
        setSubName("");
      } else {
        setNewName("");
      }
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameM = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe um nome");
      if (trimmed.toLowerCase() === "produção interna")
        throw new Error("Nome reservado do sistema");
      const { error } = await supabase
        .from("recipe_categories")
        .update({ name: trimmed })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria renomeada");
      setEditingId(null);
      setEditName("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      // Bloqueia exclusão de pai com filhas
      const hasChildren = categories.some((c) => c.parent_id === id);
      if (hasChildren)
        throw new Error("Exclua as subcategorias antes de excluir a categoria pai.");
      const upd = await supabase
        .from("recipes")
        .update({ category_id: null })
        .eq("category_id", id);
      if (upd.error) throw upd.error;
      const del = await supabase
        .from("recipe_categories")
        .delete()
        .eq("id", id);
      if (del.error) throw del.error;
    },
    onSuccess: () => {
      toast.success("Categoria excluída");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renderRow = (c: RecipeCategory, isChild = false) => {
    const isEditing = editingId === c.id;
    return (
      <div
        key={c.id}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
          isChild && "ml-5 border-dashed",
        )}
      >
        {isEditing ? (
          <>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  renameM.mutate({ id: c.id, name: editName });
                if (e.key === "Escape") {
                  setEditingId(null);
                  setEditName("");
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => renameM.mutate({ id: c.id, name: editName })}
              disabled={renameM.isPending}
            >
              Salvar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingId(null);
                setEditName("");
              }}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <>
            {isChild ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Tag className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="flex-1 truncate text-sm">{c.name}</span>
            {!isChild && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setSubFor(subFor === c.id ? null : c.id);
                  setSubName("");
                }}
                title="Adicionar subcategoria"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setEditingId(c.id);
                setEditName(c.name);
              }}
              title="Renomear"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (
                  confirm(
                    `Excluir "${c.name}"? Fichas vinculadas serão movidas para "Sem categoria".`,
                  )
                ) {
                  deleteM.mutate(c.id);
                }
              }}
              title="Excluir"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gerenciar Categorias</DialogTitle>
          <DialogDescription>
            Crie categorias e subcategorias (ex: Pizzas › Metades). A categoria
            &quot;Produção Interna&quot; é fixa do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Adicionar nova categoria pai */}
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nova categoria…"
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  createM.mutate({ name: newName, parentId: null });
              }}
            />
            <Button
              onClick={() => createM.mutate({ name: newName, parentId: null })}
              disabled={createM.isPending || !newName.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Produção Interna (fixa) */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Soup className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Produção Interna</span>
              <Badge variant="secondary" className="text-[10px]">
                Sistema
              </Badge>
            </div>
            <span className="text-[11px] text-muted-foreground">Fixa</span>
          </div>

          {/* Lista hierárquica */}
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {parents.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nenhuma categoria criada ainda.
              </p>
            )}
            {parents.map((p) => (
              <div key={p.id} className="space-y-1.5">
                {renderRow(p)}
                {subFor === p.id && (
                  <div className="ml-5 flex gap-2">
                    <Input
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      placeholder={`Subcategoria de "${p.name}"…`}
                      autoFocus
                      className="h-8"
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          createM.mutate({ name: subName, parentId: p.id });
                        if (e.key === "Escape") {
                          setSubFor(null);
                          setSubName("");
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() =>
                        createM.mutate({ name: subName, parentId: p.id })
                      }
                      disabled={createM.isPending || !subName.trim()}
                    >
                      Criar
                    </Button>
                  </div>
                )}
                {(childrenByParent.get(p.id) ?? []).map((c) => renderRow(c, true))}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OverrideRow = {
  id?: string;
  location_id: string;
  sale_price: number;
  cost_override: number | null;
};

function RecipeOverridesDialog({
  open,
  onOpenChange,
  recipe,
  locations,
  baseCost,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipe: Recipe;
  locations: LocationLite[];
  baseCost: number;
  onChanged: () => void;
}) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const { data: overrides, isLoading } = useQuery({
    queryKey: ["recipe_unit_overrides", recipe.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_unit_overrides")
        .select("id,location_id,sale_price,cost_override")
        .eq("recipe_id", recipe.id);
      if (error) throw error;
      return (data ?? []) as OverrideRow[];
    },
  });

  const [rows, setRows] = useState<OverrideRow[]>([]);
  useEffect(() => {
    if (overrides) setRows(overrides);
  }, [overrides]);

  const eligible = locations.filter(
    (l) => l.location_type === "cd" || l.location_type === "unit",
  );

  const upsert = useMutation({
    mutationFn: async (row: OverrideRow) => {
      if (!orgId) throw new Error("Organização não identificada");
      if (row.id) {
        const { error } = await supabase
          .from("recipe_unit_overrides")
          .update({
            sale_price: row.sale_price,
            cost_override: row.cost_override,
          })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("recipe_unit_overrides").insert({
          org_id: orgId,
          recipe_id: recipe.id,
          location_id: row.location_id,
          sale_price: row.sale_price,
          cost_override: row.cost_override,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Preço por unidade salvo");
      qc.invalidateQueries({ queryKey: ["recipe_unit_overrides", recipe.id] });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("recipe_unit_overrides")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe_unit_overrides", recipe.id] });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addLocation = (locId: string) => {
    if (rows.some((r) => r.location_id === locId)) return;
    setRows([
      ...rows,
      { location_id: locId, sale_price: recipe.sale_price ?? 0, cost_override: null },
    ]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preços por unidade — {recipe.name}</DialogTitle>
          <DialogDescription>
            Defina um preço de venda específico para cada unidade. Quando vazio, o
            preço padrão da ficha ({fmtBRL(recipe.sale_price ?? 0)}) é usado.
            Custo padrão: {fmtBRL(baseCost)}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_140px_140px_auto] gap-2 border-b pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Unidade</span>
              <span className="text-right">Preço (R$)</span>
              <span className="text-right">Custo manual (opc.)</span>
              <span></span>
            </div>
            {rows.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Nenhum preço específico definido.
              </p>
            )}
            {rows.map((row, idx) => {
              const loc = locations.find((l) => l.id === row.location_id);
              const cmv =
                row.sale_price > 0
                  ? ((row.cost_override ?? baseCost) / row.sale_price) * 100
                  : 0;
              return (
                <div
                  key={row.location_id}
                  className="grid grid-cols-[1fr_140px_140px_auto] items-center gap-2"
                >
                  <div>
                    <p className="text-sm font-medium">{loc?.name ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      CMV {row.sale_price > 0 ? `${cmv.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.sale_price}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, sale_price: v } : r)),
                      );
                    }}
                    onBlur={() => upsert.mutate(rows[idx])}
                    className="text-right"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="auto"
                    value={row.cost_override ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const v = raw === "" ? null : Number(raw);
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === idx ? { ...r, cost_override: v } : r,
                        ),
                      );
                    }}
                    onBlur={() => upsert.mutate(rows[idx])}
                    className="text-right"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (row.id) remove.mutate(row.id);
                      setRows((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}

            <div className="pt-2">
              <Select onValueChange={addLocation} value="">
                <SelectTrigger>
                  <SelectValue placeholder="+ Adicionar unidade" />
                </SelectTrigger>
                <SelectContent>
                  {eligible
                    .filter((l) => !rows.some((r) => r.location_id === l.id))
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
