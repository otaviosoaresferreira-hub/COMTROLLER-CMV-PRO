import { useQuery } from "@tanstack/react-query";
import { fetchEntityAuditLog, type AuditLogRow, type AuditAction } from "@/lib/audit-log";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

const ACTION_LABEL: Record<AuditAction, string> = {
  create: "Criado",
  update: "Editado",
  delete: "Excluído",
  revert: "Estornado",
  restore: "Restaurado",
  request: "Solicitação",
  approve: "Aprovado",
  reject: "Rejeitado",
};

const ACTION_VARIANT: Record<AuditAction, "default" | "secondary" | "destructive" | "outline"> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
  revert: "destructive",
  restore: "outline",
  request: "outline",
  approve: "default",
  reject: "destructive",
};

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString("pt-BR");
  } catch {
    return dt;
  }
}

function diffPreview(old: unknown, next: unknown): string | null {
  if (!old && !next) return null;
  try {
    const o = (old ?? {}) as Record<string, unknown>;
    const n = (next ?? {}) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]));
    const parts: string[] = [];
    for (const k of keys) {
      const a = JSON.stringify(o[k]);
      const b = JSON.stringify(n[k]);
      if (a !== b) parts.push(`${k}: ${a ?? "—"} → ${b ?? "—"}`);
    }
    return parts.length ? parts.slice(0, 4).join(" · ") : null;
  } catch {
    return null;
  }
}

export function AuditHistory({
  entityType,
  entityId,
  emptyLabel = "Nenhuma alteração registrada ainda.",
}: {
  entityType: string;
  entityId: string;
  emptyLabel?: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", entityType, entityId],
    queryFn: () => fetchEntityAuditLog(entityType, entityId),
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando histórico…
      </div>
    );
  }

  const rows = (data ?? []) as AuditLogRow[];
  if (!rows.length) {
    return <p className="text-xs text-muted-foreground py-4">{emptyLabel}</p>;
  }

  return (
    <ScrollArea className="max-h-80">
      <ul className="space-y-2">
        {rows.map((r) => {
          const diff = diffPreview(r.old_value, r.new_value);
          return (
            <li
              key={r.id}
              className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={ACTION_VARIANT[r.action] ?? "outline"}>
                  {ACTION_LABEL[r.action] ?? r.action}
                </Badge>
                <span className="text-muted-foreground">{fmt(r.created_at)}</span>
                {r.user_email && (
                  <span className="text-foreground/80">por {r.user_email}</span>
                )}
              </div>
              {r.reason && (
                <p className="mt-1 text-foreground">
                  <span className="font-medium">Motivo:</span> {r.reason}
                </p>
              )}
              {diff && <p className="mt-1 text-muted-foreground">{diff}</p>}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
