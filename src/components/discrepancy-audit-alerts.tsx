import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ClipboardCheck, Loader2, PackageSearch, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AuditRow = {
  id: string;
  status: "pending" | "counted" | "not_found";
  discrepancy_id: string;
  inventory_discrepancies: {
    id: string;
    item_id: string;
    kind: "shortage" | "surplus";
    expected_qty: number;
    counted_qty: number;
    delta_qty: number;
    display_unit: string;
    status: string;
    items: { id: string; name: string; unit: string } | null;
  } | null;
};

export function DiscrepancyAuditAlerts({ locationId }: { locationId: string }) {
  const qc = useQueryClient();
  const [openAudit, setOpenAudit] = useState<AuditRow | null>(null);
  const [count, setCount] = useState("");

  const { data: audits = [] } = useQuery({
    queryKey: ["discrepancy-audits", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_discrepancy_audits")
        .select(
          "id,status,discrepancy_id,inventory_discrepancies!inner(id,item_id,kind,expected_qty,counted_qty,delta_qty,display_unit,status,items(id,name,unit))",
        )
        .eq("location_id", locationId)
        .eq("status", "pending");
      if (error) throw error;
      return ((data ?? []) as unknown as AuditRow[]).filter(
        (a) => a.inventory_discrepancies?.status === "pending",
      );
    },
    refetchInterval: 30_000,
  });

  const submitMutation = useMutation({
    mutationFn: async ({ audit, qty, notFound }: { audit: AuditRow; qty: number; notFound: boolean }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("inventory_discrepancy_audits")
        .update({
          status: notFound ? "not_found" : "counted",
          counted_qty: notFound ? 0 : qty,
          counted_at: new Date().toISOString(),
          counted_by: userData?.user?.id ?? null,
        })
        .eq("id", audit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contagem registrada. Obrigado!");
      qc.invalidateQueries({ queryKey: ["discrepancy-audits"] });
      setOpenAudit(null);
      setCount("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (audits.length === 0) return null;

  return (
    <>
      <section className="space-y-2">
        {audits.map((a) => {
          const d = a.inventory_discrepancies!;
          const item = d.items;
          const isShortage = d.kind === "shortage";
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setOpenAudit(a);
                setCount("");
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border p-4 text-left shadow-sm transition-colors",
                isShortage
                  ? "border-destructive/40 bg-destructive/10 hover:bg-destructive/15"
                  : "border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/15",
              )}
            >
              <div
                className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                  isShortage
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-violet-600 text-white",
                )}
              >
                {isShortage ? <AlertTriangle className="h-5 w-5" /> : <PackageSearch className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {isShortage ? "Auditoria de Item solicitada" : "Possível sobra a verificar"}
                </p>
                <p className="truncate text-sm font-semibold">
                  {item?.name ?? "Item"}
                </p>
                <p className="text-xs opacity-80">
                  {isShortage
                    ? "Conte rapidamente o que há nesta unidade."
                    : "Verifique se este item entrou aqui sem registro."}
                </p>
              </div>
              <ClipboardCheck className="h-5 w-5 opacity-70" />
            </button>
          );
        })}
      </section>

      <Dialog
        open={!!openAudit}
        onOpenChange={(v) => {
          if (!v) {
            setOpenAudit(null);
            setCount("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              Contagem rápida
            </DialogTitle>
            <DialogDescription>
              Quanto há agora deste item nesta unidade?
            </DialogDescription>
          </DialogHeader>
          {openAudit && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Item
                </p>
                <p className="text-lg font-semibold capitalize leading-tight">
                  {openAudit.inventory_discrepancies?.items?.name ?? "Item"}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Quantidade contada (
                  {openAudit.inventory_discrepancies?.items?.unit ?? "un"})
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0"
                  autoFocus
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="0"
                  className="h-12 text-right text-2xl"
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={submitMutation.isPending}
              onClick={() => {
                if (!openAudit) return;
                submitMutation.mutate({ audit: openAudit, qty: 0, notFound: true });
              }}
            >
              <X className="mr-2 h-4 w-4" />
              Não localizei
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={submitMutation.isPending || count.trim() === ""}
              onClick={() => {
                if (!openAudit) return;
                const n = Number(count.replace(",", "."));
                if (!Number.isFinite(n) || n < 0) {
                  toast.error("Informe uma quantidade válida.");
                  return;
                }
                submitMutation.mutate({ audit: openAudit, qty: n, notFound: false });
              }}
            >
              {submitMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-2 h-4 w-4" />
              )}
              Confirmar contagem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
