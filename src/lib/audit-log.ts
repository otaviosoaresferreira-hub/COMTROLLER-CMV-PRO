import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "revert"
  | "restore"
  | "request"
  | "approve"
  | "reject";

export type AuditLogInput = {
  orgId: string;
  module: string;          // ex: 'movements', 'item_batches', 'items', 'recipes', 'processing'
  entityType: string;      // ex: 'movement', 'batch', 'item'
  entityId?: string | null;
  action: AuditAction;
  reason?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
};

/**
 * Insere um registro imutável em `audit_logs`.
 * Falhas são logadas no console mas NÃO interrompem o fluxo principal —
 * auditoria nunca pode quebrar uma ação do usuário.
 */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const u = userData?.user ?? null;

    const { error } = await supabase.from("audit_logs").insert({
      org_id: input.orgId,
      user_id: u?.id ?? null,
      user_email: u?.email ?? null,
      module: input.module,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      action: input.action,
      reason: input.reason ?? null,
      old_value: (input.oldValue ?? null) as never,
      new_value: (input.newValue ?? null) as never,
      metadata: (input.metadata ?? {}) as never,
    });
    if (error) console.warn("[audit-log] insert failed:", error.message);
  } catch (err) {
    console.warn("[audit-log] unexpected error:", err);
  }
}

export type AuditLogRow = {
  id: string;
  created_at: string;
  user_email: string | null;
  module: string;
  entity_type: string;
  entity_id: string | null;
  action: AuditAction;
  reason: string | null;
  old_value: unknown;
  new_value: unknown;
  metadata: Record<string, unknown> | null;
};

/** Lista o histórico cronológico (mais recente primeiro) de um registro específico. */
export async function fetchEntityAuditLog(
  entityType: string,
  entityId: string,
): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      "id, created_at, user_email, module, entity_type, entity_id, action, reason, old_value, new_value, metadata",
    )
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}
