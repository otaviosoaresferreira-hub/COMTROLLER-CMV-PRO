import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CENTRAL_LOCATION_NAME } from "@/lib/stock-constants";

export type SuppliesData = {
  orgId: string | null;
  orgName: string;
  buyerName: string;
  whatsappGreeting: string;
  targetCoverageDays: number;
  centralLocationId: string;
  items: Array<{
    id: string;
    name: string;
    unit: string;
    min_stock: number;
    cost_price: number;
    is_active: boolean;
    is_operational: boolean;
    is_system: boolean;
    is_free: boolean;
  }>;
  stock: Array<{ item_id: string; location_id: string; current_stock: number }>;
  outgoing: Array<{ item_id: string; quantity: number; created_at: string }>;
  suppliers: Array<{
    id: string;
    name: string;
    whatsapp_phone: string | null;
    contact_name: string | null;
    document: string | null;
    lead_time_days: number;
  }>;
  itemSuppliers: Array<{ item_id: string; supplier_id: string; is_preferred: boolean }>;
  recentInvoiceItems: Array<{
    item_id: string;
    supplier_id: string | null;
    issue_date: string | null;
    stock_unit_cost: number;
  }>;
};

export const getSuppliesData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SuppliesData> => {
    const { supabase } = context;

    const { data: memberships } = await supabase
      .from("organization_members")
      .select("org_id")
      .order("created_at", { ascending: true })
      .limit(1);
    const orgId = memberships?.[0]?.org_id ?? null;

    if (!orgId) {
      return {
        orgId: null,
        orgName: "",
        buyerName: "",
        whatsappGreeting: "",
        targetCoverageDays: 7,
        centralLocationId: "",
        items: [],
        stock: [],
        outgoing: [],
        suppliers: [],
        itemSuppliers: [],
        recentInvoiceItems: [],
      };
    }

    const sinceMs = Date.now() - 90 * 86400000;
    const sinceIso = new Date(sinceMs).toISOString();

    const [orgRes, locRes, items, stock, movements, suppliers, itemSuppliers, invItems] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("name,buyer_name,whatsapp_greeting,target_coverage_days")
          .eq("id", orgId)
          .single(),
        supabase
          .from("locations")
          .select("id,name")
          .eq("org_id", orgId)
          .limit(10000),
        supabase
          .from("items")
          .select("id,name,unit,min_stock,cost_price,is_active,is_operational,is_system,is_free")
          .eq("org_id", orgId)
          .limit(10000),
        supabase
          .from("stock_levels")
          .select("item_id,location_id,current_stock")
          .eq("org_id", orgId)
          .limit(20000),
        supabase
          .from("movements")
          .select("item_id,quantity,from_location_id,to_location_id,created_at,type")
          .eq("org_id", orgId)
          .gte("created_at", sinceIso)
          .limit(50000),
        supabase
          .from("suppliers")
          .select("id,name,whatsapp_phone,contact_name,document,lead_time_days")
          .eq("org_id", orgId)
          .order("name")
          .limit(5000),
        supabase
          .from("item_suppliers")
          .select("item_id,supplier_id,is_preferred")
          .eq("org_id", orgId)
          .limit(20000),
        supabase
          .from("invoice_items")
          .select("item_id,stock_unit_cost,invoice_id,invoices!inner(supplier_id,issue_date)")
          .eq("org_id", orgId)
          .not("item_id", "is", null)
          .limit(20000),
      ]);

    const central = (locRes.data ?? []).find(
      (l) => l.name.trim().toLowerCase() === CENTRAL_LOCATION_NAME.toLowerCase(),
    );
    const centralId = central?.id ?? "";

    // Saídas do Central nos últimos 90d (negativas omitidas: trabalhamos com qty positiva)
    const outgoing: SuppliesData["outgoing"] = [];
    ((movements.data ?? []) as Array<{
      item_id: string;
      quantity: number;
      from_location_id: string | null;
      created_at: string;
    }>).forEach((m) => {
      if (centralId && m.from_location_id === centralId) {
        const qty = Number(m.quantity ?? 0);
        if (qty > 0) {
          outgoing.push({ item_id: m.item_id, quantity: qty, created_at: m.created_at });
        }
      }
    });

    const recentInvoiceItems: SuppliesData["recentInvoiceItems"] = [];
    ((invItems.data ?? []) as Array<{
      item_id: string | null;
      stock_unit_cost: number;
      invoices?: { supplier_id: string | null; issue_date: string | null }
        | { supplier_id: string | null; issue_date: string | null }[]
        | null;
    }>).forEach((row) => {
      if (!row.item_id) return;
      const inv = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices;
      recentInvoiceItems.push({
        item_id: row.item_id,
        supplier_id: inv?.supplier_id ?? null,
        issue_date: inv?.issue_date ?? null,
        stock_unit_cost: Number(row.stock_unit_cost ?? 0),
      });
    });

    return {
      orgId,
      orgName: (orgRes.data?.name as string) ?? "",
      buyerName: ((orgRes.data as { buyer_name?: string } | null)?.buyer_name as string) ?? "",
      whatsappGreeting:
        ((orgRes.data as { whatsapp_greeting?: string } | null)?.whatsapp_greeting as string) ?? "",
      targetCoverageDays: Number(
        (orgRes.data as { target_coverage_days?: number } | null)?.target_coverage_days ?? 7,
      ),
      centralLocationId: centralId,
      items: ((items.data ?? []) as SuppliesData["items"]).map((i) => ({
        ...i,
        min_stock: Number(i.min_stock ?? 0),
        cost_price: Number(i.cost_price ?? 0),
      })),
      stock: ((stock.data ?? []) as SuppliesData["stock"]).map((s) => ({
        ...s,
        current_stock: Number(s.current_stock ?? 0),
      })),
      outgoing,
      suppliers: (suppliers.data ?? []) as SuppliesData["suppliers"],
      itemSuppliers: (itemSuppliers.data ?? []) as SuppliesData["itemSuppliers"],
      recentInvoiceItems,
    };
  });
