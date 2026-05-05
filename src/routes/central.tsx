import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EntryDialog } from "@/components/entry-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { ItemActionsSheet, type ActiveItem } from "@/components/item-actions-sheet";
import { OperationalBadge } from "@/components/operational-badge";
import { OperationalItemDialog } from "@/components/operational-item-dialog";
import { QuickAddItems } from "@/components/quick-add-items";
import { Plus } from "lucide-react";
import { useManagerMode } from "@/lib/manager-mode";
import { getCentralStock } from "@/server/central-stock.functions";
import {
  ArrowLeft,
  Warehouse,
  AlertTriangle,
  CalendarClock,
  PackageX,
  ShieldCheck,
  Search,
  AlertOctagon,
  Sparkles,
  X,
  DollarSign,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { roundUn, formatUn, formatKg } from "@/lib/shared-unit";
import { CENTRAL_LOCATION_NAME, isWaterItem, isFreeItem } from "@/lib/stock-constants";
import { WaterInfoDialog } from "@/components/water-info-dialog";
import { categoryPath } from "@/lib/categories";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, Boxes } from "lucide-react";

export const Route = createFileRoute("/central")({
  validateSearch: (search: Record<string, unknown>) => ({
    cat: typeof search.cat === "string" ? search.cat : undefined,
    sub: search.sub === true || search.sub === "true" ? true : undefined,
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  component: CentralPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date + "T00:00:00");
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  return diff;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function getTechnicalError(error: unknown): string {
  if (!error) return "Erro desconhecido no carregamento.";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

type ExpiryFilter = "all" | "7" | "15" | "30";
type HealthFilter = "all" | "critical";
type CoverageWindow = "7" | "30" | "90";

const EMPTY_CENTRAL_DATA = {
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
  itemSuppliers: [] as Array<{ item_id: string; supplier_name: string }>,
  itemsWithMovements: new Set<string>(),
};

function CentralPage() {
  const { isManager } = useManagerMode();
  const navigate = useNavigate({ from: "/central" });
  const { cat: catFilter, sub: subFilterParam } = Route.useSearch();
  const [subOnly, setSubOnly] = useState<boolean>(!!subFilterParam);
  useEffect(() => {
    setSubOnly(!!subFilterParam);
  }, [subFilterParam]);

  // Persistência do filtro de categoria via localStorage.
  // Restauramos só uma vez (no mount) para que clicar em "Todos" realmente limpe.
  const [didRestore, setDidRestore] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!didRestore) {
      setDidRestore(true);
      if (catFilter === undefined) {
        const saved = window.localStorage.getItem("central:catFilter");
        if (saved) {
          navigate({ search: (prev) => ({ ...prev, cat: saved }), replace: true });
        }
      }
      return;
    }
    if (catFilter === undefined) {
      window.localStorage.removeItem("central:catFilter");
    } else {
      window.localStorage.setItem("central:catFilter", catFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catFilter]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["central"],
    queryFn: async () => {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || !authData.session?.access_token) {
        throw new Error("Sessão expirada. Entre novamente para carregar o estoque.");
      }
      const payload = await getCentralStock({
        headers: { Authorization: `Bearer ${authData.session.access_token}` },
      });
      const itemsWithMovements = new Set(
        (payload.movements ?? []).map((m) => m.item_id),
      );
      return {
        ...payload,
        itemsWithMovements,
      };
    },
    retry: false,
  });
  const centralData = data ?? EMPTY_CENTRAL_DATA;

  const activeCategory = useMemo(
    () => centralData.categories.find((c) => c.id === catFilter),
    [centralData.categories, catFilter],
  );

  const central = useMemo(() => {
    const locations = centralData.locations;
    if (centralData.centralLocationId) {
      const byId = locations.find((l) => l.id === centralData.centralLocationId);
      if (byId) return byId;
    }
    return locations.find(
      (l) => l.name.trim().toLowerCase() === CENTRAL_LOCATION_NAME.toLowerCase(),
    );
  }, [centralData]);

  // Filtros
  const [search, setSearch] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [coverageWindow, setCoverageWindow] = useState<CoverageWindow>("30");
  // "Mostrar tudo": revela itens do sistema (Água, etc.) e itens livres ocultos.
  // Itens inativos JÁ aparecem por padrão (no final da lista) — esse toggle só
  // controla os itens internos do sistema que normalmente não fazem parte da
  // operação diária.
  const [showAllItems, setShowAllItems] = useState<boolean>(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [activeBatchOnly, setActiveBatchOnly] = useState<boolean>(false);

  // Drawer
  const [active, setActive] = useState<ActiveItem | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferItemId, setTransferItemId] = useState<string | undefined>();

  // Operational quick-edit / create
  const [opDialogOpen, setOpDialogOpen] = useState(false);
  const [opEditingId, setOpEditingId] = useState<string | null>(null);
  const [opInitialName, setOpInitialName] = useState<string>("");
  const [opInitialUnit, setOpInitialUnit] = useState<string>("UN");

  // Modal informativo de itens livres (Água + livres do usuário)
  const [waterDialogOpen, setWaterDialogOpen] = useState(false);
  const [waterDialogItem, setWaterDialogItem] = useState<{
    id: string;
    name: string;
    isWater: boolean;
  } | null>(null);

  const allRows = useMemo(() => {
    if (!central) return [];
    // Unidades reais ativas por item: soma proporcional baseada no consumo atual de cada lote.
    // units_remaining = units_qty * (current_qty / initial_qty). Garante que quando 1 lote acaba,
    // o estoque em UN reflete somente o que ainda existe fisicamente.
    const unitsByItem = new Map<string, number>();
    // Peso real ativo por item: soma proporcional de total_weight_g dos lotes ainda em estoque.
    const weightKgByItem = new Map<string, number>();
    const invoiceQtyByItem = new Map<string, number>();
    // Lotes ativos (com unidades > 0) por item, para detectar divergência de embalagens.
    const batchesByItem = new Map<string, Array<{ units: number; avgG: number }>>();
    // Próxima validade ativa por item (FEFO) — usa lotes com current_qty > 0.
    const nextExpiryByItem = new Map<string, string>();
    centralData.batches.forEach((batch) => {
      const initialQty = Number((batch as { initial_qty?: number }).initial_qty ?? 0);
      const currentQty = Number((batch as { current_qty?: number }).current_qty ?? 0);
      const unitsTotal = Number(batch.units_qty ?? 0);
      const weightTotalG = Number((batch as { total_weight_g?: number }).total_weight_g ?? 0);
      // Fração restante do lote (consumo via FEFO decrementa current_qty).
      const remainingFraction = initialQty > 0 ? Math.max(0, currentQty / initialQty) : (currentQty > 0 ? 1 : 0);
      const unitsRemaining = unitsTotal * remainingFraction;
      const weightRemainingKg = (weightTotalG / 1000) * remainingFraction;
      if (unitsRemaining > 0) {
        unitsByItem.set(
          batch.item_id,
          (unitsByItem.get(batch.item_id) ?? 0) + unitsRemaining,
        );
      }
      if (weightRemainingKg > 0) {
        weightKgByItem.set(
          batch.item_id,
          (weightKgByItem.get(batch.item_id) ?? 0) + weightRemainingKg,
        );
      }
      const avgG = Number(batch.avg_weight_g ?? 0);
      if (unitsRemaining > 0 && avgG > 0) {
        const arr = batchesByItem.get(batch.item_id) ?? [];
        arr.push({ units: unitsRemaining, avgG });
        batchesByItem.set(batch.item_id, arr);
      }
      const exp = (batch as { expiry_date?: string | null }).expiry_date ?? null;
      if (currentQty > 0 && exp) {
        const prev = nextExpiryByItem.get(batch.item_id);
        if (!prev || exp < prev) nextExpiryByItem.set(batch.item_id, exp);
      }
    });
    centralData.invoiceTotals.forEach((row) => {
      invoiceQtyByItem.set(row.item_id, Number(row.stock_quantity ?? 0));
    });
    const balanceByItem = new Map<string, number>();
    const outgoingByItem = new Map<string, number>();
    const hasIncomingMovement = new Set<string>();
    // Última entrada (purchase=entry/invoice / production=production_in)
    const lastIncomingByItem = new Map<string, { type: string; date: string }>();
    // Saídas reais para cálculo de giro: somente saídas do Central (consumo/transferência)
    const outgoingDated: Array<{ item_id: string; qty: number; date: string }> = [];
    centralData.movements.forEach((m) => {
      const qty = Number(m.quantity ?? 0);
      const date = (m as { created_at?: string }).created_at ?? "";
      if (m.to_location_id === central.id) {
        balanceByItem.set(m.item_id, (balanceByItem.get(m.item_id) ?? 0) + qty);
        hasIncomingMovement.add(m.item_id);
        const prev = lastIncomingByItem.get(m.item_id);
        if (!prev || date > prev.date) {
          lastIncomingByItem.set(m.item_id, { type: m.type, date });
        }
      }
      if (m.from_location_id === central.id) {
        balanceByItem.set(m.item_id, (balanceByItem.get(m.item_id) ?? 0) - qty);
        outgoingByItem.set(m.item_id, (outgoingByItem.get(m.item_id) ?? 0) - qty);
        if (qty > 0 && date) outgoingDated.push({ item_id: m.item_id, qty, date });
      }
    });

    // Tags adicionais (item_categories) — índice item_id -> Set<category_id>
    const tagsByItem = new Map<string, Set<string>>();
    centralData.itemCategories.forEach((row) => {
      const set = tagsByItem.get(row.item_id) ?? new Set<string>();
      set.add(row.category_id);
      tagsByItem.set(row.item_id, set);
    });

    // Última entrada por item via item_batches (cobre origens via NF/produção registradas em batches)
    const lastBatchByItem = new Map<string, string>();
    centralData.batches.forEach((b) => {
      const date = (b as { created_at?: string }).created_at ?? "";
      if (!date) return;
      const prev = lastBatchByItem.get(b.item_id);
      if (!prev || date > prev) lastBatchByItem.set(b.item_id, date);
    });

    // Janela de cobertura (dias)
    const windowDays = Number(coverageWindow);
    const windowStartMs = Date.now() - windowDays * 86400000;

    // Conjunto de IDs de categorias filhas do filtro selecionado, para incluir
    // itens vinculados a uma subcategoria quando o filtro for o pai.
    const childIdsOfFilter = new Set<string>();
    if (catFilter && catFilter !== "none") {
      centralData.categories.forEach((c) => {
        if (c.parent_id === catFilter) childIdsOfFilter.add(c.id);
      });
    }
    // IDs de categorias "Sem Categoria" do sistema (auto-atribuídas).
    const uncategorizedIds = new Set(
      centralData.categories
        .filter((c) => String(c?.name ?? "").trim().toLowerCase() === "sem categoria")
        .map((c) => c.id),
    );
    return centralData.items
      .filter((item) => {
        if (!catFilter) return true;
        if (catFilter === "none") {
          const hasTags = (tagsByItem.get(item.id)?.size ?? 0) > 0;
          const noPrimary = !item.category_id || uncategorizedIds.has(item.category_id);
          return noPrimary && !hasTags;
        }
        // Categoria cruzada: principal OU tag adicional OU subcategoria filha
        if (item.category_id === catFilter) return true;
        if (item.category_id && childIdsOfFilter.has(item.category_id)) return true;
        const tags = tagsByItem.get(item.id);
        if (!tags) return false;
        if (tags.has(catFilter)) return true;
        for (const cid of childIdsOfFilter) if (tags.has(cid)) return true;
        return false;
      })
      .map((item) => {
        const level = centralData.stock.find(
          (s) => s.item_id === item.id && s.location_id === central.id,
        );
        // Prioriza stock_levels; se não houver linha do Estoque Central, usa NF processada
        // menos saídas do Central. Se já houver movimentos de entrada, usa movimentos.
        const stockQty = level ? Number(level.current_stock ?? 0) : null;
        const movementQty = balanceByItem.get(item.id) ?? 0;
        const invoiceQty = invoiceQtyByItem.get(item.id) ?? 0;
        const outgoingQty = outgoingByItem.get(item.id) ?? 0;
        const quantity = stockQty !== null
          ? stockQty
          : hasIncomingMovement.has(item.id)
            ? movementQty
            : invoiceQty + outgoingQty;
        const isOperational =
          (item as { is_operational?: boolean }).is_operational === true;
        const isWater = isWaterItem(item);
        const isFree = isFreeItem(item);
        const isSystem = (item as { is_system?: boolean }).is_system === true;
        const isSubproduct =
          (item as { is_subproduct?: boolean }).is_subproduct === true;
        const contabilizaCmv =
          (item as { contabiliza_cmv?: boolean }).contabiliza_cmv !== false;
        const costPrice = isOperational || isFree ? 0 : Number(item.cost_price ?? 0);
        const sharedUnit = item.shared_unit_enabled === true;
        const weightVariable =
          (item as { weight_variable?: boolean }).weight_variable === true;
        const avgWeightG = Number(item.avg_weight_g ?? 0);
        const standardWeightG = Number(item.standard_weight_g ?? 0);
        const weightG = avgWeightG > 0 ? avgWeightG : standardWeightG;
        const primaryUnit = (item.unit || "un").toUpperCase();
        const totalWeightKg = quantity;
        // Soma REAL de unidades a partir dos lotes (após FEFO). Sem multiplicação fantasma.
        const realUnits = unitsByItem.get(item.id) ?? 0;
        // Fallback: se não há lotes mas há peso médio, deriva (legado).
        const derivedUnits = weightG > 0 ? totalWeightKg / (weightG / 1000) : 0;
        const totalUnits = roundUn(realUnits > 0 ? realUnits : derivedUnits);
        const hasUnitDrawer = sharedUnit || realUnits > 0 || weightG > 0;
        // Itens com Peso Médio (weight_variable) sempre exibem KG como unidade principal,
        // independentemente do "unit" cadastrado. UN aparece apenas como conferência.
        const displayUnit = hasUnitDrawer || weightVariable ? "KG" : primaryUnit;
        // Divergência de embalagens: só vale para itens compartilhados de PESO FIXO
        // (referência cadastrada). Itens de Peso Médio (weight_variable) NÃO ativam.
        let divergentPackaging = false;
        if (sharedUnit && !weightVariable) {
          const ref = standardWeightG > 0 ? standardWeightG : avgWeightG;
          const lots = batchesByItem.get(item.id) ?? [];
          if (ref > 0 && lots.length >= 1) {
            // Divergente se algum lote desviar ≥5% do peso de referência
            // OU se houver lotes com pesos diferentes entre si (≥5%).
            const minG = Math.min(...lots.map((l) => l.avgG));
            const maxG = Math.max(...lots.map((l) => l.avgG));
            const spread = minG > 0 ? Math.abs(maxG - minG) / minG : 0;
            const refDeviation = lots.some(
              (l) => Math.abs(l.avgG - ref) / ref >= 0.05,
            );
            divergentPackaging = spread >= 0.05 || refDeviation;
          }
        }
        const displayQuantity = hasUnitDrawer
          ? displayUnit === "UN"
            ? totalUnits
            : totalWeightKg
          : quantity;
        // Custo unitário derivado: o custo cadastrado representa a unidade principal
        // do item (KG para insumos por peso, UN caso contrário).
        // Em itens com Unidade Compartilhada, o cost_price está em /KG; o custo /UN
        // é calculado dinamicamente a partir do peso médio (avg_weight_g).
        const costPerKg = hasUnitDrawer ? costPrice : (primaryUnit === "KG" ? costPrice : 0);
        const costPerUnit = hasUnitDrawer
          ? (weightG > 0 ? costPrice * (weightG / 1000) : 0)
          : (primaryUnit === "UN" ? costPrice : 0);
        // Custo do "lado primário" (o que está exibido em destaque) e do lado secundário
        const primaryIsUn = displayUnit === "UN";
        const displayCost = hasUnitDrawer
          ? (primaryIsUn ? costPerUnit : costPerKg)
          : costPrice;
        const secondaryCost = hasUnitDrawer
          ? (primaryIsUn ? costPerKg : costPerUnit)
          : 0;
        // Valor total sincronizado com a unidade exibida
        const totalValue = isOperational || isFree ? 0 : displayQuantity * displayCost;

        // Origem da última entrada (movements > batches)
        const lastMov = lastIncomingByItem.get(item.id);
        const lastBatchDate = lastBatchByItem.get(item.id) ?? "";
        let originKind: "purchase" | "production" | "unknown" = "unknown";
        let lastEntryDate: string | null = null;
        if (lastMov) {
          originKind = lastMov.type === "production_in" ? "production" : "purchase";
          lastEntryDate = lastMov.date || null;
        } else if (lastBatchDate) {
          // Sem movimento: assume compra (entrada via NF gera batch)
          originKind = isSubproduct ? "production" : "purchase";
          lastEntryDate = lastBatchDate;
        }

        // Dias de cobertura: saídas dentro da janela
        let coverageDays: number | null = null;
        if (!isOperational && !isFree && quantity > 0) {
          const totalOut = outgoingDated
            .filter((o) => o.item_id === item.id && new Date(o.date).getTime() >= windowStartMs)
            .reduce((acc, o) => acc + o.qty, 0);
          if (totalOut > 0) {
            const daily = totalOut / windowDays;
            coverageDays = Math.floor(quantity / daily);
          }
        }

        // Tags adicionais
        const tagSet = tagsByItem.get(item.id) ?? new Set<string>();
        const tagPaths = Array.from(tagSet)
          .map((cid) => categoryPath(cid, centralData.categories))
          .filter(Boolean);

        return {
          id: item.id,
          name: item.name,
          unit: item.unit,
          quantity,
          displayQuantity,
          displayUnit,
          totalWeightKg,
          totalUnits,
          minStock: Number(item.min_stock ?? 0),
          expiry: nextExpiryByItem.get(item.id) ?? level?.expiry_date ?? null,
          costPrice,
          displayCost,
          secondaryCost,
          totalValue,
          isActive: item.is_active !== false,
          hasMovements: centralData.itemsWithMovements.has(item.id),
          sharedUnit,
          hasUnitDrawer,
          weightG,
          isOperational,
          isWater,
          isFree,
          isSystem,
          isSubproduct,
          contabilizaCmv,
          divergentPackaging,
          categoryPath: categoryPath(item.category_id, centralData.categories),
          tagPaths,
          originKind,
          lastEntryDate,
          coverageDays,
        };
      })
      .sort((a, b) => {
        // Inativos vão para o final
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        // Operacionais e Água ordenam normalmente (sem urgência)
        const aLow =
          !a.isOperational && !a.isFree &&
          (a.displayQuantity < 0 || (a.minStock > 0 && a.displayQuantity <= a.minStock));
        const bLow =
          !b.isOperational && !b.isFree &&
          (b.displayQuantity < 0 || (b.minStock > 0 && b.displayQuantity <= b.minStock));
        if (aLow !== bLow) return aLow ? -1 : 1;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      });
  }, [centralData, central, catFilter, coverageWindow]);

  const suppliersByItem = useMemo(() => {
    const map = new Map<string, Set<string>>();
    centralData.itemSuppliers.forEach((row) => {
      const set = map.get(row.item_id) ?? new Set<string>();
      set.add(row.supplier_name);
      map.set(row.item_id, set);
    });
    return map;
  }, [centralData.itemSuppliers]);

  const supplierOptions = useMemo(() => {
    const all = new Set<string>();
    centralData.itemSuppliers.forEach((r) => all.add(r.supplier_name));
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [centralData.itemSuppliers]);

  // Itens com lotes ativos (current_qty > 0)
  const itemsWithActiveBatch = useMemo(() => {
    const set = new Set<string>();
    centralData.batches.forEach((b) => {
      const cur = Number((b as { current_qty?: number }).current_qty ?? 0);
      if (cur > 0) set.add(b.item_id);
    });
    return set;
  }, [centralData.batches]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateRange?.from ? new Date(dateRange.from).setHours(0, 0, 0, 0) : null;
    const toMs = dateRange?.to ? new Date(dateRange.to).setHours(23, 59, 59, 999) : null;
    return allRows.filter((r) => {
      if (!showAllItems) {
        if (r.isFree && !r.isWater) return false;
        if (r.isSystem && !r.isWater) return false;
      }
      if (subOnly && !r.isSubproduct) return false;
      if (activeBatchOnly && !itemsWithActiveBatch.has(r.id)) return false;
      if (supplierFilter !== "all") {
        const sups = suppliersByItem.get(r.id);
        if (!sups || !sups.has(supplierFilter)) return false;
      }
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (healthFilter === "critical") {
        if (r.isOperational || r.isFree) return false;
        const isCritical =
          r.displayQuantity < 0 ||
          (r.minStock > 0 && r.displayQuantity <= r.minStock);
        if (!isCritical) return false;
      }
      if (fromMs !== null || toMs !== null) {
        if (!r.lastEntryDate) return false;
        const t = new Date(r.lastEntryDate).getTime();
        if (fromMs !== null && t < fromMs) return false;
        if (toMs !== null && t > toMs) return false;
      }
      if (expiryFilter !== "all") {
        const days = daysUntil(r.expiry);
        const limit = Number(expiryFilter);
        if (days === null || days > limit) return false;
      }
      return true;
    });
  }, [allRows, search, expiryFilter, subOnly, healthFilter, dateRange, showAllItems, supplierFilter, suppliersByItem, activeBatchOnly, itemsWithActiveBatch]);

  const handleOpenSheet = (r: (typeof allRows)[number]) => {
    if (!central) return;
    if (r.isFree) {
      // Água ou item livre: abre modal informativo centralizado.
      setWaterDialogItem({ id: r.id, name: r.name, isWater: r.isWater });
      setWaterDialogOpen(true);
      return;
    }
    if (r.isOperational) {
      // Operacional: abre apenas o modal simplificado (sem painel de ajustes/transferência)
      setOpEditingId(r.id);
      setOpInitialName(r.name);
      setOpInitialUnit(r.unit);
      setOpDialogOpen(true);
      return;
    }
    setActive({
      id: r.id,
      name: r.name,
      unit: r.unit,
      quantity: r.quantity,
      displayUnit: r.displayUnit,
      displayQuantity: r.displayQuantity,
      expiry: r.expiry,
      locationId: central.id,
      minStock: r.minStock,
      isActive: r.isActive,
      hasMovements: r.hasMovements,
      weightG: r.weightG,
      totalUnits: r.totalUnits,
      totalWeightKg: r.totalWeightKg,
      hasUnitDrawer: r.hasUnitDrawer,
      divergentPackaging: r.divergentPackaging,
    });
  };

  const openNewOperational = () => {
    setOpEditingId(null);
    setOpInitialName("");
    setOpInitialUnit("UN");
    setOpDialogOpen(true);
  };

  const handleTransferFromSheet = (itemId: string) => {
    setActive(null);
    setTransferItemId(itemId);
    setTransferOpen(true);
  };

  useEffect(() => {
    if (!active) return;
    const fresh = allRows.find((r) => r.id === active.id);
    if (!fresh || !central) return;
    if (
      active.unit !== fresh.unit ||
      active.quantity !== fresh.quantity ||
      active.displayUnit !== fresh.displayUnit ||
      active.displayQuantity !== fresh.displayQuantity ||
      active.minStock !== fresh.minStock ||
      active.expiry !== fresh.expiry ||
      active.isActive !== fresh.isActive
    ) {
      setActive({
        id: fresh.id,
        name: fresh.name,
        unit: fresh.unit,
        quantity: fresh.quantity,
        displayUnit: fresh.displayUnit,
        displayQuantity: fresh.displayQuantity,
        expiry: fresh.expiry,
        locationId: central.id,
        minStock: fresh.minStock,
        isActive: fresh.isActive,
        hasMovements: fresh.hasMovements,
        weightG: fresh.weightG,
        totalUnits: fresh.totalUnits,
        totalWeightKg: fresh.totalWeightKg,
        hasUnitDrawer: fresh.hasUnitDrawer,
        divergentPackaging: fresh.divergentPackaging,
      });
    }
  }, [active, allRows, central]);

  const expiryChips: { v: ExpiryFilter; label: string }[] = [
    { v: "7", label: "7 dias" },
    { v: "15", label: "15 dias" },
    { v: "30", label: "30 dias" },
  ];
  const technicalError = error
    ? getTechnicalError(error)
    : !isLoading && centralData.orgId && !central
      ? `Localização "${CENTRAL_LOCATION_NAME}" não encontrada. Verifique em Configurações.`
      : null;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Warehouse className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Estoque Principal
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">
              {central?.name ?? "Estoque Central"}
            </h1>
          </div>
          {isManager && (
            <Badge variant="default" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Gestor
            </Badge>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {/* Botões de ação simétricos */}
        <section className="flex gap-3">
          {central && (
            <>
              <EntryDialog
                items={centralData.items.filter(
                  (i) =>
                    !(i as { is_operational?: boolean }).is_operational &&
                    !isFreeItem(i),
                )}
                centralId={central.id}
                stockLevels={centralData.stock}
                categories={centralData.categories}
              />
              <TransferDialog
                items={centralData.items.filter(
                  (i) =>
                    !(i as { is_operational?: boolean }).is_operational &&
                    !isFreeItem(i),
                )}
                locations={centralData.locations}
                stockLevels={centralData.stock}
              />
            </>
          )}
        </section>

        {/* Chips de categorias */}
        {centralData.categories.length > 0 && (() => {
          const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
          const parents = centralData.categories.filter(
            (c) =>
              !c.parent_id &&
              norm(c.name) !== "sem categoria" &&
              norm(c.name) !== "sistema",
          );
          const selectedParentId =
            catFilter && catFilter !== "none"
              ? (() => {
                  const sel = centralData.categories.find((c) => c.id === catFilter);
                  if (!sel) return null;
                  return sel.parent_id ?? sel.id;
                })()
              : null;
          const subOptions = selectedParentId
            ? centralData.categories.filter((c) => c.parent_id === selectedParentId)
            : [];
          return (
            <section className="-mx-1 space-y-2 pb-1">
              <div className="overflow-x-auto">
                <div className="flex items-center gap-2 px-1">
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ search: () => ({ cat: undefined, sub: undefined }) })
                    }
                    className={cn(
                      "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                      !catFilter
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Todos
                  </button>
                  {parents.map((c) => {
                    const isActive =
                      catFilter === c.id || selectedParentId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          navigate({ search: (prev) => ({ ...prev, cat: c.id }) })
                        }
                        className={cn(
                          "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-muted",
                        )}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ search: (prev) => ({ ...prev, cat: "none" }) })
                    }
                    className={cn(
                      "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                      catFilter === "none"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-dashed border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Sem categoria
                  </button>
                </div>
              </div>
              {subOptions.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="flex items-center gap-2 px-1">
                    <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Subcategorias:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        navigate({
                          search: (prev) => ({ ...prev, cat: selectedParentId ?? undefined }),
                        })
                      }
                      className={cn(
                        "h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                        catFilter === selectedParentId
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Todas
                    </button>
                    {subOptions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          navigate({ search: (prev) => ({ ...prev, cat: s.id }) })
                        }
                        className={cn(
                          "h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                          catFilter === s.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-muted",
                        )}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        {/* Barra de pesquisa */}
        <section className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar item por nome…"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filtros rápidos */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={subOnly ? "default" : "outline"}
              onClick={() => setSubOnly((v) => !v)}
              className="h-8 gap-1"
              title="Mostrar apenas produções internas"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Só produções internas
            </Button>

            <Button
              size="sm"
              variant={healthFilter === "critical" ? "destructive" : "outline"}
              onClick={() =>
                setHealthFilter((v) => (v === "critical" ? "all" : "critical"))
              }
              className="h-8 gap-1"
              title="Itens abaixo do mínimo ou negativos"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Estoque Crítico
            </Button>

            <Button
              size="sm"
              variant={showAllItems ? "default" : "outline"}
              onClick={() => setShowAllItems((v) => !v)}
              className="h-8 gap-1"
              title="Mostrar também itens livres e itens internos do sistema (Água, etc.)"
            >
              {showAllItems ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {showAllItems ? "Ocultar sistema" : "Mostrar tudo"}
            </Button>

            <Button
              size="sm"
              variant={activeBatchOnly ? "default" : "outline"}
              onClick={() => setActiveBatchOnly((v) => !v)}
              className="h-8 gap-1"
              title="Mostrar apenas itens com lotes ativos (saldo > 0)"
            >
              <Boxes className="h-3.5 w-3.5" />
              Lotes Ativos
            </Button>

            {supplierOptions.length > 0 && (
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="Fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos fornecedores</SelectItem>
                  {supplierOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {activeCategory && (
              <Badge variant="secondary" className="gap-1">
                Categoria: {activeCategory.name}
                <Link
                  to="/central"
                  search={{ cat: undefined } as never}
                  className="ml-1 inline-flex items-center"
                  aria-label="Limpar filtro de categoria"
                >
                  <X className="h-3 w-3" />
                </Link>
              </Badge>
            )}
          </div>

          {/* Filtros compactos: vencimento + cobertura + intervalo de datas */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <span className="px-2 text-xs text-muted-foreground">Venc.:</span>
              <Button
                size="sm"
                variant={expiryFilter === "all" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setExpiryFilter("all")}
              >
                Todos
              </Button>
              {expiryChips.map((c) => (
                <Button
                  key={c.v}
                  size="sm"
                  variant={expiryFilter === c.v ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setExpiryFilter(c.v)}
                >
                  {c.label}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <span className="px-2 text-xs text-muted-foreground">Cob.:</span>
              {(["7", "30", "90"] as const).map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant={coverageWindow === w ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setCoverageWindow(w)}
                  title={`Calcular giro com base nos últimos ${w} dias`}
                >
                  {w}d
                </Button>
              ))}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 gap-2 text-xs",
                    !dateRange?.from && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "dd/MM/yy", { locale: ptBR })} →{" "}
                        {format(dateRange.to, "dd/MM/yy", { locale: ptBR })}
                      </>
                    ) : (
                      format(dateRange.from, "dd/MM/yy", { locale: ptBR })
                    )
                  ) : (
                    <span>Período de entrada</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  locale={ptBR}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>

            {dateRange?.from && (
              <button
                type="button"
                onClick={() => setDateRange(undefined)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Limpar período"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </section>

        {/* Tabela operacional */}
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Itens em estoque</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? "item" : "itens"}
              </span>
              {!isLoading && !technicalError && (
                <QuickAddItems categories={centralData.categories} orgId={centralData.orgId} />
              )}
            </div>
          </div>

          {technicalError ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="font-semibold text-destructive">Erro técnico ao carregar o estoque</p>
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {technicalError}
              </pre>
            </div>
          ) : isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <PackageX className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum item encontrado</p>
              <p className="text-xs text-muted-foreground">
                {allRows.length === 0
                  ? 'Use "Registrar Entrada" para começar.'
                  : "Ajuste os filtros para ver mais itens."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Item</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Mín.</TableHead>
                  {isManager && (
                    <>
                      <TableHead className="text-right">Preço médio</TableHead>
                      <TableHead className="text-right">Valor total</TableHead>
                    </>
                  )}
                  <TableHead className="pr-4 text-right">Validade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isNegative = !r.isOperational && !r.isFree && r.displayQuantity < 0;
                  const isLow =
                    !r.isOperational && !r.isFree &&
                    !isNegative && r.minStock > 0 && r.displayQuantity <= r.minStock;
                  const days = daysUntil(r.expiry);
                  const isExpiringSoon =
                    !r.isOperational && !r.isFree && days !== null && days >= 0 && days <= 3;
                  const isExpired =
                    !r.isOperational && !r.isFree && days !== null && days < 0;
                  return (
                    <TableRow
                      key={r.id}
                      onClick={() => handleOpenSheet(r)}
                      className={cn(
                        "cursor-pointer",
                        isLow && "bg-warning/10 hover:bg-warning/20",
                        isNegative && "bg-destructive/10 hover:bg-destructive/15",
                        !r.isActive && "opacity-60",
                      )}
                    >
                      <TableCell className="pl-4 font-medium">
                        <div className="flex flex-col leading-tight">
                          <span className="inline-flex items-center gap-2 leading-tight">
                            {r.name}
                            {r.isOperational && <OperationalBadge />}
                            {!r.isFree && (
                              r.contabilizaCmv ? (
                                <span
                                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  title="Item contabilizado no CMV"
                                  aria-label="Contabiliza CMV"
                                >
                                  <DollarSign className="h-2.5 w-2.5" strokeWidth={3} />
                                </span>
                              ) : (
                                <span
                                  className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground"
                                  title="Item fora do cálculo de CMV"
                                  aria-label="Não contabiliza CMV"
                                >
                                  <DollarSign className="h-2.5 w-2.5" strokeWidth={3} />
                                  <span className="absolute inset-0 flex items-center justify-center">
                                    <span className="h-[1.5px] w-3 rotate-45 bg-muted-foreground/80" />
                                  </span>
                                </span>
                              )
                            )}
                            {!r.isActive && (
                              <Badge variant="outline" className="text-[10px]">
                                Inativo
                              </Badge>
                            )}
                          </span>
                          {r.categoryPath && (
                            <span className="text-[10px] text-muted-foreground/80">
                              {r.categoryPath}
                            </span>
                          )}
                          {(r.tagPaths.length > 0 ||
                            r.coverageDays !== null) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              {r.tagPaths.map((tp) => (
                                <Badge
                                  key={tp}
                                  variant="outline"
                                  className="h-4 px-1 text-[9px] font-normal"
                                >
                                  {tp}
                                </Badge>
                              ))}
                              {r.coverageDays !== null && (
                                <span
                                  className={cn(
                                    "text-[9px] tabular-nums",
                                    r.coverageDays <= 3
                                      ? "text-destructive"
                                      : r.coverageDays <= 7
                                        ? "text-warning-foreground"
                                        : "text-muted-foreground/80",
                                  )}
                                  title={`Cobertura estimada com base nos últimos ${coverageWindow} dias`}
                                >
                                  ~{r.coverageDays}d cobertura
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className={cn(
                            "inline-flex flex-col items-end leading-tight",
                            isNegative && "text-destructive",
                            isLow && "text-warning-foreground",
                          )}
                        >
                          {(() => {
                            if (r.isFree) {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 text-base font-semibold text-sky-600"
                                  title={r.isWater ? "Água — estoque infinito (item de sistema)" : "Item livre — estoque infinito"}
                                >
                                  ∞
                                </span>
                              );
                            }
                            if (r.isOperational) {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                                  title="Item Operacional — saldo sempre disponível"
                                >
                                  Disponível
                                </span>
                              );
                            }
                            // Unidade compartilhada: o saldo é sempre persistido em KG no banco.
                            // A "Unidade Principal" do cadastro define apenas qual valor aparece em destaque.
                            // Trocar a unidade NÃO recalcula nem gera movimentação — só promove a leitura.
                            if (r.hasUnitDrawer) {
                              const primaryIsUn = r.displayUnit === "UN";
                              const secondaryValue = primaryIsUn
                                ? r.totalWeightKg
                                : r.totalUnits;
                              const secondaryLabel = primaryIsUn ? "KG" : "UN";
                              // Quando há embalagens divergentes, riscamos a UN
                              // secundária (priorize contagem por KG/L).
                              const strikeSecondary =
                                r.divergentPackaging && secondaryLabel === "UN";
                              // Trava absoluta: quando há divergência de embalagens,
                                // a coluna UN secundária é COMPLETAMENTE OCULTADA — não rasurada.
                                // Força o usuário a contar exclusivamente por KG/L.
                                const hideSecondary =
                                  r.divergentPackaging && secondaryLabel === "UN";
                              return (
                                <>
                                  <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                                    {(isLow || isNegative) && (
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                    )}
                                    {primaryIsUn ? formatUn(r.displayQuantity) : formatKg(r.displayQuantity)}
                                    <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {r.displayUnit}
                                    </span>
                                  </span>
                                  {!hideSecondary && (
                                    <span
                                      className={cn(
                                        "text-[11px] tabular-nums text-muted-foreground/80",
                                        strikeSecondary && "line-through opacity-60",
                                      )}
                                    >
                                      ({secondaryLabel === "UN" ? formatUn(secondaryValue) : formatKg(secondaryValue)}{" "}
                                      {secondaryLabel})
                                    </span>
                                  )}
                                  {r.divergentPackaging && (
                                    <span
                                      className="mt-0.5 inline-flex max-w-[220px] items-start gap-1 text-right text-[10px] leading-tight text-amber-600 dark:text-amber-400"
                                      title="Embalagens com pesos diferentes detectadas"
                                    >
                                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                      <span>
                                        Embalagens com pesos diferentes. Priorize a contagem por KG/L.
                                      </span>
                                    </span>
                                  )}
                                </>
                              );
                            }
                            return (
                              <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                                {(isLow || isNegative) && (
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                )}
                                {r.quantity.toLocaleString("pt-BR", {
                                  maximumFractionDigits: 3,
                                })}
                                <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {(r.unit || "un").toUpperCase()}
                                </span>
                              </span>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          isLow || isNegative
                            ? "font-semibold text-warning-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {r.isOperational || r.isFree
                          ? "—"
                          : r.minStock > 0
                            ? `${r.minStock} ${(r.unit || "un").toUpperCase()}`
                            : "—"}
                      </TableCell>
                      {isManager && (
                        <>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {r.displayCost > 0 ? (
                              r.hasUnitDrawer ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <span className="font-medium text-foreground">
                                    {fmtBRL(r.displayCost)}
                                    <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                      /{r.displayUnit}
                                    </span>
                                  </span>
                                  {r.secondaryCost > 0 && (
                                    <span className="text-[11px] text-muted-foreground/70">
                                      ({fmtBRL(r.secondaryCost)}
                                      <span className="ml-0.5 text-[10px] uppercase tracking-wide">
                                        /{r.displayUnit === "UN" ? "KG" : "UN"}
                                      </span>
                                      )
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span>
                                  {fmtBRL(r.displayCost)}
                                  <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                    /{(r.unit || "un").toUpperCase()}
                                  </span>
                                </span>
                              )
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">
                            {r.totalValue > 0 ? fmtBRL(r.totalValue) : "—"}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="pr-4 text-right">
                        {r.expiry ? (
                          <Badge
                            variant={
                              isExpired || isExpiringSoon
                                ? "destructive"
                                : "secondary"
                            }
                            className="gap-1 font-normal"
                          >
                            {(isExpired || isExpiringSoon) && (
                              <CalendarClock className="h-3 w-3" />
                            )}
                            {formatDate(r.expiry)}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      </main>

      {/* Drawer de ações */}
      <ItemActionsSheet
        active={active}
        onClose={() => setActive(null)}
        onTransfer={handleTransferFromSheet}
      />

      {/* TransferDialog controlado para abrir a partir do drawer */}
      {central && (
        <TransferDialog
          items={centralData.items.filter(
            (i) =>
              !(i as { is_operational?: boolean }).is_operational &&
              !isFreeItem(i),
          )}
          locations={centralData.locations}
          stockLevels={centralData.stock}
          hideTrigger
          open={transferOpen}
          onOpenChange={setTransferOpen}
          defaultItemId={transferItemId}
        />
      )}

      {/* Modal simplificado para Insumos Operacionais */}
      <OperationalItemDialog
        open={opDialogOpen}
        onClose={() => setOpDialogOpen(false)}
        itemId={opEditingId}
        initialName={opInitialName}
        initialUnit={opInitialUnit}
        onCreateNew={() => {
          // Abre o modal já em modo "novo" logo após fechar o de edição
          setTimeout(openNewOperational, 0);
        }}
      />

      {/* Modal informativo de Água e Itens Livres */}
      <WaterInfoDialog
        open={waterDialogOpen}
        onOpenChange={(v) => {
          setWaterDialogOpen(v);
          if (!v) setWaterDialogItem(null);
        }}
        itemName={waterDialogItem?.name ?? "Água"}
        isWater={waterDialogItem?.isWater ?? true}
        itemId={waterDialogItem?.id}
      />
    </div>
  );
}
