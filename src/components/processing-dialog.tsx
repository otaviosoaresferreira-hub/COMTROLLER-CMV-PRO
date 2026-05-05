import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { consumeStockReal } from "@/lib/fefo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Scissors,
  Plus,
  Trash2,
  Check,
  ChevronsUpDown,
  AlertTriangle,
  Package,
  Soup,
  Scale,
  ArrowLeft,
  Warehouse,
  CalendarClock,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useManagerMode } from "@/lib/manager-mode";
import { findCentralLocation } from "@/lib/stock-constants";
import { useCategoriesWithHidden, categoryPath } from "@/lib/categories";
import { useOrgId } from "@/lib/use-org-id";
import { Sparkles } from "lucide-react";

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

const fmtKg = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

type ItemRow = {
  id: string;
  name: string;
  unit: string;
  cost_price: number;
  avg_weight_g: number | null;
  is_active: boolean;
  category_id: string | null;
};
type LocationRow = { id: string; name: string; operation_type?: string | null };

type DestKind = "produced" | "scrap";
type RoutingDest = "central" | "operation" | "staff";

type DestLine = {
  key: string;
  kind: DestKind;
  itemId: string | null;
  units: string;
  weightKg: string;
  routing: RoutingDest;
  prorate?: boolean; // só aplicado em "scrap": true = rateia custo igual (CMV idêntico ao produzido)
};

interface Props {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
  triggerClassName?: string;
}

const PROCESSING_TAG = "Processamento";

const ROUTING_LABEL: Record<RoutingDest, string> = {
  central: "Estoque Central",
  operation: "Operação do Dia",
  staff: "Alimentação",
};

export function ProcessingDialog({ open: openProp, onOpenChange, hideTrigger, triggerClassName }: Props) {
  const { isManager } = useManagerMode();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };

  const qc = useQueryClient();

  // Step: 1 = inputs, 2 = routing
  const [step, setStep] = useState<1 | 2>(1);

  // Source
  const [sourceItemId, setSourceItemId] = useState<string | null>(null);
  const [sourceWeightKg, setSourceWeightKg] = useState("");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState<string>("__all__");

  // Destinations
  const [lines, setLines] = useState<DestLine[]>([
    { key: crypto.randomUUID(), kind: "produced", itemId: null, units: "", weightKg: "", routing: "central" },
  ]);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setSourceItemId(null);
      setSourceWeightKg("");
      setSourceCategoryFilter("__all__");
      setLines([{ key: crypto.randomUUID(), kind: "produced", itemId: null, units: "", weightKg: "", routing: "central" }]);
    }
  }, [open]);

  const { data: catData } = useCategoriesWithHidden();
  const visibleCats = catData?.visible ?? [];

  const { data } = useQuery({
    queryKey: ["processing-base"],
    queryFn: async () => {
      const [items, locs, stock, ops] = await Promise.all([
        supabase
          .from("items")
          .select("id,name,unit,cost_price,avg_weight_g,is_active,category_id")
          .eq("is_active", true)
          .order("name"),
        supabase.from("locations").select("id,name,operation_type"),
        supabase.from("stock_levels").select("item_id,location_id,current_stock"),
        supabase.from("operations").select("id,name,status").eq("status", "open").order("created_at", { ascending: false }).limit(1),
      ]);
      if (items.error) throw items.error;
      if (locs.error) throw locs.error;
      if (stock.error) throw stock.error;
      return {
        items: (items.data ?? []) as ItemRow[],
        locations: (locs.data ?? []) as LocationRow[],
        stock: (stock.data ?? []) as { item_id: string; location_id: string; current_stock: number }[],
        openOperation: (ops.data ?? [])[0] as { id: string; name: string } | undefined,
      };
    },
    enabled: open,
  });

  const central = useMemo(() => findCentralLocation(data?.locations ?? []), [data]);
  const itemMap = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const sourceItem = sourceItemId ? itemMap.get(sourceItemId) ?? null : null;

  const stockOf = (itemId: string) => {
    if (!central) return 0;
    const r = data?.stock.find((s) => s.item_id === itemId && s.location_id === central.id);
    return Number(r?.current_stock ?? 0);
  };

  // Computations
  const sourceWeightNum = parseFloat(sourceWeightKg.replace(",", ".")) || 0;
  const sourceUnitCost = Number(sourceItem?.cost_price ?? 0);

  const sourceCostPerKg = useMemo(() => {
    if (!sourceItem) return 0;
    const u = (sourceItem.unit ?? "").toLowerCase();
    if (u === "kg") return sourceUnitCost;
    const avgKg = Number(sourceItem.avg_weight_g ?? 0) / 1000;
    if (avgKg > 0) return sourceUnitCost / avgKg;
    return 0;
  }, [sourceItem, sourceUnitCost]);

  const sourceTotalCost = sourceWeightNum * sourceCostPerKg;

  const parsed = lines.map((l) => ({
    ...l,
    weightNum: parseFloat(l.weightKg.replace(",", ".")) || 0,
    unitsNum: parseFloat(l.units.replace(",", ".")) || 0,
  }));

  const totalDestWeight = parsed.reduce((a, b) => a + b.weightNum, 0);
  const scrapWeight = parsed.filter((l) => l.kind === "scrap").reduce((a, b) => a + b.weightNum, 0);
  const producedWeight = parsed.filter((l) => l.kind === "produced").reduce((a, b) => a + b.weightNum, 0);
  const prorateScrapWeight = parsed
    .filter((l) => l.kind === "scrap" && l.prorate)
    .reduce((a, b) => a + b.weightNum, 0);
  const absorbScrapWeight = scrapWeight - prorateScrapWeight;
  const lossKg = Math.max(0, sourceWeightNum - totalDestWeight);
  const lossPct = sourceWeightNum > 0 ? (lossKg / sourceWeightNum) * 100 : 0;
  const scrapPct = sourceWeightNum > 0 ? (scrapWeight / sourceWeightNum) * 100 : 0;
  const overflow = totalDestWeight > sourceWeightNum + 1e-6;

  // Custos:
  // - Aparas SEM rateio: mantêm valor original (peso × custo/kg origem); produzido absorve quebra
  // - Aparas COM rateio: dividem custo total junto com o produzido (mesmo R$/kg)
  const absorbScrapCost = absorbScrapWeight * sourceCostPerKg;
  const sharedPoolWeight = producedWeight + prorateScrapWeight;
  const sharedPoolCost = Math.max(0, sourceTotalCost - absorbScrapCost);
  const sharedCostPerKg = sharedPoolWeight > 0 ? sharedPoolCost / sharedPoolWeight : 0;

  const producedTotalCost = producedWeight * sharedCostPerKg;
  const producedBaseCostPerKg = sourceCostPerKg;
  const producedFinalCostPerKg = sharedCostPerKg;
  const lossImpactPerKg = Math.max(0, producedFinalCostPerKg - producedBaseCostPerKg);

  function lineCost(l: typeof parsed[number]) {
    if (l.kind === "produced") return l.weightNum * sharedCostPerKg;
    if (l.prorate) return l.weightNum * sharedCostPerKg;
    return l.weightNum * sourceCostPerKg;
  }

  function addLine(kind: DestKind) {
    setLines((p) => [
      ...p,
      { key: crypto.randomUUID(), kind, itemId: null, units: "", weightKg: "", routing: "central", prorate: false },
    ]);
  }
  function removeLine(key: string) {
    setLines((p) => (p.length > 1 ? p.filter((l) => l.key !== key) : p));
  }
  function updateLine(key: string, patch: Partial<DestLine>) {
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Validation step 1
  const canProceed = useMemo(() => {
    if (!central) return false;
    if (!sourceItem) return false;
    if (sourceWeightNum <= 0) return false;
    if (sourceWeightNum > stockOf(sourceItem.id) + 1e-6) return false;
    if (overflow) return false;
    for (const l of parsed) {
      if (l.weightNum <= 0) return false;
      if (!l.itemId) return false;
      if (l.kind === "produced") {
        const destItem = itemMap.get(l.itemId);
        const destUnit = (destItem?.unit ?? "").toLowerCase();
        // Só exige unidades se o item destino é cadastrado em "un".
        if (destUnit === "un" && l.unitsNum <= 0) return false;
      }
    }
    return true;
  }, [central, sourceItem, sourceWeightNum, parsed, overflow, data, itemMap]);

  const save = useMutation({
    mutationFn: async () => {
      if (!central || !sourceItem) throw new Error("Estoque Central não encontrado");
      const sourceUnit = (sourceItem.unit ?? "").toLowerCase();

      // Resolve destination location id
      const operationLoc = data?.openOperation
        ? data.locations.find((l) => l.id === central.id) // Operação usa central como base de estoque mas registramos via operation_id
        : null;

      // O usuário SEMPRE digita peso em KG no processamento (campo "sourceWeightNum"),
      // mesmo quando o item de origem está cadastrado em UN. Para itens em UN
      // precisamos converter via avg_weight_g; para itens em KG, é direto.
      // O helper `consumeStockReal` decide o RPC certo (FEFO em KG ou em UN
      // com peso real por lote) e devolve o consumido REAL na unidade base
      // do item — que é o valor que deve descer no stock_levels.
      const sourceItemBaseUnit = (sourceUnit === "kg" ? "kg" : "un") as "kg" | "un";
      // O input do usuário está em KG; se o item base é UN, o helper converte
      // por peso real do lote (FEFO units) para máxima fidelidade.
      const sourceInputUnit: "kg" | "un" = "kg";
      let sourceBaseQty = sourceWeightNum;
      try {
        const r = await consumeStockReal({
          itemId: sourceItem.id,
          qty: sourceWeightNum,
          inputUnit: sourceInputUnit,
          itemBaseUnit: sourceItemBaseUnit,
          avgWeightG: Number(sourceItem.avg_weight_g ?? 0),
        });
        if (r.realBaseTaken > 0) sourceBaseQty = r.realBaseTaken;
      } catch (_e) {
        // Fallback: usa estimativa global apenas se o helper falhar
        if (sourceItemBaseUnit === "un") {
          const avgKg = Number(sourceItem.avg_weight_g ?? 0) / 1000;
          if (avgKg > 0) sourceBaseQty = sourceWeightNum / avgKg;
        }
      }

      const curStock = stockOf(sourceItem.id);
      const newStock = Math.max(0, curStock - sourceBaseQty);
      const u1 = await supabase
        .from("stock_levels")
        .upsert(
          { item_id: sourceItem.id, location_id: central.id, current_stock: newStock },
          { onConflict: "item_id,location_id" },
        );
      if (u1.error) throw u1.error;

      const sourceNote = `${PROCESSING_TAG}: ${sourceItem.name} | Origem ${fmtKg(sourceWeightNum)} kg | Quebra ${fmtKg(lossKg)} kg (${lossPct.toFixed(1)}%) | Aparas ${fmtKg(scrapWeight)} kg (${scrapPct.toFixed(1)}%) | Impacto +${fmtBRL(lossImpactPerKg)}/kg`;
      const movOut = await supabase.from("movements").insert({
        item_id: sourceItem.id,
        from_location_id: central.id,
        to_location_id: null,
        quantity: sourceBaseQty,
        type: "production_out",
        unit_cost: sourceCostPerKg,
        total_cost: sourceTotalCost,
        note: sourceNote,
      }).select("id").single();
      if (movOut.error) throw movOut.error;

      for (const l of parsed) {
        const cost = lineCost(l);
        const destItem = l.itemId ? itemMap.get(l.itemId) : null;
        if (!destItem) throw new Error("Item de destino não encontrado");

        const destUnit = (destItem.unit ?? "").toLowerCase();
        const isProduced = l.kind === "produced";
        const hasUnits = isProduced && l.unitsNum > 0;
        const baseQty =
          destUnit === "kg"
            ? l.weightNum
            : hasUnits
              ? l.unitsNum
              : l.weightNum / Math.max(0.0001, Number(destItem.avg_weight_g ?? 0) / 1000 || 0.0001);

        const unitCost = baseQty > 0 ? cost / baseQty : 0;
        const avgG = hasUnits
          ? (l.weightNum / l.unitsNum) * 1000
          : Number(destItem.avg_weight_g ?? 0);

        const kindLabel = isProduced ? "Insumo Processado" : "Aparas";
        const routingLabel = ROUTING_LABEL[l.routing];

        // Alimentação: registra como waste (não entra em estoque)
        if (l.routing === "staff") {
          const note = `${PROCESSING_TAG}: ${sourceItem.name} → ${destItem.name} (${kindLabel}) | Destino: Alimentação | ${fmtKg(l.weightNum)} kg | Custo ${fmtBRL(cost)}`;
          const ins = await supabase.from("movements").insert({
            item_id: destItem.id,
            from_location_id: central.id,
            to_location_id: null,
            quantity: 0,
            type: "waste",
            unit_cost: unitCost,
            total_cost: cost,
            note,
          });
          if (ins.error) throw ins.error;
          continue;
        }

        // Estoque Central ou Operação do Dia → entrada no Central
        // (Operação do Dia: gravamos operation_id se houver operação aberta)
        // Quando destino == origem (apara que volta ao item), partir do saldo
        // já decrementado para evitar que o upsert sobrescreva a saída.
        const curDest = destItem.id === sourceItem.id ? newStock : stockOf(destItem.id);
        const newDest = curDest + baseQty;
        const u2 = await supabase
          .from("stock_levels")
          .upsert(
            { item_id: destItem.id, location_id: central.id, current_stock: newDest },
            { onConflict: "item_id,location_id" },
          );
        if (u2.error) throw u2.error;

        // Lote rastreável: PROC-YYYYMMDD-HHMM-XXXX
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        const hm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
        const lotNumber = `PROC-${ymd}-${hm}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

        const noteParts = [
          `${PROCESSING_TAG}: ${sourceItem.name} → ${destItem.name} (${kindLabel})`,
          `Lote #${lotNumber}`,
          `Destino: ${routingLabel}`,
          `${fmtKg(l.weightNum)} kg`,
        ];
        if (isProduced && l.unitsNum > 0) {
          noteParts.push(`${l.unitsNum} un`);
          noteParts.push(`Peso médio ${Math.round(avgG)} g/un`);
        }
        noteParts.push(`Custo ${fmtBRL(cost)}`);
        noteParts.push(`Custo unit. ${fmtBRL(unitCost)}`);
        if (isProduced && lossImpactPerKg > 0) {
          noteParts.push(`Impacto quebra +${fmtBRL(lossImpactPerKg)}/kg`);
        }
        if (l.kind === "scrap") {
          noteParts.push(l.prorate ? "Custo rateado" : "Quebra absorvida pelo principal");
        }

        const movInsert: {
          item_id: string;
          from_location_id: string | null;
          to_location_id: string | null;
          quantity: number;
          type: string;
          unit_cost: number;
          total_cost: number;
          note: string;
          operation_id?: string;
        } = {
          item_id: destItem.id,
          from_location_id: null,
          to_location_id: central.id,
          quantity: baseQty,
          type: "production_in",
          unit_cost: unitCost,
          total_cost: cost,
          note: noteParts.join(" | "),
        };
        if (l.routing === "operation" && data?.openOperation) {
          movInsert.operation_id = data.openOperation.id;
        }

        const movIn = await supabase.from("movements").insert(movInsert).select("id").single();
        if (movIn.error) throw movIn.error;

        try {
          await supabase.from("item_batches").insert({
            item_id: destItem.id,
            source: "production",
            lot_number: lotNumber,
            units_qty: isProduced ? l.unitsNum : 0,
            total_weight_g: l.weightNum * 1000,
            avg_weight_g: avgG > 0 ? avgG : 0,
            initial_qty: baseQty,
            current_qty: baseQty,
            unit_cost: unitCost,
            movement_id: movIn.data?.id ?? null,
            note: `Processamento de ${sourceItem.name} (${routingLabel})`,
          });
        } catch (_e) { /* ignore */ }

        const itemPatch: {
          cost_price?: number;
          avg_weight_g?: number;
          standard_weight_g?: number;
          shared_unit_enabled?: boolean;
        } = {};
        const currentCost = Number(destItem.cost_price ?? 0);
        const totalUnits = curDest + baseQty;
        const newCostAvg =
          totalUnits > 0 ? (curDest * currentCost + baseQty * unitCost) / totalUnits : unitCost;
        if (Number.isFinite(newCostAvg) && newCostAvg > 0) itemPatch.cost_price = newCostAvg;
        if (isProduced && avgG > 0) itemPatch.avg_weight_g = avgG;
        // Inferência de Unidade Compartilhada: item recém-criado (sem peso médio
        // anterior) que recebeu peso + unidades vira automaticamente "compartilhado".
        const wasNeutral = Number(destItem.avg_weight_g ?? 0) === 0;
        if (isProduced && wasNeutral && l.unitsNum > 0 && l.weightNum > 0 && avgG > 0) {
          itemPatch.standard_weight_g = avgG;
          itemPatch.shared_unit_enabled = true;
        }
        if (Object.keys(itemPatch).length > 0) {
          await supabase.from("items").update(itemPatch).eq("id", destItem.id);
        }
      }

      return operationLoc;
    },
    onSuccess: () => {
      toast.success("Processamento registrado");
      qc.invalidateQueries();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const trigger = !hideTrigger ? (
    <DialogTrigger asChild>
      <Button className={cn("gap-2", triggerClassName)}>
        <Scissors className="h-4 w-4" />
        Processar Insumo
      </Button>
    </DialogTrigger>
  ) : null;

  // Itens de origem: kg ou com peso médio. Aplicar filtro por categoria.
  const sourceItems = (data?.items ?? []).filter((i) => {
    const u = (i.unit ?? "").toLowerCase();
    if (u !== "kg" && !(Number(i.avg_weight_g ?? 0) > 0)) return false;
    if (sourceCategoryFilter !== "__all__") {
      // aceita pai ou filha
      if (sourceCategoryFilter === "__none__") {
        if (i.category_id) return false;
      } else {
        const cat = visibleCats.find((c) => c.id === i.category_id);
        if (!cat) return false;
        if (cat.id !== sourceCategoryFilter && cat.parent_id !== sourceCategoryFilter) return false;
      }
    }
    return true;
  });

  // Aparas podem voltar para o próprio item de origem (ajuste de retorno).
  const allDestItems = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" />
            {step === 1 ? "Processamento de Insumo" : "Definição de Destinos"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Converta uma peça bruta em insumo processado e aparas."
              : "Escolha para onde cada item gerado será enviado."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            {/* SOURCE */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Package className="h-4 w-4" /> Origem (peça bruta)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Item</Label>
                  <Popover open={sourcePickerOpen} onOpenChange={setSourcePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                        <span className="truncate">{sourceItem?.name ?? "Selecionar item…"}</span>
                        <ChevronsUpDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[420px] p-0" align="start">
                      <div className="border-b p-2">
                        <Select value={sourceCategoryFilter} onValueChange={setSourceCategoryFilter}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Filtrar por categoria" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">Todas as categorias</SelectItem>
                            <SelectItem value="__none__">Sem categoria</SelectItem>
                            {visibleCats
                              .filter((c) => !c.parent_id)
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Command>
                        <CommandInput placeholder="Buscar item por nome…" />
                        <CommandList>
                          <CommandEmpty>Nenhum item</CommandEmpty>
                          <CommandGroup>
                            {sourceItems.map((it) => {
                              const stock = stockOf(it.id);
                              const cPath = categoryPath(it.category_id, visibleCats);
                              return (
                                <CommandItem
                                  key={it.id}
                                  value={`${it.name} ${cPath}`}
                                  onSelect={() => {
                                    setSourceItemId(it.id);
                                    setSourcePickerOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", sourceItemId === it.id ? "opacity-100" : "opacity-0")} />
                                  <div className="flex-1 min-w-0">
                                    <p className="truncate text-sm">{it.name}</p>
                                    {cPath && <p className="text-[10px] text-muted-foreground truncate">{cPath}</p>}
                                  </div>
                                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                                    {stock.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {it.unit}
                                  </span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label className="text-xs">Peso retirado (kg)</Label>
                  <Input
                    inputMode="decimal"
                    value={sourceWeightKg}
                    onChange={(e) => setSourceWeightKg(e.target.value)}
                    placeholder="0,000"
                  />
                </div>
              </div>
              {sourceItem && (
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline">Estoque: {stockOf(sourceItem.id).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {sourceItem.unit}</Badge>
                  {isManager && sourceCostPerKg > 0 && (
                    <Badge variant="outline">{fmtBRL(sourceCostPerKg)}/kg</Badge>
                  )}
                  {isManager && sourceTotalCost > 0 && (
                    <Badge variant="outline">Custo origem: {fmtBRL(sourceTotalCost)}</Badge>
                  )}
                  <Badge variant="outline" className="gap-1"><Scale className="h-3 w-3" /> FEFO ativo</Badge>
                </div>
              )}
              {sourceItem && sourceWeightNum > stockOf(sourceItem.id) + 1e-6 && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Peso maior que o estoque disponível.
                </div>
              )}
            </div>

            {/* DESTINATIONS */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Itens gerados</Label>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => addLine("produced")} className="gap-1 h-8">
                    <Plus className="h-3 w-3" /> Insumo Processado
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addLine("scrap")} className="gap-1 h-8">
                    <Plus className="h-3 w-3" /> Aparas
                  </Button>
                </div>
              </div>

              {lines.map((l) => {
                const p = parsed.find((x) => x.key === l.key)!;
                const cost = lineCost(p);
                const Icon = l.kind === "produced" ? Soup : Package;
                const kindLabel = l.kind === "produced" ? "Insumo Processado" : "Aparas";

                return (
                  <div key={l.key} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <Icon className="h-4 w-4 text-primary" />
                        {kindLabel}
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => removeLine(l.key)} className="h-7 w-7">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div>
                      <Label className="text-[11px]">Item de destino</Label>
                      <DestItemPicker
                        items={allDestItems}
                        categories={visibleCats}
                        value={l.itemId}
                        sourceItemId={sourceItemId}
                        onChange={(v) => updateLine(l.key, { itemId: v })}
                        onCreated={async (newId) => {
                          await qc.refetchQueries({ queryKey: ["processing-base"] });
                          updateLine(l.key, { itemId: newId });
                        }}
                      />
                      {l.kind === "scrap" && l.itemId && l.itemId === sourceItemId && (
                        <p className="mt-1 text-[10px] text-amber-700">
                          Aparas retornam ao item de origem como ajuste de entrada (custo preservado).
                        </p>
                      )}
                    </div>

                    {l.kind === "scrap" && (
                      <TooltipProvider delayDuration={200}>
                        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/40 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium">
                            Ratear custo da quebra
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="text-muted-foreground hover:text-foreground">
                                  <Info className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-[11px] leading-snug">
                                Ativado: custo médio igual entre Insumo e Aparas. Desativado: o produto principal absorve a quebra.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={!!l.prorate}
                            onCheckedChange={(v) => updateLine(l.key, { prorate: v })}
                          />
                        </div>
                      </TooltipProvider>
                    )}

                    <div className={cn("grid gap-2", l.kind === "produced" ? "grid-cols-2" : "grid-cols-1")}>
                      {l.kind === "produced" && (
                        <div>
                          <Label className="text-[11px]">
                            Quantidade (un) <span className="text-muted-foreground">— opcional</span>
                          </Label>
                          <Input inputMode="decimal" value={l.units} onChange={(e) => updateLine(l.key, { units: e.target.value })} placeholder="0" />
                        </div>
                      )}
                      <div>
                        <Label className="text-[11px]">Peso total (kg)</Label>
                        <Input inputMode="decimal" value={l.weightKg} onChange={(e) => updateLine(l.key, { weightKg: e.target.value })} placeholder="0,000" />
                      </div>
                    </div>

                    {(p.weightNum > 0) && (
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {l.kind === "produced" && p.unitsNum > 0 && (
                          <Badge variant="secondary">
                            Peso médio: {Math.round((p.weightNum / p.unitsNum) * 1000)} g/un
                          </Badge>
                        )}
                        {isManager && cost > 0 && (
                          <>
                            <Badge variant="secondary">
                              Custo: {fmtBRL(cost)}
                            </Badge>
                            {p.weightNum > 0 && (
                              <Badge variant="secondary" className="border-primary/30 bg-primary/5 text-primary">
                                {fmtBRL(cost / p.weightNum)}/kg
                              </Badge>
                            )}
                            {l.kind === "produced" && p.unitsNum > 0 && (
                              <Badge variant="secondary" className="border-primary/30 bg-primary/5 text-primary">
                                {fmtBRL(cost / p.unitsNum)}/un
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* SUMMARY */}
            {sourceWeightNum > 0 && (
              <div className="rounded-lg border-2 border-dashed p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Scale className="h-4 w-4" /> Resumo
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Origem</p>
                    <p className="text-sm font-bold tabular-nums">{fmtKg(sourceWeightNum)} kg</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Aparas</p>
                    <p className="text-sm font-bold tabular-nums text-blue-600">
                      {fmtKg(scrapWeight)} kg ({scrapPct.toFixed(1)}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Quebra</p>
                    <p className={cn("text-sm font-bold tabular-nums", lossPct > 10 ? "text-amber-600" : "")}>
                      {fmtKg(lossKg)} kg ({lossPct.toFixed(1)}%)
                    </p>
                  </div>
                  {isManager && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Impacto/kg</p>
                      <p className="text-sm font-bold tabular-nums text-amber-700">+{fmtBRL(lossImpactPerKg)}</p>
                    </div>
                  )}
                </div>
                {isManager && producedWeight > 0 && (
                  <div className="rounded-md bg-primary/5 border border-primary/20 p-2 grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Custo final / kg</p>
                      <p className="text-sm font-bold tabular-nums text-primary">{fmtBRL(producedFinalCostPerKg)}</p>
                    </div>
                    {(() => {
                      const totalUnits = parsed
                        .filter((l) => l.kind === "produced")
                        .reduce((a, b) => a + b.unitsNum, 0);
                      if (totalUnits <= 0) return (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Custo final / un</p>
                          <p className="text-sm font-bold tabular-nums text-muted-foreground">—</p>
                        </div>
                      );
                      return (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Custo final / un</p>
                          <p className="text-sm font-bold tabular-nums text-primary">{fmtBRL(producedTotalCost / totalUnits)}</p>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {overflow && (
                  <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    <AlertTriangle className="h-4 w-4" /> Soma dos destinos ultrapassa o peso da origem.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              Selecione o destino de cada item gerado. <span className="font-medium text-foreground">Alimentação</span> registra como consumo interno (não entra no estoque).
            </div>
            {parsed.map((l) => {
              const dest = l.itemId ? itemMap.get(l.itemId) : null;
              const Icon = l.kind === "produced" ? Soup : Package;
              const cost = lineCost(l);
              return (
                <div key={l.key} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{dest?.name ?? "—"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {l.kind === "produced" ? "Insumo Processado" : "Aparas"} · {fmtKg(l.weightNum)} kg
                          {l.kind === "produced" && l.unitsNum > 0 && ` · ${l.unitsNum} un`}
                        </p>
                      </div>
                    </div>
                    {isManager && cost > 0 && (
                      <Badge variant="secondary" className="tabular-nums">{fmtBRL(cost)}</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["central", "operation", "staff"] as RoutingDest[]).map((r) => {
                      const RIcon = r === "central" ? Warehouse : r === "operation" ? CalendarClock : UtensilsCrossed;
                      const disabled = r === "operation" && !data?.openOperation;
                      return (
                        <button
                          key={r}
                          type="button"
                          disabled={disabled}
                          onClick={() => updateLine(l.key, { routing: r })}
                          className={cn(
                            "flex flex-col items-center justify-center gap-1 rounded-md border p-2 text-[11px] transition",
                            l.routing === r
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "border-border hover:bg-muted",
                            disabled && "opacity-40 cursor-not-allowed",
                          )}
                          title={disabled ? "Nenhuma operação aberta" : undefined}
                        >
                          <RIcon className="h-4 w-4" />
                          {ROUTING_LABEL[r]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => setStep(2)} disabled={!canProceed}>
                Avançar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1">
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Processando…" : "Finalizar Processamento"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DestItemPickerProps = {
  items: ItemRow[];
  categories: { id: string; name: string; parent_id: string | null }[];
  value: string | null;
  sourceItemId: string | null;
  onChange: (v: string) => void;
  onCreated?: (newId: string) => void | Promise<void>;
};

function DestItemPicker({ items, categories, value, sourceItemId, onChange, onCreated }: DestItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string>("__all__");
  const [createOpen, setCreateOpen] = useState(false);
  const selected = items.find((i) => i.id === value);

  const filtered = items.filter((i) => {
    if (cat === "__all__") return true;
    if (cat === "__none__") return !i.category_id;
    const c = categories.find((x) => x.id === i.category_id);
    if (!c) return false;
    return c.id === cat || c.parent_id === cat;
  });

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9">
          <span className="truncate">
            {selected ? `${selected.name} (${selected.unit})` : "Escolher item…"}
            {selected && selected.id === sourceItemId && " — origem"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <div className="border-b p-2">
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filtrar por categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as categorias</SelectItem>
              <SelectItem value="__none__">Sem categoria</SelectItem>
              {categories.filter((c) => !c.parent_id).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Command
          filter={(v, s) => {
            const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            return norm(v).includes(norm(s)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar item por nome…" />
          <CommandList>
            <CommandEmpty>Nenhum item</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__create_new__"
                onSelect={() => { setOpen(false); setCreateOpen(true); }}
                className="border-b"
              >
                <Sparkles className="mr-2 h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-primary">+ Criar Novo Item</p>
                  <p className="text-[10px] text-muted-foreground">
                    Cadastro rápido — herda custo e unidade do processamento
                  </p>
                </div>
              </CommandItem>
              {filtered.map((it) => (
                <CommandItem
                  key={it.id}
                  value={`${it.name} ${it.unit}`}
                  onSelect={() => { onChange(it.id); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === it.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{it.name}</p>
                    <p className="text-[10px] text-muted-foreground">{it.unit}{it.id === sourceItemId ? " · item de origem" : ""}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <QuickCreateItemDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      categories={categories}
      onCreated={async (id) => {
        await onCreated?.(id);
        onChange(id);
        setCreateOpen(false);
      }}
    />
    </>
  );
}

type QuickCreateItemDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: { id: string; name: string; parent_id: string | null }[];
  onCreated: (id: string) => void | Promise<void>;
};

function QuickCreateItemDialog({ open, onOpenChange, categories, onCreated }: QuickCreateItemDialogProps) {
  const orgId = useOrgId();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setName("");
      // Default: "Produções Internas" se existir
      const internal = categories.find((c) => c.name.trim().toLowerCase() === "produções internas");
      setCategoryId(internal?.id ?? "");
    }
  }, [open, categories]);

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe o nome do item");
      if (!categoryId) throw new Error("Escolha uma categoria");
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");

      // Cria item "neutro" em KG: assim o processamento permite avançar
      // apenas com Peso Total. Se o usuário também informar Quantidade (un),
      // o save converte automaticamente para Unidade Compartilhada (define
      // standard_weight_g e shared_unit_enabled).
      const { data, error } = await supabase
        .from("items")
        .insert({
          org_id: orgId,
          name: trimmed,
          unit: "kg",
          category_id: categoryId,
          cost_price: 0,
          sale_price: 0,
          min_stock: 0,
          avg_weight_g: 0,
          standard_weight_g: 0,
          shared_unit_enabled: false,
          is_active: true,
          is_subproduct: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (id) => {
      toast.success("Item criado — atributos serão herdados do processamento");
      await onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visibleCats = categories.filter(
    (c) => !c.parent_id && c.name.trim().toLowerCase() !== "sistema",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Novo item rápido
          </DialogTitle>
          <DialogDescription>
            Apenas nome e categoria. Custo, peso e unidade serão herdados do processamento atual.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Picanha em cubos"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && categoryId && !create.isPending) {
                  create.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Categoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {visibleCats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !name.trim() || !categoryId}
          >
            {create.isPending ? "Criando…" : "Criar e usar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}