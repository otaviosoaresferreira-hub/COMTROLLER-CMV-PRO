import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Estorna uma movimentação de Ajuste de Inventário (type = 'adjustment').
 */
export const revertAdjustmentMovement = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ movementId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { movementId } = data;

    const { data: mov, error: eMov } = await supabaseAdmin
      .from("movements")
      .select("*")
      .eq("id", movementId)
      .single();
    if (eMov) throw new Error(eMov.message);
    if (!mov) throw new Error("Movimentação não encontrada");
    if (mov.type !== "adjustment")
      throw new Error("Apenas ajustes de inventário podem ser estornados por aqui");
    if (mov.status === "reverted") throw new Error("Movimentação já estornada");

    const locationId = (mov.from_location_id ?? mov.to_location_id) as string | null;
    if (!locationId) throw new Error("Movimentação sem localização associada");

    const isLoss = !!mov.from_location_id;
    const qty = Number(mov.quantity ?? 0);
    const reverseDelta = isLoss ? qty : -qty;

    const { data: lvlRow, error: eLvl } = await supabaseAdmin
      .from("stock_levels")
      .select("current_stock")
      .eq("item_id", mov.item_id)
      .eq("location_id", locationId)
      .maybeSingle();
    if (eLvl) throw new Error(eLvl.message);

    const currentStock = Number(lvlRow?.current_stock ?? 0);
    const restoredStock = Math.max(0, currentStock + reverseDelta);

    const { error: eUp } = await supabaseAdmin
      .from("stock_levels")
      .upsert(
        {
          item_id: mov.item_id,
          location_id: locationId,
          current_stock: restoredStock,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "item_id,location_id" },
      );
    if (eUp) throw new Error(eUp.message);

    const { data: itemRow } = await supabaseAdmin
      .from("items")
      .select("shared_unit_enabled,standard_weight_g,avg_weight_g")
      .eq("id", mov.item_id)
      .maybeSingle();

    if (itemRow?.shared_unit_enabled) {
      const { data: lastAdj } = await supabaseAdmin
        .from("item_batches")
        .select("id")
        .eq("item_id", mov.item_id)
        .eq("source", "adjustment")
        .order("created_at", { ascending: false })
        .limit(1);
      const lastId = lastAdj?.[0]?.id;
      if (lastId) {
        await supabaseAdmin.from("item_batches").delete().eq("id", lastId);
      }

      if (restoredStock > 0) {
        const avgG = Number(itemRow.avg_weight_g || itemRow.standard_weight_g || 0);
        const totalWeightG = restoredStock * 1000;
        const unitsQty = avgG > 0 ? totalWeightG / avgG : 0;
        await supabaseAdmin.from("item_batches").insert({
          item_id: mov.item_id,
          source: "adjustment",
          units_qty: unitsQty,
          total_weight_g: totalWeightG,
          avg_weight_g: avgG,
          note: "Estorno de ajuste",
        });
      }
    }

    await supabaseAdmin.from("movements").delete().eq("id", movementId);

    return { ok: true, restoredStock };
  });

/**
 * Estorna uma operação de Produção ou Processamento.
 *
 * Lógica:
 * - Identifica o grupo de movimentos: mesmas ±10s + mesmo tag (Produção: X / Processamento: X) na nota.
 * - Bloqueia se qualquer batch destino já foi parcialmente consumido (current_qty < initial_qty).
 * - Devolve insumos ao estoque de origem (production_out → from_location_id).
 * - Subtrai destinos do estoque (production_in → to_location_id) e remove batches.
 * - Recalcula cost_price dos itens destino com base nos batches restantes (média ponderada).
 * - Marca todos os movimentos do grupo como status='reverted'.
 */
export const revertProductionMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ movementId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { movementId } = data;
    const userId = context.userId;

    const { data: anchor, error: eMov } = await supabaseAdmin
      .from("movements")
      .select("*")
      .eq("id", movementId)
      .single();
    if (eMov) throw new Error(eMov.message);
    if (!anchor) throw new Error("Movimentação não encontrada");
    if (anchor.status === "reverted") throw new Error("Movimentação já foi estornada");

    const note = String(anchor.note ?? "");
    const tagMatch = note.match(/(Produção|Processamento):\s*([^|→(\[]+)/i);
    if (!tagMatch) throw new Error("Operação não reconhecida como Produção/Processamento");
    const tag = tagMatch[1];
    const sourceName = tagMatch[2].trim();

    // Janela de ±10s
    const ts = new Date(anchor.created_at as string).getTime();
    const start = new Date(ts - 10_000).toISOString();
    const end = new Date(ts + 10_000).toISOString();

    const { data: candidates, error: eGroup } = await supabaseAdmin
      .from("movements")
      .select("*")
      .gte("created_at", start)
      .lte("created_at", end)
      .neq("status", "reverted")
      .ilike("note", `%${tag}: ${sourceName}%`);
    if (eGroup) throw new Error(eGroup.message);

    const group = (candidates ?? []).filter(
      (m) => m.org_id === anchor.org_id,
    );
    if (group.length === 0) throw new Error("Grupo de movimentações vazio");

    // 1) Validar destinos: nenhum batch pode ter sido consumido
    const destMovs = group.filter((m) => m.type === "production_in");
    for (const m of destMovs) {
      const { data: batches } = await supabaseAdmin
        .from("item_batches")
        .select("id,initial_qty,current_qty")
        .eq("movement_id", m.id);
      for (const b of batches ?? []) {
        if (Number(b.current_qty) < Number(b.initial_qty) - 1e-6) {
          throw new Error(
            "Não é possível estornar: o lote gerado já foi parcialmente consumido. Faça um ajuste manual com justificativa.",
          );
        }
      }
      // Adicionalmente: verificar saldo atual no destino
      if (m.to_location_id) {
        const { data: lvl } = await supabaseAdmin
          .from("stock_levels")
          .select("current_stock")
          .eq("item_id", m.item_id)
          .eq("location_id", m.to_location_id)
          .maybeSingle();
        const cur = Number(lvl?.current_stock ?? 0);
        if (cur + 1e-6 < Number(m.quantity)) {
          throw new Error(
            "Não é possível estornar: o estoque destino já foi consumido após esta operação.",
          );
        }
      }
    }

    // 2) Reverter destinos (subtrair stock, deletar batches)
    const affectedDestItemIds = new Set<string>();
    for (const m of destMovs) {
      affectedDestItemIds.add(m.item_id);
      if (m.to_location_id) {
        const { data: lvl } = await supabaseAdmin
          .from("stock_levels")
          .select("current_stock")
          .eq("item_id", m.item_id)
          .eq("location_id", m.to_location_id)
          .maybeSingle();
        const newStock = Math.max(0, Number(lvl?.current_stock ?? 0) - Number(m.quantity));
        await supabaseAdmin.from("stock_levels").upsert(
          {
            item_id: m.item_id,
            location_id: m.to_location_id,
            current_stock: newStock,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
      }
      await supabaseAdmin
        .from("item_batches")
        .update({ current_qty: 0, reverted_at: new Date().toISOString() })
        .eq("movement_id", m.id);
    }

    // 3) Devolver insumos (production_out) e restaurar batches consumidos por FEFO se possível
    const outMovs = group.filter((m) => m.type === "production_out");
    const affectedSrcItemIds = new Set<string>();
    for (const m of outMovs) {
      affectedSrcItemIds.add(m.item_id);
      if (m.from_location_id) {
        const { data: lvl } = await supabaseAdmin
          .from("stock_levels")
          .select("current_stock")
          .eq("item_id", m.item_id)
          .eq("location_id", m.from_location_id)
          .maybeSingle();
        const newStock = Number(lvl?.current_stock ?? 0) + Number(m.quantity);
        await supabaseAdmin.from("stock_levels").upsert(
          {
            item_id: m.item_id,
            location_id: m.from_location_id,
            current_stock: newStock,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
      }
    }

    // 4) Recalcular cost_price dos destinos E origens com base nos batches restantes
    const allAffectedItemIds = new Set<string>([...affectedDestItemIds, ...affectedSrcItemIds]);
    for (const itemId of allAffectedItemIds) {
      const { data: remaining } = await supabaseAdmin
        .from("item_batches")
        .select("current_qty,unit_cost")
        .eq("item_id", itemId)
        .gt("current_qty", 0);
      const totalQty = (remaining ?? []).reduce((a, b) => a + Number(b.current_qty), 0);
      const totalCost = (remaining ?? []).reduce(
        (a, b) => a + Number(b.current_qty) * Number(b.unit_cost),
        0,
      );
      if (totalQty > 0) {
        const avg = totalCost / totalQty;
        if (Number.isFinite(avg) && avg > 0) {
          await supabaseAdmin.from("items").update({ cost_price: avg }).eq("id", itemId);
        }
      }
    }

    // 5) Marcar movimentos como estornados
    const ids = group.map((m) => m.id);
    await supabaseAdmin
      .from("movements")
      .update({
        status: "reverted",
        reverted_at: new Date().toISOString(),
        reverted_by: userId,
      })
      .in("id", ids);

    return { ok: true, reverted: ids.length };
  });
