import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  Inbox,
  Eye,
  Undo2,
  Loader2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { weightedAvgWeight } from "@/lib/shared-unit";
import { useManagerMode } from "@/lib/manager-mode";

export const Route = createFileRoute("/notas")({
  component: NotasPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);

const fmtNum = (n: number, dec = 3) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: dec });

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y.slice(2)}`;
};

type InvoiceRow = {
  id: string;
  number: string | null;
  supplier_name: string | null;
  issue_date: string | null;
  total_value: number;
  status: string;
  created_at: string;
};

function NotasPage() {
  const { isManager } = useManagerMode();
  const qc = useQueryClient();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [reverseId, setReverseId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["notas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id,number,supplier_name,issue_date,total_value,status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as InvoiceRow[];
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      // 1. Buscar items da nota
      const { data: invItems, error: e1 } = await supabase
        .from("invoice_items")
        .select("id,item_id,xml_name,stock_quantity,xml_quantity,xml_unit")
        .eq("invoice_id", invoiceId);
      if (e1) throw e1;
      if (!invItems?.length) throw new Error("Nota sem itens vinculados");

      // 2. Buscar movements desta nota
      const { data: movs, error: e2 } = await supabase
        .from("movements")
        .select("id,item_id,quantity,to_location_id")
        .eq("invoice_id", invoiceId);
      if (e2) throw e2;

      // 3. Buscar lotes desta nota
      const { data: batches, error: e3 } = await supabase
        .from("item_batches")
        .select("id,item_id,units_qty,avg_weight_g,total_weight_g")
        .eq("invoice_id", invoiceId);
      if (e3) throw e3;

      // 4. Para cada movement: subtrair do estoque
      for (const mov of movs ?? []) {
        if (!mov.to_location_id) continue;
        const { data: lvl } = await supabase
          .from("stock_levels")
          .select("current_stock")
          .eq("item_id", mov.item_id)
          .eq("location_id", mov.to_location_id)
          .maybeSingle();
        const cur = Number(lvl?.current_stock ?? 0);
        const newQty = Math.max(0, cur - Number(mov.quantity));
        await supabase
          .from("stock_levels")
          .update({
            current_stock: newQty,
            updated_at: new Date().toISOString(),
          })
          .eq("item_id", mov.item_id)
          .eq("location_id", mov.to_location_id);
      }

      // 5. Reverter avg_weight_g para itens compartilhados
      for (const b of batches ?? []) {
        const batchUnits = Number(b.units_qty);
        const batchAvgG = Number(b.avg_weight_g);
        if (!(batchUnits > 0) || !(batchAvgG > 0)) continue;

        const { data: item } = await supabase
          .from("items")
          .select("avg_weight_g,standard_weight_g,shared_unit_enabled")
          .eq("id", b.item_id)
          .single();
        if (!item?.shared_unit_enabled) continue;

        const curAvgG = Number(item.avg_weight_g ?? 0);
        // Soma de unidades atuais (após reversão de estoque já aplicada acima):
        const { data: lvls } = await supabase
          .from("stock_levels")
          .select("current_stock")
          .eq("item_id", b.item_id);
        const totalKg = (lvls ?? []).reduce(
          (acc, l) => acc + Number(l.current_stock ?? 0),
          0,
        );
        const remainingUnits =
          curAvgG > 0 ? totalKg / (curAvgG / 1000) : 0;

        if (remainingUnits > 0 && curAvgG > 0) {
          // Inverso da média ponderada:
          // newAvg = (totalAtual*curAvg − batchUnits*batchAvg) / (totalAtual − batchUnits)
          // Mas como já subtraímos do estoque, recompomos:
          const totalUnitsBefore = remainingUnits + batchUnits;
          const numerator =
            totalUnitsBefore * curAvgG - batchUnits * batchAvgG;
          const denom = totalUnitsBefore - batchUnits;
          const newAvgG =
            denom > 0
              ? numerator / denom
              : Number(item.standard_weight_g ?? 0);
          await supabase
            .from("items")
            .update({ avg_weight_g: Math.max(0, newAvgG) })
            .eq("id", b.item_id);
        } else {
          // Sem estoque restante → volta ao standard
          await supabase
            .from("items")
            .update({ avg_weight_g: Number(item.standard_weight_g ?? 0) })
            .eq("id", b.item_id);
        }
      }

      // 6. Apagar lotes, movements, invoice_items
      // OBS: NÃO apagamos xml_item_mappings — a memória do multiplicador
      // permanece como SUGESTÃO para futuras importações (ver entry-dialog).
      const affectedItemIds = new Set<string>([
        ...(movs ?? []).map((m) => m.item_id).filter(Boolean) as string[],
        ...(batches ?? []).map((b) => b.item_id).filter(Boolean) as string[],
      ]);
      if (batches?.length) {
        await supabase.from("item_batches").delete().eq("invoice_id", invoiceId);
      }
      if (movs?.length) {
        await supabase.from("movements").delete().eq("invoice_id", invoiceId);
      }

      await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);

      // 6b. Recalcular CMV (cost_price) por média ponderada dos lotes restantes
      for (const itemId of affectedItemIds) {
        const { data: remaining } = await supabase
          .from("item_batches")
          .select("current_qty,unit_cost")
          .eq("item_id", itemId)
          .gt("current_qty", 0);
        const totalQty = (remaining ?? []).reduce((a, b) => a + Number(b.current_qty), 0);
        const totalCost = (remaining ?? []).reduce(
          (a, b) => a + Number(b.current_qty) * Number(b.unit_cost),
          0,
        );
        if (totalQty > 0) {
          const avg = totalCost / totalQty;
          if (Number.isFinite(avg) && avg > 0) {
            await supabase.from("items").update({ cost_price: avg }).eq("id", itemId);
          }
        }
      }

      // 7. DELETA permanentemente a nota (libera nfe_key/access_key/number p/ reimportação)
      const { error: eu } = await supabase
        .from("invoices")
        .delete()
        .eq("id", invoiceId);
      if (eu) throw new Error(`Falha ao remover nota: ${eu.message} (code ${eu.code ?? "?"})`);

      // Suplemento: weightedAvgWeight import só p/ tipo
      void weightedAvgWeight;
    },
    onSuccess: () => {
      toast.success("Nota estornada e removida — XML liberado para nova importação");
      qc.invalidateQueries({ queryKey: ["notas"] });
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setReverseId(null);
    },
    onError: (err: Error) => {
      toast.error(`Falha ao estornar: ${err.message}`);
    },
  });

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Histórico de Gestão
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">
              Notas Processadas
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 pt-4">
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          A importação de XML é feita no{" "}
          <Link
            to="/central"
            search={{ cat: undefined } as never}
            className="font-medium text-primary hover:underline"
          >
            Estoque Central
          </Link>
          , em <strong>Registrar Entrada → XML</strong>. Aqui você consulta,
          revisa as conversões e estorna notas se necessário.
        </div>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Notas processadas</h2>
            <span className="text-xs text-muted-foreground">
              {data?.length ?? 0}{" "}
              {(data?.length ?? 0) === 1 ? "nota" : "notas"}
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : !data?.length ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhuma nota processada ainda</p>
              <p className="text-xs text-muted-foreground">
                Importe um XML pelo Estoque Central para gerar o primeiro registro.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Data / Nº</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  {isManager && <TableHead className="text-right">Valor</TableHead>}
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="pr-4 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{inv.number ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(inv.issue_date ?? inv.created_at)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.supplier_name ?? "—"}
                    </TableCell>
                    {isManager && (
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtBRL(Number(inv.total_value))}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {inv.status === "processed" ? (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Processada
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Clock className="h-3 w-3" />
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetailsId(inv.id)}
                          className="h-8 px-2"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span className="ml-1 hidden sm:inline text-xs">
                            Detalhes
                          </span>
                        </Button>
                        {inv.status === "processed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setReverseId(inv.id)}
                            className="h-8 px-2 text-destructive hover:text-destructive"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            <span className="ml-1 hidden sm:inline text-xs">
                              Estornar
                            </span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </main>

      {/* Modal de detalhes */}
      <DetailsDialog
        invoiceId={detailsId}
        onClose={() => setDetailsId(null)}
      />

      {/* Confirmação de estorno */}
      <AlertDialog
        open={!!reverseId}
        onOpenChange={(o) => !o && setReverseId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar esta nota?</AlertDialogTitle>
            <AlertDialogDescription>
              As quantidades serão subtraídas do estoque, o peso médio dos itens
              compartilhados será recalculado removendo a contribuição desta
              nota, e o status voltará para <strong>Pendente</strong>. O
              fator de conversão salvo permanece como <em>sugestão</em> para
              a próxima importação, mas você precisará confirmá-lo manualmente.
              Esta ação é definitiva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverseMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={reverseMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (reverseId) reverseMutation.mutate(reverseId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reverseMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Estornando…
                </>
              ) : (
                "Estornar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================
// Modal de Detalhes — mostra conversão XML → estoque
// ============================================================

function DetailsDialog({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}) {
  const { isManager } = useManagerMode();
  const { data, isLoading } = useQuery({
    queryKey: ["notas", "details", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const [{ data: inv }, { data: items }, { data: batches }] =
        await Promise.all([
          supabase
            .from("invoices")
            .select(
              "number,supplier_name,issue_date,total_value,status,created_at",
            )
            .eq("id", invoiceId)
            .single(),
          supabase
            .from("invoice_items")
            .select(
              "id,item_id,xml_name,xml_quantity,xml_unit,xml_total_price,stock_quantity,stock_unit_cost,multiplier",
            )
            .eq("invoice_id", invoiceId),
          supabase
            .from("item_batches")
            .select("item_id,units_qty,total_weight_g,avg_weight_g")
            .eq("invoice_id", invoiceId),
        ]);
      const itemIds = (items ?? []).map((i) => i.item_id).filter(Boolean) as string[];
      let itemsMeta: Record<string, { name: string; unit: string; shared: boolean }> = {};
      if (itemIds.length) {
        const { data: it } = await supabase
          .from("items")
          .select("id,name,unit,shared_unit_enabled")
          .in("id", itemIds);
        itemsMeta = Object.fromEntries(
          (it ?? []).map((i) => [
            i.id,
            { name: i.name, unit: i.unit, shared: !!i.shared_unit_enabled },
          ]),
        );
      }
      const batchByItem = new Map<string, { units: number; kg: number }>();
      (batches ?? []).forEach((b) =>
        batchByItem.set(b.item_id, {
          units: Number(b.units_qty),
          kg: Number(b.total_weight_g) / 1000,
        }),
      );
      return { inv, items: items ?? [], itemsMeta, batchByItem };
    },
    enabled: !!invoiceId,
  });

  return (
    <Dialog open={!!invoiceId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detalhes da nota</DialogTitle>
          <DialogDescription>
            {data?.inv ? (
              <>
                Nº <strong>{data.inv.number ?? "—"}</strong> ·{" "}
                {data.inv.supplier_name ?? "—"} ·{" "}
                {fmtDate(data.inv.issue_date ?? data.inv.created_at)}
                {isManager && (
                  <>
                    {" "}· <strong>{fmtBRL(Number(data.inv.total_value))}</strong>
                  </>
                )}
              </>
            ) : (
              "Carregando…"
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : !data?.items.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Sem itens registrados.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-3">Item</TableHead>
                  <TableHead>XML</TableHead>
                  <TableHead className="pr-3">Estoque gerado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((it) => {
                  const meta = it.item_id ? data.itemsMeta[it.item_id] : null;
                  const batch = it.item_id
                    ? data.batchByItem.get(it.item_id)
                    : undefined;
                  const isShared = !!meta?.shared && !!batch;
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="pl-3">
                        <div className="font-medium text-sm">
                          {meta?.name ?? it.xml_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {it.xml_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="tabular-nums">
                          {fmtNum(Number(it.xml_quantity))}
                        </span>{" "}
                        {it.xml_unit ?? ""}
                        {isManager && (
                          <div className="text-[11px] text-muted-foreground">
                            {fmtBRL(Number(it.xml_total_price))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="pr-3 text-xs">
                        {isShared ? (
                          <>
                            <div className="font-semibold tabular-nums">
                              {fmtNum(batch!.units, 0)} UN
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {fmtNum(batch!.kg)} kg · média{" "}
                              {fmtNum(batch!.kg / Math.max(1, batch!.units))} kg/un
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold tabular-nums">
                              {fmtNum(Number(it.stock_quantity))}{" "}
                              {meta?.unit ?? ""}
                            </div>
                            {isManager && (
                              <div className="text-[11px] text-muted-foreground">
                                {fmtBRL(Number(it.stock_unit_cost))}/
                                {(meta?.unit ?? "").toLowerCase()}
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
