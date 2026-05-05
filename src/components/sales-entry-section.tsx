import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Upload,
  Plus,
  Minus,
  Link2,
  ChevronDown,
  ShoppingCart,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * SalesEntrySection — Vendas do turno
 *
 * Suporta:
 * 1. Importação automática de CSV (ConnectPlug e similares) com detecção de
 *    colunas Nome do produto / Quantidade.
 * 2. Modal de vínculo Venda → Ficha Técnica (persistido em sales_item_mappings).
 * 3. Lançamento manual agrupado por categoria das fichas técnicas (ou da
 *    categoria do item, quando configurado).
 *
 * Retorna ao pai um Map<recipe_id, quantity_sold> via onSalesChange.
 */

export type SalesMap = Map<string, number>; // recipe_id -> qty

type Recipe = {
  id: string;
  name: string;
  type: string;
  category_id: string | null;
  explode_on_consume?: boolean;
  sale_price?: number | null;
  unit_location_id?: string | null;
};
type RecipeCategory = { id: string; name: string };
type UnitOverride = {
  recipe_id: string;
  location_id: string;
  sale_price: number | null;
};

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(n) ? n : 0);

type Mapping = {
  id: string;
  source_name: string;
  external_code: string | null;
  recipe_id: string;
  multiplier: number;
};

type Unmapped = {
  /** Código original do CSV (ex.: "90", "126_712"). Vazio se não houver. */
  source_code: string;
  /** Nome curto exibido (parte antes do primeiro "-" do campo Produto). */
  display_name: string;
  qty: number;
  /** Receita bruta apurada para esse código. */
  revenue: number;
};

/** Extrai o "nome curto" do produto: tudo antes do primeiro " - ". */
function shortName(raw: string): string {
  if (!raw) return "";
  const idx = raw.indexOf(" - ");
  if (idx < 0) {
    const dash = raw.indexOf("-");
    return (dash > 0 ? raw.slice(0, dash) : raw).trim();
  }
  return raw.slice(0, idx).trim();
}

/** Parser de valor monetário BR ("R$ 36,90", "R$ -41,19"). */
function parseMoneyBR(raw: string): number {
  if (!raw) return 0;
  const s = raw.replace(/[^0-9,.\-]/g, "").trim();
  if (!s) return 0;
  let n = s;
  if (n.includes(",") && n.includes(".")) n = n.replace(/\./g, "").replace(",", ".");
  else if (n.includes(",")) n = n.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

interface Props {
  sales: SalesMap;
  onSalesChange: (m: SalesMap) => void;
  /** Local da operação atual — usado p/ buscar overrides de preço por unidade. */
  locationId?: string;
}

// Parser CSV simples e tolerante (suporta `,`, `;` e `\t` como separador,
// remove BOM, ignora linhas vazias e normaliza aspas duplas).
function parseCsv(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, "");
  // Detecta separador pela primeira linha não vazia.
  const firstLine = cleaned.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  let sep = ",";
  const semis = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  if (semis > commas && semis >= tabs) sep = ";";
  else if (tabs > commas && tabs > semis) sep = "\t";

  const out: string[][] = [];
  for (const raw of cleaned.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        if (inQ && raw[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === sep && !inQ) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    out.push(cols.map((c) => c.trim()));
  }
  return out;
}

// Detecta colunas: produto/descrição e quantidade.
function detectColumns(header: string[]): { name: number; qty: number } {
  const norm = header.map((h) =>
    h
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim(),
  );
  const nameKeys = ["produto", "nome", "descricao", "item", "mercadoria"];
  const qtyKeys = ["quantidade", "qtd", "qtde", "qty", "vendido", "vendidos", "qt"];
  let nameIdx = norm.findIndex((h) => nameKeys.some((k) => h === k || h.includes(k)));
  let qtyIdx = norm.findIndex((h) => qtyKeys.some((k) => h === k || h.includes(k)));
  if (nameIdx < 0) nameIdx = 0;
  if (qtyIdx < 0) {
    // Heurística: pega a primeira coluna numérica que NÃO seja a de nome
    qtyIdx = norm.findIndex((_, i) => i !== nameIdx);
    if (qtyIdx < 0) qtyIdx = 1;
  }
  return { name: nameIdx, qty: qtyIdx };
}

function parseQty(raw: string): number {
  if (!raw) return 0;
  // Trata "1.234,56" (BR) e "1234.56" (US)
  let s = raw.trim();
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export function SalesEntrySection({ sales, onSalesChange, locationId }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["sales-entry-data", locationId ?? null],
    queryFn: async () => {
      const [recipes, recipeCats, items, itemCats, mappings, overrides] = await Promise.all([
        supabase
          .from("recipes")
          .select("id,name,type,category_id,explode_on_consume,sale_price,unit_location_id")
          .eq("is_active", true)
          .order("name"),
        supabase.from("recipe_categories").select("id,name").order("name"),
        supabase
          .from("items")
          .select("id,name,category_id")
          .eq("is_active", true)
          .eq("is_free", false)
          .order("name"),
        supabase.from("categories").select("id,name").order("name"),
        supabase.from("sales_item_mappings").select("id,source_name,recipe_id,multiplier"),
        locationId
          ? supabase
              .from("recipe_unit_overrides")
              .select("recipe_id,location_id,sale_price")
              .eq("location_id", locationId)
          : Promise.resolve({ data: [] as UnitOverride[], error: null }),
      ]);
      if (recipes.error) throw recipes.error;
      if (recipeCats.error) throw recipeCats.error;
      if (items.error) throw items.error;
      if (itemCats.error) throw itemCats.error;
      if (mappings.error) throw mappings.error;
      if ((overrides as { error: unknown }).error) throw (overrides as { error: Error }).error;
      return {
        recipes: (recipes.data ?? []) as Recipe[],
        recipeCats: (recipeCats.data ?? []) as RecipeCategory[],
        items: items.data ?? [],
        itemCats: itemCats.data ?? [],
        mappings: (mappings.data ?? []) as Mapping[],
        overrides: ((overrides as { data: UnitOverride[] | null }).data ?? []) as UnitOverride[],
      };
    },
  });

  /** Mapa recipe_id -> preço efetivo na unidade ativa (override > sale_price). */
  const priceByRecipe = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    const ov = new Map<string, number>();
    data.overrides.forEach((o) => {
      if (o.sale_price != null) ov.set(o.recipe_id, Number(o.sale_price));
    });
    data.recipes.forEach((r) => {
      const override = ov.get(r.id);
      const base = Number(r.sale_price ?? 0);
      m.set(r.id, override ?? base);
    });
    return m;
  }, [data]);

  // Index para lookup rápido por nome (lowercased).
  const mappingByName = useMemo(() => {
    const m = new Map<string, Mapping>();
    data?.mappings.forEach((x) => m.set(x.source_name.trim().toLowerCase(), x));
    return m;
  }, [data]);

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    data?.recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [data]);

  // Agrupa fichas por categoria de receita (com fallback para "Sem Categoria").
  // Fichas finais aparecem sempre; produção interna e itens só caso já estejam
  // vinculadas a alguma venda manual no futuro (mantemos final para foco em vendas).
  const grouped = useMemo(() => {
    if (!data) return [] as { catId: string; catName: string; recipes: Recipe[] }[];
    const map = new Map<string, { catName: string; recipes: Recipe[] }>();
    const catName = (id: string | null) => {
      if (!id) return "Sem Categoria";
      return data.recipeCats.find((c) => c.id === id)?.name ?? "Sem Categoria";
    };
    for (const r of data.recipes.filter((r) => r.type === "final")) {
      const key = r.category_id ?? "__none__";
      const entry = map.get(key) ?? { catName: catName(r.category_id), recipes: [] };
      entry.recipes.push(r);
      map.set(key, entry);
    }
    return Array.from(map.entries()).map(([catId, v]) => ({
      catId,
      catName: v.catName,
      recipes: v.recipes,
    }));
  }, [data]);

  // ============= IMPORT CSV =============

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) {
        toast.error("CSV vazio ou sem dados além do cabeçalho.");
        return;
      }
      const { name: nameIdx, qty: qtyIdx } = detectColumns(rows[0]);
      const accum = new Map<string, number>(); // source_name (lowercased) -> qty total
      const display = new Map<string, string>(); // lowercased -> nome original
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawName = (row[nameIdx] ?? "").trim();
        const rawQty = (row[qtyIdx] ?? "").trim();
        if (!rawName) continue;
        const q = parseQty(rawQty);
        if (q <= 0) continue;
        const key = rawName.toLowerCase();
        accum.set(key, (accum.get(key) ?? 0) + q);
        if (!display.has(key)) display.set(key, rawName);
      }
      if (accum.size === 0) {
        toast.error("Não consegui identificar produtos e quantidades.");
        return;
      }

      // Aplica vínculos existentes; coleta os não mapeados.
      const newSales = new Map(sales);
      const pending: Unmapped[] = [];
      accum.forEach((qty, key) => {
        const map = mappingByName.get(key);
        if (map) {
          const recId = map.recipe_id;
          const mult = Number(map.multiplier || 1);
          newSales.set(recId, (newSales.get(recId) ?? 0) + qty * mult);
        } else {
          pending.push({ source_name: display.get(key) ?? key, qty });
        }
      });
      onSalesChange(newSales);
      const importedCount = accum.size - pending.length;
      toast.success(
        `${importedCount} ${importedCount === 1 ? "produto importado" : "produtos importados"}` +
          (pending.length > 0
            ? ` · ${pending.length} aguardam vínculo`
            : ""),
      );
      if (pending.length > 0) {
        setUnmapped(pending);
        setMappingOpen(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ============= MAPPING MUTATION =============

  const saveMapping = useMutation({
    mutationFn: async ({ source_name, recipe_id }: { source_name: string; recipe_id: string }) => {
      const { error } = await supabase
        .from("sales_item_mappings")
        .upsert(
          { source_name, recipe_id, multiplier: 1 },
          { onConflict: "org_id,source_name" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-entry-data"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linkUnmapped = (sourceName: string, qty: number, recipeId: string) => {
    saveMapping.mutate({ source_name: sourceName, recipe_id: recipeId });
    const newSales = new Map(sales);
    newSales.set(recipeId, (newSales.get(recipeId) ?? 0) + qty);
    onSalesChange(newSales);
    setUnmapped((prev) => prev.filter((u) => u.source_name !== sourceName));
  };

  // ============= MANUAL ENTRY =============

  const inc = (recipeId: string, delta: number) => {
    const cur = sales.get(recipeId) ?? 0;
    const next = Math.max(0, cur + delta);
    const m = new Map(sales);
    if (next === 0) m.delete(recipeId);
    else m.set(recipeId, next);
    onSalesChange(m);
  };

  const setManual = (recipeId: string, raw: string) => {
    const v = parseQty(raw);
    const m = new Map(sales);
    if (v <= 0) m.delete(recipeId);
    else m.set(recipeId, v);
    onSalesChange(m);
  };

  const totalSold = useMemo(
    () => Array.from(sales.values()).reduce((a, b) => a + b, 0),
    [sales],
  );

  const totalRevenue = useMemo(() => {
    let s = 0;
    sales.forEach((qty, rid) => {
      s += qty * (priceByRecipe.get(rid) ?? 0);
    });
    return s;
  }, [sales, priceByRecipe]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map((g) => ({ ...g, recipes: g.recipes.filter((r) => r.name.toLowerCase().includes(q)) }))
      .filter((g) => g.recipes.length > 0);
  }, [grouped, search]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Vendas do turno</h3>
          {totalSold > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {totalSold.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} vendidos
            </Badge>
          )}
          {totalRevenue > 0 && (
            <Badge variant="default" className="tabular-nums">
              {fmtBRL(totalRevenue)}
            </Badge>
          )}
          {unmapped.length > 0 && (
            <Badge
              variant="outline"
              className="cursor-pointer gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              onClick={() => setMappingOpen(true)}
            >
              <AlertCircle className="h-3 w-3" />
              {unmapped.length} para vincular
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Importar Vendas CSV
          </Button>
        </div>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar produto…"
        className="h-9"
      />

      <div className="max-h-[40vh] space-y-1 overflow-y-auto">
        {filteredGroups.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nenhuma ficha técnica cadastrada.
          </p>
        ) : (
          filteredGroups.map((g) => (
            <CategoryGroup
              key={g.catId}
              name={g.catName}
              recipes={g.recipes}
              sales={sales}
              priceByRecipe={priceByRecipe}
              onInc={inc}
              onSet={setManual}
              defaultOpen={!!search}
            />
          ))
        )}
      </div>

      {/* Modal de vínculo */}
      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Vincular produtos do CSV às fichas técnicas
            </DialogTitle>
            <DialogDescription>
              Esses produtos do CSV ainda não têm vínculo. Selecione a ficha
              correspondente — o vínculo será salvo para as próximas importações.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {unmapped.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Tudo vinculado! 🎉
              </p>
            ) : (
              unmapped.map((u) => (
                <div
                  key={u.source_name}
                  className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.source_name}</p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {u.qty.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} vendido(s)
                    </p>
                  </div>
                  <RecipePicker
                    recipes={data?.recipes ?? []}
                    onPick={(rid) => linkUnmapped(u.source_name, u.qty, rid)}
                  />
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMappingOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryGroup({
  name,
  recipes,
  sales,
  priceByRecipe,
  onInc,
  onSet,
  defaultOpen,
}: {
  name: string;
  recipes: Recipe[];
  sales: SalesMap;
  priceByRecipe: Map<string, number>;
  onInc: (id: string, delta: number) => void;
  onSet: (id: string, raw: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const total = useMemo(
    () => recipes.reduce((a, r) => a + (sales.get(r.id) ?? 0), 0),
    [recipes, sales],
  );
  const subtotal = useMemo(
    () =>
      recipes.reduce(
        (a, r) => a + (sales.get(r.id) ?? 0) * (priceByRecipe.get(r.id) ?? 0),
        0,
      ),
    [recipes, sales, priceByRecipe],
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-md border border-border bg-background"
    >
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="flex-1 text-sm font-medium">{name}</span>
          <Badge variant="outline" className="text-[10px]">
            {recipes.length} {recipes.length === 1 ? "ficha" : "fichas"}
          </Badge>
          {total > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {total.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
            </Badge>
          )}
          {subtotal > 0 && (
            <Badge variant="default" className="tabular-nums">
              {fmtBRL(subtotal)}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border border-t border-border">
          {recipes.map((r) => {
            const qty = sales.get(r.id) ?? 0;
            const price = priceByRecipe.get(r.id) ?? 0;
            return (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                {price > 0 && (
                  <span className="hidden text-[10px] text-muted-foreground tabular-nums sm:inline">
                    {fmtBRL(price)}
                  </span>
                )}
                {r.explode_on_consume && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-[9px] uppercase text-amber-700 dark:text-amber-400"
                    title="Esta ficha baixa direto os insumos brutos (explosão)"
                  >
                    explode
                  </Badge>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => onInc(r.id, -1)}
                  disabled={qty <= 0}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={qty === 0 ? "" : String(qty)}
                  onChange={(e) => onSet(r.id, e.target.value)}
                  placeholder="0"
                  className="h-7 w-14 text-center tabular-nums"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => onInc(r.id, 1)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RecipePicker({
  recipes,
  onPick,
}: {
  recipes: Recipe[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Link2 className="h-3.5 w-3.5" />
          Vincular
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Buscar ficha…" />
          <CommandList>
            <CommandEmpty>Nenhuma ficha.</CommandEmpty>
            <CommandGroup>
              {recipes.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.name}
                  onSelect={() => {
                    onPick(r.id);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{r.name}</span>
                  {r.type !== "final" && (
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      sub
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
