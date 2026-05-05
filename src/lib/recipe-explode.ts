import { supabase } from "@/integrations/supabase/client";
import { consumeStockReal } from "@/lib/fefo";
import { convertToBase, normalizeUnit, type Unit } from "@/lib/recipe-cost";

/**
 * "Explode" recursivamente uma ficha técnica em seus insumos brutos.
 *
 * Para cada ingrediente:
 *  - Se for um item bruto, soma na lista final.
 *  - Se for uma sub-ficha:
 *     * Se a sub-ficha tem `explode_on_consume = true`, OU se ela mesma é
 *       composta apenas por outras receitas/insumos (recursão natural),
 *       descemos um nível e multiplicamos pela proporção.
 *     * Caso contrário, ela ainda é tratada como insumo "intermediário"
 *       (não bruto). O caller decide se cria uma produção implícita ou
 *       baixa direto de saldo.
 *
 * Estratégia para suportar "Recursivo total" com fallback automático:
 *  - SE a sub-ficha tem `explode_on_consume = true` → SEMPRE explode.
 *  - SE não, mas o produto pronto da sub-ficha tem saldo zero E ela tem
 *    `produced_item_id` → também explode (fallback). O caller passa o mapa
 *    de saldos via `stockByItem`.
 *
 * Guarda contra ciclos com `visiting`. Devolve sempre `item_id` BRUTO.
 *
 * Quantidade base: a `qty` recebida representa "quantas porções/yields da
 * ficha você quer consumir". Cada ingrediente é multiplicado por
 * `qty / yield_quantity` antes de descer.
 */

export type ExplodedItem = {
  itemId: string;
  /** Quantidade total agregada na unidade `unit`. */
  qty: number;
  /** Unidade BASE do item (kg ou un). */
  unit: "kg" | "un";
};

type RecipeMini = {
  id: string;
  yield_quantity: number;
  yield_unit: string;
  unit_weight_g: number | null;
  produced_item_id: string | null;
  explode_on_consume: boolean;
};

type IngredientMini = {
  recipe_id: string;
  item_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
  unit: string;
};

type ItemMini = {
  id: string;
  unit: string;
  avg_weight_g: number | null;
  shared_unit_enabled: boolean | null;
};

export type ExplodeContext = {
  recipes: RecipeMini[];
  ingredients: IngredientMini[];
  items: ItemMini[];
  /** Saldo atual do item (na unidade base). Usado para o fallback automático. */
  stockByItem?: Map<string, number>;
};

/** Carrega tudo o que precisamos do banco em uma única chamada. */
export async function loadExplodeContext(orgId: string): Promise<ExplodeContext> {
  const [recRes, ingRes, itemRes, stockRes] = await Promise.all([
    supabase
      .from("recipes")
      .select("id,yield_quantity,yield_unit,unit_weight_g,produced_item_id,explode_on_consume")
      .eq("org_id", orgId),
    supabase
      .from("recipe_ingredients")
      .select("recipe_id,item_id,sub_recipe_id,quantity,unit")
      .eq("org_id", orgId),
    supabase
      .from("items")
      .select("id,unit,avg_weight_g,shared_unit_enabled")
      .eq("org_id", orgId),
    supabase
      .from("stock_levels")
      .select("item_id,current_stock")
      .eq("org_id", orgId),
  ]);
  if (recRes.error) throw recRes.error;
  if (ingRes.error) throw ingRes.error;
  if (itemRes.error) throw itemRes.error;
  if (stockRes.error) throw stockRes.error;

  const stockByItem = new Map<string, number>();
  ((stockRes.data ?? []) as Array<{ item_id: string; current_stock: number }>).forEach(
    (r) => {
      stockByItem.set(
        r.item_id,
        (stockByItem.get(r.item_id) ?? 0) + Number(r.current_stock ?? 0),
      );
    },
  );

  return {
    recipes: (recRes.data ?? []) as RecipeMini[],
    ingredients: (ingRes.data ?? []) as IngredientMini[],
    items: (itemRes.data ?? []) as ItemMini[],
    stockByItem,
  };
}

/** Decide se uma sub-ficha deve ser EXPLODIDA neste consumo. */
function shouldExplode(sub: RecipeMini, ctx: ExplodeContext): boolean {
  if (sub.explode_on_consume === true) return true;
  // Fallback automático: se ela aponta para um item produzido e o saldo está
  // zerado/negativo, explodimos para evitar travar a operação.
  if (sub.produced_item_id && ctx.stockByItem) {
    const bal = ctx.stockByItem.get(sub.produced_item_id) ?? 0;
    if (bal <= 0) return true;
  }
  return false;
}

/**
 * Explode uma ficha em insumos brutos. Retorna lista agregada por item.
 * Se uma sub-ficha NÃO deve ser explodida e tem `produced_item_id`,
 * ela é tratada como um "insumo final" (o saldo do produto pronto será
 * baixado normalmente).
 */
export function explodeRecipe(
  recipeId: string,
  qty: number,
  ctx: ExplodeContext,
): ExplodedItem[] {
  const agg = new Map<string, { qty: number; unit: "kg" | "un" }>();
  const visiting = new Set<string>();

  const addRaw = (itemId: string, qtyInIngUnit: number, ingUnitRaw: string) => {
    const item = ctx.items.find((i) => i.id === itemId);
    if (!item) return;
    const baseUnit: "kg" | "un" = (item.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un";
    const ingUnit = normalizeUnit(ingUnitRaw);
    // Converte para a unidade BASE do item.
    let qtyInBase = qtyInIngUnit;
    if (baseUnit === "kg") {
      // Se a ingredient unit é G, KG, ML, L → converte para KG (assumimos densidade 1).
      const targetBase: Unit = "KG";
      if (ingUnit === "G") qtyInBase = qtyInIngUnit / 1000;
      else if (ingUnit === "ML") qtyInBase = qtyInIngUnit / 1000;
      else if (ingUnit === "L") qtyInBase = qtyInIngUnit;
      else if (ingUnit === "KG") qtyInBase = qtyInIngUnit;
      else if (ingUnit === "UN") {
        // Item em KG mas ingrediente em UN → converte usando peso médio.
        const avgKg = Number(item.avg_weight_g ?? 0) / 1000;
        qtyInBase = avgKg > 0 ? qtyInIngUnit * avgKg : qtyInIngUnit;
      } else {
        qtyInBase = convertToBase(qtyInIngUnit, ingUnit, targetBase);
      }
    } else {
      // Item em UN. Se ingrediente vier em KG, converte via peso médio.
      if (ingUnit === "KG" || ingUnit === "G") {
        const kg = ingUnit === "G" ? qtyInIngUnit / 1000 : qtyInIngUnit;
        const avgKg = Number(item.avg_weight_g ?? 0) / 1000;
        qtyInBase = avgKg > 0 ? kg / avgKg : kg;
      }
    }
    const cur = agg.get(itemId);
    if (cur) cur.qty += qtyInBase;
    else agg.set(itemId, { qty: qtyInBase, unit: baseUnit });
  };

  const walk = (rid: string, multiplier: number) => {
    if (visiting.has(rid)) return; // ciclo
    visiting.add(rid);
    const recipe = ctx.recipes.find((r) => r.id === rid);
    if (!recipe) {
      visiting.delete(rid);
      return;
    }
    const yieldQty = Number(recipe.yield_quantity) || 1;
    const factor = multiplier / yieldQty;

    const ings = ctx.ingredients.filter((i) => i.recipe_id === rid);
    for (const ing of ings) {
      const ingQty = Number(ing.quantity) * factor;
      if (!isFinite(ingQty) || ingQty <= 0) continue;

      if (ing.item_id) {
        addRaw(ing.item_id, ingQty, ing.unit);
      } else if (ing.sub_recipe_id) {
        const sub = ctx.recipes.find((r) => r.id === ing.sub_recipe_id);
        if (!sub) continue;
        if (shouldExplode(sub, ctx)) {
          // Quantos "yields" da sub-ficha estamos consumindo?
          // Se ingrediente está em UN → ingQty unidades dela.
          // Se em KG → converte usando unit_weight_g se houver.
          const ingUnit = normalizeUnit(ing.unit);
          let subYieldsConsumed = ingQty;
          if (ingUnit === "KG" || ingUnit === "G") {
            const wKg = Number(sub.unit_weight_g ?? 0) / 1000;
            const kg = ingUnit === "G" ? ingQty / 1000 : ingQty;
            subYieldsConsumed = wKg > 0 ? kg / wKg : kg;
          }
          // Recursão: pede para esta sub-ficha render `subYieldsConsumed` unidades de yield.
          // Como walk multiplica por (multiplier / yieldQty), passamos o número absoluto
          // de yields desejados como "multiplier" (yieldQty se cancela).
          walk(sub.id, subYieldsConsumed * (Number(sub.yield_quantity) || 1));
        } else if (sub.produced_item_id) {
          // Não explode: trata como item final (saldo do produto pronto).
          addRaw(sub.produced_item_id, ingQty, ing.unit);
        }
      }
    }
    visiting.delete(rid);
  };

  walk(recipeId, qty);
  return Array.from(agg.entries()).map(([itemId, v]) => ({
    itemId,
    qty: v.qty,
    unit: v.unit,
  }));
}

/**
 * Executa a baixa real (FEFO por lote) para uma lista explodida e
 * devolve o CMV total. Cada item é debitado de `stock_levels` no local
 * informado.
 */
export async function applyExplodedConsumption(opts: {
  exploded: ExplodedItem[];
  locationId: string;
  orgId: string;
  ctx: ExplodeContext;
}): Promise<{ totalCost: number; perItem: Array<{ itemId: string; qty: number; cost: number }> }> {
  const { exploded, locationId, orgId, ctx } = opts;
  let totalCost = 0;
  const perItem: Array<{ itemId: string; qty: number; cost: number }> = [];

  for (const e of exploded) {
    const item = ctx.items.find((i) => i.id === e.itemId);
    const baseUnit: "kg" | "un" = (item?.unit ?? "un").toLowerCase() === "kg" ? "kg" : "un";

    // Baixa nos lotes (FEFO real, peso por lote quando aplicável).
    const { realBaseTaken } = await consumeStockReal({
      itemId: e.itemId,
      qty: e.qty,
      inputUnit: e.unit,
      itemBaseUnit: baseUnit,
      avgWeightG: Number(item?.avg_weight_g ?? 0),
    });
    const baseTaken = realBaseTaken > 0 ? realBaseTaken : e.qty;

    // Atualiza stock_levels (current_stock -= baseTaken)
    const { data: lvl } = await supabase
      .from("stock_levels")
      .select("id,current_stock")
      .eq("org_id", orgId)
      .eq("item_id", e.itemId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (lvl) {
      await supabase
        .from("stock_levels")
        .update({ current_stock: Number(lvl.current_stock ?? 0) - baseTaken })
        .eq("id", lvl.id);
    } else {
      await supabase.from("stock_levels").insert({
        org_id: orgId,
        item_id: e.itemId,
        location_id: locationId,
        current_stock: -baseTaken,
      });
    }

    // CMV: usa cost_price atual do item (poderia ser melhorado para ler unit_cost
    // do lote consumido, mas isso requer expor o per-batch cost — fica como
    // próximo passo se necessário).
    const { data: itemRow } = await supabase
      .from("items")
      .select("cost_price")
      .eq("id", e.itemId)
      .maybeSingle();
    const unitCost = Number(itemRow?.cost_price ?? 0);
    const cost = baseTaken * unitCost;
    totalCost += cost;
    perItem.push({ itemId: e.itemId, qty: baseTaken, cost });
  }

  return { totalCost, perItem };
}
