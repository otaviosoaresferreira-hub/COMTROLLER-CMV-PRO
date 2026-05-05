import { useEffect, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { consumeStockReal } from "@/lib/fefo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Check, ChevronsUpDown, Plus, Trash2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CENTRAL_LOCATION_NAME } from "@/lib/stock-constants";

type Item = {
  id: string;
  name: string;
  unit: string;
  cost_price?: number;
  shared_unit_enabled?: boolean;
  avg_weight_g?: number;
  standard_weight_g?: number;
};
type Location = { id: string; name: string; stock_mode?: string | null };
type StockLevel = { item_id: string; location_id: string; current_stock: number };
type LocationItemFactor = {
  location_id: string;
  item_id: string;
  factor: number;
  note: string | null;
};

interface Props {
  items: Item[];
  locations: Location[];
  stockLevels: StockLevel[];
  /** Quando true, não renderiza o botão; controle via `open`/`onOpenChange`. */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  /** Pré-seleciona um item ao abrir. */
  defaultItemId?: string;
  /** Pré-seleciona um destino (ex.: praça atual quando aberto de dentro de uma praça). */
  defaultDestinationId?: string;
  /** Pré-seleciona uma origem específica. */
  defaultOriginId?: string;
}

/** Formata quantidade respeitando a unidade: UN inteira, demais com 3 casas. */
function formatQtyByUnit(value: number, unit: string): string {
  const u = (unit || "").toUpperCase();
  if (u === "UN") {
    return Math.floor(Number(value) || 0).toLocaleString("pt-BR");
  }
  return (Number(value) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

type ListEntry = {
  itemId: string;
  name: string;
  unit: string;
  /** Quantidade na unidade BASE do item (sempre persistida assim). */
  quantity: number;
  available: number;
  /** Modo de exibição/edição escolhido pelo usuário (KG ou UN). */
  displayMode: "KG" | "UN";
  /** Peso por unidade (g) usado para conversão; 0 se não aplicável. */
  portionG: number;
};

/** Converte entre KG e UN usando o peso da porção (g). */
function convertUnit(
  value: number,
  from: "KG" | "UN",
  to: "KG" | "UN",
  portionG: number,
): number {
  if (from === to) return value;
  if (!portionG || portionG <= 0) return value;
  if (from === "KG" && to === "UN") return value / (portionG / 1000);
  return value * (portionG / 1000);
}

export function TransferDialog({
  items,
  locations,
  stockLevels,
  hideTrigger,
  open: openProp,
  onOpenChange,
  defaultItemId,
  defaultDestinationId,
  defaultOriginId,
}: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (openProp === undefined) setOpenInternal(v);
  };
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");


  // Linha de adição
  const [pickerOpen, setPickerOpen] = useState(false);
  const [itemId, setItemId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [quantityMode, setQuantityMode] = useState<"KG" | "UN">("KG");

  const [list, setList] = useState<ListEntry[]>([]);
  const qc = useQueryClient();

  // Última produção (kg/un real) por item — fonte autoritativa para conversão
  const { data: lastUnitWeightG } = useQuery({
    queryKey: ["transfer-last-unit-weight"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movements")
        .select("item_id,note,created_at,type")
        .eq("type", "production_in")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const map = new Map<string, number>();
      (data ?? []).forEach((m) => {
        if (map.has(m.item_id)) return;
        const note = String(m.note || "");
        let g = 0;
        const mPerUn = note.match(/Peso\s+unit[áa]rio\s+([\d.,]+)\s*(g|kg)\s*\/\s*un/i);
        if (mPerUn) {
          const v = Number(mPerUn[1].replace(/\./g, "").replace(",", "."));
          g = mPerUn[2].toLowerCase() === "kg" ? v * 1000 : v;
        }
        if (!g) {
          const mPerUn2 = note.match(/([\d.,]+)\s*(kg|g)\s*\/\s*un/i);
          if (mPerUn2) {
            const v = Number(mPerUn2[1].replace(/\./g, "").replace(",", "."));
            g = mPerUn2[2].toLowerCase() === "kg" ? v * 1000 : v;
          }
        }
        if (g > 0) map.set(m.item_id, g);
      });
      return map;
    },
  });

  /** Fator de conversão UN<->KG por item.
   * Fonte ÚNICA: items.avg_weight_g (peso médio ponderado, recalculado a cada
   * produção/NF). Fallbacks só para itens antigos sem média registrada. */
  const getPortionG = (it: Item | undefined | null): number => {
    if (!it) return 0;
    const avg = Number(it.avg_weight_g || 0);
    if (avg > 0) return avg;
    const real = Number(lastUnitWeightG?.get(it.id) || 0);
    if (real > 0) return real;
    return Number(it.standard_weight_g || 0);
  };

  const central = useMemo(
    () =>
      locations.find(
        (l) => l.name.trim().toLowerCase() === CENTRAL_LOCATION_NAME.toLowerCase(),
      ),
    [locations],
  );

  // Carrega todos os fatores de correção ativos (poucos registros — query global)
  const { data: factorsData } = useQuery({
    queryKey: ["location-factors-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_item_factors")
        .select("location_id,item_id,factor,note");
      if (error) throw error;
      return (data ?? []) as LocationItemFactor[];
    },
  });

  const getFactor = (itemId: string, destLocationId: string) => {
    if (!central || destLocationId === central.id) return null;
    if (!factorsData) return null;
    const found = factorsData.find(
      (f) => f.item_id === itemId && f.location_id === destLocationId,
    );
    if (!found) return null;
    const f = Number(found.factor);
    if (!isFinite(f) || f <= 0) return null;
    return { factor: f, note: found.note };
  };

  // Só aplica fator quando saindo do Central para uma praça
  const factorsApply = !!central && fromId === central.id && toId !== central.id;

  useEffect(() => {
    if (open) {
      // Inteligência de contexto: se o usuário abriu de dentro de uma praça,
      // o destino vem pré-preenchido como a praça atual e a origem como Central.
      // Caso contrário (Central), padrão = Central → primeira praça.
      const defaultTo =
        defaultDestinationId ||
        locations.find((l) => l.id !== (central?.id ?? locations[0]?.id))?.id ||
        "";
      const defaultFrom =
        defaultOriginId ||
        (defaultDestinationId && central && defaultDestinationId !== central.id
          ? central.id
          : central?.id ?? locations[0]?.id ?? "");
      setFromId(defaultFrom);
      setToId(defaultTo);

      setItemId(defaultItemId ?? "");
      setQuantity("");
      setQuantityMode("KG");
      setList([]);
    }
  }, [open, locations, central, defaultItemId, defaultDestinationId, defaultOriginId]);

  const selectedItem = items.find((i) => i.id === itemId);
  const selectedPortionG = getPortionG(selectedItem);
  const selectedItemUnit: "KG" | "UN" =
    (selectedItem?.unit || "un").toUpperCase() === "KG" ? "KG" : "UN";
  // Quando há peso por unidade conhecido, o valor armazenado em current_stock
  // é tratado como KG (canônico) para fins de exibição/conversão. O Toggle
  // apenas muda a forma de visualizar: KG = valor cru; UN = valor cru / porção.
  const allowToggle = !!selectedItem && selectedPortionG > 0;
  const selectedBaseUnit: "KG" | "UN" = allowToggle ? "KG" : selectedItemUnit;

  // Sincroniza o modo padrão ao trocar de item (sempre KG quando há toggle).
  useEffect(() => {
    if (selectedItem) setQuantityMode(selectedBaseUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // Ao alternar o toggle: recalcula o valor digitado entre KG/UN.
  const switchQuantityMode = (mode: "KG" | "UN") => {
    if (mode === quantityMode) return;
    const num = Number((quantity || "0").replace(",", "."));
    if (Number.isFinite(num) && num > 0 && selectedPortionG > 0) {
      const conv = convertUnit(num, quantityMode, mode, selectedPortionG);
      setQuantity(String(Number(conv.toFixed(3))));
    }
    setQuantityMode(mode);
  };

  const availableQty = useMemo(() => {
    if (!itemId || !fromId) return 0;
    const base = Number(
      stockLevels.find((s) => s.item_id === itemId && s.location_id === fromId)?.current_stock ?? 0,
    );
    // Subtrai o que já está reservado na lista para o mesmo item (em base)
    const reserved = list
      .filter((l) => l.itemId === itemId)
      .reduce((sum, l) => sum + l.quantity, 0);
    return base - reserved;
  }, [itemId, fromId, stockLevels, list]);

  // Disponível convertido para o modo de exibição atual.
  const availableQtyDisplay = useMemo(
    () =>
      allowToggle
        ? convertUnit(availableQty, selectedBaseUnit, quantityMode, selectedPortionG)
        : availableQty,
    [allowToggle, availableQty, selectedBaseUnit, quantityMode, selectedPortionG],
  );

  const handleAdd = () => {
    const qtyDisplay = Number((quantity || "0").replace(",", "."));
    if (!fromId || !toId) {
      toast.error("Selecione origem e destino");
      return;
    }
    if (fromId === toId) {
      toast.error("Origem e destino devem ser diferentes");
      return;
    }
    if (!itemId) {
      toast.error("Selecione um item");
      return;
    }
    if (!qtyDisplay || qtyDisplay <= 0) {
      toast.error("Quantidade inválida");
      return;
    }
    if (!selectedItem) return;
    // Converte para a unidade BASE do item antes de armazenar.
    const qtyBase = allowToggle
      ? convertUnit(qtyDisplay, quantityMode, selectedBaseUnit, selectedPortionG)
      : qtyDisplay;
    if (qtyBase > availableQty + 1e-9) {
      const dispUnit = allowToggle ? quantityMode : (selectedItem.unit || "un").toUpperCase();
      toast.error(
        `Saldo insuficiente na origem (disponível: ${formatQtyByUnit(availableQtyDisplay, dispUnit)} ${dispUnit})`,
      );
      return;
    }

    const baseAvailable = Number(
      stockLevels.find((s) => s.item_id === itemId && s.location_id === fromId)?.current_stock ?? 0,
    );

    setList((prev) => [
      ...prev,
      {
        itemId,
        name: selectedItem.name,
        unit: selectedItem.unit,
        quantity: qtyBase,
        available: baseAvailable,
        displayMode: allowToggle ? quantityMode : selectedBaseUnit,
        portionG: selectedPortionG,
      },
    ]);
    setItemId("");
    setQuantity("");
  };

  const handleRemove = (idx: number) => {
    setList((prev) => prev.filter((_, i) => i !== idx));
  };

  /** Recebe valor na displayMode da linha; converte para BASE antes de salvar. */
  const handleUpdateQty = (idx: number, value: string) => {
    const num = Number((value || "0").replace(",", "."));
    setList((prev) =>
      prev.map((entry, i) => {
        if (i !== idx) return entry;
        // Base canônica = KG quando há peso por porção (mesma regra do header).
        const itemUnit: "KG" | "UN" = (entry.unit || "un").toUpperCase() === "KG" ? "KG" : "UN";
        const base: "KG" | "UN" = entry.portionG > 0 ? "KG" : itemUnit;
        const qtyBase =
          entry.portionG > 0 && entry.displayMode !== base
            ? convertUnit(num, entry.displayMode, base, entry.portionG)
            : num;
        return { ...entry, quantity: qtyBase };
      }),
    );
  };

  /** Alterna a displayMode de uma linha já adicionada. quantity (base) não muda. */
  const switchListMode = (idx: number, mode: "KG" | "UN") => {
    setList((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, displayMode: mode } : entry)),
    );
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!fromId || !toId) throw new Error("Selecione origem e destino");
      if (fromId === toId) throw new Error("Origem e destino devem ser diferentes");

      if (list.length === 0) throw new Error("Adicione ao menos um item à lista");

      // Consolida quantidades por item
      const consolidated = new Map<string, number>();
      for (const entry of list) {
        if (!entry.quantity || entry.quantity <= 0) {
          throw new Error(`Quantidade inválida para ${entry.name}`);
        }
        consolidated.set(
          entry.itemId,
          (consolidated.get(entry.itemId) ?? 0) + entry.quantity,
        );
      }

      // Valida saldo disponível na origem para cada item consolidado
      for (const [iid, total] of consolidated) {
        const available = Number(
          stockLevels.find(
            (s) => s.item_id === iid && s.location_id === fromId,
          )?.current_stock ?? 0,
        );
        if (total > available + 1e-9) {
          const it = items.find((i) => i.id === iid);
          const u = (it?.unit ?? "un").toUpperCase();
          throw new Error(
            `Saldo insuficiente para ${it?.name ?? "item"} (disponível: ${formatQtyByUnit(available, u)} ${u})`,
          );
        }
      }

      const fromName =
        locations.find((l) => l.id === fromId)?.name ?? "Origem";
      const toName = locations.find((l) => l.id === toId)?.name ?? "Destino";
      const transferNote = `Remanejamento Interno: ${fromName} → ${toName}`;

      // Aplica cada item
      for (const [iid, total] of consolidated) {
        const item = items.find((i) => i.id === iid);
        const baseCost = Number(item?.cost_price ?? 0);

        const factorInfo = factorsApply ? getFactor(iid, toId) : null;
        const factor = factorInfo?.factor ?? 1;
        // Custo unitário recalculado: o valor monetário não muda, mas a qtd diminui
        const adjustedUnitCost = factor > 0 ? baseCost / factor : baseCost;

        const fromLevel = stockLevels.find(
          (s) => s.item_id === iid && s.location_id === fromId,
        );
        const toLevel = stockLevels.find(
          (s) => s.item_id === iid && s.location_id === toId,
        );

        // FEFO com peso real por lote: devolve quanto realmente foi
        // consumido na unidade base do item (kg quando item está em kg).
        // Usado para baixar stock_levels com o valor REAL — mantendo
        // integridade entre stock_levels e item_batches.
        const baseUnit = ((item?.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un") as
          | "kg"
          | "un";
        let realTaken = total;
        try {
          const r = await consumeStockReal({
            itemId: iid,
            qty: total,
            inputUnit: baseUnit,
            itemBaseUnit: baseUnit,
            avgWeightG: Number(item?.avg_weight_g ?? 0),
          });
          if (r.realBaseTaken > 0) realTaken = r.realBaseTaken;
        } catch (_e) { /* não bloqueia transferência se rastreio de lote falhar */ }

        const newFromQty = Number(fromLevel?.current_stock ?? 0) - realTaken;
        // Destino recebe a mesma proporção (aplica fator de rendimento sobre o real)
        const expectedReceiveQty = realTaken * factor;
        const newToQty = Number(toLevel?.current_stock ?? 0) + expectedReceiveQty;

        const { error: e1 } = await supabase
          .from("stock_levels")
          .upsert(
            {
              item_id: iid,
              location_id: fromId,
              current_stock: newFromQty,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "item_id,location_id" },
          );
        if (e1) throw e1;

        const { error: e2 } = await supabase
          .from("stock_levels")
          .upsert(
            {
              item_id: iid,
              location_id: toId,
              current_stock: newToQty,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "item_id,location_id" },
          );
        if (e2) throw e2;

        // Movimento de SAÍDA do origem (qty REAL consumida, custo original)
        const { error: e3 } = await supabase.from("movements").insert({
          item_id: iid,
          from_location_id: fromId,
          to_location_id: toId,
          quantity: realTaken,
          type: "transfer",
          unit_cost: baseCost,
          total_cost: baseCost * realTaken,
          note: transferNote,
        });
        if (e3) throw e3;

        // Movimento de ENTRADA no destino (qty real ajustada pelo fator)
        const { error: e4 } = await supabase.from("movements").insert({
          item_id: iid,
          from_location_id: fromId,
          to_location_id: toId,
          quantity: expectedReceiveQty,
          type: "transfer",
          unit_cost: adjustedUnitCost,
          total_cost: adjustedUnitCost * expectedReceiveQty,
          // só grava o fator quando ele realmente foi aplicado (≠ 1 e veio do cadastro)
          correction_factor: factorInfo ? factor : null,
          note: transferNote,
        });
        if (e4) throw e4;
      }
    },
    onSuccess: () => {
      toast.success("Remanejamento finalizado");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
      qc.invalidateQueries({ queryKey: ["local"] });
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      {!hideTrigger && (
        <Button
          onClick={() => setOpen(true)}
          size="lg"
          variant="secondary"
          className="h-14 flex-1 gap-2 text-base shadow-sm"
        >
          <ArrowLeftRight className="h-5 w-5" />
          Transferir
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Remanejamento Interno</DialogTitle>
            <DialogDescription>
              Movimente itens entre quaisquer locais (Central, Operações). Selecione origem e destino, monte a lista e processe tudo de uma vez.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Origem / Destino */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div className="space-y-2">
                <Label>Local de Origem</Label>
                <Select
                  value={fromId}
                  onValueChange={(v) => {
                    setFromId(v);
                    // Limpa item escolhido se ele não tiver saldo no novo local
                    if (itemId) {
                      const avail = Number(
                        stockLevels.find(
                          (s) => s.item_id === itemId && s.location_id === v,
                        )?.current_stock ?? 0,
                      );
                      if (avail <= 0) setItemId("");
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id} disabled={l.id === toId}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="pb-2 text-muted-foreground">
                <ArrowLeftRight className="h-4 w-4" />
              </div>
              <div className="space-y-2">
                <Label>Local de Destino</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => {
                      const isDirect = (l.stock_mode ?? "traditional") === "direct";
                      return (
                        <SelectItem
                          key={l.id}
                          value={l.id}
                          disabled={l.id === fromId || isDirect}
                        >
                          {l.name}
                          {isDirect && " — Venda Direta (sem transferência)"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Operações em <span className="font-medium">Venda Direta</span> consomem
                  direto do Estoque Central — não recebem transferências.
                </p>
              </div>
            </div>
            {fromId && toId && fromId === toId && (
              <p className="text-xs text-destructive">
                Origem e destino devem ser diferentes.
              </p>
            )}

            {/* Adicionar item */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="grid grid-cols-[1fr_140px_auto] gap-2 items-end">
                <div className="space-y-2 min-w-0">
                  <Label>Item</Label>
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">
                          {selectedItem ? selectedItem.name : "Buscar item…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Digite o nome…" />
                        <CommandList>
                          <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
                          <CommandGroup>
                            {items
                              .map((i) => {
                                const avail = Number(
                                  stockLevels.find(
                                    (s) =>
                                      s.item_id === i.id &&
                                      s.location_id === fromId,
                                  )?.current_stock ?? 0,
                                );
                                return { item: i, avail };
                              })
                              .filter(({ avail }) => avail > 0)
                              .sort((a, b) => a.item.name.localeCompare(b.item.name))
                              .map(({ item: i, avail }) => (
                                <CommandItem
                                  key={i.id}
                                  value={i.name}
                                  onSelect={() => {
                                    setItemId(i.id);
                                    setPickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      itemId === i.id ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  <span className="flex-1 truncate">{i.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                                    {formatQtyByUnit(avail, i.unit)}{" "}
                                    {(i.unit || "un").toUpperCase()}
                                  </span>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedItem && (
                    <p className="text-xs text-muted-foreground">
                      Disponível:{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {formatQtyByUnit(
                          availableQtyDisplay,
                          allowToggle ? quantityMode : (selectedItem.unit || "un"),
                        )}{" "}
                        {allowToggle ? quantityMode : (selectedItem.unit || "un").toUpperCase()}
                      </span>
                      {allowToggle && selectedPortionG > 0 && (
                        <span className="ml-1 text-[10px] text-muted-foreground/80">
                          · base {Math.round(selectedPortionG)}g/un
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Quantidade</Label>
                    {allowToggle && (
                      <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
                        <button
                          type="button"
                          onClick={() => switchQuantityMode("KG")}
                          className={cn(
                            "px-1.5 py-0.5 transition-colors",
                            quantityMode === "KG"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          KG
                        </button>
                        <button
                          type="button"
                          onClick={() => switchQuantityMode("UN")}
                          className={cn(
                            "border-l border-border px-1.5 py-0.5 transition-colors",
                            quantityMode === "UN"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          UN
                        </button>
                      </div>
                    )}
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAdd();
                      }
                    }}
                  />
                  {(() => {
                    if (!factorsApply || !itemId || !quantity) return null;
                    const info = getFactor(itemId, toId);
                    const qty = Number(quantity);
                    if (!info || !qty) return null;
                    // 'expected' usa a base do item (em kg/un nativos), portanto convertemos a partir do display.
                    const qtyBase = allowToggle
                      ? convertUnit(qty, quantityMode, selectedBaseUnit, selectedPortionG)
                      : qty;
                    const expectedBase = qtyBase * info.factor;
                    const expectedDisplay = allowToggle
                      ? convertUnit(expectedBase, selectedBaseUnit, quantityMode, selectedPortionG)
                      : expectedBase;
                    return (
                      <p className="flex items-start gap-1 text-[11px] leading-tight text-primary">
                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          Esperado na praça:{" "}
                          <span className="font-semibold tabular-nums">
                            {formatQtyByUnit(
                              expectedDisplay,
                              allowToggle ? quantityMode : (selectedItem?.unit || "un"),
                            )}{" "}
                            {allowToggle ? quantityMode : (selectedItem?.unit || "un").toUpperCase()}
                          </span>{" "}
                          (fator {info.factor.toLocaleString("pt-BR", {
                            maximumFractionDigits: 3,
                          })})
                        </span>
                      </p>
                    );
                  })()}
                </div>
                <Button
                  type="button"
                  onClick={handleAdd}
                  className="gap-1"
                  disabled={!itemId || !quantity}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </div>

            {/* Lista temporária */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/40">
                <h3 className="text-sm font-semibold">Itens da transferência</h3>
                <span className="text-xs text-muted-foreground">
                  {list.length} {list.length === 1 ? "item" : "itens"}
                </span>
              </div>
              {list.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhum item adicionado ainda.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-3">Item</TableHead>
                      <TableHead className="text-right w-32">Qtd.</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((entry, idx) => {
                      const itemUnit: "KG" | "UN" =
                        (entry.unit || "un").toUpperCase() === "KG" ? "KG" : "UN";
                      // Base canônica = KG quando há peso por porção.
                      const baseUnit: "KG" | "UN" = entry.portionG > 0 ? "KG" : itemUnit;
                      const overflow = entry.quantity > entry.available;
                      const allowRowToggle = entry.portionG > 0;
                      const displayQty =
                        allowRowToggle && entry.displayMode !== baseUnit
                          ? convertUnit(entry.quantity, baseUnit, entry.displayMode, entry.portionG)
                          : entry.quantity;
                      return (
                        <TableRow key={idx}>
                          <TableCell className="pl-3 font-medium">
                            {entry.name}
                            <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                              {entry.displayMode}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {allowRowToggle && (
                                <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
                                  <button
                                    type="button"
                                    onClick={() => switchListMode(idx, "KG")}
                                    className={cn(
                                      "px-1 py-0.5 transition-colors",
                                      entry.displayMode === "KG"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-muted",
                                    )}
                                  >
                                    KG
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => switchListMode(idx, "UN")}
                                    className={cn(
                                      "border-l border-border px-1 py-0.5 transition-colors",
                                      entry.displayMode === "UN"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-muted",
                                    )}
                                  >
                                    UN
                                  </button>
                                </div>
                              )}
                              <Input
                                type="number"
                                inputMode="decimal"
                                step={entry.displayMode === "UN" ? "1" : "0.001"}
                                value={
                                  entry.displayMode === "UN"
                                    ? Math.floor(displayQty)
                                    : Number(displayQty.toFixed(3))
                                }
                                onChange={(e) => handleUpdateQty(idx, e.target.value)}
                                className={cn(
                                  "h-8 w-20 text-right tabular-nums",
                                  overflow && "border-destructive text-destructive",
                                )}
                              />
                            </div>
                            {(() => {
                              if (!factorsApply) return null;
                              const info = getFactor(entry.itemId, toId);
                              if (!info) return null;
                              const expectedBase = entry.quantity * info.factor;
                              const expectedDisplay =
                                allowRowToggle && entry.displayMode !== baseUnit
                                  ? convertUnit(
                                      expectedBase,
                                      baseUnit,
                                      entry.displayMode,
                                      entry.portionG,
                                    )
                                  : expectedBase;
                              return (
                                <p className="mt-1 text-[10px] leading-tight text-primary tabular-nums">
                                  → {formatQtyByUnit(expectedDisplay, entry.displayMode)}{" "}
                                  {entry.displayMode} na praça (×{info.factor.toLocaleString("pt-BR", {
                                    maximumFractionDigits: 3,
                                  })})
                                </p>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemove(idx)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {(() => {
              const consolidated = new Map<string, number>();
              for (const e of list)
                consolidated.set(
                  e.itemId,
                  (consolidated.get(e.itemId) ?? 0) + e.quantity,
                );
              const overflowItems: string[] = [];
              for (const [iid, total] of consolidated) {
                const avail = Number(
                  stockLevels.find(
                    (s) => s.item_id === iid && s.location_id === fromId,
                  )?.current_stock ?? 0,
                );
                if (total > avail + 1e-9) {
                  const it = items.find((i) => i.id === iid);
                  overflowItems.push(it?.name ?? "item");
                }
              }
              const sameLoc = !!fromId && fromId === toId;
              const blocked = overflowItems.length > 0 || sameLoc;
              return (
                <>
                  {overflowItems.length > 0 && (
                    <p className="w-full text-center text-xs text-destructive">
                      Saldo insuficiente: {overflowItems.join(", ")}
                    </p>
                  )}
                  <Button
                    onClick={() => mutation.mutate()}
                    disabled={
                      mutation.isPending ||
                      list.length === 0 ||
                      blocked
                    }
                    className="w-full"
                  >
                    {mutation.isPending
                      ? "Processando…"
                      : `Processar Remanejamento${list.length > 0 ? ` (${list.length})` : ""}`}
                  </Button>
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
