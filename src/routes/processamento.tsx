import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { revertProductionMovement } from "@/server/movements.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProcessingDialog } from "@/components/processing-dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { ReasonConfirmDialog } from "@/components/reason-confirm-dialog";
import { ArrowLeft, Scissors, Clock, Scale, AlertTriangle, Undo2 } from "lucide-react";
import { useManagerMode } from "@/lib/manager-mode";
import { useAppRole } from "@/lib/use-app-role";
import { writeAuditLog } from "@/lib/audit-log";
import { useOrgId } from "@/lib/use-org-id";

export const Route = createFileRoute("/processamento")({
  component: ProcessamentoPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(isFinite(n) ? n : 0);

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const TAG = "Processamento";

function ProcessamentoPage() {
  const { isManager } = useManagerMode();
  const { isGestor } = useAppRole();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const canRevertDirect = isManager || isGestor;

  const revertMutation = useMutation({
    mutationFn: async ({ movementId, reason }: { movementId: string; reason: string }) => {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || !authData.session?.access_token) {
        throw new Error("Sessão expirada. Entre novamente para estornar.");
      }
      const result = await revertProductionMovement({
        data: { movementId },
        headers: { Authorization: `Bearer ${authData.session.access_token}` },
      });
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "processing",
          entityType: "movement",
          entityId: movementId,
          action: "revert",
          reason,
          metadata: { reverted: result.reverted },
        });
      }
      return result;
    },
    onSuccess: (r) => {
      toast.success(`Processamento estornado (${r.reverted} movimentos). Estoque e CMV restaurados.`);
      qc.invalidateQueries();
      setConfirmRevertId(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const requestRevertMutation = useMutation({
    mutationFn: async ({ movementId, reason }: { movementId: string; reason: string }) => {
      const { createAdjustmentRequest } = await import("@/lib/adjustment-requests");
      await createAdjustmentRequest({
        kind: "processing_revert",
        currentValue: { movement_id: movementId },
        newValue: { movement_id: movementId },
        justification: reason,
      });
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "processing",
          entityType: "movement",
          entityId: movementId,
          action: "request",
          reason,
          metadata: { kind: "processing_revert" },
        });
      }
    },
    onSuccess: () => {
      toast.success("Solicitação enviada ao gestor.");
      setConfirmRevertId(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["processamentos"],
    queryFn: async () => {
      const [movs, items] = await Promise.all([
        supabase
          .from("movements")
          .select("*")
          .or(`note.ilike.%${TAG}%`)
          .neq("status", "reverted")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("items").select("id,name,unit"),
      ]);
      if (movs.error) throw movs.error;
      if (items.error) throw items.error;
      return { movs: movs.data ?? [], items: items.data ?? [] };
    },
  });

  // Agrupa por janela de tempo (±5s) — mesmo processamento gera vários movimentos
  const groups = useMemo(() => {
    if (!data) return [];
    const itemMap = new Map(data.items.map((i) => [i.id, i]));
    const sorted = [...data.movs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const buckets: Array<{
      key: string;
      date: string;
      sourceName: string;
      sourceWeight: number;
      lossKg: number;
      lossPct: number;
      destinations: Array<{ id: string; name: string; kind: string; qty: number; weight: number; cost: number; unit: string }>;
      totalCost: number;
    }> = [];
    let cur: typeof buckets[number] | null = null;
    let curTs = 0;

    for (const m of sorted) {
      const ts = new Date(m.created_at).getTime();
      if (!cur || ts - curTs > 5000) {
        cur = {
          key: m.id,
          date: m.created_at,
          sourceName: "",
          sourceWeight: 0,
          lossKg: 0,
          lossPct: 0,
          destinations: [],
          totalCost: 0,
        };
        buckets.push(cur);
      }
      curTs = ts;
      const item = itemMap.get(m.item_id);
      const note: string = m.note ?? "";

      if (m.type === "production_out") {
        // origem
        const srcMatch = note.match(/Processamento:\s*([^|]+?)\s*\|\s*Origem\s+([\d.,]+)/);
        if (srcMatch) {
          cur.sourceName = srcMatch[1].trim();
          cur.sourceWeight = parseFloat(srcMatch[2].replace(/\./g, "").replace(",", ".")) || 0;
        }
        const lossMatch = note.match(/Quebra\s+([\d.,]+)\s*kg\s*\(([\d.,]+)%\)/);
        if (lossMatch) {
          cur.lossKg = parseFloat(lossMatch[1].replace(/\./g, "").replace(",", ".")) || 0;
          cur.lossPct = parseFloat(lossMatch[2].replace(",", ".")) || 0;
        }
      } else {
        // destino (production_in ou waste/consumo)
        const kindMatch = note.match(/\((Porcionado|Aparas)\)/);
        const isConsumption = note.includes("Consumo Interno");
        const kind = isConsumption ? "Consumo Interno" : kindMatch?.[1] ?? "Destino";
        const wMatch = note.match(/\|\s*([\d.,]+)\s*kg/);
        const w = wMatch ? parseFloat(wMatch[1].replace(/\./g, "").replace(",", ".")) || 0 : 0;
        cur.destinations.push({
          id: m.id,
          name: item?.name ?? (isConsumption ? "Consumo Interno" : "—"),
          kind,
          qty: Number(m.quantity ?? 0),
          weight: w,
          cost: Number(m.total_cost ?? 0),
          unit: item?.unit ?? "",
        });
        cur.totalCost += Number(m.total_cost ?? 0);
      }
    }

    return buckets.reverse();
  }, [data]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Processamento</p>
            <h1 className="truncate text-base font-semibold leading-tight">Transformações</h1>
          </div>
          <ProcessingDialog />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <section className="rounded-2xl border bg-card shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Scissors className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum processamento registrado</p>
              <p className="text-xs text-muted-foreground">
                Use o botão "Processar Insumo" para registrar conversões.
              </p>
            </div>
          ) : (
            <Accordion type="multiple">
              {groups.map((g) => (
                <AccordionItem key={g.key} value={g.key}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-semibold">{g.sourceName || "Processamento"}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                          <Clock className="h-3 w-3" />{fmtDateTime(g.date)}
                          {g.sourceWeight > 0 && (
                            <>
                              <Scale className="h-3 w-3" />
                              {g.sourceWeight.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg
                            </>
                          )}
                          {g.lossKg > 0 && (
                            <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> Quebra {g.lossPct.toFixed(1)}%
                            </Badge>
                          )}
                        </p>
                      </div>
                      {isManager && g.totalCost > 0 && (
                        <Badge variant="secondary" className="tabular-nums">{fmtBRL(g.totalCost)}</Badge>
                      )}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmRevertId(g.key);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            setConfirmRevertId(g.key);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        {isManager ? "Estornar" : "Solicitar estorno"}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-0 pb-0">
                    <ul className="divide-y border-t">
                      {g.destinations.map((d) => (
                        <li key={d.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{d.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {d.kind} · {d.weight.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg
                              {d.qty > 0 && d.unit.toLowerCase() === "un" && ` · ${d.qty} un`}
                            </p>
                          </div>
                          {isManager && d.cost > 0 && (
                            <span className="text-sm font-bold tabular-nums">{fmtBRL(d.cost)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </section>
      </main>

      <ReasonConfirmDialog
        open={!!confirmRevertId}
        onOpenChange={(o) => !o && setConfirmRevertId(null)}
        title={canRevertDirect ? "Estornar este processamento?" : "Solicitar estorno deste processamento?"}
        description={
          canRevertDirect
            ? "A matéria-prima original será devolvida ao estoque, os produtos gerados serão removidos e o CMV recalculado. Bloqueado se algum lote já tiver sido consumido."
            : "Sua solicitação será enviada ao gestor para aprovação."
        }
        confirmLabel={canRevertDirect ? "Confirmar estorno" : "Enviar solicitação"}
        destructive
        pending={revertMutation.isPending || requestRevertMutation.isPending}
        onConfirm={(reason) => {
          if (!confirmRevertId) return;
          if (canRevertDirect) revertMutation.mutate({ movementId: confirmRevertId, reason });
          else requestRevertMutation.mutate({ movementId: confirmRevertId, reason });
        }}
      />
    </div>
  );
}
