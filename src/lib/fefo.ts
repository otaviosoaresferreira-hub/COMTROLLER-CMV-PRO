import { supabase } from "@/integrations/supabase/client";

/**
 * Consome `qty` do item via FEFO (validade mais próxima primeiro).
 * Atualiza item_batches.current_qty no servidor e retorna a quebra por lote.
 * NOTA: o caller deve continuar atualizando stock_levels separadamente —
 * esta função apenas baixa os lotes para manter rastreabilidade.
 */
export async function consumeFefo(itemId: string, qty: number) {
  if (!(qty > 0)) return [];
  const { data, error } = await supabase.rpc("consume_stock_fefo", {
    _item_id: itemId,
    _qty: qty,
  });
  if (error) throw new Error(`FEFO: ${error.message}`);
  return (data ?? []) as Array<{
    batch_id: string;
    taken: number;
    unit_cost: number;
    expiry_date: string | null;
  }>;
}

/**
 * Consome `units` do item via FEFO usando o **peso real de cada lote**
 * (avg_weight_g do lote específico) para converter UN → KG.
 *
 * Use quando o usuário informar uma quantidade em UNIDADES e o estoque
 * for armazenado em KG (item shared_unit_enabled). Retorna a quebra por
 * lote com units_taken e o KG real consumido (peso ponderado por lote).
 *
 * IMPORTANTE: o caller é responsável por atualizar stock_levels com a
 * SOMA de kg_taken devolvida (não com `units * avg_global`).
 */
export async function consumeFefoUnits(itemId: string, units: number) {
  if (!(units > 0)) return [];
  const { data, error } = await supabase.rpc("consume_stock_fefo_units", {
    _item_id: itemId,
    _units: units,
  });
  if (error) throw new Error(`FEFO (units): ${error.message}`);
  return (data ?? []) as Array<{
    batch_id: string;
    units_taken: number;
    kg_taken: number;
    unit_cost: number;
    expiry_date: string | null;
  }>;
}

/**
 * Helper unificado: dada a quantidade e a unidade DIGITADA pelo usuário
 * (UN ou KG) e a unidade BASE armazenada no item, decide qual RPC FEFO
 * usar e retorna o KG REAL consumido (somado entre lotes) para que o
 * caller atualize `stock_levels` com o valor correto.
 *
 * Regras:
 * - Item em KG + usuário digitou em KG → `consumeFefo` em KG.
 *   `realBaseTaken = soma(taken)`.
 * - Item em KG + usuário digitou em UN → `consumeFefoUnits` (peso real
 *   por lote). `realBaseTaken = soma(kg_taken)`.
 * - Item em UN + usuário digitou em UN → `consumeFefo` em UN.
 *   `realBaseTaken = soma(taken)`.
 * - Item em UN + usuário digitou em KG → fallback: converte usando
 *   `avg_weight_g` global e chama `consumeFefo` em UN.
 *
 * Devolve `realBaseTaken` na unidade BASE do item (kg se item.unit==='kg',
 * un caso contrário). Se nenhum lote rastreado existir, devolve a própria
 * quantidade base estimada (para não quebrar o fluxo legado).
 */
export async function consumeStockReal(opts: {
  itemId: string;
  qty: number;
  inputUnit: "kg" | "un";
  itemBaseUnit: "kg" | "un";
  /** Peso médio global em gramas — usado só como fallback. */
  avgWeightG?: number;
}): Promise<{ realBaseTaken: number; usedRealPerBatch: boolean }> {
  const { itemId, qty, inputUnit, itemBaseUnit, avgWeightG = 0 } = opts;
  if (!(qty > 0)) return { realBaseTaken: 0, usedRealPerBatch: false };

  // Caso A: KG ↔ KG
  if (itemBaseUnit === "kg" && inputUnit === "kg") {
    const rows = await consumeFefo(itemId, qty);
    const taken = rows.reduce((acc, r) => acc + Number(r.taken ?? 0), 0);
    return { realBaseTaken: taken > 0 ? taken : qty, usedRealPerBatch: false };
  }

  // Caso B: estoque em KG mas usuário digitou em UN → peso real por lote
  if (itemBaseUnit === "kg" && inputUnit === "un") {
    const rows = await consumeFefoUnits(itemId, qty);
    const kg = rows.reduce((acc, r) => acc + Number(r.kg_taken ?? 0), 0);
    if (kg > 0) return { realBaseTaken: kg, usedRealPerBatch: true };
    // Fallback (sem lote rastreado): usa peso médio global
    const avgKg = avgWeightG > 0 ? avgWeightG / 1000 : 0;
    return { realBaseTaken: qty * avgKg, usedRealPerBatch: false };
  }

  // Caso C: UN ↔ UN
  if (itemBaseUnit === "un" && inputUnit === "un") {
    const rows = await consumeFefo(itemId, qty);
    const taken = rows.reduce((acc, r) => acc + Number(r.taken ?? 0), 0);
    return { realBaseTaken: taken > 0 ? taken : qty, usedRealPerBatch: false };
  }

  // Caso D: estoque em UN mas usuário digitou em KG → fallback global
  const avgKg = avgWeightG > 0 ? avgWeightG / 1000 : 0;
  const unitsEstimate = avgKg > 0 ? qty / avgKg : qty;
  const rows = await consumeFefo(itemId, unitsEstimate);
  const taken = rows.reduce((acc, r) => acc + Number(r.taken ?? 0), 0);
  return {
    realBaseTaken: taken > 0 ? taken : unitsEstimate,
    usedRealPerBatch: false,
  };
}
