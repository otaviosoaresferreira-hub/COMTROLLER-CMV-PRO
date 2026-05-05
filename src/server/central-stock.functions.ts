import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CENTRAL_LOCATION_NAME } from "@/lib/stock-constants";

export type CentralStockData = {
  orgId: string | null;
  centralLocationId: string;
  items: Array<{
    id: string;
    name: string;
    unit: string;
    min_stock: number;
    cost_price: number;
    category_id: string | null;
    is_active: boolean;
    shared_unit_enabled: boolean;
    standard_weight_g: number;
    avg_weight_g: number;
    weight_variable: boolean;
    is_operational: boolean;
    is_system: boolean;
    is_free: boolean;
    is_subproduct: boolean;
  }>;
  locations: Array<{ id: string; name: string; stock_mode?: string | null }>;
  stock: Array<{
    item_id: string;
    location_id: string;
    current_stock: number;
    expiry_date: string | null;
  }>;
  categories: Array<{ id: string; name: string; parent_id: string | null; is_system: boolean }>;
  movements: Array<{
    item_id: string;
    type: string;
    quantity: number;
    from_location_id: string | null;
    to_location_id: string | null;
    created_at: string;
  }>;
  batches: Array<{ item_id: string; units_qty: number; total_weight_g: number; avg_weight_g: number; created_at: string; expiry_date: string | null; current_qty: number }>;
  invoiceTotals: Array<{ item_id: string; stock_quantity: number }>;
  itemCategories: Array<{ item_id: string; category_id: string }>;
  itemSuppliers: Array<{ item_id: string; supplier_name: string }>;
};

function numericRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out = { ...row };
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        out[key as keyof T] = Number(value) as T[keyof T];
      }
    }
    return out;
  });
}

// IMPORTANTE: usa o cliente autenticado (RLS aplicada) para garantir que
// cada usuário só veja dados da(s) sua(s) organização(ões).
export const getCentralStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CentralStockData> => {
    const { supabase } = context;

    const { data: memberships, error: membershipError } = await supabase
      .from("organization_members")
      .select("org_id,created_at")
      .order("created_at", { ascending: true })
      .limit(1);

    if (membershipError) {
      throw new Error(`Falha ao identificar a organização do usuário: ${membershipError.message}`);
    }

    let orgId = memberships?.[0]?.org_id ?? null;
    if (!orgId) {
      const { data: ensuredOrgId, error: ensureError } = await supabase.rpc(
        "ensure_my_primary_organization",
      );
      if (ensureError) {
        throw new Error(`Falha ao provisionar a organização do usuário: ${ensureError.message}`);
      }
      orgId = ensuredOrgId ?? null;
    }

    if (!orgId) {
      return {
        orgId: null,
        centralLocationId: "",
        items: [],
        locations: [],
        stock: [],
        categories: [],
        movements: [],
        batches: [],
        invoiceTotals: [],
        itemCategories: [],
        itemSuppliers: [],
      };
    }

    const [items, locations, stock, categories, hiddenCats, movements, batches, invoiceItems, itemCats] =
      await Promise.all([
        supabase
          .from("items")
          .select(
            "id,name,unit,min_stock,cost_price,category_id,is_active,shared_unit_enabled,standard_weight_g,avg_weight_g,weight_variable,is_operational,is_system,is_free,is_subproduct",
          )
          .eq("org_id", orgId)
          .limit(10000),
        supabase.from("locations").select("id,name,stock_mode").eq("org_id", orgId).order("name").limit(10000),
        supabase
          .from("stock_levels")
          .select("item_id,location_id,current_stock,expiry_date")
          .eq("org_id", orgId)
          .limit(10000),
        supabase
          .from("categories")
          .select("id,name,parent_id,is_system")
          .eq("org_id", orgId)
          .order("name")
          .limit(10000),
        supabase
          .from("hidden_system_categories")
          .select("category_id")
          .eq("org_id", orgId)
          .limit(10000),
        supabase
          .from("movements")
          .select("item_id,type,quantity,from_location_id,to_location_id,created_at")
          .eq("org_id", orgId)
          .limit(10000),
        supabase
          .from("item_batches")
          .select("item_id,units_qty,total_weight_g,avg_weight_g,created_at,expiry_date,current_qty")
          .eq("org_id", orgId)
          .limit(10000),
        supabase
          .from("invoice_items")
          .select("item_id,stock_quantity,invoice_id,invoices!inner(supplier_name)")
          .eq("org_id", orgId)
          .not("item_id", "is", null)
          .limit(10000),
        supabase
          .from("item_categories")
          .select("item_id,category_id")
          .eq("org_id", orgId)
          .limit(20000),
      ]);

    const errors = [items, locations, stock, categories, hiddenCats, movements, batches, invoiceItems, itemCats]
      .map((result) => result.error)
      .filter(Boolean);

    if (errors.length > 0) {
      throw new Error(errors.map((error) => error?.message).join(" | "));
    }

    const invoiceTotalsMap = new Map<string, number>();
    const supplierMap = new Map<string, Set<string>>();
    ((invoiceItems.data ?? []) as Array<{
      item_id: string | null;
      stock_quantity: number;
      invoices?: { supplier_name: string | null } | { supplier_name: string | null }[] | null;
    }>).forEach((row) => {
      if (!row.item_id) return;
      invoiceTotalsMap.set(
        row.item_id,
        (invoiceTotalsMap.get(row.item_id) ?? 0) + Number(row.stock_quantity ?? 0),
      );
      const inv = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices;
      const supplier = inv?.supplier_name?.trim();
      if (supplier) {
        const set = supplierMap.get(row.item_id) ?? new Set<string>();
        set.add(supplier);
        supplierMap.set(row.item_id, set);
      }
    });

    const itemSuppliers: Array<{ item_id: string; supplier_name: string }> = [];
    supplierMap.forEach((set, item_id) => {
      set.forEach((supplier_name) => itemSuppliers.push({ item_id, supplier_name }));
    });

    const locationsData = (locations.data ?? []) as CentralStockData["locations"];
    const central = locationsData.find(
      (l) => l.name.trim().toLowerCase() === CENTRAL_LOCATION_NAME.toLowerCase(),
    );

    const hiddenIds = new Set(
      ((hiddenCats.data ?? []) as Array<{ category_id: string }>).map((r) => r.category_id),
    );
    const visibleCategories = ((categories.data ?? []) as CentralStockData["categories"])
      .filter((c) => !hiddenIds.has(c.id));

    return {
      orgId,
      centralLocationId: central?.id ?? "",
      items: numericRows((items.data ?? []) as CentralStockData["items"]),
      locations: locationsData,
      stock: numericRows((stock.data ?? []) as CentralStockData["stock"]),
      categories: visibleCategories,
      movements: numericRows((movements.data ?? []) as CentralStockData["movements"]),
      batches: numericRows((batches.data ?? []) as CentralStockData["batches"]),
      invoiceTotals: Array.from(invoiceTotalsMap.entries()).map(([item_id, stock_quantity]) => ({
        item_id,
        stock_quantity,
      })),
      itemCategories: ((itemCats.data ?? []) as CentralStockData["itemCategories"]),
      itemSuppliers,
    };
  });
