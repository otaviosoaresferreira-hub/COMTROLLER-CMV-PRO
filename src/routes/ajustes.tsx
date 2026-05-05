import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useManagerMode } from "@/lib/manager-mode";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  KIND_LABEL,
  applyAdjustmentRequest,
  type AdjustmentRequest,
} from "@/lib/adjustment-requests";
import { Check, X, ShieldAlert, ClipboardCheck } from "lucide-react";
import { writeAuditLog } from "@/lib/audit-log";
import { useOrgId } from "@/lib/use-org-id";

export const Route = createFileRoute("/ajustes")({
  component: AjustesPage,
});

type Tab = "pending" | "history";

function fmtDate(s: string) {
  return new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function ValueDiff({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  return (
    <div className="space-y-1 text-xs">
      {keys.map((k) => {
        const b = before?.[k];
        const a = after?.[k];
        if (b === undefined && a === undefined) return null;
        return (
          <div key={k} className="flex items-baseline gap-2 tabular-nums">
            <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</span>
            <span className="line-through text-muted-foreground">{formatVal(b)}</span>
            <span>→</span>
            <span className="font-semibold text-foreground">{formatVal(a)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

function AjustesPage() {
  const { user } = useAuth();
  const { isManager, enable } = useManagerMode();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const [tab, setTab] = useState<Tab>("pending");
  const [pwd, setPwd] = useState("");
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});

  const { data: requests, isLoading } = useQuery({
    queryKey: ["adjustment-requests"],
    enabled: isManager,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("adjustment_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as AdjustmentRequest[];
    },
  });

  // Carrega nomes de itens para exibir
  const itemIds = useMemo(
    () => Array.from(new Set((requests ?? []).map((r) => r.item_id).filter((x): x is string => !!x))),
    [requests],
  );
  const { data: items } = useQuery({
    queryKey: ["adjustment-requests-items", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("items").select("id,name").in("id", itemIds);
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((i) => map.set(i.id, i.name));
      return map;
    },
  });

  const decide = useMutation({
    mutationFn: async (vars: { req: AdjustmentRequest; approve: boolean; note?: string }) => {
      const { req, approve, note } = vars;
      if (approve) {
        await applyAdjustmentRequest(req, user?.email ?? null);
      }
      const { error } = await supabase
        .from("adjustment_requests")
        .update({
          status: approve ? "approved" : "rejected",
          reviewed_by: user?.id ?? null,
          reviewer_email: user?.email ?? null,
          reviewed_at: new Date().toISOString(),
          applied_at: approve ? new Date().toISOString() : null,
          review_note: note?.trim() || null,
        } as never)
        .eq("id", req.id);
      if (error) throw error;
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "adjustment_requests",
          entityType: "adjustment_request",
          entityId: req.id,
          action: approve ? "approve" : "reject",
          reason: note?.trim() || req.justification,
          oldValue: req.current_value,
          newValue: req.new_value,
          metadata: { kind: req.kind, item_id: req.item_id, batch_id: req.batch_id },
        });
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? "Ajuste aprovado e aplicado" : "Solicitação recusada");
      qc.invalidateQueries({ queryKey: ["adjustment-requests"] });
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["item-batches"] });
      qc.invalidateQueries({ queryKey: ["item-extract"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isManager) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4" /> Modo Gestor obrigatório
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Esta tela é exclusiva do perfil Gestor. Informe a senha para liberar.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              placeholder="Senha do gestor"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
            <Button
              onClick={() => {
                if (!enable(pwd)) toast.error("Senha incorreta");
                else toast.success("Modo Gestor ativado");
              }}
            >
              Entrar
            </Button>
          </div>
          <div className="mt-3">
            <Link to="/" className="text-xs underline text-muted-foreground">Voltar ao Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  const list = (requests ?? []).filter((r) =>
    tab === "pending" ? r.status === "pending" : r.status !== "pending",
  );

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-4 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Solicitações de Ajuste</h1>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="pending">
            Pendentes
            {requests && requests.filter((r) => r.status === "pending").length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {requests.filter((r) => r.status === "pending").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-3">
          {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
          {!isLoading && list.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {tab === "pending" ? "Nenhuma solicitação pendente." : "Nenhum registro no histórico."}
            </p>
          )}
          {list.map((r) => {
            const itemName = r.item_id ? items?.get(r.item_id) ?? "(item)" : "—";
            const note = reviewNote[r.id] ?? "";
            return (
              <article
                key={r.id}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{KIND_LABEL[r.kind]}</Badge>
                      {r.status === "approved" && (
                        <Badge className="bg-green-600 hover:bg-green-600">Aprovado</Badge>
                      )}
                      {r.status === "rejected" && (
                        <Badge variant="destructive">Recusado</Badge>
                      )}
                      {r.status === "pending" && <Badge variant="secondary">Pendente</Badge>}
                    </div>
                    <p className="text-sm font-semibold">{itemName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Solicitado por <span className="font-medium">{r.requester_email ?? "—"}</span>{" "}
                      em {fmtDate(r.created_at)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Mudanças
                    </p>
                    <ValueDiff before={r.current_value} after={r.new_value} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Justificativa
                    </p>
                    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                      {r.justification}
                    </p>
                    {r.status !== "pending" && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {r.status === "approved" ? "Aprovado" : "Recusado"} por{" "}
                        <span className="font-medium">{r.reviewer_email ?? "—"}</span>
                        {r.reviewed_at ? ` em ${fmtDate(r.reviewed_at)}` : ""}
                        {r.review_note ? ` — ${r.review_note}` : ""}
                      </p>
                    )}
                  </div>
                </div>

                {r.status === "pending" && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <Textarea
                      rows={2}
                      placeholder="Observação do gestor (opcional)"
                      value={note}
                      onChange={(e) =>
                        setReviewNote((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ req: r, approve: false, note })}
                      >
                        <X className="mr-1 h-4 w-4" /> Recusar
                      </Button>
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ req: r, approve: true, note })}
                      >
                        <Check className="mr-1 h-4 w-4" /> Aprovar
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
