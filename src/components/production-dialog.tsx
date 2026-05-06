import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { consumeStockReal } from "@/lib/fefo";
import { explodeRecipe, type ExplodeContext } from "@/lib/recipe-explode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChefHat,
  Plus,
  Trash2,
  Check,
  ChevronsUpDown,
  Package,
  Soup,
  AlertTriangle,
  Link as LinkIcon,
  Scale,
  RotateCcw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useManagerMode } from "@/lib/manager-mode";
import { weightedAvgWeight } from "@/lib/shared-unit";

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

const PRODUCAO_PROPRIA_NAME = "Produção Própria";

interface Props {
  defaultLocationId?: string;
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  triggerVariant?: "default" | "secondary" | "outline";
  triggerClassName?: string;
  /** Se preenchido, o dialog abre em modo EDIÇÃO de uma produção existente.
   *  Ao confirmar, estorna os movimentos originais e relança os novos. */
  editMovementId?: string;
  /** Pré-seleciona uma receita ao abrir (apenas modo criação). */
  presetRecipeId?: string;
}

type ItemRow = {
  id: string;
  name: string;
  unit: string;
  cost_price: number;
  category_id: string | null;
  shared_unit_enabled?: boolean;
  standard_weight_g?: number;
  avg_weight_g?: number;
};
type LocationRow = { id: string; name: string; stock_mode?: string | null; is_shared?: boolean | null };
type StockRow = { item_id: string; location_id: string; current_stock: number };
type RecipeRow = {
  id: string;
  name: string;
  type: string;
  yield_quantity: number;
  yield_unit: string;
  category_id: string | null;
  unit_weight_g?: number | null;
  produced_item_id?: string | null;
  explode_on_consume?: boolean;
};
type IngredientRow = {
  id: string;
  recipe_id: string;
  item_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
  unit: string;
};
type RecipeCategoryRow = { id: string; name: string };

type LineKind = "item" | "sub";

type Line = {
  /** id local */
  key: string;
  kind: LineKind;
  /** id do item (se kind="item") OU id da produção interna (se kind="sub") */
  refId: string;
  qty: string;
  /** quantidade original sugerida pela ficha técnica (referência para recálculo proporcional) */
  baseQty: number;
  /** Unidade escolhida pelo usuário ("UN" ou "KG"). Se vazia, usa unidade base do item. */
  unitOverride?: string;
};

/** Peso (KG) por unidade do item (para conversão UN <-> KG).
 * Prioriza avg_weight_g (peso médio real ponderado dos lotes do estoque)
 * para alinhar com o preço médio do Estoque Central. Cai para standard_weight_g
 * apenas quando ainda não há lotes registrados. */
function itemWeightKg(item: ItemRow | null | undefined): number {
  if (!item) return 0;
  const avg = Number(item.avg_weight_g ?? 0);
  if (avg > 0) return avg / 1000;
  const std = Number(item.standard_weight_g ?? 0);
  if (std > 0) return std / 1000;
  return 0;
}

function canToggleItemUnit(item: ItemRow | null | undefined): boolean {
  if (!item) return false;
  if (!item.shared_unit_enabled) return false;
  return itemWeightKg(item) > 0;
}

export function ProductionDialog({
  defaultLocationId,
  hideTrigger,
  open: openProp,
  onOpenChange,
  triggerVariant = "default",
  triggerClassName,
  editMovementId,
  presetRecipeId,
}: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (openProp === undefined) setOpenInternal(v);
  };
  const qc = useQueryClient();
  const { isManager } = useManagerMode();
  const isEditMode = !!editMovementId;

  const [recipeId, setRecipeId] = useState("");
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [lastEditedKey, setLastEditedKey] = useState<string | null>(null);
  /** Guarda o último recipeId para o qual o pré-preenchimento da ficha já foi aplicado.
   *  Usado para impedir que refetches do `data` resetem campos que o usuário já editou
   *  (ex: depois de clicar na balança "Recalcular insumos"). */
  const loadedRecipeIdRef = useRef<string | null>(null);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [yieldQty, setYieldQty] = useState(""); // sempre na unidade base do linkedItem (KG ou UN)
  const [yieldKg, setYieldKg] = useState(""); // rendimento em KG (campo editável, INDEPENDENTE)
  const [yieldUnits, setYieldUnits] = useState(""); // rendimento em unidades (campo editável, INDEPENDENTE)
  const [proportionFactor, setProportionFactor] = useState(1); // multiplicador aplicado pelo "Recalcular proporcional"
  const [batchExpiry, setBatchExpiry] = useState(""); // validade opcional do lote produzido (YYYY-MM-DD)
  const [locationId, setLocationId] = useState("");

  // ============ Modo "Criar Receita na Hora" (on-the-fly) ============
  // Quando ativo, ignora o seletor de receita e usa estes campos para montar
  // uma "ficha improvisada". Ao confirmar, opcionalmente persiste a receita.
  const [quickMode, setQuickMode] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickProducedItemId, setQuickProducedItemId] = useState(""); // item existente OU "__new__"
  const [quickProducedItemNewName, setQuickProducedItemNewName] = useState("");
  const [quickProducedItemUnit, setQuickProducedItemUnit] = useState<"KG" | "UN">("UN");
  const [quickSaveAsRecipe, setQuickSaveAsRecipe] = useState(false);

  const { data } = useQuery({
    queryKey: ["production-data-v3"],
    queryFn: async () => {
      const [
        items,
        locations,
        stock,
        categories,
        recipes,
        ingredients,
        recipeCats,
      ] = await Promise.all([
        supabase
          .from("items")
          .select(
            "id,name,unit,cost_price,category_id,shared_unit_enabled,standard_weight_g,avg_weight_g",
          )
          .eq("is_active", true),
        supabase.from("locations").select("id,name,stock_mode,is_shared").order("name"),
        supabase.from("stock_levels").select("item_id,location_id,current_stock"),
        supabase.from("categories").select("id,name"),
        supabase
          .from("recipes")
          .select("id,name,type,yield_quantity,yield_unit,category_id,unit_weight_g,produced_item_id,explode_on_consume")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("recipe_ingredients")
          .select("id,recipe_id,item_id,sub_recipe_id,quantity,unit"),
        supabase.from("recipe_categories").select("id,name"),
      ]);
      if (items.error) throw items.error;
      if (locations.error) throw locations.error;
      if (stock.error) throw stock.error;
      if (categories.error) throw categories.error;
      if (recipes.error) throw recipes.error;
      if (ingredients.error) throw ingredients.error;
      if (recipeCats.error) throw recipeCats.error;
      return {
        items: items.data as ItemRow[],
        locations: locations.data as LocationRow[],
        stock: stock.data as StockRow[],
        categories: categories.data as RecipeCategoryRow[],
        recipes: recipes.data as RecipeRow[],
        ingredients: ingredients.data as IngredientRow[],
        recipeCategories: recipeCats.data as RecipeCategoryRow[],
      };
    },
    enabled: open,
  });

  // Em modo edição, carrega o movimento de entrada original e os movimentos de saída de insumos
  // (production_out) lançados na mesma produção. Como não temos um group_id no banco, agrupamos
  // por janela de tempo de ±5 segundos em torno do production_in.
  const { data: editData } = useQuery({
    queryKey: ["production-edit", editMovementId],
    queryFn: async () => {
      if (!editMovementId) return null;
      const inRes = await supabase
        .from("movements")
        .select("*")
        .eq("id", editMovementId)
        .single();
      if (inRes.error) throw inRes.error;
      const inMov = inRes.data;
      const ts = new Date(inMov.created_at).getTime();
      const fromIso = new Date(ts - 5000).toISOString();
      const toIso = new Date(ts + 5000).toISOString();
      const outRes = await supabase
        .from("movements")
        .select("*")
        .eq("type", "production_out")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      if (outRes.error) throw outRes.error;
      const recipeName = (inMov.note ?? "").match(/Produção(?:\s*\(.*?\))?:\s*([^|]+)/)?.[1]?.trim();
      const outs = (outRes.data ?? []).filter((m) =>
        recipeName ? (m.note ?? "").toLowerCase().includes(recipeName.toLowerCase()) : true,
      );
      return { inMov, outs, recipeName };
    },
    enabled: open && !!editMovementId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const producaoCategoryId = useMemo(
    () =>
      data?.categories.find(
        (c) => c.name.trim().toLowerCase() === PRODUCAO_PROPRIA_NAME.toLowerCase(),
      )?.id ?? null,
    [data],
  );

  const central = useMemo(
    () => data?.locations.find((l) => l.name.toLowerCase().includes("central")),
    [data],
  );

  const realRecipe = data?.recipes.find((r) => r.id === recipeId) ?? null;

  // Em modo "Criar Receita na Hora", monta uma receita "virtual" com base nos campos quick.
  // Assim toda a UI/cálculos abaixo (que usam `recipe`) continuam funcionando sem mudanças.
  const quickRecipe = useMemo<RecipeRow | null>(() => {
    if (!quickMode) return null;
    return {
      id: "__quick__",
      name: quickName.trim() || "Receita rápida",
      type: "final",
      yield_quantity: 1,
      yield_unit: quickProducedItemUnit,
      category_id: null,
      unit_weight_g: null,
      produced_item_id: null,
    };
  }, [quickMode, quickName, quickProducedItemUnit]);

  const recipe = quickMode ? quickRecipe : realRecipe;

  /** Item da categoria Produção Própria vinculado à receita.
   *  Prioridade: 1) recipes.produced_item_id (vínculo persistente)
   *              2) match por nome (compatibilidade com fichas antigas)
   *  Em modo quick: usa o item escolhido manualmente em quickProducedItemId.
   *  Se for "__new__", retorna um item "virtual" — só será criado de fato no submit. */
  const linkedItem = useMemo<ItemRow | null>(() => {
    if (!data) return null;
    if (quickMode) {
      if (quickProducedItemId && quickProducedItemId !== "__new__") {
        return data.items.find((i) => i.id === quickProducedItemId) ?? null;
      }
      if (quickProducedItemId === "__new__" && quickProducedItemNewName.trim()) {
        // Item "virtual" — placeholder com cost_price 0; será criado no submit.
        return {
          id: "__quick_new_item__",
          name: quickProducedItemNewName.trim(),
          unit: quickProducedItemUnit.toLowerCase(),
          cost_price: 0,
          category_id: producaoCategoryId,
          shared_unit_enabled: false,
          standard_weight_g: 0,
          avg_weight_g: 0,
        };
      }
      return null;
    }
    if (!recipe) return null;
    if (recipe.produced_item_id) {
      const byId = data.items.find((i) => i.id === recipe.produced_item_id);
      if (byId) return byId;
    }
    return (
      data.items.find(
        (i) =>
          i.category_id === producaoCategoryId &&
          i.name.trim().toLowerCase() === recipe.name.trim().toLowerCase(),
      ) ?? null
    );
  }, [data, recipe, producaoCategoryId, quickMode, quickProducedItemId, quickProducedItemNewName, quickProducedItemUnit]);

  /** Item de Produção Própria associado a uma produção interna. */
  const subItemFor = (subRecipeId: string): ItemRow | null => {
    if (!data) return null;
    const sub = data.recipes.find((r) => r.id === subRecipeId);
    if (!sub) return null;
    if (sub.produced_item_id) {
      const byId = data.items.find((i) => i.id === sub.produced_item_id);
      if (byId) return byId;
    }
    return (
      data.items.find(
        (i) =>
          i.category_id === producaoCategoryId &&
          i.name.trim().toLowerCase() === sub.name.trim().toLowerCase(),
      ) ?? null
    );
  };

  // Refs para rastrear se o usuário editou manualmente cada campo de rendimento.
  // Permitem o auto-sync KG↔UN APENAS quando o outro campo ainda não foi tocado —
  // evitando "trava" quando o usuário insere os dois valores reais (peso da balança + contagem).
  const userEditedKgRef = useRef(false);
  const userEditedUnRef = useRef(false);
  // Marca a chave da última linha editada manualmente DEPOIS do recálculo automático,
  // para preservar ajustes finos do usuário em insumos individuais.
  const manualLineEditsRef = useRef<Set<string>>(new Set());
  // Debounce do recálculo proporcional automático dos insumos.
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open (modo criação). Em modo edição, deixamos o efeito específico abaixo popular.
  useEffect(() => {
    if (open && !isEditMode) {
      setRecipeId(presetRecipeId ?? "");
      setLines([]);
      setYieldQty("");
      setYieldKg("");
      setYieldUnits("");
      setProportionFactor(1);
      setBatchExpiry("");
      setLocationId(defaultLocationId ?? central?.id ?? data?.locations[0]?.id ?? "");
      setQuickMode(false);
      setQuickName("");
      setQuickProducedItemId("");
      setQuickProducedItemNewName("");
      setQuickProducedItemUnit("UN");
      setQuickSaveAsRecipe(false);
      loadedRecipeIdRef.current = null;
      userEditedKgRef.current = false;
      userEditedUnRef.current = false;
      manualLineEditsRef.current.clear();
    }
  }, [open, defaultLocationId, central, data, isEditMode, presetRecipeId]);

  // Em modo edição: quando temos data + editData, encontra a receita pelo nome,
  // monta as linhas a partir dos movimentos production_out e preenche o rendimento.
  // Este efeito sobrescreve o pré-preenchimento da ficha (que roda quando recipeId muda).
  useEffect(() => {
    if (!isEditMode || !open || !data || !editData) return;
    const { inMov, outs, recipeName } = editData;
    const matchedRecipe = recipeName
      ? data.recipes.find((r) => r.name.trim().toLowerCase() === recipeName.toLowerCase())
      : null;
    if (!matchedRecipe) return;
    setRecipeId(matchedRecipe.id);
    setLocationId(inMov.to_location_id ?? "");

    // Aguarda a próxima tick para sobrescrever as linhas (depois do efeito da receita).
    const t = setTimeout(() => {
      const fmt = (n: number) =>
        n.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
      const newLines: Line[] = outs.map((m, idx) => {
        const item = data.items.find((i) => i.id === m.item_id);
        const isSub = (m.note ?? "").toLowerCase().includes("(sub-produto)");
        const ficha = data.ingredients.find(
          (i) => i.recipe_id === matchedRecipe.id && i.item_id === m.item_id,
        );
        const qtyNum = Number(m.quantity) || 0;
        const baseUnit = (item?.unit ?? "").toUpperCase();
        let unitOverride = baseUnit;
        let displayQty = qtyNum;
        const fichaUnit = (ficha?.unit ?? "").toUpperCase();
        if (item?.shared_unit_enabled && fichaUnit && fichaUnit !== baseUnit) {
          const wKg = itemWeightKg(item);
          if (wKg > 0) {
            if (baseUnit === "KG" && fichaUnit === "UN") {
              displayQty = qtyNum / wKg;
              unitOverride = "UN";
            } else if (baseUnit === "UN" && fichaUnit === "KG") {
              displayQty = qtyNum * wKg;
              unitOverride = "KG";
            }
          }
        }
        if (isSub) {
          const subRecipe = data.recipes.find(
            (r) =>
              r.type === "sub" &&
              item &&
              r.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
          );
          return {
            key: `edit-sub-${m.id}-${idx}`,
            kind: "sub" as LineKind,
            refId: subRecipe?.id ?? "",
            qty: fmt(displayQty),
            baseQty: Number(ficha?.quantity ?? 0),
            unitOverride,
          };
        }
        return {
          key: `edit-item-${m.id}-${idx}`,
          kind: "item" as LineKind,
          refId: m.item_id ?? "",
          qty: fmt(displayQty),
          baseQty: Number(ficha?.quantity ?? 0),
          unitOverride,
        };
      });
      setLines(newLines);

      const yieldQ = Number(inMov.quantity) || 0;
      const linkedItemEdit = data.items.find((i) => i.id === inMov.item_id);
      const linkedUnit = (linkedItemEdit?.unit ?? "").toUpperCase();
      const wKg = itemWeightKg(linkedItemEdit);
      setYieldQty(fmt(yieldQ));
      if (linkedUnit === "KG") {
        setYieldKg(fmt(yieldQ));
        if (wKg > 0) setYieldUnits(fmt(yieldQ / wKg));
        else setYieldUnits("");
      } else if (linkedUnit === "UN") {
        setYieldUnits(fmt(yieldQ));
        if (wKg > 0) setYieldKg(fmt(yieldQ * wKg));
        else setYieldKg("");
      }
      setProportionFactor(1);
      setLastEditedKey(null);
    }, 0);
    return () => clearTimeout(t);
  }, [isEditMode, open, data, editData]);

  // Pré-carrega a ficha quando seleciona uma receita — já preenche QTD USADA com os valores da ficha.
  // Não dispara em modo quick: nele as linhas são adicionadas manualmente pelo usuário.
  // IMPORTANTE: só executa quando o usuário troca a receita selecionada (recipeId).
  // Refetches do `data` (ex: invalidação após mutações) NÃO devem resetar os campos
  // que o usuário já editou — caso contrário, o botão da balança parece "voltar pro padrão".
  // (loadedRecipeIdRef declarado no topo do componente)
  useEffect(() => {
    if (quickMode) {
      loadedRecipeIdRef.current = null;
      return;
    }
    if (!recipe || !data) {
      if (!recipe) {
        loadedRecipeIdRef.current = null;
        setLines([]);
      }
      return;
    }
    // Se já carregamos esta mesma receita, NÃO resetar — preserva o que o usuário recalculou/editou.
    if (loadedRecipeIdRef.current === recipe.id) return;
    loadedRecipeIdRef.current = recipe.id;

    const ings = data.ingredients.filter((i) => i.recipe_id === recipe.id);
    setLines(
      ings.map((i, idx) => {
        const base = Number(i.quantity) || 0;
        const qty = base > 0
          ? base.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false })
          : "";
        const unitOverride = (i.unit ?? "").toUpperCase();
        if (i.sub_recipe_id) {
          return {
            key: `sub-${i.id}-${idx}`,
            kind: "sub" as LineKind,
            refId: i.sub_recipe_id,
            qty,
            baseQty: base,
            unitOverride,
          };
        }
        return {
          key: `item-${i.id}-${idx}`,
          kind: "item" as LineKind,
          refId: i.item_id ?? "",
          qty,
          baseQty: base,
          unitOverride,
        };
      }),
    );
    setLastEditedKey(null);
    // Sugere rendimento conforme a ficha (apenas como pré-preenchimento; o usuário pode editar)
    const suggested = Number(recipe.yield_quantity) || 0;
    const yu = (recipe.yield_unit || "").toUpperCase();
    setYieldQty(
      suggested > 0
        ? suggested.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false })
        : "",
    );
    if (suggested > 0 && yu === "KG") {
      setYieldKg(suggested.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }));
      setYieldUnits("");
    } else if (suggested > 0 && yu === "UN") {
      setYieldUnits(suggested.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }));
      setYieldKg("");
    } else {
      setYieldKg("");
      setYieldUnits("");
    }
    setProportionFactor(1);
    userEditedKgRef.current = false;
    userEditedUnRef.current = false;
    manualLineEditsRef.current.clear();
  }, [recipe, data, quickMode]);

  // Ao alternar entrada/saída do modo quick, zera as linhas, rendimento e seleção de ficha
  // para evitar contaminação cruzada entre os dois fluxos.
  useEffect(() => {
    if (!open || isEditMode) return;
    setRecipeId("");
    setLines([]);
    setYieldQty("");
    setYieldKg("");
    setYieldUnits("");
    setProportionFactor(1);
    setLastEditedKey(null);
    userEditedKgRef.current = false;
    userEditedUnRef.current = false;
    manualLineEditsRef.current.clear();
  }, [quickMode, open, isEditMode]);

  function addItemLine(itemId: string) {
    setLines((prev) => {
      if (prev.some((l) => l.kind === "item" && l.refId === itemId)) return prev;
      return [
        ...prev,
        { key: `item-${itemId}-${Date.now()}`, kind: "item", refId: itemId, qty: "", baseQty: 0 },
      ];
    });
    setAddPickerOpen(false);
  }
  function addSubLine(subRecipeId: string) {
    setLines((prev) => {
      if (prev.some((l) => l.kind === "sub" && l.refId === subRecipeId)) return prev;
      return [
        ...prev,
        { key: `sub-${subRecipeId}-${Date.now()}`, kind: "sub", refId: subRecipeId, qty: "", baseQty: 0 },
      ];
    });
    setAddPickerOpen(false);
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }
  function updateQty(key: string, qty: string) {
    // Marca esta linha como "editada manualmente" para que o auto-recálculo
    // proporcional (disparado por mudanças no rendimento) NÃO sobrescreva-a.
    manualLineEditsRef.current.add(key);
    setLastEditedKey(key);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty } : l)));
  }

  /** Recalcula proporcionalmente. Identifica a linha âncora (última editada, ou única preenchida)
   *  e aplica o fator (qtdAtual / baseQty) a todos os outros insumos com base na ficha técnica. */
  function recalcProportional() {
    const filled = lines.filter((l) => (parseFloat(l.qty.replace(",", ".")) || 0) > 0);
    let ref = lines.find((l) => l.key === lastEditedKey && (parseFloat(l.qty.replace(",", ".")) || 0) > 0);
    if (!ref) ref = filled[0];
    if (!ref) {
      toast.error("Digite uma quantidade em um insumo para usar como âncora");
      return;
    }
    const refQty = parseFloat(ref.qty.replace(",", ".")) || 0;
    if (refQty <= 0 || ref.baseQty <= 0) {
      toast.error("A âncora precisa ter quantidade e valor original na ficha técnica");
      return;
    }
    const factor = refQty / ref.baseQty;
    setLines((prev) =>
      prev.map((l) => {
        if (l.key === ref!.key) return l;
        if (l.baseQty <= 0) return l; // linha extra adicionada na hora — preserva
        const newQty = l.baseQty * factor;
        return { ...l, qty: newQty.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }) };
      }),
    );
    const newProportion = proportionFactor * factor;
    setProportionFactor(newProportion);

    // Injeção de sugestão: preenche automaticamente os campos de rendimento "Real em KG" e "Real em UN"
    // com a nova sugestão escalada da FICHA TÉCNICA. Conversão usa o peso por porção da própria ficha
    // (recipe.unit_weight_g) — nunca o avg_weight_g do estoque. O usuário ainda pode sobrescrever.
    const baseSuggested = Number(recipe?.yield_quantity ?? 0) * newProportion;
    const baseUnit = (recipe?.yield_unit ?? "").toUpperCase();
    const fichaUnitKg = Number(recipe?.unit_weight_g ?? 0) / 1000;
    if (baseSuggested > 0) {
      const fmt = (n: number) =>
        n.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
      let kgVal = 0;
      let unVal = 0;
      if (baseUnit === "KG") {
        kgVal = baseSuggested;
        if (fichaUnitKg > 0) unVal = baseSuggested / fichaUnitKg;
      } else if (baseUnit === "UN") {
        unVal = baseSuggested;
        if (fichaUnitKg > 0) kgVal = baseSuggested * fichaUnitKg;
      }
      if (kgVal > 0) setYieldKg(fmt(kgVal));
      if (unVal > 0) setYieldUnits(fmt(unVal));
    }

    toast.success(`Proporção aplicada (×${factor.toFixed(3)}) — rendimento sugerido preenchido`);
  }

  function resetToFicha() {
    setLines((prev) => prev.map((l) => ({ ...l, qty: "" })));
    setLastEditedKey(null);
  }

  /** Recalcula proporcionalmente todos os insumos a partir do rendimento digitado.
   *  fator = novoRendimento / rendimentoOriginalDaFicha — aplica a baseQty de cada linha.
   *  Suporta tanto KG quanto UN: usa o campo compatível com a unidade da ficha
   *  (recipe.yield_unit). Se a ficha rende em KG e o usuário só tem UN preenchido,
   *  converte via recipe.unit_weight_g (mesma lógica do "rendimento estimado"). */
  function recalcFromYield() {
    if (!recipe) {
      toast.error("Selecione uma receita primeiro");
      return;
    }
    const baseYield = Number(recipe.yield_quantity) || 0;
    if (baseYield <= 0) {
      toast.error("A ficha técnica não tem rendimento original definido");
      return;
    }
    const fichaUnit = (recipe.yield_unit || "").toUpperCase();
    const fichaUnitKg = Number(recipe.unit_weight_g ?? 0) / 1000;

    // Determina o "novo rendimento" na MESMA unidade da ficha
    let newYield = 0;
    if (fichaUnit === "KG") {
      if (yieldKgNum > 0) newYield = yieldKgNum;
      else if (yieldUnNum > 0 && fichaUnitKg > 0) newYield = yieldUnNum * fichaUnitKg;
    } else if (fichaUnit === "UN") {
      if (yieldUnNum > 0) newYield = yieldUnNum;
      else if (yieldKgNum > 0 && fichaUnitKg > 0) newYield = yieldKgNum / fichaUnitKg;
    } else {
      newYield = yieldNumber;
    }
    if (newYield <= 0) {
      toast.error("Digite o rendimento desejado (KG ou UN) antes de usar a balança");
      return;
    }
    const factor = newYield / baseYield;
    setLines((prev) =>
      prev.map((l) => {
        if (l.baseQty <= 0) return l; // linha extra adicionada manualmente — preserva
        const newQty = l.baseQty * factor;
        return {
          ...l,
          qty: newQty.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }),
        };
      }),
    );
    setProportionFactor(factor);
    setLastEditedKey(null);
    toast.success(
      `Insumos recalculados (×${factor.toFixed(3)}) para render ${newYield.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${fichaUnit}`,
    );
  }

  /** Resolve item subjacente (para baixa de estoque e custo) de uma linha. */
  function resolveLineItem(l: Line): ItemRow | null {
    if (!data) return null;
    if (l.kind === "item") return data.items.find((i) => i.id === l.refId) ?? null;
    return subItemFor(l.refId);
  }

  /** Unidade efetiva exibida/usada na linha (UN, KG, L, etc.). */
  function lineUnit(l: Line): string {
    const item = resolveLineItem(l);
    const base = (item?.unit ?? "").toUpperCase() || "UN";
    if (l.kind === "item" && canToggleItemUnit(item)) {
      const ov = (l.unitOverride ?? "").toUpperCase();
      if (ov === "UN" || ov === "KG") return ov;
    }
    return base;
  }

  /** Converte qty digitada para a unidade real gravada no estoque. */
  function qtyInBaseUnit(l: Line, qty: number): number {
    if (l.kind !== "item") return qty;
    const item = resolveLineItem(l);
    if (!item) return qty;
    if (item.shared_unit_enabled) {
      const chosen = lineUnit(l);
      const wKg = itemWeightKg(item);
      if (chosen === "UN" && wKg > 0) return qty * wKg;
      return qty;
    }
    const base = (item.unit ?? "").toUpperCase();
    const chosen = lineUnit(l);
    if (chosen === base) return qty;
    if (canToggleItemUnit(item)) {
      const wKg = itemWeightKg(item);
      if (wKg <= 0) return qty;
      if (base === "UN" && chosen === "KG") return qty / wKg;
      if (base === "KG" && chosen === "UN") return qty * wKg;
    }
    return qty;
  }

  // Cálculos
  const totalCost = useMemo(() => {
    return lines.reduce((acc, l) => {
      const item = resolveLineItem(l);
      const q = parseFloat(l.qty.replace(",", ".")) || 0;
      const qBase = qtyInBaseUnit(l, q);
      return acc + qBase * Number(item?.cost_price ?? 0);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, data]);

  const totalInputQty = useMemo(
    () => lines.reduce((acc, l) => acc + (parseFloat(l.qty.replace(",", ".")) || 0), 0),
    [lines],
  );

  // Peso unitário (KG por unidade) do produto pronto — para conversão híbrida nos
  // CAMPOS DE ENTRADA (KG/UN reais informados pelo usuário). Aqui pode usar o peso
  // médio do estoque, pois é só conversão de input do usuário.
  const linkedWeightKg = itemWeightKg(linkedItem) || (Number(recipe?.unit_weight_g ?? 0) / 1000);
  const linkedBaseUnit = (linkedItem?.unit ?? recipe?.yield_unit ?? "KG").toUpperCase();
  const canHybridYield = linkedWeightKg > 0;

  // Bidirecional KG ↔ UN: ao digitar em um, o outro é atualizado pelo peso médio cadastrado.
  // Não dispara reset dos insumos — apenas reflete a equivalência. Permite que o usuário troque
  // livremente entre as duas unidades antes de clicar na balança "Recalcular insumos".
  const fmtYield = (n: number) =>
    n.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
  // Calculadora bidirecional KG ↔ UN baseada na proporção da Ficha Técnica:
  // se o usuário ainda NÃO editou manualmente o outro campo, sugerimos o equivalente.
  // Se ele editar AMBOS, paramos de sobrescrever — esses valores reais ditam o
  // peso médio real desta leva (KG/UN). O recálculo dos insumos roda em debounce
  // para não "piscar" enquanto digita.
  const handleYieldKgChange = (raw: string) => {
    setYieldKg(raw);
    userEditedKgRef.current = raw.trim() !== "";
    if (canHybridYield && !userEditedUnRef.current) {
      const kg = parseFloat(raw.replace(",", ".")) || 0;
      if (kg > 0 && linkedWeightKg > 0) {
        setYieldUnits(fmtYield(kg / linkedWeightKg));
      } else if (raw.trim() === "") {
        setYieldUnits("");
      }
    }
    scheduleAutoRecalc();
  };
  const handleYieldUnitsChange = (raw: string) => {
    const sanitized = sanitizeUnitsInput(raw);
    setYieldUnits(sanitized);
    userEditedUnRef.current = sanitized.trim() !== "";
    if (canHybridYield && !userEditedKgRef.current) {
      const un = parseFloat(sanitized.replace(",", ".")) || 0;
      if (un > 0 && linkedWeightKg > 0) {
        setYieldKg(fmtYield(un * linkedWeightKg));
      } else if (sanitized.trim() === "") {
        setYieldKg("");
      }
    }
    scheduleAutoRecalc();
  };

  /** Agenda recálculo proporcional dos insumos com debounce (350 ms).
   *  Preserva linhas que o usuário já editou manualmente após o último auto-recálculo. */
  function scheduleAutoRecalc() {
    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
    recalcTimerRef.current = setTimeout(() => autoRecalcIngredients(), 350);
  }

  function autoRecalcIngredients() {
    if (!recipe) return;
    const baseYield = Number(recipe.yield_quantity) || 0;
    if (baseYield <= 0) return;
    const fichaUnit = (recipe.yield_unit || "").toUpperCase();
    const fichaUnitKg = Number(recipe.unit_weight_g ?? 0) / 1000;
    const kg = parseFloat(yieldKg.replace(",", ".")) || 0;
    const un = parseFloat(yieldUnits.replace(",", ".")) || 0;
    let newYield = 0;
    if (fichaUnit === "KG") {
      if (kg > 0) newYield = kg;
      else if (un > 0 && fichaUnitKg > 0) newYield = un * fichaUnitKg;
    } else if (fichaUnit === "UN") {
      if (un > 0) newYield = un;
      else if (kg > 0 && fichaUnitKg > 0) newYield = kg / fichaUnitKg;
    }
    if (newYield <= 0) return;
    const factor = newYield / baseYield;
    if (!Number.isFinite(factor) || factor <= 0) return;
    const manuals = manualLineEditsRef.current;
    setLines((prev) =>
      prev.map((l) => {
        if (l.baseQty <= 0) return l; // linha extra adicionada manualmente
        if (manuals.has(l.key)) return l; // ajuste fino do usuário — preserva
        const newQty = l.baseQty * factor;
        return { ...l, qty: fmtYield(newQty) };
      }),
    );
    setProportionFactor(factor);
  }

  // REGRA DE OURO: o "Rendimento Estimado" exibido vem EXCLUSIVAMENTE da Ficha Técnica.
  // Não usar avg_weight_g do estoque aqui — apenas recipe.unit_weight_g (peso por porção
  // definido no cadastro da ficha) para converter entre KG e UN quando necessário.
  const recipeUnitWeightKg = Number(recipe?.unit_weight_g ?? 0) / 1000;
  const canConvertEstimate = recipeUnitWeightKg > 0;

  // Os campos KG e UN agora são INDEPENDENTES — nada de auto-sync entre eles.
  // O `yieldQty` (usado para gravar entrada no estoque) é derivado da unidade base do item:
  // - se base = KG → usa o KG digitado
  // - se base = UN → usa o UN digitado
  // - se a base requer KG mas o usuário só preencheu UN (e há peso médio), converte ao salvar.
  useEffect(() => {
    const kg = parseFloat(yieldKg.replace(",", ".")) || 0;
    const un = parseFloat(yieldUnits.replace(",", ".")) || 0;
    if (linkedBaseUnit === "KG") {
      if (kg > 0) {
        setYieldQty(kg.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }));
      } else if (un > 0 && canHybridYield) {
        const conv = un * linkedWeightKg;
        setYieldQty(conv.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }));
      } else {
        setYieldQty("");
      }
    } else if (linkedBaseUnit === "UN") {
      if (un > 0) {
        setYieldQty(un.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }));
      } else if (kg > 0 && canHybridYield && linkedWeightKg > 0) {
        const conv = kg / linkedWeightKg;
        setYieldQty(conv.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false }));
      } else {
        setYieldQty("");
      }
    }
  }, [yieldKg, yieldUnits, linkedBaseUnit, canHybridYield, linkedWeightKg]);

  const yieldNumber = parseFloat(yieldQty.replace(",", ".")) || 0;
  const yieldKgNum = parseFloat(yieldKg.replace(",", ".")) || 0;
  const yieldUnNum = parseFloat(yieldUnits.replace(",", ".")) || 0;

  // Regra de Negócio: quantidade produzida em UNIDADES só aceita inteiros ou frações de 0,5.
  // Aplicável apenas quando o produto é um PRODUÇÃO INTERNA porcionado (canHybridYield) e o usuário
  // informou unidades. Tolerância de 0,001 para erros de ponto flutuante.
  const isHalfStep = (n: number) => {
    if (!isFinite(n) || n <= 0) return true;
    const x = n * 2;
    return Math.abs(x - Math.round(x)) < 0.001;
  };
  const unitsFractionInvalid =
    canHybridYield && yieldUnNum > 0 && !isHalfStep(yieldUnNum);

  // Arredondamento "half-down" para o Rendimento Estimado (sugestão):
  // 0,5 → inteiro inferior; > 0,5 → inteiro superior.
  const roundEstimatedUnits = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return 0;
    const frac = n - Math.floor(n);
    return frac > 0.5 ? Math.ceil(n) : Math.floor(n);
  };

  // Sanitiza o input de "Quantidade Produzida (un)": apenas inteiros ou .5.
  // Aceita digitação parcial ("43", "43,") e descarta decimais inválidos.
  const sanitizeUnitsInput = (raw: string) => {
    let v = raw.replace(/[^\d.,]/g, "").replace(",", ".");
    const firstDot = v.indexOf(".");
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
    }
    if (v === "" || v === ".") return v;
    const dot = v.indexOf(".");
    if (dot === -1) return v;
    const intPart = v.slice(0, dot);
    const decPart = v.slice(dot + 1);
    if (decPart === "") return intPart + ".";
    if (decPart[0] === "5") return intPart + ".5";
    return intPart;
  };

  // Peso unitário REAL desta leva (kg/un) — derivado de KG ÷ UN reais informados.
  // É esse valor que fica gravado no note para a Auditoria de Turno usar como "Base".
  const realUnitWeightKg = yieldKgNum > 0 && yieldUnNum > 0 ? yieldKgNum / yieldUnNum : 0;
  // Custo unitário híbrido
  const costPerKg = yieldKgNum > 0 ? totalCost / yieldKgNum : (linkedBaseUnit === "KG" && yieldNumber > 0 ? totalCost / yieldNumber : 0);
  const costPerUn = yieldUnNum > 0 ? totalCost / yieldUnNum : (linkedBaseUnit === "UN" && yieldNumber > 0 ? totalCost / yieldNumber : (canHybridYield && yieldKgNum > 0 ? totalCost / (yieldKgNum / linkedWeightKg) : 0));
  const unitCost = yieldNumber > 0 ? totalCost / yieldNumber : 0;
  const yieldFactor = totalInputQty > 0 ? (yieldNumber / totalInputQty) * 100 : 0;
  const lossPercent = 100 - yieldFactor;
  const allLinesFilled =
    lines.length > 0 && lines.every((l) => (parseFloat(l.qty.replace(",", ".")) || 0) > 0);

  // Sugestões da ficha técnica (para mostrar "deveria render" vs "real").
  // Aplica `proportionFactor` para refletir o "Recalcular proporcional" — ao escalar os insumos,
  // a sugestão de rendimento escala junto.
  // IMPORTANTE: a conversão entre KG e UN aqui usa o peso por porção da PRÓPRIA Ficha Técnica
  // (recipe.unit_weight_g), JAMAIS o avg_weight_g do estoque. Isso garante que o rendimento
  // estimado siga fielmente o que está cadastrado na ficha.
  const suggestedYieldRaw = Number(recipe?.yield_quantity ?? 0) * proportionFactor;
  const suggestedYieldUnit = (recipe?.yield_unit ?? "").toUpperCase();
  const suggestedYield = suggestedYieldRaw;
  const suggestedYieldKg = suggestedYieldRaw > 0
    ? (suggestedYieldUnit === "KG"
        ? suggestedYieldRaw
        : (canConvertEstimate ? suggestedYieldRaw * recipeUnitWeightKg : 0))
    : 0;
  const suggestedYieldUn = suggestedYieldRaw > 0
    ? (suggestedYieldUnit === "UN"
        ? suggestedYieldRaw
        : (canConvertEstimate ? suggestedYieldRaw / recipeUnitWeightKg : 0))
    : 0;

  // Cria (ou reaproveita) o item de Produção Própria e PERSISTE o vínculo na ficha.
  const linkItem = useMutation({
    mutationFn: async () => {
      if (!recipe) throw new Error("Sem receita");
      if (!data) throw new Error("Dados não carregados");

      // 1) Se a ficha já tem produced_item_id válido, nada a fazer.
      if (recipe.produced_item_id) {
        const exists = data.items.find((i) => i.id === recipe.produced_item_id);
        if (exists) return { id: exists.id, reused: true };
      }

      // 2) Reaproveita item existente com mesmo nome na categoria Produção Própria.
      const normalized = recipe.name.trim().toLowerCase();
      const existing = data.items.find(
        (i) =>
          i.category_id === producaoCategoryId &&
          i.name.trim().toLowerCase() === normalized,
      );

      let itemId: string;
      let reused = false;
      if (existing) {
        itemId = existing.id;
        reused = true;
      } else {
        const { data: created, error } = await supabase
          .from("items")
          .insert({
            name: recipe.name,
            unit: recipe.yield_unit || "KG",
            category_id: producaoCategoryId,
          })
          .select("id")
          .single();
        if (error) throw error;
        itemId = created.id;
      }

      // 3) Persiste o vínculo na ficha técnica.
      const { error: linkErr } = await supabase
        .from("recipes")
        .update({ produced_item_id: itemId })
        .eq("id", recipe.id);
      if (linkErr) throw linkErr;

      return { id: itemId, reused };
    },
    onSuccess: async (res) => {
      toast.success(
        res.reused
          ? "Item existente vinculado à ficha"
          : "Item de Produção Própria criado e vinculado à ficha",
      );
      await qc.invalidateQueries({ queryKey: ["production-data-v3"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Vincula manualmente um item já existente (escolhido em dropdown) à ficha.
  const linkExistingItem = useMutation({
    mutationFn: async (itemId: string) => {
      if (!recipe) throw new Error("Sem receita");
      const { error } = await supabase
        .from("recipes")
        .update({ produced_item_id: itemId })
        .eq("id", recipe.id);
      if (error) throw error;
      return itemId;
    },
    onSuccess: async () => {
      toast.success("Vínculo atualizado");
      await qc.invalidateQueries({ queryKey: ["production-data-v3"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Dados não carregados");
      if (!recipe) throw new Error("Selecione uma receita");
      if (quickMode) {
        if (!quickName.trim()) throw new Error("Dê um nome para a receita");
        if (!quickProducedItemId) throw new Error("Selecione ou crie o item de produto pronto");
        if (quickProducedItemId === "__new__" && !quickProducedItemNewName.trim()) {
          throw new Error("Informe o nome do novo item de produto pronto");
        }
      }
      if (!linkedItem) throw new Error("Esta receita não tem item de Produção Própria vinculado");
      if (!central) throw new Error("Estoque Central não encontrado");
      if (!locationId) throw new Error("Selecione o destino");
      // VENDA DIRETA: se a operação destino opera em modo "direct", o produto
      // pronto entra fisicamente no Estoque Central — a operação consumirá
      // dali na hora da venda/auditoria. Mantemos rastro no note do movement.
      const selectedLoc = data.locations.find((l) => l.id === locationId) as
        | { id: string; name: string; stock_mode?: string | null }
        | undefined;
      const destIsDirect = (selectedLoc?.stock_mode ?? "traditional") === "direct";
      const effectiveDestId = destIsDirect && central ? central.id : locationId;
      const directNoteSuffix = destIsDirect
        ? ` [Venda Direta @ ${selectedLoc?.name ?? "operação"}]`
        : "";
      if (yieldNumber <= 0) throw new Error("Informe o rendimento final");
      if (unitsFractionInvalid) {
        throw new Error(
          "A quantidade produzida deve ser um número inteiro ou meio (ex: .5). Ajuste o peso total ou a quantidade.",
        );
      }

      const validLines = lines
        .map((l) => ({ ...l, qtyNum: parseFloat(l.qty.replace(",", ".")) || 0 }))
        .filter((l) => l.qtyNum > 0);
      if (validLines.length === 0) throw new Error("Informe ao menos um insumo com quantidade");

      // ====== MODO QUICK: cria (se necessário) o item produto pronto e a receita ======
      // Substituímos `linkedItem` por uma referência com ID real para o restante do fluxo.
      let effectiveLinkedItem = linkedItem;
      let effectiveRecipeId: string | null = quickMode ? null : recipe.id;
      let effectiveRecipeName = recipe.name;
      if (quickMode) {
        // 1) Item de produto pronto
        let producedItemId = quickProducedItemId;
        if (producedItemId === "__new__") {
          const { data: created, error } = await supabase
            .from("items")
            .insert({
              name: quickProducedItemNewName.trim(),
              unit: quickProducedItemUnit.toLowerCase(),
              category_id: producaoCategoryId,
            })
            .select("id,name,unit,cost_price,category_id,shared_unit_enabled,standard_weight_g,avg_weight_g")
            .single();
          if (error) throw error;
          producedItemId = created.id;
          effectiveLinkedItem = created as ItemRow;
        } else {
          const found = data.items.find((i) => i.id === producedItemId);
          if (!found) throw new Error("Item de produto pronto não encontrado");
          effectiveLinkedItem = found;
        }

        // 2) Opcionalmente persiste como ficha técnica reaproveitável
        if (quickSaveAsRecipe) {
          const { data: createdRecipe, error: rErr } = await supabase
            .from("recipes")
            .insert({
              name: quickName.trim(),
              type: "final",
              yield_quantity: yieldNumber,
              yield_unit: quickProducedItemUnit,
              produced_item_id: producedItemId,
            })
            .select("id")
            .single();
          if (rErr) throw rErr;
          effectiveRecipeId = createdRecipe.id;
          effectiveRecipeName = quickName.trim();
          // Insere ingredientes com as quantidades digitadas (na unidade do item)
          const ingsPayload = validLines
            .filter((l) => l.kind === "item")
            .map((l) => ({
              recipe_id: createdRecipe.id,
              item_id: l.refId,
              quantity: qtyInBaseUnit(l, l.qtyNum),
              unit: (data.items.find((i) => i.id === l.refId)?.unit ?? "UN").toUpperCase(),
            }));
          if (ingsPayload.length > 0) {
            const { error: iErr } = await supabase.from("recipe_ingredients").insert(ingsPayload);
            if (iErr) throw iErr;
          }
        }
      }

      // Validação de vínculo de produção interna: precisam ter item de Produção Própria
      for (const l of validLines) {
        if (l.kind === "sub") {
          const subItem = subItemFor(l.refId);
          if (!subItem) {
            const sub = data.recipes.find((r) => r.id === l.refId);
            throw new Error(
              `Produção Interna "${sub?.name ?? "?"}" não tem item de Produção Própria vinculado. Produza-a primeiro ou crie o item.`,
            );
          }
        }
      }

      if (!effectiveLinkedItem || effectiveLinkedItem.id.startsWith("__")) {
        throw new Error("Item de produto pronto inválido");
      }

      // Snapshot de estoque local que vamos manipular ao longo do fluxo (especialmente
      // importante em modo edição, onde estornamos antes de relançar).
      const stockMap = new Map<string, number>();
      const stockKey = (itemId: string, locId: string) => `${itemId}|${locId}`;
      for (const s of data.stock) {
        stockMap.set(stockKey(s.item_id, s.location_id), Number(s.current_stock ?? 0));
      }

      // ====== MODO EDIÇÃO: estornar movimentos originais antes de relançar ======
      if (isEditMode && editData) {
        const { inMov, outs } = editData;
        // Devolve cada insumo original ao Estoque Central
        for (const m of outs) {
          if (!m.item_id) continue;
          const k = stockKey(m.item_id, central.id);
          const cur = stockMap.get(k) ?? 0;
          const restored = cur + Number(m.quantity ?? 0);
          stockMap.set(k, restored);
          const { error } = await supabase
            .from("stock_levels")
            .upsert(
              { item_id: m.item_id, location_id: central.id, current_stock: restored },
              { onConflict: "item_id,location_id" },
            );
          if (error) throw error;
        }
        // Remove a entrada do produto pronto do destino original
        if (inMov.item_id && inMov.to_location_id) {
          const k = stockKey(inMov.item_id, inMov.to_location_id);
          const cur = stockMap.get(k) ?? 0;
          const restored = cur - Number(inMov.quantity ?? 0);
          stockMap.set(k, restored);
          const { error } = await supabase
            .from("stock_levels")
            .upsert(
              {
                item_id: inMov.item_id,
                location_id: inMov.to_location_id,
                current_stock: restored,
              },
              { onConflict: "item_id,location_id" },
            );
          if (error) throw error;
        }
        // Deleta os movimentos antigos para que não dupliquem o histórico
        const idsToDelete = [inMov.id, ...outs.map((o) => o.id)];
        const { error: delErr } = await supabase
          .from("movements")
          .delete()
          .in("id", idsToDelete);
        if (delErr) throw delErr;
      }

      // Contexto pré-montado para "explosão" recursiva quando uma sub-ficha
      // tem `explode_on_consume = true` (ou produto pronto zerado, fallback).
      const stockByItemForExplode = new Map<string, number>();
      for (const s of data.stock) {
        stockByItemForExplode.set(
          s.item_id,
          (stockByItemForExplode.get(s.item_id) ?? 0) + Number(s.current_stock ?? 0),
        );
      }
      const explodeCtx: ExplodeContext = {
        recipes: data.recipes.map((r) => ({
          id: r.id,
          yield_quantity: Number(r.yield_quantity ?? 1),
          yield_unit: String(r.yield_unit ?? "UN"),
          unit_weight_g: r.unit_weight_g != null ? Number(r.unit_weight_g) : null,
          produced_item_id: (r as { produced_item_id?: string | null }).produced_item_id ?? null,
          explode_on_consume:
            (r as { explode_on_consume?: boolean }).explode_on_consume === true,
        })),
        ingredients: data.ingredients.map((i) => ({
          recipe_id: i.recipe_id,
          item_id: i.item_id,
          sub_recipe_id: i.sub_recipe_id,
          quantity: Number(i.quantity),
          unit: String(i.unit ?? ""),
        })),
        items: data.items.map((it) => ({
          id: it.id,
          unit: String(it.unit ?? "un"),
          avg_weight_g: Number(it.avg_weight_g ?? 0),
          shared_unit_enabled: (it as { shared_unit_enabled?: boolean }).shared_unit_enabled === true,
        })),
        stockByItem: stockByItemForExplode,
      };

      const debitOne = async (
        itemId: string,
        baseQty: number,
        baseUnit: "kg" | "un",
        avgWeightG: number,
        noteSuffix: string,
      ) => {
        let realTaken = baseQty;
        try {
          const r = await consumeStockReal({
            itemId,
            qty: baseQty,
            inputUnit: baseUnit,
            itemBaseUnit: baseUnit,
            avgWeightG,
          });
          if (r.realBaseTaken > 0) realTaken = r.realBaseTaken;
        } catch (_e) { /* não bloqueia produção */ }
        const k = stockKey(itemId, central.id);
        const cur = stockMap.get(k) ?? 0;
        const newQty = cur - realTaken;
        stockMap.set(k, newQty);
        const { error } = await supabase
          .from("stock_levels")
          .upsert(
            { item_id: itemId, location_id: central.id, current_stock: newQty },
            { onConflict: "item_id,location_id" },
          );
        if (error) throw error;
        const { error: mErr } = await supabase.from("movements").insert({
          item_id: itemId,
          from_location_id: central.id,
          to_location_id: null,
          quantity: realTaken,
          type: "production_out",
          note: `Produção: ${effectiveRecipeName}${noteSuffix}${isEditMode ? " [EDITADO]" : ""}`,
        });
        if (mErr) throw mErr;
      };

      // 1) Baixa cada insumo do Estoque Central (usando o stockMap atualizado)
      for (const l of validLines) {
        const item = resolveLineItem(l);
        if (!item) continue;
        const qtyBase = qtyInBaseUnit(l, l.qtyNum);

        // Se é uma sub-ficha que deve EXPLODIR, descemos até insumos brutos.
        if (l.kind === "sub") {
          const subRecipe = explodeCtx.recipes.find((r) => r.id === l.refId);
          const shouldExplode =
            subRecipe?.explode_on_consume === true ||
            (subRecipe?.produced_item_id != null &&
              (stockByItemForExplode.get(subRecipe.produced_item_id) ?? 0) <= 0);
          if (subRecipe && shouldExplode) {
            // qtyBase aqui é a quantidade de "yields" da sub-ficha que estamos consumindo
            // (em UN ou KG — a função explodeRecipe normaliza internamente).
            const yieldsConsumed =
              ((item.unit ?? "un").toLowerCase() === "kg")
                ? // Se o item de produto pronto da sub está em KG, qtyBase já está em KG.
                  // Convertemos para "yields" usando unit_weight_g.
                  (() => {
                    const wKg = (subRecipe.unit_weight_g ?? 0) / 1000;
                    return wKg > 0 ? qtyBase / wKg : qtyBase;
                  })()
                : qtyBase;
            const exploded = explodeRecipe(
              subRecipe.id,
              yieldsConsumed * subRecipe.yield_quantity,
              explodeCtx,
            );
            for (const e of exploded) {
              const rawItem = data.items.find((i) => i.id === e.itemId);
              if (!rawItem) continue;
              const rawBaseUnit = (rawItem.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un";
              await debitOne(
                e.itemId,
                e.qty,
                rawBaseUnit,
                Number(rawItem.avg_weight_g ?? 0),
                ` (explodido de ${data.recipes.find((r) => r.id === subRecipe.id)?.name ?? "sub-ficha"})`,
              );
            }
            continue;
          }
        }

        const baseUnit = ((item.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un") as
          | "kg"
          | "un";
        await debitOne(
          item.id,
          qtyBase,
          baseUnit,
          Number(item.avg_weight_g ?? 0),
          l.kind === "sub" ? " (sub-produto)" : "",
        );
      }

      // 2) Entrada do produto pronto no destino
      const destKey = stockKey(effectiveLinkedItem.id, effectiveDestId);
      const currentQty = stockMap.get(destKey) ?? 0;
      const newDest = currentQty + yieldNumber;
      stockMap.set(destKey, newDest);
      const { error: e1 } = await supabase
        .from("stock_levels")
        .upsert(
          { item_id: effectiveLinkedItem.id, location_id: effectiveDestId, current_stock: newDest },
          { onConflict: "item_id,location_id" },
        );
      if (e1) throw e1;

      // 3) Custo médio ponderado
      const currentCost = Number(effectiveLinkedItem.cost_price ?? 0);
      const newAvg =
        currentQty + yieldNumber > 0
          ? (currentQty * currentCost + yieldNumber * unitCost) / (currentQty + yieldNumber)
          : unitCost;
      // 3a) Recalcula peso médio ponderado por unidade do produção interna/produção própria.
      // Regra: items.avg_weight_g é o FATOR ÚNICO usado pelo Toggle (KG/UN) em todo o app.
      // Soma o peso real (kg) e as unidades reais desta leva à média atual ponderada.
      const itemUpdate: { cost_price: number; avg_weight_g?: number } = { cost_price: newAvg };
      if (!isEditMode && realUnitWeightKg > 0 && yieldUnNum > 0) {
        const currentAvgG = Number(effectiveLinkedItem.avg_weight_g ?? 0);
        // Estima unidades atuais no estoque global a partir do saldo do destino e da média atual.
        // Quando ainda não há média, considera apenas as unidades novas (primeiro lote).
        const currentUnitsEstimate =
          currentAvgG > 0 ? currentQty / (currentAvgG / 1000) : 0;
        const newAvgG = weightedAvgWeight(
          currentUnitsEstimate,
          currentAvgG,
          yieldUnNum,
          realUnitWeightKg * 1000,
        );
        if (newAvgG > 0 && Number.isFinite(newAvgG)) {
          itemUpdate.avg_weight_g = newAvgG;
        }
      }
      const { error: e2 } = await supabase
        .from("items")
        .update(itemUpdate)
        .eq("id", effectiveLinkedItem.id);
      if (e2) throw e2;

      // 4) Movement de entrada (com selo [EDITADO] em modo edição)
      const editMark = isEditMode ? " [EDITADO]" : "";
      const parts: string[] = [`Produção: ${effectiveRecipeName}${editMark}`];
      parts.push(
        `Entrada ${totalInputQty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} → Saída ${yieldNumber.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${effectiveLinkedItem.unit.toUpperCase()}`,
      );
      if (yieldKgNum > 0) {
        parts.push(`Peso ${yieldKgNum.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`);
      }
      if (yieldUnNum > 0) {
        parts.push(`Unidades ${yieldUnNum.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`);
      }
      // Peso unitário REAL desta leva — fonte autoritativa para a Auditoria de Turno.
      // Formato compatível com o regex /([\d.,]+)\s*(kg|g)\s*\/\s*un/i do shift-audit-dialog.
      if (realUnitWeightKg > 0) {
        const gPerUn = Math.round(realUnitWeightKg * 1000);
        parts.push(`Peso unitário ${gPerUn} g/un`);
      }
      parts.push(`Custo total ${fmtBRL(totalCost)}`);
      parts.push(`Custo unitário ${fmtBRL(unitCost)}`);
      if (costPerKg > 0) parts.push(`Custo/kg ${fmtBRL(costPerKg)}`);
      if (costPerUn > 0) parts.push(`Custo/un ${fmtBRL(costPerUn)}`);
      const note = parts.join(" | ") + directNoteSuffix;
      const { data: movIn, error: mErr } = await supabase.from("movements").insert({
        item_id: effectiveLinkedItem.id,
        from_location_id: null,
        to_location_id: effectiveDestId,
        quantity: yieldNumber,
        type: "production_in",
        note,
      }).select("id").single();
      if (mErr) throw mErr;

      // 5) Cria LOTE da produção (rastreabilidade FEFO + custo/peso médio próprios da leva).
      // Cada produção vira seu próprio lote, com avg_weight_g e unit_cost calculados aqui.
      try {
        const avgG =
          realUnitWeightKg > 0
            ? realUnitWeightKg * 1000
            : (Number(effectiveLinkedItem.avg_weight_g ?? 0) || 0);
        const totalG = yieldKgNum > 0 ? yieldKgNum * 1000 : avgG * yieldUnNum;
        await supabase.from("item_batches").insert({
          item_id: effectiveLinkedItem.id,
          source: "production",
          units_qty: yieldUnNum > 0 ? yieldUnNum : (linkedBaseUnit === "UN" ? yieldNumber : 0),
          total_weight_g: totalG > 0 && Number.isFinite(totalG) ? totalG : 0,
          avg_weight_g: avgG > 0 && Number.isFinite(avgG) ? avgG : 0,
          initial_qty: yieldNumber,
          current_qty: yieldNumber,
          unit_cost: unitCost > 0 && Number.isFinite(unitCost) ? unitCost : 0,
          expiry_date: batchExpiry || null,
          movement_id: movIn?.id ?? null,
          note: `Produção: ${effectiveRecipeName}${editMark}`,
        });
      } catch (_e) {
        // não bloqueia produção se o lote falhar (ex.: tabela ausente em ambientes legados)
      }
    },
    onSuccess: () => {
      toast.success(isEditMode ? "Produção atualizada" : "Produção registrada");
      qc.invalidateQueries();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Lista de receitas para o picker — APENAS Produção Interna e Produção Própria
  const recipesByGroup = useMemo(() => {
    if (!data) return [] as { label: string; recipes: RecipeRow[] }[];
    const producaoRecipeCatId = data.recipeCategories.find(
      (c) => c.name.trim().toLowerCase() === PRODUCAO_PROPRIA_NAME.toLowerCase(),
    )?.id;
    const subs = data.recipes.filter((r) => r.type === "sub");
    const producao = data.recipes.filter(
      (r) => r.type !== "sub" && producaoRecipeCatId && r.category_id === producaoRecipeCatId,
    );
    const groups: { label: string; recipes: RecipeRow[] }[] = [];
    if (subs.length) groups.push({ label: "Produção Interna", recipes: subs });
    if (producao.length) groups.push({ label: PRODUCAO_PROPRIA_NAME, recipes: producao });
    return groups;
  }, [data]);

  // Itens disponíveis para adicionar ao vivo (excluindo Produção Própria — usar produção interna para isso)
  const ingredientItems = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter((i) => i.category_id !== producaoCategoryId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, producaoCategoryId]);

  const subRecipeOptions = useMemo(() => {
    if (!data) return [] as RecipeRow[];
    // Apenas subs que JÁ têm item de Produção Própria (já produzidas alguma vez)
    return data.recipes
      .filter((r) => r.type === "sub" && r.id !== recipeId)
      .filter((r) =>
        data.items.some(
          (i) =>
            i.category_id === producaoCategoryId &&
            i.name.trim().toLowerCase() === r.name.trim().toLowerCase(),
        ),
      );
  }, [data, recipeId, producaoCategoryId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <Button
          type="button"
          onClick={() => setOpen(true)}
          variant={triggerVariant}
          className={cn("gap-2", triggerClassName)}
        >
          <ChefHat className="h-4 w-4" /> Registrar Produção
        </Button>
      )}

      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChefHat className="h-5 w-5" />
            {isEditMode ? "Editar Produção" : "Registrar Produção"}
            {isEditMode && (
              <Badge variant="secondary" className="ml-1 text-[10px]">
                modo edição
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Selecione uma receita, ajuste os insumos com o peso real e informe o rendimento final.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Toggle Modo Quick (apenas fora de edição) */}
          {!isEditMode && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold">
                  {quickMode ? "Modo: Receita na Hora" : "Use uma ficha técnica existente"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {quickMode
                    ? "Monte uma receita improvisada e (opcionalmente) salve como ficha."
                    : "Ou crie uma receita do zero, sem cadastrar antes."}
                </p>
              </div>
              <Button
                type="button"
                variant={quickMode ? "secondary" : "outline"}
                size="sm"
                onClick={() => setQuickMode((v) => !v)}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                {quickMode ? "Voltar para fichas" : "Criar Receita na Hora"}
              </Button>
            </div>
          )}

          {/* Receita */}
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              {quickMode ? "Receita na hora" : "Receita / Produção Interna"}
            </Label>
            {isEditMode ? (
              <div className="flex h-12 w-full items-center justify-between rounded-md border border-input bg-muted/40 px-3 text-base">
                <span className="flex items-center gap-2 truncate">
                  <ChefHat className="h-4 w-4 text-muted-foreground" />
                  {recipe ? recipe.name : "Carregando…"}
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  bloqueado na edição
                </Badge>
              </div>
            ) : quickMode ? (
              <div className="space-y-3 rounded-xl border border-border bg-background p-3">
                <div>
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Nome da produção
                  </Label>
                  <Input
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                    placeholder="Ex: Molho do dia, Caldo de legumes…"
                    className="mt-1 h-11"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Item de produto pronto
                    </Label>
                    <select
                      value={quickProducedItemId}
                      onChange={(e) => setQuickProducedItemId(e.target.value)}
                      className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">Selecione…</option>
                      <option value="__new__">+ Criar novo item de Produção Própria</option>
                      {(data?.items ?? [])
                        .filter((i) => i.category_id === producaoCategoryId)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({(i.unit ?? "").toUpperCase()})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Unidade
                    </Label>
                    <select
                      value={quickProducedItemUnit}
                      onChange={(e) => setQuickProducedItemUnit(e.target.value as "KG" | "UN")}
                      disabled={quickProducedItemId !== "__new__"}
                      className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                    >
                      <option value="UN">UN</option>
                      <option value="KG">KG</option>
                    </select>
                  </div>
                </div>
                {quickProducedItemId === "__new__" && (
                  <div>
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Nome do novo item
                    </Label>
                    <Input
                      value={quickProducedItemNewName}
                      onChange={(e) => setQuickProducedItemNewName(e.target.value)}
                      placeholder={quickName.trim() || "Nome do produto pronto"}
                      className="mt-1 h-11"
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={quickSaveAsRecipe}
                    onChange={(e) => setQuickSaveAsRecipe(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>
                    Salvar como ficha técnica reaproveitável (aparece em "Fichas")
                  </span>
                </label>
              </div>
            ) : (
              <Popover open={recipePickerOpen} onOpenChange={setRecipePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-12 w-full justify-between text-base"
                  >
                    <span className="truncate">
                      {recipe ? recipe.name : "Selecione a ficha técnica…"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[480px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar receita…" />
                    <CommandList>
                      <CommandEmpty>Nenhuma receita encontrada.</CommandEmpty>
                      {recipesByGroup.map((g) => (
                        <CommandGroup key={g.label} heading={g.label}>
                          {g.recipes.map((r) => (
                            <CommandItem
                              key={r.id}
                              value={r.name}
                              onSelect={() => {
                                setRecipeId(r.id);
                                setRecipePickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  recipeId === r.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {r.type === "sub" ? (
                                <Soup className="mr-2 h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChefHat className="mr-2 h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="flex-1">{r.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                rende {r.yield_quantity} {r.yield_unit}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
            {/* Vínculo obrigatório com item de Produção Própria (oculto em modo quick) */}
            {!quickMode && recipe && !linkedItem && (
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="flex-1">
                    <p className="font-medium">Receita sem item vinculado</p>
                    <p className="text-xs text-muted-foreground">
                      Toda receita de Produção Própria precisa de um item correspondente para receber
                      o estoque pronto e o custo médio. Crie um novo automaticamente ou selecione um
                      item já existente.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => linkItem.mutate()}
                    disabled={linkItem.isPending || linkExistingItem.isPending}
                    className="gap-1"
                  >
                    <LinkIcon className="h-3.5 w-3.5" />
                    {linkItem.isPending ? "…" : "Criar e vincular"}
                  </Button>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">
                    Ou usar existente:
                  </Label>
                  <select
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    defaultValue=""
                    disabled={linkExistingItem.isPending || linkItem.isPending}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) linkExistingItem.mutate(val);
                    }}
                  >
                    <option value="">Selecione um item de Produção Própria…</option>
                    {(data?.items ?? [])
                      .filter((i) => i.category_id === producaoCategoryId)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unit?.toUpperCase()})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            {!quickMode && recipe && !data?.ingredients.some((i) => i.recipe_id === recipe.id) && (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Esta ficha não tem ingredientes cadastrados.{" "}
                <Link to="/fichas" className="underline">
                  Editar ficha técnica
                </Link>
                .
              </p>
            )}
          </section>

          {/* Tabela de insumos */}
          {recipe && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Ficha de Produção · insumos
                </Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={recalcProportional}
                    disabled={lines.length === 0}
                    title="Aplica a mesma proporção da última quantidade editada nos demais insumos"
                  >
                    <Scale className="h-3.5 w-3.5" /> Recalcular proporcional
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={resetToFicha}
                    disabled={lines.length === 0}
                    title="Limpa as quantidades digitadas (volta à ficha em branco)"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Limpar
                  </Button>
                  <Popover open={addPickerOpen} onOpenChange={setAddPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="gap-1">
                        <Plus className="h-3.5 w-3.5" /> Adicionar
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[380px] p-0" align="end">
                      <Command>
                        <CommandInput placeholder="Buscar insumo ou produção interna…" />
                        <CommandList>
                          <CommandEmpty>Nada encontrado.</CommandEmpty>
                          {subRecipeOptions.length > 0 && (
                            <CommandGroup heading="Produções Internas prontas">
                              {subRecipeOptions.map((r) => {
                                const it = subItemFor(r.id);
                                return (
                                  <CommandItem
                                    key={`sub-${r.id}`}
                                    value={`sub ${r.name}`}
                                    onSelect={() => addSubLine(r.id)}
                                  >
                                    <Soup className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span className="flex-1">{r.name}</span>
                                    {isManager && (
                                      <span className="text-xs text-muted-foreground">
                                        {fmtBRL(Number(it?.cost_price ?? 0))}/{(it?.unit ?? "kg").toUpperCase()}
                                      </span>
                                    )}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          )}
                          <CommandGroup heading="Insumos">
                            {ingredientItems.map((it) => (
                              <CommandItem
                                key={it.id}
                                value={it.name}
                                onSelect={() => addItemLine(it.id)}
                              >
                                <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                                <span className="flex-1">{it.name}</span>
                                {isManager && (
                                  <span className="text-xs text-muted-foreground">
                                    {fmtBRL(Number(it.cost_price ?? 0))}/{it.unit.toUpperCase()}
                                  </span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Os campos vêm preenchidos com os valores da ficha técnica. Apague qualquer campo
                para limpar todos e digitar uma nova âncora — depois use "Recalcular proporcional"
                para ajustar os demais. Você também pode editar livremente sem aplicar proporção.
                Insumos adicionados aqui valem só para esta produção.
              </p>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Insumo</th>
                      <th className="w-20 px-2 py-2 text-center font-medium">Un.</th>
                      <th className="w-32 px-2 py-2 text-right font-medium">Qtd usada</th>
                      {isManager && (
                        <th className="w-28 px-2 py-2 text-right font-medium">Custo</th>
                      )}
                      <th className="w-10 px-1 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td
                          colSpan={isManager ? 5 : 4}
                          className="px-3 py-6 text-center text-xs text-muted-foreground"
                        >
                          Sem insumos. Use "Adicionar" para incluir.
                        </td>
                      </tr>
                    )}
                    {lines.map((l) => {
                      const item = resolveLineItem(l);
                      const sub =
                        l.kind === "sub"
                          ? data?.recipes.find((r) => r.id === l.refId)
                          : null;
                      const q = parseFloat(l.qty.replace(",", ".")) || 0;
                      const cost = qtyInBaseUnit(l, q) * Number(item?.cost_price ?? 0);
                      const missing = !item;
                      const isRef = l.key === lastEditedKey;
                      const allowToggle = l.kind === "item" && canToggleItemUnit(item);
                      const currentUnit = lineUnit(l);
                      return (
                        <tr
                          key={l.key}
                          className={cn(
                            "border-t border-border",
                            isRef && "bg-primary/5",
                          )}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              {l.kind === "sub" ? (
                                <Soup className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : null}
                              {sub?.name ?? item?.name ?? "—"}
                              {missing && (
                                <Badge variant="destructive" className="text-[10px]">
                                  sem vínculo
                                </Badge>
                              )}
                              {isRef && (
                                <Badge variant="secondary" className="text-[10px]">
                                  referência
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] uppercase text-muted-foreground">
                              {l.kind === "sub" && <span>produção interna</span>}
                              {l.baseQty > 0 && (
                                <span>
                                  ficha:{" "}
                                  {l.baseQty.toLocaleString("pt-BR", {
                                    maximumFractionDigits: 3,
                                  })}{" "}
                                  {(l.unitOverride || item?.unit || "").toLowerCase()}
                                </span>
                              )}
                              {l.baseQty === 0 && <span>extra</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center text-xs font-semibold uppercase tabular-nums">
                            {allowToggle ? (
                              <select
                                value={currentUnit === "KG" ? "KG" : "UN"}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const wKg = itemWeightKg(item);
                                  const qNow = parseFloat(l.qty.replace(",", ".")) || 0;
                                  let newQty = l.qty;
                                  if (qNow > 0 && wKg > 0 && currentUnit !== v) {
                                    if (currentUnit === "UN" && v === "KG") {
                                      newQty = (qNow * wKg).toFixed(3);
                                    } else if (currentUnit === "KG" && v === "UN") {
                                      newQty = (qNow / wKg).toFixed(3);
                                    }
                                  }
                                  setLines((prev) =>
                                    prev.map((p) =>
                                      p.key === l.key
                                        ? { ...p, unitOverride: v, qty: newQty }
                                        : p,
                                    ),
                                  );
                                }}
                                className="h-8 rounded-md border border-input bg-background px-1 text-xs uppercase"
                              >
                                <option value="UN">UN</option>
                                <option value="KG">KG</option>
                              </select>
                            ) : (
                              (currentUnit || "?").toUpperCase()
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              inputMode="decimal"
                              placeholder="0,000"
                              value={l.qty}
                              onChange={(e) => updateQty(l.key, e.target.value)}
                              onFocus={() => setLastEditedKey(l.key)}
                              className="h-11 text-right text-base tabular-nums"
                            />
                          </td>
                          {isManager && (
                            <td className="px-2 py-2 text-right tabular-nums">
                              {fmtBRL(cost)}
                            </td>
                          )}
                          <td className="px-1 py-2 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-muted-foreground hover:text-destructive"
                              onClick={() => removeLine(l.key)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {lines.length > 0 && isManager && (
                    <tfoot className="bg-muted/40 text-sm">
                      <tr>
                        <td className="px-3 py-2 text-right font-medium" colSpan={3}>
                          Total entrada · custo
                        </td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums">
                          {fmtBRL(totalCost)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          )}

          {/* Rendimento final */}
          {recipe && (
            <section className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wide text-primary">
                  Rendimento Final (Real)
                </Label>
                <div className="flex items-center gap-2">
                  {suggestedYield > 0 && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Ficha sugere:{" "}
                      <strong className="tabular-nums text-foreground">
                        {suggestedYield.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
                        {suggestedYieldUnit}
                      </strong>
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={recalcFromYield}
                    disabled={lines.length === 0 || (yieldKgNum <= 0 && yieldUnNum <= 0 && yieldNumber <= 0)}
                    title="Recalcula proporcionalmente os insumos a partir do rendimento digitado (KG ou UN)"
                  >
                    <Scale className="h-3.5 w-3.5" /> Recalcular insumos
                  </Button>
                </div>
              </div>

              {canHybridYield ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Peso Total Produzido (kg)
                    </Label>
                    <div className="flex items-end gap-1.5">
                      <Input
                        inputMode="decimal"
                        placeholder="0,000"
                        value={yieldKg}
                        onChange={(e) => handleYieldKgChange(e.target.value)}
                        className="h-12 flex-1 text-xl font-bold tabular-nums"
                      />
                      <span className="pb-3 text-sm font-semibold text-muted-foreground">KG</span>
                    </div>
                    {suggestedYieldKg > 0 && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Rendimento estimado ~
                        {suggestedYieldKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} KG
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Quantidade Produzida (un)
                    </Label>
                    <div className="flex items-end gap-1.5">
                      <Input
                        inputMode="decimal"
                        placeholder="0"
                        value={yieldUnits}
                        onChange={(e) => handleYieldUnitsChange(e.target.value)}
                        className="h-12 flex-1 text-xl font-bold tabular-nums"
                      />
                      <span className="pb-3 text-sm font-semibold text-muted-foreground">UN</span>
                    </div>
                    {suggestedYieldUn > 0 && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Rendimento Estimado (un) ~
                        <strong className="tabular-nums text-foreground">
                          {roundEstimatedUnits(suggestedYieldUn).toLocaleString("pt-BR")}
                        </strong>{" "}
                        un
                      </p>
                    )}
                    {unitsFractionInvalid && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <div className="flex-1 leading-tight">
                          A quantidade produzida deve ser um número inteiro ou meio (ex: .5).
                          Ajuste o peso total ou a quantidade.
                          <button
                            type="button"
                            className="ml-1 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                            onClick={() => {
                              const rounded = Math.round(yieldUnNum * 2) / 2;
                              setYieldUnits(
                                rounded.toLocaleString("pt-BR", {
                                  maximumFractionDigits: 1,
                                  useGrouping: false,
                                }),
                              );
                            }}
                          >
                            Arredondar para {(Math.round(yieldUnNum * 2) / 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-end gap-3">
                  <Input
                    inputMode="decimal"
                    placeholder="0,000"
                    value={yieldQty}
                    onChange={(e) => setYieldQty(e.target.value)}
                    className="h-14 flex-1 text-2xl font-bold tabular-nums"
                  />
                  <div className="pb-3 text-lg font-semibold text-muted-foreground">
                    {linkedBaseUnit}
                  </div>
                </div>
              )}

              {canHybridYield && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Digite no campo que preferir — o outro é convertido automaticamente pelo peso médio.
                  Depois clique na balança "Recalcular insumos" para escalar todas as quantidades acima.
                </p>
              )}

              <div className="mt-3 grid grid-cols-1 gap-1 sm:max-w-xs">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Validade do lote (opcional)
                </Label>
                <Input
                  type="date"
                  value={batchExpiry}
                  onChange={(e) => setBatchExpiry(e.target.value)}
                  className="h-10"
                />
                <p className="text-[10px] text-muted-foreground">
                  Usada apenas internamente para FEFO (saídas consomem o lote mais próximo do vencimento).
                </p>
              </div>

              {isManager && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <div className="rounded-lg bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Custo Total
                    </p>
                    <p className="text-sm font-bold tabular-nums">
                      {totalCost > 0 ? fmtBRL(totalCost) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Custo R$ / KG
                    </p>
                    <p className="text-sm font-bold tabular-nums">
                      {costPerKg > 0 ? fmtBRL(costPerKg) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Custo R$ / UN
                    </p>
                    <p className="text-sm font-bold tabular-nums">
                      {costPerUn > 0 ? fmtBRL(costPerUn) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-background p-2" title="Peso unitário real desta leva — gravado como 'Base' para a Auditoria de Turno">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Peso unit. real
                    </p>
                    <p className="text-sm font-bold tabular-nums">
                      {realUnitWeightKg > 0
                        ? `${Math.round(realUnitWeightKg * 1000)} g`
                        : "—"}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Destino */}
          {recipe && (
            <section className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Destino do produto pronto
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {(data?.locations ?? []).map((l) => {
                  const isDirect = ((l as { stock_mode?: string | null }).stock_mode ?? "traditional") === "direct";
                  return (
                    <Button
                      key={l.id}
                      type="button"
                      variant={locationId === l.id ? "default" : "outline"}
                      className="h-12 justify-start gap-2 text-base"
                      onClick={() => setLocationId(l.id)}
                      title={isDirect ? "Venda Direta — produto pronto entra no Estoque Central" : undefined}
                    >
                      <Package className="h-4 w-4" />
                      <span className="truncate">{l.name}</span>
                      {l.id === central?.id && (
                        <Badge variant="secondary" className="ml-auto text-[10px]">
                          Central
                        </Badge>
                      )}
                      {isDirect && l.id !== central?.id && (
                        <Badge
                          variant="outline"
                          className="ml-auto border-amber-500/40 bg-amber-500/15 text-[9px] text-amber-700 dark:text-amber-300"
                        >
                          → Central
                        </Badge>
                      )}
                    </Button>
                  );
                })}
              </div>
              {(() => {
                const sel = data?.locations.find((l) => l.id === locationId) as
                  | { stock_mode?: string | null; name?: string }
                  | undefined;
                const isDirect = (sel?.stock_mode ?? "traditional") === "direct";
                if (!isDirect) return null;
                return (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    <span className="font-semibold">Venda Direta:</span> o produto pronto será
                    armazenado no Estoque Central — esta operação consumirá direto de lá.
                  </p>
                );
              })()}
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-12">
            Cancelar
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={
              submit.isPending ||
              !recipe ||
              (!quickMode && !linkedItem) ||
              (quickMode && (!quickName.trim() || !quickProducedItemId || (quickProducedItemId === "__new__" && !quickProducedItemNewName.trim()))) ||
              yieldNumber <= 0 ||
              !allLinesFilled ||
              unitsFractionInvalid
            }
            className="h-12 flex-1 text-base sm:flex-initial"
          >
            {submit.isPending
              ? isEditMode
                ? "Atualizando…"
                : "Registrando…"
              : isEditMode
                ? "Salvar alterações"
                : "Confirmar produção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
