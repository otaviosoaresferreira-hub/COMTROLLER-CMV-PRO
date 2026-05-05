import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CalcInput } from "@/components/calc-input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { findCentralLocation } from "@/lib/stock-constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RotateCcw,
  ChevronDown,
  Package,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inventario/$locationId")({
  component: InventarioLocation,
});

type Step = "counting" | "review" | "done";
type CountUnit = "KG" | "UN";

type StockItem = {
  id: string;
  name: string;
  unit: string;
  category_id: string | null;
  shared_unit_enabled: boolean;
  standard_weight_g: number;
  avg_weight_g: number;
};

type CountEntry = {
  value: string;
  unit: CountUnit;
};

const fmt = (n: number, d = 3) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: d });

// Formatação inteligente para UN: até 1 casa decimal, oculta ".0" quando inteiro.
// Ex: 1.0 → "1", 0.5 → "0,5", -1.0 → "-1", 50.5 → "50,5"
const fmtUn = (n: number) => {
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
};

// Converte string da entrada (com vírgula PT-BR) em número.
const parseEntry = (s: string | undefined): number => {
  if (!s) return 0;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function InventarioLocation() {
  const { locationId } = Route.useParams();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("counting");
  const [openCategoryId, setOpenCategoryId] = useState<string>("");
  const [entries, setEntries] = useState<Record<string, CountEntry>>({});
  // Reconciliação de embalagens divergentes — peso novo informado pelo usuário (kg/un)
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileWeights, setReconcileWeights] = useState<Record<string, string>>({});

  // Modo de configuração de itens do inventário (engrenagem).
  // Quando ativo, mostra checkboxes para o usuário escolher quais itens
  // entram nesta contagem. A seleção é persistida em localStorage por local.
  const [configMode, setConfigMode] = useState(false);
  const selectionStorageKey = `inv-selection:${locationId}`;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(`inv-selection:${locationId}`);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });
  // Indica se o usuário já fez uma seleção antes (controla "todos por padrão").
  const [hasSelection, setHasSelection] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !!window.localStorage.getItem(`inv-selection:${locationId}`);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasSelection) return;
    window.localStorage.setItem(
      selectionStorageKey,
      JSON.stringify(Array.from(selectedIds)),
    );
  }, [selectedIds, hasSelection, selectionStorageKey]);


  const { data: location } = useQuery({
    queryKey: ["inventario-location", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,operation_type")
        .eq("id", locationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["inventario-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ["inventario-all-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select(
          "id,name,unit,category_id,shared_unit_enabled,standard_weight_g,avg_weight_g",
        )
        .eq("is_active", true)
        .eq("is_free", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as StockItem[];
    },
  });

  // Localização Estoque Central — usada para transferência automática quando
  // a contagem na Operação for MAIOR que o esperado (sobra real veio do Central).
  const { data: centralLocation } = useQuery({
    queryKey: ["inventario-central-location"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name");
      if (error) throw error;
      return findCentralLocation(data ?? []) ?? null;
    },
  });

  // Lotes ativos por item — usados para detectar embalagens divergentes.
  const { data: batchesByItem = {} } = useQuery({
    queryKey: ["inventario-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_batches")
        .select("item_id,units_qty,avg_weight_g");
      if (error) throw error;
      const map: Record<string, Array<{ units: number; avgG: number }>> = {};
      for (const b of data ?? []) {
        const units = Number(b.units_qty ?? 0);
        const avgG = Number(b.avg_weight_g ?? 0);
        if (units > 0 && avgG > 0) {
          (map[b.item_id] ??= []).push({ units, avgG });
        }
      }
      return map;
    },
  });

  // Detecta itens com embalagens divergentes (mesma regra do Estoque Central):
  // só vale para shared_unit_enabled, ref = standard_weight_g (ou avg) > 0,
  // e (spread entre lotes ≥ 5%) ou (algum lote desvia ≥ 5% do ref).
  function isItemDivergent(item: StockItem): boolean {
    if (!item.shared_unit_enabled) return false;
    const ref = item.standard_weight_g > 0 ? item.standard_weight_g : item.avg_weight_g;
    if (ref <= 0) return false;
    const lots = batchesByItem[item.id] ?? [];
    if (lots.length === 0) return false;
    const minG = Math.min(...lots.map((l) => l.avgG));
    const maxG = Math.max(...lots.map((l) => l.avgG));
    const spread = minG > 0 ? Math.abs(maxG - minG) / minG : 0;
    const refDeviation = lots.some((l) => Math.abs(l.avgG - ref) / ref >= 0.05);
    return spread >= 0.05 || refDeviation;
  }

  const itemsByCategory = useMemo(() => {
    const map: Record<string, StockItem[]> = {};
    for (const it of allItems) {
      const key = it.category_id ?? "_none";
      (map[key] ??= []).push(it);
    }
    return map;
  }, [allItems]);

  // Detecta se este local é o Estoque Central (sem seleção de itens — sempre carrega tudo).
  const isCentralLocation = useMemo(() => {
    const n = (location?.name ?? "").trim().toLowerCase();
    return n === "estoque central";
  }, [location?.name]);

  // Garantia adicional: no Estoque Central nunca exibimos modo de configuração.
  useEffect(() => {
    if (isCentralLocation && configMode) setConfigMode(false);
  }, [isCentralLocation, configMode]);

  // Conjunto de IDs efetivamente "ligados" para esta contagem.
  // Central: SEMPRE todos os itens ativos (sem opção de seleção).
  // Operações: padrão (sem seleção salva) = TODOS; senão respeita a seleção salva.
  const activeSelection = useMemo<Set<string>>(() => {
    if (isCentralLocation) return new Set(allItems.map((i) => i.id));
    if (!hasSelection) return new Set(allItems.map((i) => i.id));
    return selectedIds;
  }, [isCentralLocation, hasSelection, selectedIds, allItems]);

  // Itens visíveis no fluxo de contagem (após filtro de seleção).
  const visibleItemsByCategory = useMemo(() => {
    const map: Record<string, StockItem[]> = {};
    for (const [cat, items] of Object.entries(itemsByCategory)) {
      const filtered = items.filter((i) => activeSelection.has(i.id));
      if (filtered.length > 0) map[cat] = filtered;
    }
    return map;
  }, [itemsByCategory, activeSelection]);

  const countedItemsCount = Object.entries(entries).filter(
    ([id, e]) => e.value.trim() !== "" && activeSelection.has(id),
  ).length;

  // Fetch system stock only at review (blind counting)
  const { data: systemStock = {}, isLoading: isLoadingSystem } = useQuery({
    queryKey: ["inventario-system-stock", locationId],
    enabled: step === "review",
    queryFn: async () => {
      const ids = Object.keys(entries).filter(
        (k) => entries[k].value.trim() !== "",
      );
      if (ids.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("stock_levels")
        .select("item_id,current_stock")
        .eq("location_id", locationId)
        .in("item_id", ids);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        map[r.item_id] = Number(r.current_stock) || 0;
      }
      return map;
    },
  });

  // Converte o saldo bruto do sistema (em KG soberano para shared, ou unidade nativa)
  // para a unidade exibida ao usuário (a mesma que ele digitou).
  function systemInDisplayUnit(
    item: StockItem,
    rawSystem: number,
    displayUnit: CountUnit,
  ): number {
    const weightKg = (item.avg_weight_g || item.standard_weight_g || 0) / 1000;
    const isShared = item.shared_unit_enabled && weightKg > 0;
    if (!isShared) return rawSystem;
    // rawSystem está em KG; se usuário digitou em UN, convertemos para UN
    return displayUnit === "UN" ? rawSystem / weightKg : rawSystem;
  }

  // Retorna o peso por unidade (g) efetivo para um item: se o usuário
  // reconciliou a divergência, usa o novo peso; senão usa avg/standard.
  function effectiveWeightG(item: StockItem): number {
    const reconciledKg = Number(reconcileWeights[item.id]);
    if (Number.isFinite(reconciledKg) && reconciledKg > 0) return reconciledKg * 1000;
    return item.avg_weight_g || item.standard_weight_g || 0;
  }

  // Converte a contagem digitada para KG (soberano) para gravar no banco.
  // Regra: Novo Peso Total = Quantidade Contada × Peso Médio (efetivo).
  function countedToSovereignKg(
    item: StockItem,
    entry: CountEntry | undefined,
  ): number {
    if (!entry || entry.value.trim() === "") return 0;
    const n = parseEntry(entry.value);
    if (!Number.isFinite(n) || n < 0) return 0;
    const weightKg = effectiveWeightG(item) / 1000;
    const isShared = item.shared_unit_enabled && weightKg > 0;
    if (!isShared) return n;
    return entry.unit === "UN" ? n * weightKg : n;
  }

  // Items to consider in review = those with any non-empty entry,
  // restritos à seleção ativa do inventário (itens não selecionados são ignorados).
  const countedItems = useMemo(
    () =>
      allItems.filter(
        (i) =>
          activeSelection.has(i.id) &&
          entries[i.id] &&
          entries[i.id].value.trim() !== "",
      ),
    [allItems, entries, activeSelection],
  );

  // Itens contados que precisam reconciliação: divergentes (histórico) E contados em UN.
  const itemsNeedingReconcile = useMemo(
    () => countedItems.filter((i) => isItemDivergent(i) && entries[i.id]?.unit === "UN"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countedItems, entries, batchesByItem],
  );

  const divergences = useMemo(() => {
    return countedItems
      .map((item) => {
        const entry = entries[item.id];
        const weightKg = effectiveWeightG(item) / 1000;
        const isShared = item.shared_unit_enabled && weightKg > 0;

        // Unidade que o usuário usou na contagem (define a unidade da revisão).
        const displayUnit: CountUnit = isShared
          ? entry.unit
          : item.unit.toUpperCase() === "KG"
            ? "KG"
            : "UN";

        const rawSystem = systemStock[item.id] ?? 0;
        // Comparação SEMPRE na mesma unidade que o usuário digitou.
        const systemDisplay = systemInDisplayUnit(item, rawSystem, displayUnit);
        const countedDisplay = parseEntry(entry.value) || 0;
        // Matemática seca: contado − esperado, sem arredondamento.
        const delta = countedDisplay - systemDisplay;

        // Saldo soberano em KG (para gravar no banco).
        const countedSovereignKg = countedToSovereignKg(item, entry);

        // Tolerância: se UN inteiras → 0.5 un; se KG → 1g.
        const tol = displayUnit === "UN" ? 0.05 : 0.001;
        const significant = Math.abs(delta) > tol;

        return {
          item,
          entry,
          displayUnit,
          systemDisplay,
          countedDisplay,
          countedSovereignKg,
          delta,
          isShared,
          weightKg,
          significant,
        };
      })
      .filter((d) => d.significant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countedItems, entries, systemStock, reconcileWeights]);

  const closeMutation = useMutation({
    mutationFn: async () => {
      // 1) Para itens reconciliados (embalagens divergentes contadas em UN com
      // novo peso informado), persistimos o novo peso no item ANTES dos ajustes.
      // Isso "bate o martelo" sobre o padrão atual e zera o aviso de divergência
      // em todos os módulos (Estoque Central, Fichas, Controller).
      const reconciledItemIds = new Set<string>();
      for (const item of itemsNeedingReconcile) {
        const newKg = Number(reconcileWeights[item.id]);
        if (!Number.isFinite(newKg) || newKg <= 0) continue;
        const newAvgG = newKg * 1000;
        const { error: eUp } = await supabase
          .from("items")
          .update({ avg_weight_g: newAvgG, standard_weight_g: newAvgG })
          .eq("id", item.id);
        if (eUp) throw eUp;
        reconciledItemIds.add(item.id);
      }

      // 2) Para itens reconciliados sem divergência de saldo, ainda assim
      // precisamos limpar lotes antigos e gravar um único lote no novo peso,
      // garantindo o reset do alerta de "Embalagem Divergente".
      const divergenceItemIds = new Set(divergences.map((d) => d.item.id));
      for (const item of itemsNeedingReconcile) {
        if (divergenceItemIds.has(item.id)) continue; // será tratado abaixo
        if (!reconciledItemIds.has(item.id)) continue;
        const entry = entries[item.id];
        const newAvgG = Number(reconcileWeights[item.id]) * 1000;
        const countedDisplay = parseEntry(entry.value) || 0;
        const totalKg = (countedDisplay * newAvgG) / 1000;
        const { error: eDel } = await supabase
          .from("item_batches")
          .delete()
          .eq("item_id", item.id);
        if (eDel) throw eDel;
        if (totalKg > 0) {
          const { error: eIns } = await supabase.from("item_batches").insert({
            item_id: item.id,
            source: "adjustment",
            units_qty: countedDisplay,
            total_weight_g: totalKg * 1000,
            avg_weight_g: newAvgG,
            note: "Reconciliação de embalagem (Inventário)",
          });
          if (eIns) throw eIns;
        }
        // Atualiza saldo soberano (KG) com base no novo peso.
        const { error: eLvl } = await supabase.from("stock_levels").upsert(
          {
            item_id: item.id,
            location_id: locationId,
            current_stock: totalKg,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
        if (eLvl) throw eLvl;
      }

      if (divergences.length === 0) {
        return { adjusted: 0, reconciled: reconciledItemIds.size, transferred: 0 };
      }

      // Pré-carrega saldos do Estoque Central para os itens com sobra (delta > 0).
      // Multi-tenant: o RLS já garante que só vemos a Central da nossa organização.
      const positiveItemIds = divergences
        .filter((d) => d.delta > 0)
        .map((d) => d.item.id);
      const centralStockById: Record<string, number> = {};
      if (centralLocation && positiveItemIds.length > 0) {
        const { data: cs, error: eCs } = await supabase
          .from("stock_levels")
          .select("item_id,current_stock")
          .eq("location_id", centralLocation.id)
          .in("item_id", positiveItemIds);
        if (eCs) throw eCs;
        for (const row of cs ?? []) {
          centralStockById[row.item_id] = Number(row.current_stock) || 0;
        }
      }

      let transferredCount = 0;

      for (const d of divergences) {
        const { item, countedSovereignKg, countedDisplay, displayUnit, delta, isShared, weightKg } = d;
        const wasReconciled = reconciledItemIds.has(item.id);

        const { error: e1 } = await supabase.from("stock_levels").upsert(
          {
            item_id: item.id,
            location_id: locationId,
            current_stock: countedSovereignKg,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
        if (e1) throw e1;

        if (isShared) {
          const { error: eDel } = await supabase
            .from("item_batches")
            .delete()
            .eq("item_id", item.id);
          if (eDel) throw eDel;
          if (countedSovereignKg > 0) {
            const avgWeightG = wasReconciled
              ? Number(reconcileWeights[item.id]) * 1000
              : (item.avg_weight_g || item.standard_weight_g || 0);
            const unitsQty =
              displayUnit === "UN"
                ? countedDisplay
                : weightKg > 0
                  ? countedSovereignKg / weightKg
                  : 0;
            const totalWeightG = countedSovereignKg * 1000;
            const { error: eIns } = await supabase.from("item_batches").insert({
              item_id: item.id,
              source: "adjustment",
              units_qty: unitsQty,
              total_weight_g: totalWeightG,
              avg_weight_g: avgWeightG,
              note: wasReconciled
                ? "Reconciliação de embalagem (Inventário)"
                : "Ajuste de Inventário",
            });
            if (eIns) throw eIns;
          }
        }

        // Decide o tipo de movimentação:
        // - delta < 0 (faltou): adjustment de "Diferença/Extravio".
        // - delta > 0 (sobrou) e Central tem saldo: transferência Central → Operação
        //   (saldo veio de lá e não foi registrado).
        // - delta > 0 sem Central com saldo suficiente: fallback "Sobra de Inventário".
        if (delta > 0 && centralLocation) {
          // delta está na unidade exibida; precisamos da quantidade soberana (KG p/ shared)
          // para debitar o Central corretamente.
          const sovereignDeltaKg = isShared && weightKg > 0
            ? (displayUnit === "UN" ? delta * weightKg : delta)
            : delta;
          const centralStock = centralStockById[item.id] ?? 0;
          if (centralStock >= sovereignDeltaKg && sovereignDeltaKg > 0) {
            // Debita Central
            const { error: eCentral } = await supabase
              .from("stock_levels")
              .upsert(
                {
                  item_id: item.id,
                  location_id: centralLocation.id,
                  current_stock: centralStock - sovereignDeltaKg,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "item_id,location_id" },
              );
            if (eCentral) throw eCentral;
            // Registra transferência
            const { error: eMov } = await supabase.from("movements").insert({
              item_id: item.id,
              from_location_id: centralLocation.id,
              to_location_id: locationId,
              quantity: Math.abs(delta),
              type: "transfer",
              note: `Transferência automática (Inventário) (${displayUnit})`,
            });
            if (eMov) throw eMov;
            transferredCount += 1;
            continue;
          }
        }

        const note =
          delta < 0
            ? "Diferença de Inventário/Extravio"
            : "Sobra de Inventário";
        const { error: e2 } = await supabase.from("movements").insert({
          item_id: item.id,
          from_location_id: delta < 0 ? locationId : null,
          to_location_id: delta > 0 ? locationId : null,
          quantity: Math.abs(delta),
          type: "adjustment",
          note: `${note} (${displayUnit})`,
        });
        if (e2) throw e2;
      }
      return {
        adjusted: divergences.length - transferredCount,
        reconciled: reconciledItemIds.size,
        transferred: transferredCount,
      };
    },
    onSuccess: ({ adjusted, reconciled, transferred }) => {
      const parts: string[] = [];
      parts.push(
        adjusted === 0 && transferred === 0
          ? "Inventário fechado sem divergências."
          : `Inventário fechado. ${adjusted} item(ns) ajustado(s).`,
      );
      if (transferred > 0) {
        parts.push(`${transferred} item(ns) transferido(s) do Estoque Central.`);
      }
      if (reconciled > 0) {
        parts.push(`${reconciled} embalagem(ns) reconciliada(s).`);
      }
      toast.success(parts.join(" "));
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
      qc.invalidateQueries({ queryKey: ["inventario-system-stock"] });
      qc.invalidateQueries({ queryKey: ["inventario-batches"] });
      qc.invalidateQueries({ queryKey: ["inventario-reports"] });
      setStep("done");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        to="/inventario"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight capitalize">
              {location?.name ?? "Local"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isCentralLocation
                ? "Inventário do Estoque Central · contagem cega"
                : "Inventário por Operação · contagem cega"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step === "counting" && !isCentralLocation && (
            <Button
              variant={configMode ? "default" : "outline"}
              size="sm"
              onClick={() => setConfigMode((v) => !v)}
              aria-pressed={configMode}
            >
              <Settings className="mr-2 h-4 w-4" />
              {configMode ? "Concluir seleção" : "Configurar itens"}
            </Button>
          )}
          <Badge variant="outline">
            {step === "counting" && `Contagem · ${countedItemsCount} item(ns)`}
            {step === "review" && "Revisão"}
            {step === "done" && "Concluído"}
          </Badge>
        </div>
      </header>

      {step === "counting" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {configMode
              ? "Marque as categorias e itens que entram nesta contagem. Itens não marcados não aparecerão para digitação e seu saldo no banco permanecerá intacto."
              : "Toque numa categoria para abrir e digitar a contagem. Você não verá o saldo do sistema até a revisão."}
          </p>

          {categories.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                Nenhuma categoria cadastrada.
              </CardContent>
            </Card>
          ) : (
            categories.map((c) => {
              const allCatItems = itemsByCategory[c.id] ?? [];
              const items = configMode
                ? allCatItems
                : allCatItems.filter((i) => activeSelection.has(i.id));
              // Em modo de contagem, oculta categorias sem itens selecionados.
              if (!configMode && items.length === 0) return null;
              const isOpen = openCategoryId === c.id;
              const filledInCat = items.filter(
                (i) => entries[i.id] && entries[i.id].value.trim() !== "",
              ).length;
              const selectedInCat = allCatItems.filter((i) =>
                activeSelection.has(i.id),
              ).length;
              const allSelected =
                allCatItems.length > 0 && selectedInCat === allCatItems.length;
              const someSelected = selectedInCat > 0 && !allSelected;
              const toggleCategory = (checked: boolean) => {
                setHasSelection(true);
                setSelectedIds((cur) => {
                  const next = new Set(cur);
                  // Se ainda não havia seleção salva, parte de "todos selecionados"
                  // para preservar o estado atual ao desmarcar uma categoria.
                  if (!hasSelection) {
                    for (const it of allItems) next.add(it.id);
                  }
                  for (const it of allCatItems) {
                    if (checked) next.add(it.id);
                    else next.delete(it.id);
                  }
                  return next;
                });
              };
              return (
                <div
                  key={c.id}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                >
                  <div
                    className={cn(
                      "flex items-center gap-2 transition-colors",
                      isOpen ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    {configMode && (
                      <label className="flex shrink-0 items-center pl-4">
                        <Checkbox
                          checked={
                            allSelected
                              ? true
                              : someSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(v) => toggleCategory(v === true)}
                          aria-label={`Selecionar categoria ${c.name}`}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenCategoryId(isOpen ? "" : c.id)}
                      className="flex flex-1 items-center justify-between gap-3 px-4 py-4 text-left"
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                          <Package className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold capitalize">
                            {c.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {configMode
                              ? `${selectedInCat}/${allCatItems.length} selecionado(s)`
                              : `${items.length} item(ns)${filledInCat > 0 ? ` · ${filledInCat} contado(s)` : ""}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!configMode && filledInCat > 0 && (
                          <Badge variant="secondary">{filledInCat}</Badge>
                        )}
                        <ChevronDown
                          className={cn(
                            "h-5 w-5 text-muted-foreground transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </div>
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border">
                      {items.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-muted-foreground">
                          Nenhum item ativo nesta categoria.
                        </p>
                      ) : (
                        <div className="divide-y divide-border">
                          {items.map((item) => {
                            const weightKg =
                              (item.standard_weight_g ||
                                item.avg_weight_g ||
                                0) / 1000;
                            const isShared =
                              item.shared_unit_enabled && weightKg > 0;
                            const entry: CountEntry = entries[item.id] ?? {
                              value: "",
                              unit: isShared
                                ? "KG"
                                : item.unit.toUpperCase() === "KG"
                                  ? "KG"
                                  : "UN",
                            };
                            const itemSelected = activeSelection.has(item.id);
                            return (
                              <div
                                key={item.id}
                                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
                              >
                                {configMode && (
                                  <Checkbox
                                    className="shrink-0"
                                    checked={itemSelected}
                                    onCheckedChange={(v) => {
                                      const checked = v === true;
                                      setHasSelection(true);
                                      setSelectedIds((cur) => {
                                        const next = new Set(cur);
                                        if (!hasSelection) {
                                          for (const it of allItems) next.add(it.id);
                                        }
                                        if (checked) next.add(item.id);
                                        else next.delete(item.id);
                                        return next;
                                      });
                                    }}
                                    aria-label={`Selecionar ${item.name}`}
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium capitalize leading-tight">
                                    {item.name}
                                  </p>
                                  <p className="text-xs uppercase text-muted-foreground">
                                    {isShared
                                      ? "Unidade compartilhada"
                                      : item.unit}
                                  </p>
                                  {isItemDivergent(item) && (
                                    <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                      <AlertTriangle className="h-3 w-3" />
                                      Embalagem divergente
                                    </span>
                                  )}
                                </div>
                                {!configMode && (
                                <div className="flex items-center gap-2">
                                  {isShared && (
                                    <div className="inline-flex overflow-hidden rounded-md border border-border">
                                      {(["KG", "UN"] as CountUnit[]).map(
                                        (u) => (
                                          <button
                                            key={u}
                                            type="button"
                                            onClick={() =>
                                              setEntries((cur) => ({
                                                ...cur,
                                                [item.id]: {
                                                  ...entry,
                                                  unit: u,
                                                },
                                              }))
                                            }
                                            className={cn(
                                              "px-2.5 py-2 text-xs font-medium transition-colors",
                                              entry.unit === u
                                                ? "bg-primary text-primary-foreground"
                                                : "bg-background text-muted-foreground hover:bg-accent",
                                            )}
                                            aria-pressed={entry.unit === u}
                                          >
                                            {u}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  )}
                                  <CalcInput
                                    min="0"
                                    placeholder="0"
                                    className="h-11 w-32 text-base"
                                    decimals={entry.unit === "UN" ? 1 : 3}
                                    value={entry.value}
                                    onValueChange={(raw) => {
                                      let v = raw;
                                      // Limita UN a 1 casa decimal quando for número puro
                                      if (entry.unit === "UN" && v && !/[+\-*/()]/.test(v)) {
                                        const n = Number(v.replace(",", "."));
                                        if (Number.isFinite(n)) {
                                          const rounded = Math.round(n * 10) / 10;
                                          if (!/[.,]$/.test(v) && rounded !== n) {
                                            v = String(rounded).replace(".", ",");
                                          }
                                        }
                                      }
                                      setEntries((cur) => ({
                                        ...cur,
                                        [item.id]: {
                                          unit: entry.unit,
                                          value: v,
                                        },
                                      }));
                                    }}
                                    aria-label={`Quantidade contada de ${item.name}`}
                                  />
                                </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          <div className="sticky bottom-2 z-10 mt-4 flex flex-col-reverse gap-2 rounded-xl border border-border bg-background/90 p-3 backdrop-blur sm:flex-row sm:justify-between sm:items-center">
            <p className="text-xs text-muted-foreground">
              {configMode
                ? `${activeSelection.size} item(ns) selecionado(s) para esta contagem.`
                : countedItemsCount === 0
                  ? "Nenhum item contado ainda."
                  : `${countedItemsCount} item(ns) com contagem digitada.`}
            </p>
            {configMode ? (
              <Button size="lg" onClick={() => setConfigMode(false)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Concluir seleção
              </Button>
            ) : (
              <Button
                size="lg"
                disabled={countedItemsCount === 0}
                onClick={() => {
                  if (itemsNeedingReconcile.length > 0) {
                    setReconcileWeights((cur) => {
                      const next = { ...cur };
                      for (const it of itemsNeedingReconcile) {
                        if (next[it.id] === undefined) {
                          const g = it.avg_weight_g || it.standard_weight_g || 0;
                          next[it.id] = g > 0 ? String(g / 1000) : "";
                        }
                      }
                      return next;
                    });
                    setReconcileOpen(true);
                    return;
                  }
                  setStep("review");
                }}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Revisar Contagem
              </Button>
            )}
          </div>
        </div>
      )}

      {step === "review" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revisão de divergências</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingSystem ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Comparando com o
                sistema...
              </div>
            ) : divergences.length === 0 ? (
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
                Nenhuma divergência. A contagem bate com o sistema. ✅
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="hidden grid-cols-[1fr_5rem_8rem_5rem] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground sm:grid">
                  <span>Item</span>
                  <span className="text-right">Sistema</span>
                  <span className="text-right">Contado</span>
                  <span className="text-right">Diferença</span>
                </div>
                <div className="divide-y divide-border">
                  {divergences.map((d) => {
                    const unitLabel = d.displayUnit;
                    const isLoss = d.delta < 0;
                    const isUn = d.displayUnit === "UN";
                    const formatVal = (n: number) =>
                      isUn ? fmtUn(n) : fmt(n, 3);
                    return (
                      <div
                        key={d.item.id}
                        className={cn(
                          "grid grid-cols-2 items-center gap-2 px-3 py-3 text-sm sm:grid-cols-[1fr_5rem_8rem_5rem]",
                          isLoss
                            ? "bg-destructive/5"
                            : "bg-emerald-500/5",
                        )}
                      >
                        <div className="col-span-2 sm:col-span-1">
                          <p className="font-medium capitalize leading-tight">
                            {d.item.name}
                          </p>
                          <p className="text-xs uppercase text-muted-foreground">
                            {unitLabel}
                          </p>
                        </div>
                        <div className="text-right text-xs sm:text-sm">
                          <span className="text-muted-foreground sm:hidden">
                            Sistema:{" "}
                          </span>
                          <span className="tabular-nums">
                            {formatVal(d.systemDisplay)} {unitLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          {d.isShared && (
                            <div className="inline-flex overflow-hidden rounded-md border border-border">
                              {(["KG", "UN"] as CountUnit[]).map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() =>
                                    setEntries((cur) => ({
                                      ...cur,
                                      [d.item.id]: {
                                        ...d.entry,
                                        unit: u,
                                      },
                                    }))
                                  }
                                  className={cn(
                                    "px-1.5 py-1 text-[10px] font-medium transition-colors",
                                    d.entry.unit === u
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-background text-muted-foreground hover:bg-accent",
                                  )}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>
                          )}
                          <CalcInput
                            min="0"
                            decimals={isUn ? 1 : 3}
                            className="h-9 w-24 text-right text-sm"
                            value={d.entry.value}
                            onValueChange={(raw) => {
                              let v = raw;
                              if (isUn && v && !/[+\-*/()]/.test(v)) {
                                const n = Number(v.replace(",", "."));
                                if (Number.isFinite(n)) {
                                  const rounded = Math.round(n * 10) / 10;
                                  if (!/[.,]$/.test(v) && rounded !== n) {
                                    v = String(rounded).replace(".", ",");
                                  }
                                }
                              }
                              setEntries((cur) => ({
                                ...cur,
                                [d.item.id]: {
                                  unit: d.entry.unit,
                                  value: v,
                                },
                              }));
                            }}
                            aria-label={`Corrigir contagem de ${d.item.name}`}
                          />
                        </div>
                        <div
                          className={cn(
                            "text-right text-sm font-semibold tabular-nums",
                            isLoss
                              ? "text-destructive"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          <span className="text-muted-foreground sm:hidden font-normal">
                            Δ:{" "}
                          </span>
                          {d.delta > 0 ? "+" : ""}
                          {formatVal(d.delta)} {unitLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setStep("counting")}
                disabled={closeMutation.isPending}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Voltar à Contagem
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={closeMutation.isPending}>
                    {closeMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Finalizar Inventário
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Confirmar finalização?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {divergences.length === 0
                        ? "Nenhuma divergência será registrada."
                        : `${divergences.length} item(ns) terão saldo ajustado e serão registrados como perda/sobra no histórico. Esta ação não pode ser desfeita.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => closeMutation.mutate()}
                    >
                      Sim, finalizar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inventário concluído</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Os ajustes foram registrados no histórico como{" "}
              <strong>Diferença de Inventário/Extravio</strong> (faltas) ou{" "}
              <strong>Sobra de Inventário</strong> (sobras).
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setEntries({});
                  setOpenCategoryId("");
                  setReconcileWeights({});
                  setStep("counting");
                }}
              >
                Nova contagem
              </Button>
              <Button asChild>
                <Link to="/inventario">Voltar ao Inventário</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliação de embalagens divergentes */}
      <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Conciliação de Embalagem
            </DialogTitle>
            <DialogDescription>
              {itemsNeedingReconcile.length === 1
                ? "Este item possui embalagens de pesos diferentes no histórico. Para as unidades contadas agora, qual o peso de cada embalagem?"
                : "Estes itens possuem embalagens de pesos diferentes no histórico. Para cada um, informe o peso atual de cada embalagem (kg/un)."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto py-2">
            {itemsNeedingReconcile.map((item) => {
              const refG = item.standard_weight_g || item.avg_weight_g || 0;
              const counted = parseEntry(entries[item.id]?.value) || 0;
              const newKg = Number(reconcileWeights[item.id]);
              const validNew = Number.isFinite(newKg) && newKg > 0;
              const projectedKg = validNew ? counted * newKg : 0;
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <p className="font-medium capitalize leading-tight">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Padrão atual: {refG > 0 ? `${(refG / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg/un` : "—"}
                    {" · "}Contagem: {counted.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} un
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">
                      Peso por embalagem (kg)
                    </label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.001"
                      placeholder="ex.: 1,2"
                      className="h-9 w-28 text-right"
                      value={reconcileWeights[item.id] ?? ""}
                      onChange={(e) =>
                        setReconcileWeights((cur) => ({
                          ...cur,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                  {validNew && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Estoque resultante:{" "}
                      <strong className="text-foreground">
                        {projectedKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg
                      </strong>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReconcileOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const allValid = itemsNeedingReconcile.every((it) => {
                  const n = Number(reconcileWeights[it.id]);
                  return Number.isFinite(n) && n > 0;
                });
                if (!allValid) {
                  toast.error("Informe um peso válido (kg) para cada item.");
                  return;
                }
                setReconcileOpen(false);
                setStep("review");
              }}
            >
              Confirmar e Revisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
