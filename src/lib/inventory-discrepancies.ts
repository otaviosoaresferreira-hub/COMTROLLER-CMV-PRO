import { supabase } from "@/integrations/supabase/client";

export type DiscrepancyKind = "shortage" | "surplus";
export type DiscrepancyStatus = "pending" | "resolved" | "loss" | "identified";
export type AuditStatus = "pending" | "counted" | "not_found";

export type Discrepancy = {
  id: string;
  org_id: string;
  count_id: string;
  item_id: string;
  central_location_id: string;
  kind: DiscrepancyKind;
  expected_qty: number;
  counted_qty: number;
  delta_qty: number;
  display_unit: string;
  status: DiscrepancyStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type DiscrepancyAudit = {
  id: string;
  discrepancy_id: string;
  location_id: string;
  status: AuditStatus;
  counted_qty: number | null;
  counted_at: string | null;
  counted_by: string | null;
  note: string | null;
  created_at: string;
};

/**
 * Para um item, descobre quais unidades/operações tiveram movimentação
 * nos últimos N dias. Usado para escopar o alerta de auditoria.
 */
export async function findRecentlyActiveLocations(
  itemIds: string[],
  excludeLocationId: string,
  days = 14,
): Promise<Record<string, string[]>> {
  if (itemIds.length === 0) return {};
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("movements")
    .select("item_id,from_location_id,to_location_id")
    .in("item_id", itemIds)
    .gte("created_at", since);
  if (error) throw error;
  const map: Record<string, Set<string>> = {};
  for (const m of data ?? []) {
    for (const loc of [m.from_location_id, m.to_location_id]) {
      if (!loc || loc === excludeLocationId) continue;
      (map[m.item_id] ??= new Set()).add(loc);
    }
  }
  // fallback: locais com saldo > 0 do item
  const { data: stock, error: e2 } = await supabase
    .from("stock_levels")
    .select("item_id,location_id,current_stock")
    .in("item_id", itemIds)
    .gt("current_stock", 0);
  if (e2) throw e2;
  for (const s of stock ?? []) {
    if (s.location_id === excludeLocationId) continue;
    (map[s.item_id] ??= new Set()).add(s.location_id);
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(map)) out[k] = Array.from(v);
  return out;
}
