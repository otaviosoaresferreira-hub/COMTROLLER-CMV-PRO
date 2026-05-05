import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, PackageSearch, ShieldAlert, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useManagerMode } from "@/lib/manager-mode";
import { writeAuditLog } from "@/lib/audit-log";
import { useOrgId } from "@/lib/use-org-id";

type DiscRow = {
  id: string;
  kind: "shortage" | "surplus";
  expected_qty: number;
  counted_qty: number;
  delta_qty: number;
  display_unit: string;
  status: "pending" | "resolved" | "loss" | "identified";
  central_location_id: string;
  item_id: string;
  created_at: string;
  items: { id: string; name: string; unit: string } | null;
};

type AuditAgg = {
  discrepancy_id: string;
  total: number;
  pending: number;
  counted_sum: number;
  not_found: number;
};

const fmt = (n: number) =>
  Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export function DiscrepancyPanel() {
  const qc = useQueryClient();
  const { isManager } = useManagerMode();
  const orgId = useOrgId();

  const { data: discs = [], isLoading } = useQuery({
    queryKey: ["inventory-discrepancies", "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_discrepancies")
        .select(
          "id,kind,expected_qty,counted_qty,delta_qty,display_unit,status,central_location_id,item_id,created_at,items(id,name,unit)",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DiscRow[];
    },
  });

  const ids = useMemo(() => discs.map((d) => d.id), [discs]);

  const { data: audits = [] } = useQuery({
    enabled: ids.length > 0,
    queryKey: ["inventory-discrepancies", "audits", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_discrepancy_audits")
        .select("discrepancy_id,status,counted_qty")
        .in("discrepancy_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const aggByDisc = useMemo(() => {
    const m: Record<string, AuditAgg> = {};
    for (const a of audits) {
      const e = (m[a.discrepancy_id] ??= {
        discrepancy_id: a.discrepancy_id,
        total: 0,
        pending: 0,
        counted_sum: 0,
        not_found: 0,
      });
      e.total += 1;
      if (a.status === "pending") e.pending += 1;
      else if (a.status === "counted") e.counted_sum += Number(a.counted_qty ?? 0);
      else if (a.status === "not_found") e.not_found += 1;
    }
    return m;
  }, [audits]);

  const closeAsLossMutation = useMutation({
    mutationFn: async (d: DiscRow) => {
      // Registra movimento de perda no Estoque Central com a quantidade faltante
      const qty = Math.abs(Number(d.delta_qty) || 0);
      if (qty > 0) {
        const { error: eMov } = await supabase.from("movements").insert({
          item_id: d.item_id,
          from_location_id: d.central_location_id,
          to_location_id: null,
          quantity: qty,
          type: "adjustment",
          note: `Perda por Extravio (Auditoria de Inventário) (${d.display_unit})`,
          reason_category: "inventory_loss",
        });
        if (eMov) throw eMov;
      }
      const { error } = await supabase
        .from("inventory_discrepancies")
        .update({
          status: "loss",
          resolved_at: new Date().toISOString(),
          resolution_note: "Encerrado como perda por extravio",
        })
        .eq("id", d.id);
      if (error) throw error;
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "inventory",
          entityType: "inventory_discrepancy",
          entityId: d.id,
          action: "update",
          reason: "Encerramento como perda por extravio",
          newValue: { status: "loss", qty },
        });
      }
    },
    onSuccess: () => {
      toast.success("Divergência encerrada como perda.");
      qc.invalidateQueries({ queryKey: ["inventory-discrepancies"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markResolvedMutation = useMutation({
    mutationFn: async ({ d, status }: { d: DiscRow; status: "resolved" | "identified" }) => {
      const { error } = await supabase
        .from("inventory_discrepancies")
        .update({
          status,
          resolved_at: new Date().toISOString(),
          resolution_note:
            status === "identified"
              ? "Entrada não identificada conferida"
              : "Divergência resolvida",
        })
        .eq("id", d.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Divergência atualizada.");
      qc.invalidateQueries({ queryKey: ["inventory-discrepancies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return null;
  if (discs.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Alertas de Divergência ({discs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {discs.map((d) => {
          const isShortage = d.kind === "shortage";
          const agg = aggByDisc[d.id];
          return (
            <div
              key={d.id}
              className={cn(
                "rounded-xl border p-3",
                isShortage
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-violet-500/40 bg-violet-500/5",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {isShortage ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : (
                  <PackageSearch className="h-4 w-4 text-violet-500" />
                )}
                <span className="font-medium capitalize">
                  {d.items?.name ?? "Item"}
                </span>
                <Badge
                  variant={isShortage ? "destructive" : "secondary"}
                  className={cn(
                    !isShortage && "bg-violet-500/15 text-violet-700 dark:text-violet-300",
                  )}
                >
                  {isShortage
                    ? "Solicitação de Auditoria em Andamento"
                    : "Entrada não Identificada"}
                </Badge>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  Esperado {fmt(d.expected_qty)} · Contado {fmt(d.counted_qty)} ·{" "}
                  <strong className={isShortage ? "text-destructive" : "text-violet-600"}>
                    {d.delta_qty > 0 ? "+" : ""}
                    {fmt(d.delta_qty)} {d.display_unit}
                  </strong>
                </span>
              </div>
              {isShortage && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {agg
                    ? `${agg.total - agg.pending}/${agg.total} unidades responderam · ${fmt(agg.counted_sum)} ${d.display_unit} localizado(s)${agg.not_found > 0 ? ` · ${agg.not_found} não localizou` : ""}`
                    : "Aguardando contagens das unidades."}
                </p>
              )}
              {!isShortage && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Verifique se há notas fiscais pendentes de entrada para este item.
                </p>
              )}
              {isManager && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {isShortage ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={closeAsLossMutation.isPending}
                      onClick={() => closeAsLossMutation.mutate(d)}
                    >
                      {closeAsLossMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldAlert className="mr-2 h-4 w-4" />
                      )}
                      Encerrar como Perda
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markResolvedMutation.isPending}
                      onClick={() => markResolvedMutation.mutate({ d, status: "identified" })}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Marcar como conferido
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={markResolvedMutation.isPending}
                    onClick={() => markResolvedMutation.mutate({ d, status: "resolved" })}
                  >
                    Resolver sem ajuste
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
