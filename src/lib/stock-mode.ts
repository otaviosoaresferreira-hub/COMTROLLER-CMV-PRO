import { supabase } from "@/integrations/supabase/client";
import { CENTRAL_LOCATION_NAME } from "@/lib/stock-constants";

/**
 * Modo de baixa de uma operação.
 * - traditional: consome do saldo da própria operação (comportamento padrão).
 * - direct ("Venda Direta"): consome direto do Estoque Central, ignorando
 *   o saldo local da operação. Reduz o atrito operacional, mas perde a
 *   distinção entre perdas no centro de produção e perdas na ponta.
 */
export type StockMode = "traditional" | "direct";

export type LocationLite = {
  id: string;
  name: string;
  stock_mode?: StockMode | null;
};

/** True quando a operação opera em modo Venda Direta. */
export function isDirectMode(loc: LocationLite | null | undefined): boolean {
  return (loc?.stock_mode ?? "traditional") === "direct";
}

/**
 * Encontra o id do Estoque Central numa lista de locais já carregada.
 * Use sempre a versão em-memória quando possível para evitar round-trip.
 */
export function findCentralId(locations: readonly LocationLite[] | null | undefined): string | null {
  if (!locations) return null;
  const target = CENTRAL_LOCATION_NAME.trim().toLowerCase();
  return (
    locations.find((l) => String(l?.name ?? "").trim().toLowerCase() === target)?.id ?? null
  );
}

/**
 * Resolve o location_id que deve receber a baixa para um (operação, item)
 * considerando: modo da operação + override por item (skip_auto_deduction).
 *
 * Retorna:
 * - { skip: true } quando o item está marcado para PULAR baixa automática
 *   (típico de bebidas/trocas) — caller não deve gravar movimento nem
 *   alterar stock_levels.
 * - { skip: false, locationId } com o local físico que sofrerá a baixa.
 *   Em modo "direct" e sem override, devolve o id do Estoque Central.
 */
export type ResolveResult =
  | { skip: true }
  | { skip: false; locationId: string; usedCentral: boolean };

export function resolveStockTarget(
  operation: LocationLite,
  itemId: string,
  centralId: string | null,
  overrides: ReadonlyMap<string, boolean>,
): ResolveResult {
  // Override por item sempre vence — permite "manter bebidas limpas".
  if (overrides.get(itemId) === true) return { skip: true };
  if (isDirectMode(operation) && centralId) {
    return { skip: false, locationId: centralId, usedCentral: true };
  }
  return { skip: false, locationId: operation.id, usedCentral: false };
}

/**
 * Carrega o mapa de overrides (item_id → skip_auto_deduction) para uma
 * operação. Mapa vazio quando não houver overrides cadastrados.
 */
export async function loadStockOverrides(locationId: string): Promise<Map<string, boolean>> {
  const { data, error } = await supabase
    .from("location_item_stock_overrides")
    .select("item_id,skip_auto_deduction")
    .eq("location_id", locationId);
  if (error) throw error;
  const map = new Map<string, boolean>();
  (data ?? []).forEach((row) => {
    map.set(String(row.item_id), row.skip_auto_deduction === true);
  });
  return map;
}
