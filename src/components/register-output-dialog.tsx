import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { consumeStockReal } from "@/lib/fefo";
import {
  loadExplodeContext,
  explodeRecipe,
  applyExplodedConsumption,
} from "@/lib/recipe-explode";
import {
  OUTPUT_KIND_META,
  WASTE_REASONS,
  type OutputKind,
  type ReasonCategory,
} from "@/lib/movement-categories";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locationId: string;
  orgId: string;
  /** Pre-selecionar Descarte ou Alimentação. Padrão: waste. */
  defaultKind?: OutputKind;
  /** Pré-selecionar um item específico. */
  defaultItemId?: string;
};

type ItemOption = {
  id: string;
  name: string;
  unit: string;
  cost_price: number;
  avg_weight_g: number;
};

type RecipeOption = {
  id: string;
  name: string;
  explode_on_consume: boolean;
  produced_item_id: string | null;
};

type StockRow = { item_id: string; current_stock: number };

export function RegisterOutputDialog({
  open,
  onOpenChange,
  locationId,
  orgId,
  defaultKind = "waste",
  defaultItemId,
}: Props) {
  const qc = useQueryClient();

  const [kind, setKind] = useState<OutputKind>(defaultKind);
  const [reason, setReason] = useState<ReasonCategory>(
    OUTPUT_KIND_META[defaultKind].defaultReason,
  );
  const [mode, setMode] = useState<"item" | "recipe">("item");
  const [itemId, setItemId] = useState<string>(defaultItemId ?? "");
  const [recipeId, setRecipeId] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setKind(defaultKind);
      setReason(OUTPUT_KIND_META[defaultKind].defaultReason);
      setMode("item");
      setItemId(defaultItemId ?? "");
      setRecipeId("");
      setQty("");
      setNote("");
    }
  }, [open, defaultKind, defaultItemId]);

  // Quando muda o tipo (Descarte ↔ Alimentação), reseta razão coerente
  useEffect(() => {
    setReason(OUTPUT_KIND_META[kind].defaultReason);
  }, [kind]);

  const { data: items } = useQuery({
    queryKey: ["register-output:items", orgId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id,name,unit,cost_price,avg_weight_g")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ItemOption[];
    },
  });

  const { data: recipes } = useQuery({
    queryKey: ["register-output:recipes", orgId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id,name,explode_on_consume,produced_item_id")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as RecipeOption[];
    },
  });

  const { data: stockHere } = useQuery({
    queryKey: ["register-output:stock", orgId, locationId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_levels")
        .select("item_id,current_stock")
        .eq("org_id", orgId)
        .eq("location_id", locationId);
      if (error) throw error;
      return (data ?? []) as StockRow[];
    },
  });

  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    (stockHere ?? []).forEach((r) => m.set(r.item_id, Number(r.current_stock ?? 0)));
    return m;
  }, [stockHere]);

  const selectedItem = items?.find((i) => i.id === itemId) ?? null;
  const selectedRecipe = recipes?.find((r) => r.id === recipeId) ?? null;
  const currentBalance = selectedItem ? stockMap.get(selectedItem.id) ?? 0 : 0;

  const numericQty = Number((qty || "0").replace(",", "."));
  const willGoNegative =
    mode === "item" && selectedItem
      ? currentBalance - numericQty < 0
      : false;

  const mutation = useMutation({
    mutationFn: async () => {
      if (numericQty <= 0 || !Number.isFinite(numericQty)) {
        throw new Error("Informe uma quantidade válida.");
      }
      const movementType = OUTPUT_KIND_META[kind].movementType;
      const finalReason = kind === "staff_meal" ? "staff" : reason;
      const reasonNote = note.trim() || null;

      // ============================================================
      // Modo RECEITA → explode em insumos brutos (se a receita pedir)
      // e baixa cada insumo, registrando 1 movimento por insumo.
      // ============================================================
      if (mode === "recipe") {
        if (!selectedRecipe) throw new Error("Selecione uma ficha técnica.");
        const ctx = await loadExplodeContext(orgId);
        let exploded;
        if (selectedRecipe.explode_on_consume) {
          exploded = explodeRecipe(selectedRecipe.id, numericQty, ctx);
        } else if (selectedRecipe.produced_item_id) {
          // Sem explosão: baixa direto o produto pronto
          const item = ctx.items.find((i) => i.id === selectedRecipe.produced_item_id);
          if (!item) throw new Error("Item produzido da ficha não encontrado.");
          const baseUnit: "kg" | "un" =
            (item.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un";
          exploded = [
            { itemId: selectedRecipe.produced_item_id, qty: numericQty, unit: baseUnit },
          ];
        } else {
          // Sem produced_item_id e sem explode_on_consume → forçamos explosão
          exploded = explodeRecipe(selectedRecipe.id, numericQty, ctx);
        }
        if (exploded.length === 0) {
          throw new Error("Ficha sem insumos para baixar.");
        }
        // applyExplodedConsumption faz FEFO + atualiza stock_levels (permite negativo)
        const { totalCost, perItem } = await applyExplodedConsumption({
          exploded,
          locationId,
          orgId,
          ctx,
        });
        // Cria 1 movimento por insumo + incident se ficou negativo
        for (const p of perItem) {
          const balRow = stockMap.get(p.itemId);
          // Recarrega saldo atualizado (após baixa)
          const { data: latest } = await supabase
            .from("stock_levels")
            .select("current_stock")
            .eq("org_id", orgId)
            .eq("item_id", p.itemId)
            .eq("location_id", locationId)
            .maybeSingle();
          const newBal = Number(latest?.current_stock ?? balRow ?? 0);

          const baseNote = `${OUTPUT_KIND_META[kind].label} (explodido de ${selectedRecipe.name})${reasonNote ? ` — ${reasonNote}` : ""}`;
          const { data: mv, error: mvErr } = await supabase
            .from("movements")
            .insert({
              item_id: p.itemId,
              from_location_id: locationId,
              to_location_id: null,
              quantity: p.qty,
              type: movementType,
              reason_category: finalReason,
              unit_cost: p.qty > 0 ? p.cost / p.qty : 0,
              total_cost: p.cost,
              note: baseNote,
            })
            .select("id")
            .single();
          if (mvErr) throw mvErr;

          if (newBal < 0) {
            await supabase.from("movement_incidents").insert({
              movement_id: mv?.id ?? null,
              location_id: locationId,
              item_id: p.itemId,
              missing_qty: Math.abs(newBal),
              resulting_balance: newBal,
              movement_type: movementType,
              reason_category: finalReason,
              note: baseNote,
            });
          }
        }
        return { totalCost, count: perItem.length, recipe: selectedRecipe.name };
      }

      // ============================================================
      // Modo ITEM bruto
      // ============================================================
      if (!selectedItem) throw new Error("Selecione um item.");
      const baseUnit: "kg" | "un" =
        (selectedItem.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un";

      let realTaken = numericQty;
      try {
        const r = await consumeStockReal({
          itemId: selectedItem.id,
          qty: numericQty,
          inputUnit: baseUnit,
          itemBaseUnit: baseUnit,
          avgWeightG: Number(selectedItem.avg_weight_g ?? 0),
        });
        if (r.realBaseTaken > 0) realTaken = r.realBaseTaken;
      } catch {
        // FEFO falhou (sem lotes) — ainda assim seguimos com a baixa,
        // só não rastreamos lote.
      }

      const { data: lvl } = await supabase
        .from("stock_levels")
        .select("id,current_stock")
        .eq("org_id", orgId)
        .eq("item_id", selectedItem.id)
        .eq("location_id", locationId)
        .maybeSingle();
      const prevBal = Number(lvl?.current_stock ?? 0);
      const newBal = prevBal - realTaken;
      if (lvl) {
        const { error } = await supabase
          .from("stock_levels")
          .update({ current_stock: newBal })
          .eq("id", lvl.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("stock_levels").insert({
          org_id: orgId,
          item_id: selectedItem.id,
          location_id: locationId,
          current_stock: newBal,
        });
        if (error) throw error;
      }

      const unitCost = Number(selectedItem.cost_price ?? 0);
      const totalCost = unitCost * realTaken;
      const baseNote = `${OUTPUT_KIND_META[kind].label}${reasonNote ? ` — ${reasonNote}` : ""}`;
      const { data: mv, error: mvErr } = await supabase
        .from("movements")
        .insert({
          item_id: selectedItem.id,
          from_location_id: locationId,
          to_location_id: null,
          quantity: realTaken,
          type: movementType,
          reason_category: finalReason,
          unit_cost: unitCost,
          total_cost: totalCost,
          note: baseNote,
        })
        .select("id")
        .single();
      if (mvErr) throw mvErr;

      if (newBal < 0) {
        await supabase.from("movement_incidents").insert({
          movement_id: mv?.id ?? null,
          location_id: locationId,
          item_id: selectedItem.id,
          missing_qty: Math.abs(newBal),
          resulting_balance: newBal,
          movement_type: movementType,
          reason_category: finalReason,
          note: baseNote,
        });
      }
      return { totalCost, count: 1, item: selectedItem.name };
    },
    onSuccess: (res) => {
      const valor = (res.totalCost ?? 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
      toast.success(
        `${OUTPUT_KIND_META[kind].label} registrado · ${res.count} ${res.count === 1 ? "movimento" : "movimentos"} · ${valor}`,
      );
      qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Falha ao registrar saída.";
      toast.error(msg);
    },
  });

  const canSubmit =
    numericQty > 0 &&
    Number.isFinite(numericQty) &&
    ((mode === "item" && !!itemId) || (mode === "recipe" && !!recipeId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "waste" ? (
              <Trash2 className="h-5 w-5 text-destructive" />
            ) : (
              <Utensils className="h-5 w-5 text-primary" />
            )}
            Registrar Saída
          </DialogTitle>
          <DialogDescription>
            Baixa categorizada de estoque. Saídas sem saldo geram um incidente
            para conferência posterior.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tipo de saída */}
          <Tabs value={kind} onValueChange={(v) => setKind(v as OutputKind)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="waste" className="gap-2">
                <Trash2 className="h-3.5 w-3.5" /> Descarte
              </TabsTrigger>
              <TabsTrigger value="staff_meal" className="gap-2">
                <Utensils className="h-3.5 w-3.5" /> Alimentação
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Razão (somente para descarte) */}
          {kind === "waste" && (
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as ReasonCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WASTE_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Item ou Receita */}
          <Tabs value={mode} onValueChange={(v) => setMode(v as "item" | "recipe")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="item">Insumo</TabsTrigger>
              <TabsTrigger value="recipe">Ficha técnica</TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "item" ? (
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um item…" />
                </SelectTrigger>
                <SelectContent>
                  {(items ?? []).map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.name} ({it.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedItem && (
                <p className="text-xs text-muted-foreground">
                  Saldo atual: {currentBalance.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
                  {selectedItem.unit}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Ficha técnica</Label>
              <Select value={recipeId} onValueChange={setRecipeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma ficha…" />
                </SelectTrigger>
                <SelectContent>
                  {(recipes ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.explode_on_consume ? " · explode" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRecipe?.explode_on_consume && (
                <p className="text-xs text-muted-foreground">
                  Esta ficha será explodida em insumos brutos ao registrar a saída.
                </p>
              )}
            </div>
          )}

          {/* Quantidade */}
          <div className="space-y-1.5">
            <Label>Quantidade</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.001"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
            />
            {willGoNegative && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Saldo ficará negativo · será criado incidente
              </Badge>
            )}
          </div>

          {/* Observação */}
          <div className="space-y-1.5">
            <Label>Observação (opcional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: caiu no chão, queimou na chapa…"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? "Registrando…" : "Registrar saída"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
