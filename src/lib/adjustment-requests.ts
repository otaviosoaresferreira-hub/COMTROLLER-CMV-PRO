import { supabase } from "@/integrations/supabase/client";

export type AdjustmentKind =
  | "stock_adjustment"
  | "batch_edit"
  | "expiry"
  | "batch_expiry"
  | "item_edit"
  | "processing_revert";

export type AdjustmentRequestInput = {
  kind: AdjustmentKind;
  itemId?: string | null;
  batchId?: string | null;
  locationId?: string | null;
  currentValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  justification: string;
};

export async function createAdjustmentRequest(input: AdjustmentRequestInput) {
  const justification = (input.justification ?? "").trim();
  if (!justification) throw new Error("Justificativa obrigatória");

  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) throw new Error("Usuário não autenticado");

  const { error } = await supabase.from("adjustment_requests").insert({
    kind: input.kind,
    item_id: input.itemId ?? null,
    batch_id: input.batchId ?? null,
    location_id: input.locationId ?? null,
    current_value: input.currentValue ?? {},
    new_value: input.newValue ?? {},
    justification,
    requested_by: user.id,
    requester_email: user.email ?? null,
  } as never);
  if (error) throw new Error(error.message);
}

export type AdjustmentRequest = {
  id: string;
  kind: AdjustmentKind;
  item_id: string | null;
  batch_id: string | null;
  location_id: string | null;
  current_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  justification: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requester_email: string | null;
  reviewed_by: string | null;
  reviewer_email: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
};

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
};

/**
 * Aplica a mudança aprovada e gera log em movements (Ajuste Administrativo).
 * Roda APENAS após aprovação do gestor.
 */
export async function applyAdjustmentRequest(req: AdjustmentRequest, reviewerEmail: string | null) {
  if (req.kind === "stock_adjustment") {
    const itemId = req.item_id!;
    const locationId = req.location_id!;
    const currentKg = num(req.current_value.current_stock);
    const targetKg = num(req.new_value.current_stock);
    const delta = targetKg - currentKg;

    const { error: e1 } = await supabase
      .from("stock_levels")
      .upsert(
        {
          item_id: itemId,
          location_id: locationId,
          current_stock: targetKg,
          expiry_date: str(req.new_value.expiry_date) ?? str(req.current_value.expiry_date),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "item_id,location_id" },
      );
    if (e1) throw e1;

    // Se a solicitação trouxe payload de batch (modo divergente / unidades), aplicar.
    if (req.new_value.batches_replace === true) {
      const { error: eDel } = await supabase.from("item_batches").delete().eq("item_id", itemId);
      if (eDel) throw eDel;

      const unitsQty = num(req.new_value.units_qty);
      const totalWeightG = num(req.new_value.total_weight_g);
      const avgG = num(req.new_value.avg_weight_g);
      if (totalWeightG > 0 || unitsQty > 0) {
        const { error: eIns } = await supabase.from("item_batches").insert({
          item_id: itemId,
          source: "adjustment",
          units_qty: unitsQty,
          total_weight_g: totalWeightG,
          avg_weight_g: avgG,
          note: `Ajuste Administrativo — aprovado por ${reviewerEmail ?? "gestor"}`,
        });
        if (eIns) throw eIns;
      }
      if (avgG > 0) {
        const { error: eAvg } = await supabase
          .from("items")
          .update({ avg_weight_g: avgG })
          .eq("id", itemId);
        if (eAvg) throw eAvg;
      }
    }

    const { error: eMv } = await supabase.from("movements").insert({
      item_id: itemId,
      from_location_id: delta < 0 ? locationId : null,
      to_location_id: delta > 0 ? locationId : null,
      quantity: Math.abs(delta),
      type: "adjustment",
      note: `Ajuste Administrativo — ${req.justification} (aprovado por ${reviewerEmail ?? "gestor"})`,
    });
    if (eMv) throw eMv;
    return;
  }

  if (req.kind === "batch_edit") {
    const batchId = req.batch_id!;
    const payload: Record<string, unknown> = {};
    [
      "lot_number",
      "current_qty",
      "avg_weight_g",
      "total_weight_g",
      "unit_cost",
      "expiry_date",
    ].forEach((k) => {
      if (k in req.new_value) payload[k] = req.new_value[k];
    });
    payload.edited_at = new Date().toISOString();
    const { error } = await supabase
      .from("item_batches")
      .update(payload as never)
      .eq("id", batchId);
    if (error) throw error;

    if (req.item_id) {
      await supabase.from("movements").insert({
        item_id: req.item_id,
        type: "adjustment",
        quantity: 0,
        note: `Ajuste Administrativo (lote) — ${req.justification} (aprovado por ${reviewerEmail ?? "gestor"})`,
      });
    }
    return;
  }

  if (req.kind === "expiry") {
    const itemId = req.item_id!;
    const locationId = req.location_id!;
    const newExpiry = str(req.new_value.expiry_date);
    const { error } = await supabase
      .from("stock_levels")
      .upsert(
        {
          item_id: itemId,
          location_id: locationId,
          current_stock: num(req.current_value.current_stock),
          expiry_date: newExpiry,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "item_id,location_id" },
      );
    if (error) throw error;
    await supabase.from("movements").insert({
      item_id: itemId,
      type: "adjustment",
      quantity: 0,
      note: `Ajuste Administrativo (validade) — ${req.justification} (aprovado por ${reviewerEmail ?? "gestor"})`,
    });
    return;
  }

  if (req.kind === "item_edit") {
    const itemId = req.item_id!;
    const allowed = [
      "name",
      "unit",
      "category_id",
      "shared_unit_enabled",
      "standard_weight_g",
      "avg_weight_g",
      "min_stock",
      "is_operational",
      "contabiliza_cmv",
      "cost_price",
    ];
    const payload: Record<string, unknown> = {};
    allowed.forEach((k) => {
      if (k in req.new_value) payload[k] = req.new_value[k];
    });
    if (Object.keys(payload).length > 0) {
      const { error } = await supabase
        .from("items")
        .update(payload as never)
        .eq("id", itemId);
      if (error) throw error;
    }
    await supabase.from("movements").insert({
      item_id: itemId,
      type: "adjustment",
      quantity: 0,
      note: `Ajuste Administrativo (cadastro) — ${req.justification} (aprovado por ${reviewerEmail ?? "gestor"})`,
    });
    return;
  }

  if (req.kind === "processing_revert") {
    const movementId = String(req.new_value.movement_id ?? "");
    if (!movementId) throw new Error("Solicitação sem movement_id");
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError || !authData.session?.access_token) {
      throw new Error("Sessão expirada — entre novamente para aprovar.");
    }
    const { revertProductionMovement } = await import("@/server/movements.functions");
    await revertProductionMovement({
      data: { movementId },
      headers: { Authorization: `Bearer ${authData.session.access_token}` },
    });
    return;
  }

  throw new Error(`Tipo de solicitação não suportado: ${req.kind}`);
}

export const KIND_LABEL: Record<AdjustmentKind, string> = {
  stock_adjustment: "Ajuste de Saldo",
  batch_edit: "Edição de Lote",
  expiry: "Validade do Item",
  batch_expiry: "Validade de Lote",
  item_edit: "Edição de Insumo",
  processing_revert: "Estorno de Processamento",
};
