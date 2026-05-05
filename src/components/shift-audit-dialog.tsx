import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { consumeStockReal } from "@/lib/fefo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ClipboardCheck,
  Search,
  Settings2,
  AlertTriangle,
  ArrowLeft,
  Plus,
  X,
  Trash2,
  UtensilsCrossed,
  Flame,
  Gift,
  Info,
  PackagePlus,
} from "lucide-react";

/**
 * Avalia uma expressão aritmética simples (apenas + - * / e parênteses).
 * Retorna NaN se a expressão for inválida ou conter caracteres não permitidos.
 * Aceita vírgula como separador decimal.
 */
function evalCalc(input: string): number {
  if (!input) return 0;
  const cleaned = String(input).replace(/,/g, ".").trim();
  if (cleaned === "") return 0;
  // Apenas dígitos, ponto, espaço, parênteses e operadores +-*/
  if (!/^[0-9+\-*/().\s]+$/.test(cleaned)) return Number(cleaned);
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${cleaned});`)();
    return typeof v === "number" && Number.isFinite(v) ? v : Number(cleaned);
  } catch {
    return Number(cleaned);
  }
}
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useManagerMode } from "@/lib/manager-mode";
import { SalesEntrySection, type SalesMap } from "./sales-entry-section";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locationId: string;
  locationName: string;
}

type EntryState = {
  opening: string;
  entries: string; // entradas/reforço durante o turno
  final: string;
  staff: string;
  waste: string;
  unitMode?: "KG" | "UN"; // alternância p/ itens com porcionamento
};

const emptyEntry: EntryState = { opening: "", entries: "", final: "", staff: "", waste: "" };

type PickKind = "ficha" | "sub" | "insumo";
type Channel = "staff" | "waste" | "courtesy";
type Lancamento = {
  key: string;
  channel: Channel;
  kind: PickKind;
  refId: string;
  name: string;
  unit: string;
  qty: string;
  reason?: string;
  /** Peso da porção (g) para itens/produção interna porcionados; 0 se não aplicável. */
  portionG?: number;
  /** Unidade base do estoque (KG ou UN) — para onde converter ao salvar. */
  baseUnit?: "KG" | "UN";
  /** Modo atual de exibição/digitação para este lançamento. */
  unitMode?: "KG" | "UN";
};

/** Converte um valor entre KG e UN usando o peso da porção (g). */
function convertUnit(
  value: number,
  from: "KG" | "UN",
  to: "KG" | "UN",
  portionG: number,
): number {
  if (from === to) return value;
  if (!portionG || portionG <= 0) return value;
  if (from === "KG" && to === "UN") return value / (portionG / 1000);
  // UN -> KG
  return value * (portionG / 1000);
}

/**
 * Resolve a unidade BASE (canônica) usada para armazenar valores no banco.
 * Regra: quando há peso por porção (portionG > 0), o valor armazenado em
 * stock_levels é tratado como KG. O Toggle apenas muda a forma de visualizar
 * (KG = valor cru; UN = valor cru / porção).
 */
function resolveBaseMode(itemUnit: string | undefined | null, portionG: number): "KG" | "UN" {
  if (portionG > 0) return "KG";
  return (itemUnit || "un").toUpperCase() === "KG" ? "KG" : "UN";
}

/** Formata um número como string para preencher campo de input (sem notação científica). */
function fmtForField(n: number): string {
  if (!Number.isFinite(n)) return "";
  // até 3 casas, sem zeros à direita inúteis
  return String(Number(n.toFixed(3)));
}

const WASTE_REASONS = [
  "Queimado",
  "Estragado",
  "Erro de produção",
  "Vencido",
  "Caiu/Contaminado",
  "Outro",
];

const PRODUCAO_PROPRIA_NAME = "Produção Própria";

function kindLabel(k: PickKind) {
  if (k === "ficha") return "Ficha";
  if (k === "sub") return "Produção Interna";
  return "Insumo";
}
function kindBadgeClass(k: PickKind) {
  if (k === "ficha") return "bg-primary/15 text-primary border-primary/30";
  if (k === "sub") return "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400";
}

export function ShiftAuditDialog({ open, onOpenChange, locationId, locationName }: Props) {
  const qc = useQueryClient();
  const { isManager } = useManagerMode();
  const [search, setSearch] = useState("");
  const [shiftLabel, setShiftLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [manageMode, setManageMode] = useState(false);
  const [entries, setEntries] = useState<Record<string, EntryState>>({});
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [sales, setSales] = useState<SalesMap>(new Map());

  const { data, isLoading } = useQuery({
    enabled: open,
    queryKey: ["shift-audit-data-v2", locationId],
    queryFn: async () => {
      const [items, stock, recipes, ingredients, categories, locations, overrides] =
        await Promise.all([
          supabase
            .from("items")
            .select("id,name,unit,monitor_daily,category_id,shared_unit_enabled,avg_weight_g,standard_weight_g")
            .eq("is_active", true)
            .eq("is_free", false)
            .order("name"),
          supabase
            .from("stock_levels")
            .select("item_id,location_id,current_stock"),
          supabase
            .from("recipes")
            .select("id,name,type,yield_quantity,yield_unit,unit_weight_g,explode_on_consume,produced_item_id")
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("recipe_ingredients")
            .select("id,recipe_id,item_id,sub_recipe_id,quantity,unit"),
          supabase.from("categories").select("id,name"),
          supabase.from("locations").select("id,name,stock_mode"),
          supabase
            .from("location_item_stock_overrides")
            .select("item_id,skip_auto_deduction")
            .eq("location_id", locationId),
        ]);
      if (items.error) throw items.error;
      if (stock.error) throw stock.error;
      if (recipes.error) throw recipes.error;
      if (ingredients.error) throw ingredients.error;
      if (categories.error) throw categories.error;
      if (locations.error) throw locations.error;
      if (overrides.error) throw overrides.error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: moves, error: e } = await supabase
        .from("movements")
        .select("item_id,quantity,type,from_location_id,to_location_id,created_at")
        .gte("created_at", today.toISOString())
        .eq("to_location_id", locationId);
      if (e) throw e;

      const receivedMap = new Map<string, number>();
      moves?.forEach((m) => {
        if (m.from_location_id === locationId) return;
        receivedMap.set(m.item_id, (receivedMap.get(m.item_id) ?? 0) + Number(m.quantity));
      });

      // Última produção real por item (production_in) — para extrair peso real por unidade
      // a partir do "note" gravado pelo módulo de produção.
      const { data: prodMoves } = await supabase
        .from("movements")
        .select("item_id,quantity,note,created_at,type")
        .eq("type", "production_in")
        .order("created_at", { ascending: false })
        .limit(500);
      const lastUnitWeightG = new Map<string, number>();
      prodMoves?.forEach((m) => {
        if (lastUnitWeightG.has(m.item_id)) return;
        // Tenta extrair peso unitário (g/un) ou unidades+peso total do note
        const note = String(m.note || "");
        // padrões: "0.255 kg/un", "255g/un", "Unidades: 66", "Peso: 16.318 kg"
        let g = 0;
        const mPerUn = note.match(/([\d.,]+)\s*(kg|g)\s*\/\s*un/i);
        if (mPerUn) {
          const v = Number(mPerUn[1].replace(",", "."));
          g = mPerUn[2].toLowerCase() === "kg" ? v * 1000 : v;
        }
        if (!g) {
          const mUn = note.match(/(?:Unidades?|Un)\s*[:=]?\s*([\d.,]+)/i);
          const mPeso = note.match(/(?:Peso|Total)\s*[:=]?\s*([\d.,]+)\s*(kg|g)?/i);
          const units = mUn ? Number(mUn[1].replace(",", ".")) : 0;
          if (mPeso && units > 0) {
            const v = Number(mPeso[1].replace(",", "."));
            const totalG = (mPeso[2] ?? "kg").toLowerCase() === "g" ? v : v * 1000;
            g = totalG / units;
          }
        }
        if (g > 0) lastUnitWeightG.set(m.item_id, g);
      });

      // Mapeia overrides item→skip para esta operação
      const overrideMap = new Map<string, boolean>();
      (overrides.data ?? []).forEach((o) => {
        overrideMap.set(String(o.item_id), o.skip_auto_deduction === true);
      });
      const currentLoc = locations.data?.find((l) => l.id === locationId) ?? null;
      const centralLoc =
        locations.data?.find(
          (l) => String(l.name ?? "").trim().toLowerCase() === "estoque central",
        ) ?? null;

      // O resto do código assume `data.stock` filtrado pela operação. Mantemos
      // esse formato; mas guardamos `stockAll` para resolver baixas em modo
      // Venda Direta (precisamos do saldo do Central).
      const localStock = (stock.data ?? []).filter((s) => s.location_id === locationId);

      return {
        items: items.data,
        stock: localStock,
        stockAll: stock.data ?? [],
        received: receivedMap,
        recipes: recipes.data,
        ingredients: ingredients.data,
        categories: categories.data,
        lastUnitWeightG,
        currentLocation: currentLoc,
        centralLocation: centralLoc,
        overrideMap,
      };
    },
  });

  useEffect(() => {
    if (!open) {
      setEntries({});
      setSearch("");
      setShiftLabel("");
      setNotes("");
      setManageMode(false);
      setLancamentos([]);
      setSales(new Map());
    }
  }, [open]);

  const producaoCatId = useMemo(
    () =>
      data?.categories.find(
        (c) => c.name.trim().toLowerCase() === PRODUCAO_PROPRIA_NAME.toLowerCase(),
      )?.id ?? null,
    [data],
  );

  // Item de Produção Própria vinculado a uma produção interna (pelo nome)
  const subItemFor = (subRecipeId: string) => {
    if (!data) return null;
    const sub = data.recipes.find((r) => r.id === subRecipeId);
    if (!sub) return null;
    return (
      data.items.find(
        (i) =>
          i.category_id === producaoCatId &&
          i.name.trim().toLowerCase() === sub.name.trim().toLowerCase(),
      ) ?? null
    );
  };

  const monitored = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.items
      .filter((i) => i.monitor_daily)
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .map((i) => {
        const opening = Number(data.stock.find((s) => s.item_id === i.id)?.current_stock ?? 0);
        const received = Number(data.received.get(i.id) ?? 0);
        const isSubproduct = i.category_id === producaoCatId;
        // Fator único de conversão UN<->KG: items.avg_weight_g (média ponderada
        // recalculada a cada produção/NF). Fallbacks: produção real recente →
        // ficha técnica → standard_weight_g (apenas para itens sem histórico).
        const realG = Number(data.lastUnitWeightG.get(i.id) || 0);
        const recipeRef = isSubproduct
          ? data.recipes.find(
              (r) => r.name.trim().toLowerCase() === i.name.trim().toLowerCase(),
            )
          : null;
        const recipeG = Number((recipeRef as { unit_weight_g?: number } | null | undefined)?.unit_weight_g || 0);
        const avgG = Number(i.avg_weight_g || 0);
        const stdG = Number(i.standard_weight_g || 0);
        const portionG = avgG > 0 ? avgG : realG > 0 ? realG : recipeG > 0 ? recipeG : stdG;
        const portionSource: "real" | "recipe" | "avg" | "std" | "none" =
          avgG > 0 ? "avg" : realG > 0 ? "real" : recipeG > 0 ? "recipe" : stdG > 0 ? "std" : "none";
        const allowUnitToggle = !!i.shared_unit_enabled || isSubproduct || portionG > 0;
        return {
          ...i,
          opening,
          received,
          isSubproduct,
          portionG,
          portionSource,
          allowUnitToggle,
        };
      });
  }, [data, search, producaoCatId]);

  const allItemsFiltered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.items.filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [data, search]);

  /**
   * Soma o consumo esperado por item (em unidade BASE), considerando vendas
   * (explode fichas) + baixas operacionais (lancamentos). Usado para confronto
   * com a contagem dos itens monitorados → gera a quebra real do turno.
   */
  const expectedByItem = useMemo(() => {
    const out = new Map<string, number>();
    if (!data) return out;
    sales.forEach((qty, recipeId) => {
      if (!qty || qty <= 0) return;
      const tmp = new Map<string, number>();
      explodeRecipe(recipeId, qty, tmp);
      tmp.forEach((q, itemId) => out.set(itemId, (out.get(itemId) ?? 0) + q));
    });
    for (const l of lancamentos) {
      const d = resolveDeductions(l);
      d.forEach((q, itemId) => out.set(itemId, (out.get(itemId) ?? 0) + q));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sales, lancamentos]);

  const setField = (itemId: string, field: keyof EntryState, value: string) => {
    setEntries((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? emptyEntry), [field]: value },
    }));
  };

  /**
   * Alterna a unidade de exibição (KG/UN) para um item monitorado e
   * RECALCULA os valores nos campos (Inicial, Entradas, Final) de forma
   * instantânea, usando o peso da porção do item. Também converte o campo
   * 'waste' (descarte) e 'staff' (alimentação) se preenchidos.
   */
  const setUnitMode = (itemId: string, mode: "KG" | "UN", portionG: number) => {
    setEntries((prev) => {
      const cur = prev[itemId] ?? emptyEntry;
      const from: "KG" | "UN" = cur.unitMode ?? "KG";
      // Se o modo atual já é o desejado, não faz nada.
      if (from === mode) return { ...prev, [itemId]: { ...cur, unitMode: mode } };
      const convertField = (v: string): string => {
        if (!v || v.trim() === "") return v;
        const num = evalCalc(v);
        if (!Number.isFinite(num) || num === 0) return v;
        return fmtForField(convertUnit(num, from, mode, portionG));
      };
      return {
        ...prev,
        [itemId]: {
          ...cur,
          opening: convertField(cur.opening),
          entries: convertField(cur.entries),
          final: convertField(cur.final),
          staff: convertField(cur.staff),
          waste: convertField(cur.waste),
          unitMode: mode,
        },
      };
    });
  };

  // Consumo Real = (Inicial + Entradas) - Final  (descontando staff/waste registrados como lançamentos)
  // Os valores digitados estão na unitMode atual; convertemos para a base (m.unit) antes de operar.
  const computeVariance = (
    systemOpening: number,
    received: number,
    e: EntryState,
    baseMode: "KG" | "UN",
    portionG: number,
  ) => {
    const mode = e.unitMode ?? baseMode;
    const toBase = (v: number) => convertUnit(v, mode, baseMode, portionG);
    const opening = e.opening !== "" ? toBase(evalCalc(e.opening)) : systemOpening;
    const entradas = toBase(evalCalc(e.entries || "0"));
    const staff = toBase(evalCalc(e.staff || "0"));
    const waste = toBase(evalCalc(e.waste || "0"));
    const finalCount = toBase(evalCalc(e.final || "0"));
    return opening + received + entradas - staff - waste - finalCount;
  };

  // Consumo real (gestão): (Inicial + Entradas manuais) - Final, retornado na unidade de exibição.
  const computeConsumo = (
    systemOpening: number,
    e: EntryState,
    baseMode: "KG" | "UN",
    portionG: number,
  ) => {
    const mode = e.unitMode ?? baseMode;
    // Tudo na unidade de exibição: converte o systemOpening para a unidade visualizada.
    const openingBase = e.opening !== "" ? evalCalc(e.opening) : convertUnit(systemOpening, baseMode, mode, portionG);
    const entradas = evalCalc(e.entries || "0");
    const finalCount = evalCalc(e.final || "0");
    return openingBase + entradas - finalCount;
  };

  const toggleMonitor = useMutation({
    mutationFn: async ({ itemId, value }: { itemId: string; value: boolean }) => {
      const { error } = await supabase
        .from("items")
        .update({ monitor_daily: value })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-audit-data-v2", locationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ============= LANÇAMENTOS (Janta / Descarte) =============

  function addLancamento(channel: Channel, kind: PickKind, refId: string) {
    if (!data) return;
    let name = "";
    let unit = "UN";
    let portionG = 0;
    if (kind === "ficha" || kind === "sub") {
      const r = data.recipes.find((x) => x.id === refId);
      if (!r) return;
      name = r.name;
      unit = (r.yield_unit || "UN").toUpperCase();
      // Fator: avg do item linkado → produção real → ficha
      const linkedItem = data.items.find(
        (i) => i.category_id === producaoCatId &&
               i.name.trim().toLowerCase() === r.name.trim().toLowerCase(),
      );
      const linkedAvgG = linkedItem ? Number((linkedItem as { avg_weight_g?: number }).avg_weight_g || 0) : 0;
      const realG = linkedItem ? Number(data.lastUnitWeightG.get(linkedItem.id) || 0) : 0;
      const recipeG = Number((r as { unit_weight_g?: number }).unit_weight_g || 0);
      portionG = linkedAvgG > 0 ? linkedAvgG : realG > 0 ? realG : recipeG;
    } else {
      const it = data.items.find((x) => x.id === refId);
      if (!it) return;
      name = it.name;
      unit = (it.unit || "un").toUpperCase();
      // Fator único: avg_weight_g → produção real → standard
      const avgG = Number((it as { avg_weight_g?: number }).avg_weight_g || 0);
      const realG = Number(data.lastUnitWeightG.get(it.id) || 0);
      const stdG = Number((it as { standard_weight_g?: number }).standard_weight_g || 0);
      portionG = avgG > 0 ? avgG : realG > 0 ? realG : stdG;
    }
    const baseUnit: "KG" | "UN" = resolveBaseMode(unit, portionG);
    setLancamentos((prev) => [
      ...prev,
      {
        key: `${channel}-${kind}-${refId}-${Date.now()}`,
        channel,
        kind,
        refId,
        name,
        unit,
        qty: "1",
        reason: channel === "waste" ? WASTE_REASONS[0] : undefined,
        portionG,
        baseUnit,
        unitMode: baseUnit,
      },
    ]);
  }

  function updateLanc(key: string, patch: Partial<Lancamento>) {
    setLancamentos((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLanc(key: string) {
    setLancamentos((prev) => prev.filter((l) => l.key !== key));
  }

  /**
   * Explode uma receita em itens-folha (raw items) com quantidade total.
   *
   * Regras (alinhadas com src/lib/recipe-explode.ts):
   *  - Se a sub-ficha tem `explode_on_consume = true` → SEMPRE recursamos
   *    (mesmo que o produto pronto tenha saldo).
   *  - Caso contrário, se existe item de Produção Própria com saldo > 0,
   *    consumimos esse item diretamente (sem recursar).
   *  - Caso contrário (sem saldo / sem item linkado), recursamos.
   *
   * `out` é populado com itemId → qty acumulado.
   */
  function explodeRecipe(
    recipeId: string,
    factor: number,
    out: Map<string, number>,
    seen: Set<string> = new Set(),
  ) {
    if (!data) return;
    if (seen.has(recipeId)) return; // proteção contra ciclos
    seen.add(recipeId);
    const r = data.recipes.find((x) => x.id === recipeId);
    if (!r) return;
    // fator = quantidade desejada / yield_quantity
    const yieldQty = Number(r.yield_quantity || 1) || 1;
    const ratio = factor / yieldQty;
    const ings = data.ingredients.filter((i) => i.recipe_id === recipeId);
    for (const ing of ings) {
      const qty = Number(ing.quantity || 0) * ratio;
      if (qty <= 0) continue;
      if (ing.sub_recipe_id) {
        const subRec = data.recipes.find((x) => x.id === ing.sub_recipe_id);
        const forceExplode = (subRec as { explode_on_consume?: boolean } | undefined)?.explode_on_consume === true;
        const subItem = subItemFor(ing.sub_recipe_id);
        const stockHere = subItem
          ? Number(data.stock.find((s) => s.item_id === subItem.id)?.current_stock ?? 0)
          : 0;
        if (!forceExplode && subItem && stockHere > 0) {
          out.set(subItem.id, (out.get(subItem.id) ?? 0) + qty);
        } else {
          explodeRecipe(ing.sub_recipe_id, qty, out, new Set(seen));
        }
      } else if (ing.item_id) {
        out.set(ing.item_id, (out.get(ing.item_id) ?? 0) + qty);
      }
    }
  }

  function resolveDeductions(l: Lancamento): Map<string, number> {
    const out = new Map<string, number>();
    const qtyRaw = Number((l.qty || "0").replace(",", ".")) || 0;
    if (qtyRaw <= 0) return out;
    // Converte a quantidade digitada para a unidade BASE do item/receita.
    // Assim, "1 unidade" baixa apenas o equivalente em peso dessa unidade.
    const baseUnit: "KG" | "UN" = l.baseUnit ?? resolveBaseMode(l.unit, l.portionG ?? 0);
    const mode: "KG" | "UN" = l.unitMode ?? baseUnit;
    const qty = convertUnit(qtyRaw, mode, baseUnit, l.portionG ?? 0);
    if (l.kind === "ficha") {
      explodeRecipe(l.refId, qty, out);
    } else if (l.kind === "sub") {
      // Tenta usar item de Produção Própria diretamente; se não houver, explode
      const subItem = subItemFor(l.refId);
      if (subItem) out.set(subItem.id, qty);
      else explodeRecipe(l.refId, qty, out);
    } else {
      out.set(l.refId, qty);
    }
    return out;
  }

  // ============= SAVE =============

  const save = useMutation({
    mutationFn: async () => {
      // 1) Salvar auditoria (campos numéricos por item monitorado) — opcional
      const filled = monitored
        .map((m) => {
          const e = entries[m.id];
          if (!e) return null;
          const hasAny =
            e.final !== "" ||
            e.opening !== "" ||
            e.entries !== "" ||
            e.staff !== "" ||
            e.waste !== "";
          if (!hasAny) return null;
          return { item: m, entry: e };
        })
        .filter(Boolean) as { item: (typeof monitored)[number]; entry: EntryState }[];

      const hasLancamentos = lancamentos.length > 0;
      const hasSales = sales.size > 0;
      if (filled.length === 0 && !hasLancamentos && !hasSales) {
        throw new Error("Preencha ao menos um item, venda ou baixa para salvar a auditoria.");
      }

      const { data: audit, error: e1 } = await supabase
        .from("shift_audits")
        .insert({
          location_id: locationId,
          shift_label: shiftLabel || null,
          notes: notes || null,
        })
        .select("id")
        .single();
      if (e1) throw e1;

      if (filled.length > 0) {
        const rows = filled.map(({ item, entry }) => {
          const baseMode = resolveBaseMode(item.unit, item.portionG);
          const mode = entry.unitMode ?? baseMode;
          const toBase = (v: number) => convertUnit(v, mode, baseMode, item.portionG);
          const openingBase = entry.opening !== "" ? toBase(evalCalc(entry.opening)) : item.opening;
          const entradasBase = toBase(evalCalc(entry.entries || "0"));
          const staffBase = toBase(evalCalc(entry.staff || "0"));
          const wasteBase = toBase(evalCalc(entry.waste || "0"));
          const finalBase = toBase(evalCalc(entry.final || "0"));
          return {
            audit_id: audit.id,
            item_id: item.id,
            opening_qty: openingBase,
            received_qty: item.received + entradasBase,
            sales_qty: expectedByItem.get(item.id) ?? 0,
            staff_qty: staffBase,
            waste_qty: wasteBase,
            final_count_qty: finalBase,
            variance_qty: computeVariance(item.opening, item.received, entry, baseMode, item.portionG),
          };
        });
        const { error: e2 } = await supabase.from("shift_audit_entries").insert(rows);
        if (e2) throw e2;

        // Lançar movimentos de ENTRADA MANUAL para cada item com "entradas" preenchidas
        for (const { item, entry } of filled) {
          const baseMode = resolveBaseMode(item.unit, item.portionG);
          const mode = entry.unitMode ?? baseMode;
          const toBase = (v: number) => convertUnit(v, mode, baseMode, item.portionG);
          const qtyEntrada = toBase(evalCalc(entry.entries || "0"));
          if (!qtyEntrada || qtyEntrada <= 0) continue;
          // Atualiza estoque (inicial+entradas), independente da contagem final
          const baseStock = entry.opening !== "" ? toBase(evalCalc(entry.opening)) : item.opening;
          const newStock = baseStock + qtyEntrada;
          const { error: upErr } = await supabase
            .from("stock_levels")
            .upsert(
              { item_id: item.id, location_id: locationId, current_stock: newStock },
              { onConflict: "item_id,location_id" },
            );
          if (upErr) throw upErr;
          const tag = item.isSubproduct
            ? `Entrada manual de turno (produção interna — pendência de produção)`
            : `Entrada manual de turno (verificar XML pendente)`;
          const { error: mErr } = await supabase.from("movements").insert({
            item_id: item.id,
            from_location_id: null,
            to_location_id: locationId,
            quantity: qtyEntrada,
            type: "audit_in",
            note: tag,
          });
          if (mErr) throw mErr;
        }
      }

      // 2) Aplicar lançamentos: explode → consolida → baixa estoque + registra movimentos
      if (!data) return;
      const totals = new Map<string, { qty: number; reasons: string[] }>();
      for (const l of lancamentos) {
        const d = resolveDeductions(l);
        const tag =
          l.channel === "staff"
            ? `Alimentação: ${l.name}`
            : l.channel === "courtesy"
              ? `Cortesia: ${l.name}`
              : `Descarte (${l.reason || "—"}): ${l.name}`;
        d.forEach((qty, itemId) => {
          const cur = totals.get(itemId) ?? { qty: 0, reasons: [] };
          cur.qty += qty;
          cur.reasons.push(tag);
          totals.set(itemId, cur);
        });
      }

      // 2.b) Aplicar VENDAS: explode cada ficha vendida → soma nos totals como
      // baixa de tipo "sale". Mesmo bloco de baixa abaixo cuida de stock_levels
      // + movements; a venda é distinguida pela tag "Venda:". Quando o item
      // baixado NÃO é o produto direto da ficha (ou seja, foi resolvido via
      // explosão recursiva), anotamos "(explodido de <ficha>)" para preservar
      // a rastreabilidade do CMV.
      for (const [recipeId, qtySold] of sales.entries()) {
        if (!qtySold || qtySold <= 0) continue;
        const recipe = data.recipes.find((r) => r.id === recipeId);
        const recipeName = recipe?.name ?? "Venda";
        const producedItemId =
          (recipe as { produced_item_id?: string | null } | undefined)?.produced_item_id ?? null;
        const expanded = new Map<string, number>();
        explodeRecipe(recipeId, qtySold, expanded);
        expanded.forEach((qty, itemId) => {
          const wasExploded = !producedItemId || itemId !== producedItemId;
          const tag = wasExploded
            ? `Venda (${qtySold}x): ${recipeName} (explodido de ${recipeName})`
            : `Venda (${qtySold}x): ${recipeName}`;
          const cur = totals.get(itemId) ?? { qty: 0, reasons: [] };
          cur.qty += qty;
          cur.reasons.push(tag);
          totals.set(itemId, cur);
        });
      }

      // Resolve modo da operação para roteamento Tradicional vs Venda Direta
      const isDirect = (data.currentLocation?.stock_mode ?? "traditional") === "direct";
      const centralId = data.centralLocation?.id ?? null;

      for (const [itemId, info] of totals.entries()) {
        // Override por item: pula a baixa automática (ex.: trocas, bebidas)
        if (data.overrideMap.get(itemId) === true) continue;

        // Em Venda Direta, baixa sai do Central; senão, da própria operação.
        const targetLocId = isDirect && centralId ? centralId : locationId;
        const usedCentral = isDirect && !!centralId;

        const current = Number(
          (data.stockAll ?? []).find(
            (s) => s.item_id === itemId && s.location_id === targetLocId,
          )?.current_stock ?? 0,
        );
        const itemRef = data.items.find((i) => i.id === itemId);
        const baseUnit = ((itemRef?.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un") as
          | "kg"
          | "un";
        // FEFO com peso real por lote (consumeStockReal).
        let realTaken = info.qty;
        try {
          const r = await consumeStockReal({
            itemId,
            qty: info.qty,
            inputUnit: baseUnit,
            itemBaseUnit: baseUnit,
            avgWeightG: Number(itemRef?.avg_weight_g ?? 0),
          });
          if (r.realBaseTaken > 0) realTaken = r.realBaseTaken;
        } catch (e) {
          console.warn("FEFO falhou", e);
        }
        const newQty = current - realTaken;
        const { error: upErr } = await supabase
          .from("stock_levels")
          .upsert(
            { item_id: itemId, location_id: targetLocId, current_stock: newQty },
            { onConflict: "item_id,location_id" },
          );
        if (upErr) throw upErr;

        // Determina tipo do movimento
        const allStaff = info.reasons.every((r) => r.startsWith("Alimentação"));
        const allWaste = info.reasons.every((r) => r.startsWith("Descarte"));
        const allCourtesy = info.reasons.every((r) => r.startsWith("Cortesia"));
        const allSale = info.reasons.every((r) => r.startsWith("Venda"));
        const type = allSale
          ? "sale"
          : allStaff
            ? "staff_meal"
            : allWaste
              ? "waste"
              : allCourtesy
                ? "courtesy"
                : "audit_out";

        // Em Venda Direta anotamos a operação de origem no note p/ rastreabilidade
        const directTag = usedCentral
          ? ` [Venda Direta @ ${data.currentLocation?.name ?? "operação"}]`
          : "";

        const { error: mErr } = await supabase.from("movements").insert({
          item_id: itemId,
          from_location_id: targetLocId,
          to_location_id: null,
          quantity: info.qty,
          type,
          note: info.reasons.join(" | ") + directTag,
        });
        if (mErr) throw mErr;
      }
    },
    onSuccess: () => {
      toast.success("Auditoria de turno registrada");
      qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filledCount = useMemo(
    () =>
      monitored.filter((m) => {
        const e = entries[m.id];
        return (
          e &&
          (e.final !== "" || e.opening !== "" || e.entries !== "" || e.staff !== "" || e.waste !== "")
        );
      }).length,
    [monitored, entries],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            {manageMode ? "Itens monitorados diariamente" : "Auditoria de turno"}
          </DialogTitle>
          <DialogDescription>
            {manageMode
              ? "Marque quais itens entram na auditoria diária deste e dos demais locais."
              : `Fechamento de turno em ${locationName}. Janta e Descarte fazem baixa real no estoque deste local.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={manageMode ? "Buscar item para monitorar…" : "Buscar item monitorado…"}
              className="pl-9"
            />
          </div>
          {isManager && (
            <Button
              variant={manageMode ? "default" : "outline"}
              size="sm"
              onClick={() => setManageMode((v) => !v)}
              className="h-9 gap-1"
            >
              {manageMode ? <ArrowLeft className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
              {manageMode ? "Voltar" : "Itens monitorados"}
            </Button>
          )}
        </div>

        {manageMode ? (
          <div className="max-h-[55vh] space-y-1 overflow-y-auto rounded-md border border-border">
            {isLoading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : allItemsFiltered.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Nenhum item.</p>
            ) : (
              allItemsFiltered.map((i) => (
                <label
                  key={i.id}
                  className="flex cursor-pointer items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {i.unit}
                    </p>
                  </div>
                  <Switch
                    checked={!!i.monitor_daily}
                    onCheckedChange={(v) => toggleMonitor.mutate({ itemId: i.id, value: v })}
                  />
                </label>
              ))
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Rótulo do turno</Label>
                <Input
                  value={shiftLabel}
                  onChange={(e) => setShiftLabel(e.target.value)}
                  placeholder="Ex: Turno Noite"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Observações</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                  className="h-9"
                />
              </div>
            </div>

            {/* ============== Vendas (CSV / Manual) ============== */}
            <SalesEntrySection sales={sales} onSalesChange={setSales} locationId={locationId} />

            {/* ============== Baixas Operacionais (Sem Valor Monetário) ============== */}
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Baixas Operacionais (Sem Valor Monetário)</h3>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  baixa imediata em {locationName}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <PickerButton
                  channel="staff"
                  data={data}
                  onPick={(kind, refId) => addLancamento("staff", kind, refId)}
                />
                <PickerButton
                  channel="courtesy"
                  data={data}
                  onPick={(kind, refId) => addLancamento("courtesy", kind, refId)}
                />
                <PickerButton
                  channel="waste"
                  data={data}
                  onPick={(kind, refId) => addLancamento("waste", kind, refId)}
                />
              </div>

              {lancamentos.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Nenhum lançamento ainda. Use os botões acima para adicionar.
                </p>
              ) : (
                <div className="space-y-2">
                  {lancamentos.map((l) => (
                    <div
                      key={l.key}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2"
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1 text-[10px]",
                          l.channel === "staff" && "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
                          l.channel === "courtesy" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                          l.channel === "waste" && "border-destructive/30 bg-destructive/10 text-destructive",
                        )}
                      >
                        {l.channel === "staff" && <UtensilsCrossed className="h-3 w-3" />}
                        {l.channel === "courtesy" && <Gift className="h-3 w-3" />}
                        {l.channel === "waste" && <Flame className="h-3 w-3" />}
                        {l.channel === "staff" ? "Alimentação" : l.channel === "courtesy" ? "Cortesia" : "Descarte"}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[10px]", kindBadgeClass(l.kind))}>
                        {kindLabel(l.kind)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => updateLanc(l.key, { qty: e.target.value })}
                        className="h-8 w-20 text-right tabular-nums"
                      />
                      {(l.portionG ?? 0) > 0 ? (
                        <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
                          <button
                            type="button"
                            onClick={() => {
                              const from = l.unitMode ?? l.baseUnit ?? "UN";
                              if (from === "KG") return;
                              const num = Number((l.qty || "0").replace(",", ".")) || 0;
                              const conv = convertUnit(num, from, "KG", l.portionG ?? 0);
                              updateLanc(l.key, { unitMode: "KG", qty: fmtForField(conv) });
                            }}
                            className={cn(
                              "px-2 py-0.5 transition-colors",
                              (l.unitMode ?? l.baseUnit) === "KG"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            KG
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const from = l.unitMode ?? l.baseUnit ?? "KG";
                              if (from === "UN") return;
                              const num = Number((l.qty || "0").replace(",", ".")) || 0;
                              const conv = convertUnit(num, from, "UN", l.portionG ?? 0);
                              updateLanc(l.key, { unitMode: "UN", qty: fmtForField(conv) });
                            }}
                            className={cn(
                              "border-l border-border px-2 py-0.5 transition-colors",
                              (l.unitMode ?? l.baseUnit) === "UN"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            UN
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {l.unit}
                        </span>
                      )}
                      {l.channel === "waste" && (
                        <Select
                          value={l.reason}
                          onValueChange={(v) => updateLanc(l.key, { reason: v })}
                        >
                          <SelectTrigger className="h-8 w-[150px]">
                            <SelectValue placeholder="Motivo" />
                          </SelectTrigger>
                          <SelectContent>
                            {WASTE_REASONS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLanc(l.key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {isLoading ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Carregando…</p>
              ) : monitored.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-8 text-center">
                  <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Nenhum item marcado como “Monitorar Diariamente”.</p>
                  {isManager ? (
                    <p className="text-xs text-muted-foreground">
                      Use o botão <strong>Itens monitorados</strong> acima para selecionar os itens.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Peça ao gestor para marcar os itens que devem ser auditados todo dia.
                    </p>
                  )}
                </div>
              ) : (
                monitored.map((m) => {
                  const e = entries[m.id] ?? emptyEntry;
                  const baseModeTop = resolveBaseMode(m.unit, m.portionG);
                  const variance = computeVariance(m.opening, m.received, e, baseModeTop, m.portionG);
                  const consumo = computeConsumo(m.opening, e, baseModeTop, m.portionG);
                  const hasAny =
                    e.final !== "" ||
                    e.opening !== "" ||
                    e.entries !== "" ||
                    e.staff !== "" ||
                    e.waste !== "";
                  const entradasNum = evalCalc(e.entries || "0");
                  const baseMode = baseModeTop;
                  const mode: "KG" | "UN" = e.unitMode ?? baseMode;
                  const displayUnit = m.allowUnitToggle ? mode : baseMode;
                  // Estoque inicial convertido para a unidade visualizada
                  const openingDisplay =
                    mode === baseMode
                      ? m.opening
                      : convertUnit(m.opening, baseMode, mode, m.portionG);
                  return (
                    <div key={m.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{m.name}</p>
                          {m.isSubproduct && (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                              Produção Interna
                            </Badge>
                          )}
                          {m.allowUnitToggle && (
                            <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
                              <button
                                type="button"
                                onClick={() => setUnitMode(m.id, "KG", m.portionG)}
                                className={cn(
                                  "px-2 py-0.5 transition-colors",
                                  mode === "KG"
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted",
                                )}
                              >
                                KG
                              </button>
                              <button
                                type="button"
                                onClick={() => setUnitMode(m.id, "UN", m.portionG)}
                                className={cn(
                                  "border-l border-border px-2 py-0.5 transition-colors",
                                  mode === "UN"
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted",
                                )}
                              >
                                UN
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          inicial:{" "}
                          <span className="tabular-nums">
                            {openingDisplay.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                          </span>{" "}
                          {displayUnit} • recebido:{" "}
                          <span className="tabular-nums">
                            {(mode === baseMode
                              ? m.received
                              : convertUnit(m.received, baseMode, mode, m.portionG)
                            ).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                          </span>{" "}
                          {displayUnit}
                          {m.allowUnitToggle && m.portionG > 0 && (
                            <span
                              className="ml-2 normal-case text-muted-foreground/80"
                              title={
                                m.portionSource === "real"
                                  ? "Peso da última produção real"
                                  : m.portionSource === "recipe"
                                    ? "Peso da ficha técnica"
                                    : "Peso médio cadastrado"
                              }
                            >
                              · Base: {Math.round(m.portionG)}g/un
                              {m.portionSource === "real" && " ✓"}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <Field
                          label={`Inicial (${displayUnit})`}
                          value={e.opening}
                          onChange={(v) => setField(m.id, "opening", v)}
                          placeholder={openingDisplay.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                        />
                        <Field
                          label={`Entradas (${displayUnit})`}
                          value={e.entries}
                          onChange={(v) => setField(m.id, "entries", v)}
                          placeholder="0  (aceita 10+5+3)"
                          icon={<PackagePlus className="h-3 w-3" />}
                        />
                        <Field
                          label={`Final (${displayUnit})`}
                          value={e.final}
                          onChange={(v) => setField(m.id, "final", v)}
                          highlight
                        />
                      </div>
                      {entradasNum > 0 && (
                        <div
                          className={cn(
                            "mt-2 flex items-start gap-2 rounded-md border p-2 text-[11px]",
                            m.isSubproduct
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
                          )}
                        >
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {m.isSubproduct
                              ? "Esta entrada gerará uma pendência no módulo de Produção para regularização de custos."
                              : "Entrada manual detectada. Verifique se há XML pendente para este item."}
                          </span>
                        </div>
                      )}
                      {(() => {
                        const expectedBase = expectedByItem.get(m.id) ?? 0;
                        if (expectedBase <= 0 && !hasAny) return null;
                        const expectedDisplay = convertUnit(expectedBase, baseMode, mode, m.portionG);
                        const quebra = hasAny ? consumo - expectedDisplay : 0;
                        return (
                          <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
                            {expectedBase > 0 && (
                              <span className="text-muted-foreground">
                                Vendas+Baixas:{" "}
                                <span className="font-semibold tabular-nums text-foreground">
                                  {expectedDisplay.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {displayUnit}
                                </span>
                              </span>
                            )}
                            {hasAny && (
                              <>
                                <span className="text-muted-foreground">
                                  Consumo real:{" "}
                                  <span className="font-semibold tabular-nums text-foreground">
                                    {consumo.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {displayUnit}
                                  </span>
                                </span>
                                {expectedBase > 0 ? (
                                  <span className="text-muted-foreground">
                                    Quebra real:{" "}
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1 font-semibold tabular-nums",
                                        Math.abs(quebra) > 0.001 && "text-destructive",
                                      )}
                                    >
                                      {Math.abs(quebra) > 0.001 && <AlertTriangle className="h-3 w-3" />}
                                      {quebra.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {displayUnit}
                                    </span>
                                  </span>
                                ) : (
                                  <>
                                    <span className="text-muted-foreground">Desvio:</span>
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1 font-semibold tabular-nums",
                                        Math.abs(variance) > 0.001 && "text-destructive",
                                      )}
                                    >
                                      {Math.abs(variance) > 0.001 && <AlertTriangle className="h-3 w-3" />}
                                      {variance.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {displayUnit}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })
              )}
            </div>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas gerais do fechamento (opcional)"
              className="min-h-[60px]"
            />

            <div className="flex flex-wrap gap-2">
              {filledCount > 0 && (
                <Badge variant="secondary">
                  {filledCount} {filledCount === 1 ? "item preenchido" : "itens preenchidos"}
                </Badge>
              )}
              {sales.size > 0 && (
                <Badge variant="secondary">
                  {sales.size} {sales.size === 1 ? "ficha vendida" : "fichas vendidas"}
                </Badge>
              )}
              {lancamentos.length > 0 && (
                <Badge variant="secondary">
                  {lancamentos.length}{" "}
                  {lancamentos.length === 1 ? "baixa operacional" : "baixas operacionais"}
                </Badge>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {manageMode ? "Fechar" : "Cancelar"}
          </Button>
          {!manageMode && (
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                (filledCount === 0 && lancamentos.length === 0 && sales.size === 0)
              }
            >
              {save.isPending ? "Salvando…" : "Salvar auditoria"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  highlight,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  highlight?: boolean;
  placeholder?: string;
  icon?: ReactNode;
}) {
  // Mostra o resultado calculado (ex: "10+5+3" -> "= 18") como dica visual
  const showCalc = !!value && /[+\-*/]/.test(value);
  const calcVal = showCalc ? evalCalc(value) : NaN;
  return (
    <div>
      <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </Label>
      <Input
        type="text"
        inputMode="decimal"
        placeholder={placeholder ?? "0"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-10 text-right tabular-nums",
          highlight && "border-primary/60 font-semibold",
        )}
      />
      {showCalc && Number.isFinite(calcVal) && (
        <p className="mt-0.5 text-right text-[10px] text-muted-foreground tabular-nums">
          = {calcVal.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
        </p>
      )}
    </div>
  );
}

// ============= Picker (Autocomplete) =============

type DataShape = {
  items: { id: string; name: string; unit: string; category_id: string | null; monitor_daily: boolean }[];
  recipes: { id: string; name: string; type: string; yield_quantity: number; yield_unit: string }[];
  categories: { id: string; name: string }[];
} | undefined;

function PickerButton({
  channel,
  data,
  onPick,
}: {
  channel: Channel;
  data: DataShape;
  onPick: (kind: PickKind, refId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isStaff = channel === "staff";
  const isCourtesy = channel === "courtesy";
  const allowHybrid = channel === "courtesy" || channel === "waste";

  const producaoCatId = useMemo(
    () =>
      data?.categories.find(
        (c) => c.name.trim().toLowerCase() === PRODUCAO_PROPRIA_NAME.toLowerCase(),
      )?.id ?? null,
    [data],
  );

  const fichas = useMemo(
    () => data?.recipes.filter((r) => r.type === "final") ?? [],
    [data],
  );
  const subs = useMemo(
    () => data?.recipes.filter((r) => r.type === "sub") ?? [],
    [data],
  );
  // Insumos brutos: itens que NÃO são da categoria Produção Própria
  const insumos = useMemo(
    () => data?.items.filter((i) => i.category_id !== producaoCatId) ?? [],
    [data, producaoCatId],
  );

  const buttonLabel = isStaff
    ? "Adicionar Alimentação"
    : isCourtesy
      ? "Adicionar Cortesia"
      : "Adicionar Descarte";

  const buttonStyle = isStaff
    ? "border-blue-500/30 hover:bg-blue-500/10"
    : isCourtesy
      ? "border-emerald-500/30 hover:bg-emerald-500/10"
      : "border-destructive/30 hover:bg-destructive/10";

  const Icon = isStaff ? UtensilsCrossed : isCourtesy ? Gift : Flame;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-10 w-full justify-start gap-2", buttonStyle)}
        >
          <Icon className="h-4 w-4" />
          <span className="font-medium">{buttonLabel}</span>
          <Plus className="ml-auto h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput
            placeholder={
              allowHybrid ? "Buscar ficha, produção interna ou insumo…" : "Buscar ficha técnica…"
            }
          />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>

            {fichas.length > 0 && (
              <CommandGroup heading="Fichas técnicas (Produtos Finais)">
                {fichas.map((r) => (
                  <CommandItem
                    key={`f-${r.id}`}
                    value={`ficha ${r.name}`}
                    onSelect={() => {
                      onPick("ficha", r.id);
                      setOpen(false);
                    }}
                  >
                    <Badge variant="outline" className={cn("mr-2 text-[10px]", kindBadgeClass("ficha"))}>
                      Ficha
                    </Badge>
                    <span className="truncate">{r.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {allowHybrid && subs.length > 0 && (
              <CommandGroup heading="Produções Internas">
                {subs.map((r) => (
                  <CommandItem
                    key={`s-${r.id}`}
                    value={`sub ${r.name}`}
                    onSelect={() => {
                      onPick("sub", r.id);
                      setOpen(false);
                    }}
                  >
                    <Badge variant="outline" className={cn("mr-2 text-[10px]", kindBadgeClass("sub"))}>
                      Produção Interna
                    </Badge>
                    <span className="truncate">{r.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {allowHybrid && insumos.length > 0 && (
              <CommandGroup heading="Insumos brutos">
                {insumos.map((i) => (
                  <CommandItem
                    key={`i-${i.id}`}
                    value={`insumo ${i.name}`}
                    onSelect={() => {
                      onPick("insumo", i.id);
                      setOpen(false);
                    }}
                  >
                    <Badge variant="outline" className={cn("mr-2 text-[10px]", kindBadgeClass("insumo"))}>
                      Insumo
                    </Badge>
                    <span className="truncate">{i.name}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                      {i.unit}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
