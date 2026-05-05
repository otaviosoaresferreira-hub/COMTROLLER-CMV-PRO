import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pencil, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useManagerMode } from "@/lib/manager-mode";
import { AdjustmentJustificationDialog } from "@/components/adjustment-justification-dialog";
import { ReasonConfirmDialog } from "@/components/reason-confirm-dialog";
import { createAdjustmentRequest } from "@/lib/adjustment-requests";
import { writeAuditLog } from "@/lib/audit-log";
import { useOrgId } from "@/lib/use-org-id";
import { useAppRole } from "@/lib/use-app-role";

type Batch = {
  id: string;
  lot_number: string | null;
  initial_qty: number;
  current_qty: number;
  unit_cost: number;
  avg_weight_g: number;
  expiry_date: string | null;
  created_at: string;
  invoice_id: string | null;
  edited_at?: string | null;
  reverted_at?: string | null;
  source?: string | null;
  movement_id?: string | null;
};

type EditState = {
  lot_number: string;
  current_qty: string;
  total_weight_kg: string;
  avg_weight_g: string;
  unit_cost: string;
  expiry_date: string;
};

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function toNum(s: string): number {
  const n = Number((s ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function ItemBatchesHistory({ itemId, onlyActive = true, editable = true }: { itemId: string; onlyActive?: boolean; editable?: boolean }) {
  const qc = useQueryClient();
  const { isManager } = useManagerMode();
  const { isGestor } = useAppRole();
  const orgId = useOrgId();
  const canEditDirect = isManager || isGestor;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{ id: string; payload: Record<string, unknown>; previous: Record<string, unknown> } | null>(null);
  const [justOpen, setJustOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["item-batches", itemId, onlyActive],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_active_batches", { _item_id: itemId });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Batch[];
      return onlyActive ? rows.filter((b) => Number(b.current_qty) > 0) : rows;
    },
    enabled: !!itemId,
  });

  const saveMutation = useMutation({
    mutationFn: async (vars: { id: string; payload: Record<string, unknown>; previous: Record<string, unknown>; reason: string }) => {
      const { error } = await supabase
        .from("item_batches")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(vars.payload as any)
        .eq("id", vars.id);
      if (error) throw new Error(error.message);
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "item_batches",
          entityType: "batch",
          entityId: vars.id,
          action: "update",
          reason: vars.reason,
          oldValue: vars.previous,
          newValue: vars.payload,
        });
      }
    },
    onSuccess: () => {
      toast.success("Lote atualizado");
      setEditingId(null);
      setEdit(null);
      setReasonOpen(false);
      setPendingPayload(null);
      qc.invalidateQueries({ queryKey: ["item-batches", itemId] });
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["item-extract", itemId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (b: Batch) => {
    setEditingId(b.id);
    const totalKg = (Number(b.avg_weight_g || 0) * Number(b.current_qty || 0)) / 1000;
    setEdit({
      lot_number: b.lot_number ?? "",
      current_qty: String(Number(b.current_qty || 0)),
      total_weight_kg: totalKg ? String(Number(totalKg.toFixed(3))) : "",
      avg_weight_g: b.avg_weight_g ? String(Number(Number(b.avg_weight_g).toFixed(2))) : "",
      unit_cost: b.unit_cost ? String(Number(Number(b.unit_cost).toFixed(4))) : "",
      expiry_date: b.expiry_date ?? "",
    });
  };

  const buildPending = () => {
    if (!editingId || !edit) return null;
    const qty = toNum(edit.current_qty);
    const totalKg = toNum(edit.total_weight_kg);
    let avgG = toNum(edit.avg_weight_g);
    if (avgG <= 0 && qty > 0 && totalKg > 0) {
      avgG = (totalKg * 1000) / qty;
    }
    const payload: Record<string, unknown> = {
      lot_number: edit.lot_number.trim() || null,
      current_qty: qty,
      avg_weight_g: avgG,
      total_weight_g: totalKg > 0 ? totalKg * 1000 : avgG * qty,
      unit_cost: toNum(edit.unit_cost),
      expiry_date: edit.expiry_date || null,
      edited_at: new Date().toISOString(),
    };
    const original = data?.find((b) => b.id === editingId);
    const previous: Record<string, unknown> = {
      lot_number: original?.lot_number ?? null,
      current_qty: Number(original?.current_qty ?? 0),
      avg_weight_g: Number(original?.avg_weight_g ?? 0),
      unit_cost: Number(original?.unit_cost ?? 0),
      expiry_date: original?.expiry_date ?? null,
    };
    return { id: editingId, payload, previous };
  };

  const handleSave = () => {
    const pending = buildPending();
    if (!pending) return;
    setPendingPayload(pending);
    if (canEditDirect) {
      setReasonOpen(true);
    } else {
      setJustOpen(true);
    }
  };

  const submitRequest = async (justification: string) => {
    if (!pendingPayload) return;
    setSubmitting(true);
    try {
      await createAdjustmentRequest({
        kind: "batch_edit",
        itemId,
        batchId: pendingPayload.id,
        currentValue: pendingPayload.previous,
        newValue: pendingPayload.payload,
        justification,
      });
      toast.success("Solicitação enviada ao gestor");
      setJustOpen(false);
      setPendingPayload(null);
      setEditingId(null);
      setEdit(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar solicitação");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Carregando lotes…</p>;
  }
  if (!data || data.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum lote {onlyActive ? "ativo" : "registrado"}.</p>;
  }

  return (
    <>
    <div className="overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Lote</TableHead>
            <TableHead className="text-xs">Entrada</TableHead>
            <TableHead className="text-xs text-right">Unidades</TableHead>
            <TableHead className="text-xs text-right">Peso Total do Lote (kg)</TableHead>
            <TableHead className="text-xs text-right">Peso Unitário do Lote</TableHead>
            <TableHead className="text-xs text-right">Custo</TableHead>
            <TableHead className="text-xs">Validade</TableHead>
            {editable && <TableHead className="text-xs w-16" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((b) => {
            const dleft = daysUntil(b.expiry_date);
            const danger = dleft !== null && dleft <= 7;
            const warn = dleft !== null && dleft > 7 && dleft <= 30;
            const isEditing = editingId === b.id && edit;
            const totalKg = (Number(b.avg_weight_g || 0) * Number(b.current_qty || 0)) / 1000;

            if (isEditing && edit) {
              return (
                <TableRow key={b.id} className="bg-muted/30">
                  <TableCell>
                    <Input className="h-8 text-xs" value={edit.lot_number} onChange={(e) => setEdit({ ...edit, lot_number: e.target.value })} placeholder="—" />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(b.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-xs text-right tabular-nums" type="number" inputMode="decimal" step="0.001" value={edit.current_qty} onChange={(e) => setEdit({ ...edit, current_qty: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-xs text-right tabular-nums" type="number" inputMode="decimal" step="0.001" value={edit.total_weight_kg} onChange={(e) => setEdit({ ...edit, total_weight_kg: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-xs text-right tabular-nums" type="number" inputMode="decimal" step="1" value={edit.avg_weight_g} onChange={(e) => setEdit({ ...edit, avg_weight_g: e.target.value })} placeholder="g" />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-xs text-right tabular-nums" type="number" inputMode="decimal" step="0.0001" value={edit.unit_cost} onChange={(e) => setEdit({ ...edit, unit_cost: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-xs" type="date" value={edit.expiry_date} onChange={(e) => setEdit({ ...edit, expiry_date: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSave} disabled={saveMutation.isPending} title={canEditDirect ? "Salvar (com motivo)" : "Enviar para aprovação"}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingId(null); setEdit(null); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            }

            return (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span>{b.lot_number || "—"}</span>
                    {b.source === "production" && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">Produção</Badge>
                    )}
                    {b.edited_at && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">Editado</Badge>
                    )}
                    {b.reverted_at && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Estornado</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {new Date(b.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {Number(b.current_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                  <span className="text-muted-foreground"> / {Number(b.initial_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {totalKg > 0 ? totalKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {Number(b.avg_weight_g) > 0
                    ? `${Math.round(Number(b.avg_weight_g))} g`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">{fmtBRL(Number(b.unit_cost))}</TableCell>
                <TableCell
                  className={cn(
                    "text-xs",
                    danger && "font-semibold text-destructive",
                    warn && "font-semibold text-amber-600",
                  )}
                >
                  {b.expiry_date
                    ? `${new Date(b.expiry_date + "T00:00:00").toLocaleDateString("pt-BR")}${
                        dleft !== null ? ` (${dleft >= 0 ? `${dleft}d` : "vencido"})` : ""
                      }`
                    : "—"}
                </TableCell>
                {editable && (
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(b)} aria-label="Editar lote">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
    <AdjustmentJustificationDialog
      open={justOpen}
      onClose={() => { setJustOpen(false); setPendingPayload(null); }}
      onConfirm={submitRequest}
      pending={submitting}
      title="Solicitar edição de lote"
      description="A alteração será registrada e aplicada após aprovação do gestor."
      summary={pendingPayload ? (
        <div className="space-y-1 text-[11px]">
          <p><span className="text-muted-foreground">Saldo: </span>{Number(pendingPayload.previous.current_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} → <strong>{Number(pendingPayload.payload.current_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</strong></p>
          <p><span className="text-muted-foreground">Peso médio: </span>{Math.round(Number(pendingPayload.previous.avg_weight_g))} g → <strong>{Math.round(Number(pendingPayload.payload.avg_weight_g))} g</strong></p>
          <p><span className="text-muted-foreground">Validade: </span>{(pendingPayload.previous.expiry_date as string) || "—"} → <strong>{(pendingPayload.payload.expiry_date as string) || "—"}</strong></p>
        </div>
      ) : null}
    />
    <ReasonConfirmDialog
      open={reasonOpen}
      onOpenChange={(o) => { setReasonOpen(o); if (!o) setPendingPayload(null); }}
      title="Confirmar edição de lote"
      description="Esta alteração será registrada no histórico de auditoria com seu motivo."
      confirmLabel="Salvar alteração"
      destructive={false}
      pending={saveMutation.isPending}
      summary={pendingPayload ? (
        <div className="space-y-1 text-[11px]">
          <p><span className="text-muted-foreground">Saldo: </span>{Number(pendingPayload.previous.current_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} → <strong>{Number(pendingPayload.payload.current_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</strong></p>
          <p><span className="text-muted-foreground">Peso médio: </span>{Math.round(Number(pendingPayload.previous.avg_weight_g))} g → <strong>{Math.round(Number(pendingPayload.payload.avg_weight_g))} g</strong></p>
          <p><span className="text-muted-foreground">Custo: </span>{fmtBRL(Number(pendingPayload.previous.unit_cost))} → <strong>{fmtBRL(Number(pendingPayload.payload.unit_cost))}</strong></p>
        </div>
      ) : null}
      onConfirm={(reason) => {
        if (!pendingPayload) return;
        saveMutation.mutate({ id: pendingPayload.id, payload: pendingPayload.payload, previous: pendingPayload.previous, reason });
      }}
    />
    </>
  );
}
