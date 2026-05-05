import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, CalendarDays, ClipboardEdit, AlertTriangle, Power, Trash2, Settings, Boxes, FileText } from "lucide-react";
import { ItemEditDialog } from "@/components/item-edit-dialog";
import { ItemBatchesHistory } from "@/components/item-batches-history";
import { AuditHistory } from "@/components/audit-history";
import { ItemExtract } from "@/components/item-extract";
import { Switch } from "@/components/ui/switch";
import { useManagerMode } from "@/lib/manager-mode";
import { roundUn, formatUn, formatKg, formatGrams } from "@/lib/shared-unit";
import { AdjustmentJustificationDialog } from "@/components/adjustment-justification-dialog";
import { createAdjustmentRequest, type AdjustmentKind } from "@/lib/adjustment-requests";

export type ActiveItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  displayQuantity?: number;
  displayUnit?: string;
  expiry: string | null;
  locationId: string;
  minStock: number;
  isActive: boolean;
  hasMovements: boolean;
  // Para sincronização KG <-> UN no ajuste de saldo
  weightG?: number; // peso unitário em gramas (avg ou padrão)
  totalUnits?: number; // total de unidades atual (somado dos batches/derivado)
  totalWeightKg?: number; // total de peso atual em KG
  hasUnitDrawer?: boolean; // possui gaveta de unidades (compartilhado ou batches > 0)
  divergentPackaging?: boolean; // embalagens divergentes — bloqueia entrada manual em UN
};

const REASONS = [
  "Perda",
  "Erro de Contagem",
  "Consumo Equipe",
  "Quebra / Avaria",
  "Devolução",
  "Outro",
];

interface Props {
  active: ActiveItem | null;
  onClose: () => void;
  onTransfer: (itemId: string) => void;
}

export function ItemActionsSheet({ active, onClose, onTransfer }: Props) {
  const qc = useQueryClient();
  const { isManager } = useManagerMode();
  const [expiry, setExpiry] = useState<string>("");
  const [newQty, setNewQty] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [reasonNote, setReasonNote] = useState<string>("");
  const [minStock, setMinStock] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);
  // Seletor de unidade para Ajuste de Saldo e Estoque Mínimo (itens compartilhados)
  const [adjustUnit, setAdjustUnit] = useState<"KG" | "UN">("KG");
  const [minStockUnit, setMinStockUnit] = useState<"KG" | "UN">("KG");
  // Modo divergente: dois inputs independentes (KG total + UN total) para recalcular avg.
  const [divergentKg, setDivergentKg] = useState<string>("");
  const [divergentUn, setDivergentUn] = useState<string>("");

  // Solicitação de ajuste (operacional → gestor)
  const [requestState, setRequestState] = useState<{
    kind: AdjustmentKind;
    title: string;
    description: string;
    summary: React.ReactNode;
    currentValue: Record<string, unknown>;
    newValue: Record<string, unknown>;
  } | null>(null);
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const submitRequest = async (justification: string) => {
    if (!requestState || !active) return;
    setSubmittingRequest(true);
    try {
      await createAdjustmentRequest({
        kind: requestState.kind,
        itemId: active.id,
        locationId: active.locationId,
        currentValue: requestState.currentValue,
        newValue: requestState.newValue,
        justification,
      });
      toast.success("Solicitação enviada ao gestor");
      setRequestState(null);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar solicitação");
    } finally {
      setSubmittingRequest(false);
    }
  };

  useEffect(() => {
    if (active) {
      setExpiry(active.expiry ?? "");
      // Se embalagens estão divergentes, força entrada em KG (trava absoluta).
      const lockedKg = active.divergentPackaging === true;
      const defaultUnit: "KG" | "UN" = lockedKg
        ? "KG"
        : (active.displayUnit || active.unit || "un").toUpperCase() === "UN"
          ? "UN"
          : "KG";
      setAdjustUnit(defaultUnit);
      setMinStockUnit(defaultUnit);
      // Sincronia absoluta: usa exatamente o mesmo valor formatado do Dashboard.
      // Para UN, aplica a regra do 0,5; para KG, mantém precisão de 1g.
      const rawTotalUn = active.totalUnits ?? 0;
      const rawTotalKg = active.totalWeightKg ?? active.quantity ?? 0;
      const initial = defaultUnit === "UN"
        ? roundUn(rawTotalUn || (active.displayQuantity ?? 0))
        : Number((rawTotalKg).toFixed(3));
      setNewQty(String(initial));
      setReason("");
      setReasonNote("");
      setMinStock(active.minStock > 0 ? String(active.minStock) : "");
      // Inicializa inputs divergentes com os valores atuais
      setDivergentKg(String(Number((active.totalWeightKg ?? active.quantity ?? 0).toFixed(3))));
      setDivergentUn(String(roundUn(active.totalUnits ?? 0)));
    }
  }, [active]);

  const expiryMutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Item inválido");
      const { error } = await supabase
        .from("stock_levels")
        .upsert(
          {
            item_id: active.id,
            location_id: active.locationId,
            current_stock: active.quantity,
            expiry_date: expiry || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Validade atualizada");
      qc.invalidateQueries({ queryKey: ["central"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cálculos auxiliares para conversão KG <-> UN no ajuste de saldo.
  // weightKg = peso médio unitário (avg_weight_g / 1000), fonte de conversão.
  const weightKg = (active?.weightG ?? 0) / 1000;
  const displayUnit = (active?.displayUnit || active?.unit || "un").toUpperCase();
  const hasUnitDrawer = active?.hasUnitDrawer === true;
  // Para itens compartilhados, o usuário pode escolher KG ou UN; senão usa a unidade exibida
  const inputIsUn = hasUnitDrawer && weightKg > 0
    ? adjustUnit === "UN"
    : displayUnit === "UN" && weightKg > 0;
  const newQtyNum = Number(newQty);
  const newQtyValid = !Number.isNaN(newQtyNum) && newQtyNum >= 0;
  // Converte o valor digitado (na unidade selecionada) para KG (unidade soberana no banco).
  // Se input está em UN, aplica snap 0,5 ANTES de converter para evitar peso errado.
  const inputUnSnapped = inputIsUn ? roundUn(newQtyNum) : newQtyNum;
  const previewKg = newQtyValid
    ? inputIsUn
      ? inputUnSnapped * weightKg
      : newQtyNum
    : 0;
  const previewUn = newQtyValid
    ? inputIsUn
      ? inputUnSnapped
      : weightKg > 0
        ? roundUn(newQtyNum / weightKg)
        : 0
    : 0;

  // Troca o toggle KG/UN puxando o valor original do banco (active.totalUnits / totalWeightKg)
  // — NÃO converte o input atual, evitando erros sucessivos de arredondamento.
  const handleSwitchAdjustUnit = (u: "KG" | "UN") => {
    if (u === adjustUnit) return;
    setAdjustUnit(u);
    if (!active) return;
    if (u === "UN") {
      const raw = active.totalUnits ?? (weightKg > 0 ? (active.totalWeightKg ?? active.quantity) / weightKg : 0);
      setNewQty(String(roundUn(raw)));
    } else {
      const raw = active.totalWeightKg ?? active.quantity ?? 0;
      setNewQty(String(Number(raw.toFixed(3))));
    }
  };

  const isDivergent = active?.divergentPackaging === true && hasUnitDrawer;
  const divergentKgNum = Number(divergentKg);
  const divergentUnNum = Number(divergentUn);
  const divergentValid =
    !Number.isNaN(divergentKgNum) &&
    divergentKgNum >= 0 &&
    !Number.isNaN(divergentUnNum) &&
    divergentUnNum >= 0;
  const divergentNewAvgG =
    divergentValid && divergentUnNum > 0 ? (divergentKgNum * 1000) / divergentUnNum : 0;

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Item inválido");
      if (!reason) throw new Error("Selecione uma justificativa");

      // ===== MODO DIVERGENTE: KG e UN independentes, recalcula avg_weight_g =====
      if (isDivergent) {
        if (!divergentValid) throw new Error("Quantidades inválidas");
        const finalNote =
          reason === "Outro" && reasonNote.trim()
            ? reasonNote.trim()
            : reasonNote.trim()
              ? `${reason} — ${reasonNote.trim()}`
              : reason;

        const targetKg = divergentKgNum;
        const targetUn = roundUn(divergentUnNum);
        const totalWeightG = targetKg * 1000;
        const newAvgG = targetUn > 0 ? totalWeightG / targetUn : (active.weightG ?? 0);
        const delta = targetKg - active.quantity;

        const { error: e1 } = await supabase
          .from("stock_levels")
          .upsert(
            {
              item_id: active.id,
              location_id: active.locationId,
              current_stock: targetKg,
              expiry_date: active.expiry,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "item_id,location_id" },
          );
        if (e1) throw e1;

        // Substitui batches por um único refletindo o novo peso médio
        const { error: eDel } = await supabase
          .from("item_batches")
          .delete()
          .eq("item_id", active.id);
        if (eDel) throw eDel;

        if (targetKg > 0 || targetUn > 0) {
          const { error: eIns } = await supabase.from("item_batches").insert({
            item_id: active.id,
            source: "adjustment",
            units_qty: targetUn,
            total_weight_g: totalWeightG,
            avg_weight_g: newAvgG,
            note: `Ajuste divergente — ${finalNote}`,
          });
          if (eIns) throw eIns;
        }

        // Atualiza avg_weight_g do item para refletir o novo peso médio efetivo
        if (newAvgG > 0) {
          const { error: eAvg } = await supabase
            .from("items")
            .update({ avg_weight_g: newAvgG })
            .eq("id", active.id);
          if (eAvg) throw eAvg;
        }

        const { error: e2 } = await supabase.from("movements").insert({
          item_id: active.id,
          from_location_id: delta < 0 ? active.locationId : null,
          to_location_id: delta > 0 ? active.locationId : null,
          quantity: Math.abs(delta),
          type: "adjustment",
          note: `${finalNote} (divergente: ${formatUn(targetUn)} un @ ${formatKg(newAvgG / 1000)} kg/un médio)`,
        });
        if (e2) throw e2;
        return;
      }

      // ===== MODO PADRÃO =====
      if (!newQtyValid) throw new Error("Quantidade inválida");
      const finalNote =
        reason === "Outro" && reasonNote.trim()
          ? reasonNote.trim()
          : reasonNote.trim()
            ? `${reason} — ${reasonNote.trim()}`
            : reason;

      const targetKg = previewKg;
      const targetStockValue = hasUnitDrawer ? targetKg : newQtyNum;
      const delta = targetStockValue - active.quantity;

      const { error: e1 } = await supabase
        .from("stock_levels")
        .upsert(
          {
            item_id: active.id,
            location_id: active.locationId,
            current_stock: targetStockValue,
            expiry_date: active.expiry,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
      if (e1) throw e1;

      if (hasUnitDrawer || (active.totalUnits ?? 0) > 0) {
        const { error: eDel } = await supabase
          .from("item_batches")
          .delete()
          .eq("item_id", active.id);
        if (eDel) throw eDel;

        if (targetKg > 0 || previewUn > 0) {
          const totalWeightG = targetKg * 1000;
          const unitsQty = previewUn;
          const avgWeightG = unitsQty > 0 ? totalWeightG / unitsQty : (active.weightG ?? 0);
          const { error: eIns } = await supabase.from("item_batches").insert({
            item_id: active.id,
            source: "adjustment",
            units_qty: unitsQty,
            total_weight_g: totalWeightG,
            avg_weight_g: avgWeightG,
            note: `Ajuste manual — ${finalNote}`,
          });
          if (eIns) throw eIns;
        }
      }

      const { error: e2 } = await supabase.from("movements").insert({
        item_id: active.id,
        from_location_id: delta < 0 ? active.locationId : null,
        to_location_id: delta > 0 ? active.locationId : null,
        quantity: Math.abs(delta),
        type: "adjustment",
        note: finalNote,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      const msg = isDivergent
        ? `Saldo ajustado: ${formatKg(divergentKgNum)} kg / ${formatUn(roundUn(divergentUnNum))} un (peso médio recalculado)`
        : hasUnitDrawer && weightKg > 0
          ? `Saldo ajustado: ${formatKg(previewKg)} kg / ${formatUn(previewUn)} un`
          : `Saldo ajustado para ${formatKg(newQtyNum)} ${displayUnit.toLowerCase()}`;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const minStockMutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Item inválido");
      const value = minStock.trim() === "" ? 0 : Number(minStock);
      if (Number.isNaN(value) || value < 0)
        throw new Error("Estoque mínimo inválido");
      // Para itens compartilhados, converte UN -> KG antes de salvar (sempre KG no banco)
      const valueKg = hasUnitDrawer && weightKg > 0 && minStockUnit === "UN"
        ? value * weightKg
        : value;
      const { error } = await supabase
        .from("items")
        .update({ min_stock: valueKg })
        .eq("id", active.id);
      if (error) throw error;
      return { value, unit: minStockUnit };
    },
    onSuccess: (res) => {
      toast.success(
        `Estoque mínimo definido: ${res.value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${res.unit.toLowerCase()}`,
      );
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Item inválido");
      const { error } = await supabase
        .from("items")
        .update({ is_active: !active.isActive })
        .eq("id", active.id);
      if (error) throw error;
      return !active.isActive;
    },
    onSuccess: (newState) => {
      toast.success(newState ? "Item reativado" : "Item inativado");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Item inválido");
      if (active.hasMovements)
        throw new Error("Item possui histórico de movimentação. Inative-o em vez de excluir.");
      const { error: e1 } = await supabase
        .from("stock_levels")
        .delete()
        .eq("item_id", active.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("items")
        .delete()
        .eq("id", active.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Item excluído");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={!!active} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-left">{active?.name}</SheetTitle>
          <SheetDescription className="text-left">
            Saldo atual:{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {(() => {
                const u = (active?.displayUnit || active?.unit || "un").toUpperCase();
                const v = active?.displayQuantity ?? active?.quantity ?? 0;
                return u === "UN" ? formatUn(v) : formatKg(v);
              })()}{" "}
              {(active?.displayUnit || active?.unit || "un").toUpperCase()}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* 1. Editar Insumo */}
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => setEditOpen(true)}
          >
            <Settings className="h-4 w-4" />
            Editar Insumo
          </Button>

          <Separator />

          {/* 2. Transferir Item */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Transferir Item</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Abre a transferência com este item já selecionado.
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => active && onTransfer(active.id)}
            >
              Abrir Transferência
            </Button>
          </section>

          <Separator />

          {/* 3. Ajuste de Saldo */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardEdit className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Ajuste de Saldo</h3>
            </div>

            {isDivergent ? (
              <>
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  ⚠️ Embalagens divergentes detectadas. Informe o <strong>peso total (KG)</strong> e a <strong>quantidade de embalagens (UN)</strong> que existem hoje no estoque — o sistema recalcula o peso médio por unidade.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Peso total (KG)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      value={divergentKg}
                      onChange={(e) => setDivergentKg(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Embalagens (UN)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="0"
                      value={divergentUn}
                      onChange={(e) => setDivergentUn(e.target.value)}
                      onBlur={() => {
                        if (divergentUn !== "" && !Number.isNaN(Number(divergentUn))) {
                          const snapped = roundUn(Number(divergentUn));
                          if (snapped !== Number(divergentUn)) setDivergentUn(String(snapped));
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs tabular-nums">
                  <span className="text-muted-foreground">Novo peso médio por unidade: </span>
                  <span className="font-semibold text-foreground">
                    {divergentNewAvgG > 0 ? formatGrams(divergentNewAvgG) : "—"}
                  </span>
                  {weightKg > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      (padrão: {formatGrams(weightKg * 1000)})
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                {hasUnitDrawer && weightKg > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Inserir ajuste em</Label>
                    <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1">
                      {(["KG", "UN"] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => handleSwitchAdjustUnit(u)}
                          className={`px-4 h-7 text-xs font-medium rounded-md transition ${
                            adjustUnit === u
                              ? "bg-background text-foreground shadow"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Nova Quantidade ({inputIsUn ? "UN" : displayUnit === "UN" ? "UN" : "KG"})</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step={inputIsUn ? "0.5" : "0.001"}
                    min="0"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    onBlur={() => {
                      if (inputIsUn && newQtyValid) {
                        const snapped = roundUn(Number(newQty));
                        if (snapped !== Number(newQty)) setNewQty(String(snapped));
                      }
                    }}
                  />
                  {hasUnitDrawer && weightKg > 0 && (
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                      <p className="font-medium text-foreground">
                        Conversão automática (ambas as unidades serão sincronizadas):
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-2 tabular-nums">
                        <div>
                          <span className="text-muted-foreground">Peso (KG): </span>
                          <span className="font-semibold text-foreground">
                            {formatKg(previewKg)} kg
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Unidades: </span>
                          <span className="font-semibold text-foreground">
                            {formatUn(previewUn)} un
                          </span>
                        </div>
                      </div>
                      {newQtyNum === 0 && (
                        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                          Zerar o saldo zera KG e UN simultaneamente.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Justificativa</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Input
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Detalhes do ajuste"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => {
                if (!active) return;
                if (!reason) {
                  toast.error("Selecione uma justificativa");
                  return;
                }
                if (isManager) {
                  adjustMutation.mutate();
                  return;
                }
                // Operacional → cria solicitação
                const finalNote =
                  reason === "Outro" && reasonNote.trim()
                    ? reasonNote.trim()
                    : reasonNote.trim()
                      ? `${reason} — ${reasonNote.trim()}`
                      : reason;
                if (isDivergent) {
                  if (!divergentValid) { toast.error("Quantidades inválidas"); return; }
                  const targetKg = divergentKgNum;
                  const targetUn = roundUn(divergentUnNum);
                  const totalWeightG = targetKg * 1000;
                  const newAvgG = targetUn > 0 ? totalWeightG / targetUn : (active.weightG ?? 0);
                  setRequestState({
                    kind: "stock_adjustment",
                    title: "Solicitar ajuste de saldo",
                    description: "O ajuste será aplicado ao estoque após aprovação do gestor.",
                    summary: (
                      <div className="space-y-1 text-[11px]">
                        <p><span className="text-muted-foreground">Saldo (kg): </span>{formatKg(active.quantity)} → <strong>{formatKg(targetKg)}</strong></p>
                        <p><span className="text-muted-foreground">Unidades: </span>{formatUn(active.totalUnits ?? 0)} → <strong>{formatUn(targetUn)}</strong></p>
                        <p><span className="text-muted-foreground">Peso médio: </span>{formatGrams(active.weightG ?? 0)} → <strong>{formatGrams(newAvgG)}</strong></p>
                      </div>
                    ),
                    currentValue: { current_stock: active.quantity, units_qty: active.totalUnits ?? 0, avg_weight_g: active.weightG ?? 0 },
                    newValue: {
                      current_stock: targetKg,
                      batches_replace: true,
                      units_qty: targetUn,
                      total_weight_g: totalWeightG,
                      avg_weight_g: newAvgG,
                      reason: finalNote,
                    },
                  });
                  return;
                }
                if (!newQtyValid) { toast.error("Quantidade inválida"); return; }
                const targetKg = previewKg;
                const targetStockValue = hasUnitDrawer ? targetKg : newQtyNum;
                setRequestState({
                  kind: "stock_adjustment",
                  title: "Solicitar ajuste de saldo",
                  description: "O ajuste será aplicado ao estoque após aprovação do gestor.",
                  summary: (
                    <div className="space-y-1 text-[11px]">
                      <p><span className="text-muted-foreground">Saldo: </span>{formatKg(active.quantity)} → <strong>{formatKg(targetStockValue)}</strong></p>
                      {hasUnitDrawer && weightKg > 0 && (
                        <p><span className="text-muted-foreground">Unidades: </span>{formatUn(active.totalUnits ?? 0)} → <strong>{formatUn(previewUn)}</strong></p>
                      )}
                      <p><span className="text-muted-foreground">Motivo: </span>{finalNote}</p>
                    </div>
                  ),
                  currentValue: { current_stock: active.quantity, units_qty: active.totalUnits ?? 0 },
                  newValue: hasUnitDrawer
                    ? {
                        current_stock: targetStockValue,
                        batches_replace: true,
                        units_qty: previewUn,
                        total_weight_g: targetKg * 1000,
                        avg_weight_g: previewUn > 0 ? (targetKg * 1000) / previewUn : (active.weightG ?? 0),
                        reason: finalNote,
                      }
                    : { current_stock: targetStockValue, reason: finalNote },
                });
              }}
              disabled={adjustMutation.isPending || submittingRequest}
            >
              {adjustMutation.isPending ? "Salvando…" : isManager ? "Confirmar Ajuste" : "Solicitar Ajuste"}
            </Button>
          </section>

          <Separator />

          {/* 4. Próxima Validade (dinâmica via FEFO) */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Próxima Validade</h3>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              {active?.expiry ? (
                <span className="font-medium text-foreground">
                  {new Date(active.expiry + "T00:00:00").toLocaleDateString("pt-BR")}
                </span>
              ) : (
                <span className="text-muted-foreground">Indeterminada — nenhum lote ativo possui validade.</span>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Calculada a partir do lote ativo com vencimento mais próximo (FEFO). Edite a validade de cada lote no Histórico de Lotes abaixo.
              </p>
            </div>
          </section>

          {isManager && active && (
            <>
              <Separator />

              {/* 5. Estoque Mínimo */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Estoque Mínimo</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Aviso visual quando o saldo ficar abaixo deste valor.
                </p>

                {hasUnitDrawer && weightKg > 0 && (
                  <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1">
                    {(["KG", "UN"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setMinStockUnit(u)}
                        className={`px-4 h-7 text-xs font-medium rounded-md transition ${
                          minStockUnit === u
                            ? "bg-background text-foreground shadow"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    placeholder={`0 ${hasUnitDrawer && weightKg > 0 ? minStockUnit.toLowerCase() : ""}`}
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                  />
                  <Button
                    onClick={() => minStockMutation.mutate()}
                    disabled={minStockMutation.isPending}
                  >
                    Salvar
                  </Button>
                </div>
                {hasUnitDrawer && weightKg > 0 && minStock && !Number.isNaN(Number(minStock)) && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    Equivale a{" "}
                    <span className="font-medium text-foreground">
                      {(minStockUnit === "UN"
                        ? Number(minStock) * weightKg
                        : weightKg > 0
                          ? Number(minStock) / weightKg
                          : 0
                      ).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
                      {minStockUnit === "UN" ? "kg" : "un"}
                    </span>
                  </p>
                )}
              </section>

              <Separator />

              {/* Histórico de Lotes (FEFO) — edição inline por lote */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Histórico de Lotes</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Edite peso médio, peso total, saldo, custo ou validade de cada lote individualmente. Alterações em um lote nunca afetam lotes anteriores. Em vermelho: vence em ≤7 dias. Em âmbar: ≤30 dias.
                </p>
                <ItemBatchesHistory itemId={active.id} />
              </section>

              <Separator />

              {/* Extrato do Produto: entradas (lotes) + saídas (movimentos) */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Extrato do Produto</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Histórico físico e financeiro: cada entrada com seu próprio custo/peso médio (sem média global) e cada saída com motivo e quantidade.
                </p>
                <ItemExtract itemId={active.id} locationId={active.locationId} />
              </section>

              <Separator />

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Histórico de Alterações</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Registro cronológico imutável de criações, edições, exclusões e estornos relacionados a este item — com usuário, data/hora e motivo.
                </p>
                <AuditHistory entityType="item" entityId={active.id} />
              </section>

              <Separator />

              {/* 6. Status do Item */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Power className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Status do Item</h3>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {active.isActive ? "Ativo" : "Inativo"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {active.isActive
                        ? "Aparece em buscas de Auditoria e Fichas."
                        : "Oculto em buscas; histórico preservado."}
                    </p>
                  </div>
                  <Switch
                    checked={active.isActive}
                    onCheckedChange={() => toggleActiveMutation.mutate()}
                    disabled={toggleActiveMutation.isPending}
                  />
                </div>
              </section>

              <Separator />

              {/* 7. Excluir Item (zona de perigo) */}
              <section className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-destructive" />
                  <h3 className="text-sm font-semibold text-destructive">Excluir Item</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Ação permanente. Itens com histórico não podem ser excluídos —
                  use o status Inativo para ocultá-los.
                </p>
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  onClick={() => {
                    if (active.hasMovements) {
                      toast.error(
                        "Item possui histórico de movimentação. Inative-o em vez de excluir.",
                      );
                      return;
                    }
                    if (
                      window.confirm(
                        `Excluir definitivamente "${active.name}"? Esta ação não pode ser desfeita.`,
                      )
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending || active.hasMovements}
                  title={
                    active.hasMovements
                      ? "Não é possível excluir: existe histórico de movimentação."
                      : "Excluir item"
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir Definitivamente
                </Button>
              </section>
            </>
          )}
        </div>
      </SheetContent>
      <ItemEditDialog
        itemId={active?.id ?? null}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <AdjustmentJustificationDialog
        open={!!requestState}
        onClose={() => setRequestState(null)}
        onConfirm={submitRequest}
        pending={submittingRequest}
        title={requestState?.title}
        description={requestState?.description}
        summary={requestState?.summary}
      />
    </Sheet>
  );
}
