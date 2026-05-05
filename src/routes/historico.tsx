import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { revertAdjustmentMovement, revertProductionMovement } from "@/server/movements.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useManagerMode } from "@/lib/manager-mode";
import { ReasonConfirmDialog } from "@/components/reason-confirm-dialog";
import { writeAuditLog } from "@/lib/audit-log";
import { useOrgId } from "@/lib/use-org-id";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  History,
  ArrowDownToLine,
  ArrowRightLeft,
  ClipboardEdit,
  ClipboardList,
  TrendingDown,
  TrendingUp,
  ChevronDown,
  ChefHat,
  Package,
  Trash2,
  Utensils,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { reasonLabel, type ReasonCategory } from "@/lib/movement-categories";

export const Route = createFileRoute("/historico")({
  component: HistoricoPage,
});

// Origem/Motivo unificado: combina type da movimentação + reason_category
type OriginFilter =
  | "all"
  | "entry" // Compras/NF
  | "sale" // Vendas
  | "consumption_food" // Consumo Alimentação (consumption sem reason=staff)
  | "staff_meal" // Alimentação Equipe (consumption + reason=staff)
  | "waste_discard" // Descarte (waste sem reason específico ou other)
  | "waste_expired" // Vencido
  | "waste_process" // Perda de Processo
  | "adjustment" // Inventário/Ajuste
  | "transfer"; // Transferência

type StatusFilter = "all" | "edited" | "reverted" | "normal";

const ORIGIN_GROUPS: Array<{
  label: string;
  options: Array<{ value: OriginFilter; label: string }>;
}> = [
  {
    label: "Entradas",
    options: [{ value: "entry", label: "Compras / NF" }],
  },
  {
    label: "Saídas",
    options: [
      { value: "sale", label: "Vendas" },
      { value: "consumption_food", label: "Consumo Alimentação" },
      { value: "staff_meal", label: "Alimentação Equipe" },
    ],
  },
  {
    label: "Perdas",
    options: [
      { value: "waste_discard", label: "Descarte" },
      { value: "waste_expired", label: "Vencido" },
      { value: "waste_process", label: "Perda de Processo" },
    ],
  },
  {
    label: "Ajustes",
    options: [
      { value: "adjustment", label: "Inventário / Ajuste" },
      { value: "transfer", label: "Transferência" },
    ],
  },
];

type Movement = {
  id: string;
  type: string;
  item_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  note: string | null;
  created_at: string;
  invoice_id: string | null;
  operation_id: string | null;
  status?: string | null;
  edited_at?: string | null;
  reverted_at?: string | null;
  reason_category?: string | null;
};

type Incident = {
  id: string;
  movement_id: string | null;
  location_id: string;
  item_id: string;
  missing_qty: number;
  resulting_balance: number;
  movement_type: string | null;
  reason_category: string | null;
  note: string | null;
  resolved_at: string | null;
  created_at: string;
};

type ItemRow = { id: string; name: string; unit: string; cost_price: number };
type LocRow = { id: string; name: string };
type InvoiceRow = {
  id: string;
  number: string | null;
  supplier_name: string | null;
  total_value: number | null;
  issue_date: string | null;
};

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function withinRange(d: Date, range: DateRange | undefined) {
  if (!range?.from && !range?.to) return true;
  if (range.from) {
    const start = new Date(range.from);
    start.setHours(0, 0, 0, 0);
    if (d < start) return false;
  }
  if (range.to) {
    const end = new Date(range.to);
    end.setHours(23, 59, 59, 999);
    if (d > end) return false;
  }
  return true;
}

function matchesOrigin(m: Movement, origin: OriginFilter): boolean {
  if (origin === "all") return true;
  const t = m.type;
  const r = m.reason_category ?? null;
  switch (origin) {
    case "entry":
      return t === "entry" || t === "production_in";
    case "sale":
      return t === "sale";
    case "consumption_food":
      return t === "consumption" && r !== "staff";
    case "staff_meal":
      return t === "consumption" && r === "staff";
    case "waste_discard":
      return t === "waste" && (r === null || r === "other");
    case "waste_expired":
      return t === "waste" && r === "expired";
    case "waste_process":
      return t === "waste" && r === "process_loss";
    case "adjustment":
      return t === "adjustment";
    case "transfer":
      return t === "transfer";
  }
}

function movementStatusKey(m: Movement): "edited" | "reverted" | "normal" {
  if (m.status === "reverted" || m.reverted_at) return "reverted";
  if (m.status === "edited" || m.edited_at) return "edited";
  return "normal";
}

function HistoricoPage() {
  const { isManager } = useManagerMode();
  const orgId = useOrgId();
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [openReportKey, setOpenReportKey] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [confirmRevertProdId, setConfirmRevertProdId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["historico"] });
    qc.invalidateQueries({ queryKey: ["central"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["local"] });
    qc.invalidateQueries({ queryKey: ["inventario-system-stock"] });
    qc.invalidateQueries({ queryKey: ["inventario-reports"] });
  };

  const revertMutation = useMutation({
    mutationFn: async ({ movementId, reason }: { movementId: string; reason: string }) => {
      const result = await revertAdjustmentMovement({ data: { movementId } });
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "movements",
          entityType: "movement",
          entityId: movementId,
          action: "revert",
          reason,
          metadata: { kind: "adjustment" },
        });
      }
      return result;
    },
    onSuccess: () => {
      toast.success("Ajuste estornado. Saldo restaurado.");
      invalidateAll();
      setConfirmRevertId(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmRevertId(null);
    },
  });

  const revertProdMutation = useMutation({
    mutationFn: async ({ movementId, reason }: { movementId: string; reason: string }) => {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || !authData.session?.access_token) {
        throw new Error("Sessão expirada. Entre novamente para estornar.");
      }
      const r = await revertProductionMovement({
        data: { movementId },
        headers: { Authorization: `Bearer ${authData.session.access_token}` },
      });
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "movements",
          entityType: "movement",
          entityId: movementId,
          action: "revert",
          reason,
          metadata: { kind: "production", reverted: r.reverted },
        });
      }
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Operação estornada (${r.reverted} movimentos).`);
      invalidateAll();
      setConfirmRevertProdId(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmRevertProdId(null);
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["historico"],
    queryFn: async () => {
      const [movs, items, locs, invs, incidents] = await Promise.all([
        supabase
          .from("movements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("items").select("id,name,unit,cost_price,is_free").eq("is_free", false),
        supabase.from("locations").select("id,name"),
        supabase.from("invoices").select("id,number,supplier_name,total_value,issue_date"),
        supabase
          .from("movement_incidents")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (movs.error) throw movs.error;
      if (items.error) throw items.error;
      if (locs.error) throw locs.error;
      if (invs.error) throw invs.error;
      if (incidents.error) throw incidents.error;
      return {
        movs: (movs.data ?? []) as Movement[],
        items: (items.data ?? []) as ItemRow[],
        locs: (locs.data ?? []) as LocRow[],
        invoices: (invs.data ?? []) as InvoiceRow[],
        incidents: (incidents.data ?? []) as Incident[],
      };
    },
  });

  const filteredMovs = useMemo(() => {
    if (!data) return [];
    return data.movs.filter((m) => {
      if (!matchesOrigin(m, originFilter)) return false;
      if (statusFilter !== "all" && movementStatusKey(m) !== statusFilter) return false;
      if (!withinRange(new Date(m.created_at), dateRange)) return false;
      if (locationFilter !== "all") {
        if (
          m.from_location_id !== locationFilter &&
          m.to_location_id !== locationFilter
        )
          return false;
      }
      return true;
    });
  }, [data, originFilter, statusFilter, dateRange, locationFilter]);

  // CMV breakdown — agrupa custos por categoria de saída (perdas e alimentação)
  // dentro do filtro vigente. Útil para diferenciar CMV teórico (vendas) do
  // custo real perdido em desperdícios e refeições da equipe.
  const cmvBreakdown = useMemo(() => {
    if (!data) return { waste: 0, processLoss: 0, expired: 0, staff: 0, other: 0, total: 0 };
    const itemMap = new Map(data.items.map((i) => [i.id, i]));
    const acc = { waste: 0, processLoss: 0, expired: 0, staff: 0, other: 0, total: 0 };
    for (const m of filteredMovs) {
      if (m.type !== "waste" && m.type !== "consumption") continue;
      const item = itemMap.get(m.item_id);
      const value =
        Number(m.total_cost ?? 0) ||
        Number(m.quantity) * Number(m.unit_cost ?? item?.cost_price ?? 0);
      if (m.type === "waste") acc.waste += value;
      acc.total += value;
      switch (m.reason_category) {
        case "process_loss":
          acc.processLoss += value;
          break;
        case "expired":
          acc.expired += value;
          break;
        case "staff":
          acc.staff += value;
          break;
        case "other":
          acc.other += value;
          break;
      }
    }
    return acc;
  }, [data, filteredMovs]);

  // Incidentes pendentes (saldo negativo gerado por saída sem estoque).
  const pendingIncidents = useMemo(() => {
    if (!data) return [] as Incident[];
    return data.incidents.filter((i) => {
      if (i.resolved_at) return false;
      if (locationFilter !== "all" && i.location_id !== locationFilter) return false;
      if (!withinRange(new Date(i.created_at), dateRange)) return false;
      return true;
    });
  }, [data, locationFilter, dateRange]);

  type MovGroup = {
    key: string;
    kind: "entry" | "production" | "transfer" | "adjustment" | "production_out" | "other";
    title: string;
    subtitle: string;
    date: string;
    badgeLabel: string;
    badgeClass: string;
    Icon: typeof ArrowDownToLine;
    totalValue: number;
    movements: Movement[];
  };

  const movGroups = useMemo<MovGroup[]>(() => {
    if (!data) return [];
    const invMap = new Map(data.invoices.map((i) => [i.id, i]));
    const locMap = new Map(data.locs.map((l) => [l.id, l]));
    const itemMap = new Map(data.items.map((i) => [i.id, i]));
    const groups = new Map<string, MovGroup>();

    function ensure(key: string, init: () => MovGroup): MovGroup {
      let g = groups.get(key);
      if (!g) {
        g = init();
        groups.set(key, g);
      }
      return g;
    }

    function productionRecipeName(note: string | null): string {
      if (!note) return "Produção";
      const m = note.match(/Produção:\s*([^|]+?)(?:\s*\(sub-produto\))?(?:\s*\[EDITADO\])?\s*(?:\||$)/i);
      return (m?.[1] ?? "Produção").trim();
    }

    for (const m of filteredMovs) {
      const minute = new Date(m.created_at).toISOString().slice(0, 16);
      const item = itemMap.get(m.item_id);
      const lineValue =
        Number(m.total_cost ?? 0) ||
        Number(m.quantity) * Number(m.unit_cost ?? item?.cost_price ?? 0);

      if (m.type === "entry" && m.invoice_id) {
        const inv = invMap.get(m.invoice_id);
        const key = `inv:${m.invoice_id}`;
        const g = ensure(key, () => ({
          key,
          kind: "entry",
          title: `Entrada de Nota Fiscal${inv?.number ? ` #${inv.number}` : ""}`,
          subtitle: inv?.supplier_name ?? "Fornecedor não identificado",
          date: m.created_at,
          badgeLabel: "Entrada",
          badgeClass:
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          Icon: ArrowDownToLine,
          totalValue: 0,
          movements: [],
        }));
        g.movements.push(m);
        g.totalValue += lineValue;
        continue;
      }

      if (m.type === "production_in") {
        const recipeName = productionRecipeName(m.note);
        const key = `prod-in:${recipeName}:${minute}`;
        const g = ensure(key, () => ({
          key,
          kind: "production",
          title: `Produção Própria: ${recipeName}`,
          subtitle: `Quantidade: ${Number(m.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${(item?.unit ?? "un").toUpperCase()}`,
          date: m.created_at,
          badgeLabel: "Produção",
          badgeClass:
            "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          Icon: ChefHat,
          totalValue: 0,
          movements: [],
        }));
        g.movements.push(m);
        g.totalValue += lineValue;
        continue;
      }

      if (m.type === "production_out") {
        // Group with the matching production_in by recipe name + minute window (±2 min)
        const recipeName = productionRecipeName(m.note);
        const ts = new Date(m.created_at).getTime();
        let attached: MovGroup | undefined;
        for (const g of groups.values()) {
          if (g.kind !== "production") continue;
          if (!g.title.endsWith(recipeName)) continue;
          if (Math.abs(new Date(g.date).getTime() - ts) <= 5 * 60 * 1000) {
            attached = g;
            break;
          }
        }
        if (attached) {
          attached.movements.push(m);
          continue;
        }
        const key = `prod-out:${recipeName}:${minute}`;
        const g = ensure(key, () => ({
          key,
          kind: "production",
          title: `Produção Própria: ${recipeName} (consumo)`,
          subtitle: "Baixa de insumos",
          date: m.created_at,
          badgeLabel: "Saída",
          badgeClass:
            "border-destructive/40 bg-destructive/10 text-destructive",
          Icon: ChefHat,
          totalValue: 0,
          movements: [],
        }));
        g.movements.push(m);
        continue;
      }

      if (m.type === "transfer") {
        const fromName = locMap.get(m.from_location_id ?? "")?.name ?? "—";
        const toName = locMap.get(m.to_location_id ?? "")?.name ?? "—";
        const key = `tr:${m.from_location_id}->${m.to_location_id}:${minute}`;
        const g = ensure(key, () => ({
          key,
          kind: "transfer",
          title: `Remanejamento Interno: ${fromName} → ${toName}`,
          subtitle: fmtDateTime(m.created_at),
          date: m.created_at,
          badgeLabel: "Transferência",
          badgeClass:
            "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
          Icon: ArrowRightLeft,
          totalValue: 0,
          movements: [],
        }));
        g.movements.push(m);
        continue;
      }

      if (m.type === "adjustment") {
        const locId = m.from_location_id ?? m.to_location_id ?? "";
        const key = `adj:${locId}:${minute}`;
        const g = ensure(key, () => ({
          key,
          kind: "adjustment",
          title: `Ajuste de Inventário · ${locMap.get(locId)?.name ?? "—"}`,
          subtitle: fmtDateTime(m.created_at),
          date: m.created_at,
          badgeLabel: "Ajuste",
          badgeClass:
            "border-destructive/40 bg-destructive/10 text-destructive",
          Icon: ClipboardEdit,
          totalValue: 0,
          movements: [],
        }));
        g.movements.push(m);
        const isLoss = !!m.from_location_id;
        g.totalValue += isLoss ? -lineValue : lineValue;
        continue;
      }

      // fallback: ungrouped, one per movement
      const key = `mov:${m.id}`;
      const g = ensure(key, () => ({
        key,
        kind: "other",
        title: item?.name ?? "Movimentação",
        subtitle: fmtDateTime(m.created_at),
        date: m.created_at,
        badgeLabel: m.type,
        badgeClass: "border-border bg-muted text-foreground",
        Icon: Package,
        totalValue: 0,
        movements: [m],
      }));
      g.totalValue += lineValue;
    }

    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [data, filteredMovs]);

  // Group adjustment movements into "Inventory reports"
  // Bucket: location + minute granularity of created_at
  const reports = useMemo(() => {
    if (!data) return [];
    const adjustments = data.movs.filter((m) => m.type === "adjustment");
    const itemMap = new Map(data.items.map((i) => [i.id, i]));
    const locMap = new Map(data.locs.map((l) => [l.id, l]));

    type Bucket = {
      key: string;
      locationId: string;
      locationName: string;
      date: string;
      movements: Movement[];
      lossValue: number;
      surplusValue: number;
      lossCount: number;
      surplusCount: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const m of adjustments) {
      const locId = m.from_location_id ?? m.to_location_id ?? "";
      if (locationFilter !== "all" && locId !== locationFilter) continue;
      if (!withinRange(new Date(m.created_at), dateRange)) continue;

      const minute = new Date(m.created_at).toISOString().slice(0, 16);
      const key = `${locId}__${minute}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          key,
          locationId: locId,
          locationName: locMap.get(locId)?.name ?? "—",
          date: m.created_at,
          movements: [],
          lossValue: 0,
          surplusValue: 0,
          lossCount: 0,
          surplusCount: 0,
        };
        buckets.set(key, b);
      }
      b.movements.push(m);
      const item = itemMap.get(m.item_id);
      const value = Number(m.quantity) * Number(item?.cost_price ?? 0);
      const isLoss = !!m.from_location_id;
      if (isLoss) {
        b.lossValue += value;
        b.lossCount += 1;
      } else {
        b.surplusValue += value;
        b.surplusCount += 1;
      }
    }
    return Array.from(buckets.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [data, dateRange, locationFilter]);

  const openReport = openReportKey
    ? reports.find((r) => r.key === openReportKey)
    : null;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="h-10 w-10">
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight">Histórico</h1>
          <p className="text-sm text-muted-foreground">
            Movimentações e relatórios de inventário
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={originFilter} onValueChange={(v) => setOriginFilter(v as OriginFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Origem / Motivo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            {ORIGIN_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                {g.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="normal">Normais</SelectItem>
            <SelectItem value="edited">Editados</SelectItem>
            <SelectItem value="reverted">Estornados / Cancelados</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-9 justify-start text-left font-normal",
                !dateRange?.from && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "dd/MM/yy", { locale: ptBR })} –{" "}
                    {format(dateRange.to, "dd/MM/yy", { locale: ptBR })}
                  </>
                ) : (
                  format(dateRange.from, "dd/MM/yy", { locale: ptBR })
                )
              ) : (
                <span>Período</span>
              )}
              {dateRange?.from && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDateRange(undefined);
                  }}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                >
                  limpar
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              locale={ptBR}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Local" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os locais</SelectItem>
            {(data?.locs ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* CMV breakdown — visível apenas para gestores e quando houver custo registrado */}
      {isManager && cmvBreakdown.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> Perda de processo
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums text-destructive">
              {fmtBRL(cmvBreakdown.processLoss)}
            </p>
            <p className="text-[10px] text-muted-foreground">Quebras, derrames, erros de preparo</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Vencido
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {fmtBRL(cmvBreakdown.expired)}
            </p>
            <p className="text-[10px] text-muted-foreground">Validade expirada / fora de padrão</p>
          </div>
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-sky-700 dark:text-sky-400">
              <Utensils className="h-3.5 w-3.5" /> Alimentação equipe
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums text-sky-700 dark:text-sky-400">
              {fmtBRL(cmvBreakdown.staff)}
            </p>
            <p className="text-[10px] text-muted-foreground">Refeições do staff (não-CMV de venda)</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Package className="h-3.5 w-3.5" /> Total saídas categorizadas
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {fmtBRL(cmvBreakdown.total)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Outro: {fmtBRL(cmvBreakdown.other)}
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="movs" className="w-full">
        <TabsList>
          <TabsTrigger value="movs">Movimentações</TabsTrigger>
          <TabsTrigger value="reports">
            Relatórios de Inventário
            {reports.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {reports.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="incidents">
            Incidentes
            {pendingIncidents.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pendingIncidents.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="movs">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : movGroups.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Nenhuma movimentação encontrada para os filtros aplicados.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {movGroups.map((g) => {
                  const open = !!expandedGroups[g.key];
                  const Icon = g.Icon;
                  return (
                    <li key={g.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((p) => ({ ...p, [g.key]: !open }))
                        }
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
                            g.badgeClass,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold">
                              {g.title}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn("font-normal", g.badgeClass)}
                            >
                              {g.badgeLabel}
                            </Badge>
                            {g.movements.length > 1 && (
                              <Badge variant="secondary" className="font-normal">
                                {g.movements.length} itens
                              </Badge>
                            )}
                            {(() => {
                              const allReverted = g.movements.every((m) => m.status === "reverted");
                              const anyEdited = g.movements.some((m) => m.status === "edited");
                              if (allReverted) return (
                                <Badge variant="outline" className="border-destructive/40 text-destructive font-normal">
                                  Estornado
                                </Badge>
                              );
                              if (anyEdited) return (
                                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 font-normal">
                                  Editado
                                </Badge>
                              );
                              return null;
                            })()}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {g.subtitle} · {fmtDateTime(g.date)}
                          </p>
                        </div>
                        {isManager && g.totalValue > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] uppercase text-muted-foreground">
                              Total
                            </p>
                            <p className="text-sm font-semibold tabular-nums">
                              {fmtBRL(g.totalValue)}
                            </p>
                          </div>
                        )}
                        {g.kind === "production" && isManager && g.movements.every((m) => m.status !== "reverted") && (
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                          >
                            <span
                              role="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmRevertProdId(g.movements[0].id);
                              }}
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Estornar
                            </span>
                          </Button>
                        )}
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </button>
                      {open && (
                        <div className="border-t border-border bg-muted/20">
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="pl-4">Item</TableHead>
                                <TableHead className="text-right">Qtd.</TableHead>
                                {isManager && <TableHead className="text-right">Custo unit.</TableHead>}
                                {isManager && <TableHead className="text-right">Custo total</TableHead>}
                                <TableHead>Detalhes</TableHead>
                                <TableHead className="w-[80px] pr-4 text-right">
                                  Ações
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {g.movements.map((m) => {
                                const item = data!.items.find(
                                  (i) => i.id === m.item_id,
                                );
                                const from = data!.locs.find(
                                  (l) => l.id === m.from_location_id,
                                );
                                const to = data!.locs.find(
                                  (l) => l.id === m.to_location_id,
                                );
                                const isAdjust = m.type === "adjustment";
                                const isLoss =
                                  isAdjust && !!m.from_location_id;
                                const isOut = m.type === "production_out";
                                const qty = Number(m.quantity);
                                const unitCost = Number(
                                  m.unit_cost ?? item?.cost_price ?? 0,
                                );
                                const totalCost =
                                  Number(m.total_cost ?? 0) ||
                                  qty * unitCost;
                                const negative = isOut || isLoss;
                                return (
                                  <TableRow key={m.id}>
                                    <TableCell className="pl-4 font-medium">
                                      {item?.name ?? "—"}
                                    </TableCell>
                                    <TableCell
                                      className={cn(
                                        "text-right tabular-nums",
                                        negative && "text-destructive",
                                        isAdjust &&
                                          !isLoss &&
                                          "text-emerald-600 dark:text-emerald-400",
                                      )}
                                    >
                                      {negative
                                        ? "-"
                                        : isAdjust && !isLoss
                                          ? "+"
                                          : ""}
                                      {qty.toLocaleString("pt-BR", {
                                        maximumFractionDigits: 3,
                                      })}{" "}
                                      <span className="text-[10px] uppercase text-muted-foreground">
                                        {(item?.unit || "un").toUpperCase()}
                                      </span>
                                    </TableCell>
                                    {isManager && (
                                      <TableCell className="text-right tabular-nums text-xs">
                                        {unitCost > 0 ? fmtBRL(unitCost) : "—"}
                                      </TableCell>
                                    )}
                                    {isManager && (
                                      <TableCell className="text-right tabular-nums text-xs font-medium">
                                        {totalCost > 0 ? fmtBRL(totalCost) : "—"}
                                      </TableCell>
                                    )}
                                    <TableCell className="text-xs text-muted-foreground">
                                      {isAdjust
                                        ? `${from?.name ?? to?.name ?? "—"} · ${m.note ?? "—"}`
                                        : m.type === "transfer"
                                          ? `${from?.name ?? "—"} → ${to?.name ?? "—"}`
                                          : (m.note ?? "—")}
                                    </TableCell>
                                    <TableCell className="pr-4 text-right">
                                      {isAdjust ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmRevertId(m.id);
                                          }}
                                          disabled={revertMutation.isPending}
                                        >
                                          <Undo2 className="h-3.5 w-3.5" />
                                          Desfazer
                                        </Button>
                                      ) : null}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reports">
          {reports.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Nenhum inventário finalizado encontrado para os filtros
              aplicados.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {reports.map((r) => {
                const net = r.surplusValue - r.lossValue;
                const isNetLoss = net < 0;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setOpenReportKey(r.key)}
                    className="group rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                          <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold capitalize">
                            {r.locationName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDateTime(r.date)}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">
                        {r.movements.length} divergência(s)
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                        <div className="flex items-center gap-1 text-xs text-destructive">
                          <TrendingDown className="h-3 w-3" /> Faltas
                        </div>
                        <p className="mt-1 font-semibold tabular-nums text-destructive">
                          {isManager ? fmtBRL(r.lossValue) : "•••"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.lossCount} item(ns)
                        </p>
                      </div>
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <TrendingUp className="h-3 w-3" /> Sobras
                        </div>
                        <p className="mt-1 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {isManager ? fmtBRL(r.surplusValue) : "•••"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.surplusCount} item(ns)
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
                      <span className="text-muted-foreground">
                        Resultado líquido
                      </span>
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          isNetLoss
                            ? "text-destructive"
                            : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {isManager ? `${net > 0 ? "+" : ""}${fmtBRL(net)}` : "•••"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="incidents">
          {pendingIncidents.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Nenhum incidente pendente. Saídas com saldo insuficiente aparecem aqui para auditoria.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Local</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Faltante</TableHead>
                    <TableHead className="text-right">Saldo resultante</TableHead>
                    <TableHead>Obs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingIncidents.map((inc) => {
                    const item = data?.items.find((i) => i.id === inc.item_id);
                    const loc = data?.locs.find((l) => l.id === inc.location_id);
                    return (
                      <TableRow key={inc.id}>
                        <TableCell className="text-xs">{fmtDateTime(inc.created_at)}</TableCell>
                        <TableCell className="text-xs font-medium">{loc?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{item?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="font-normal">
                            {reasonLabel(inc.reason_category as ReasonCategory | null)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-destructive">
                          {Number(inc.missing_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {(item?.unit ?? "un").toUpperCase()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-destructive">
                          {Number(inc.resulting_balance).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={inc.note ?? ""}>
                          {inc.note ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Report Detail Dialog */}
      <Dialog
        open={!!openReport}
        onOpenChange={(o) => !o && setOpenReportKey(null)}
      >
        <DialogContent className="max-w-2xl">
          {openReport && (
            <>
              <DialogHeader>
                <DialogTitle className="capitalize">
                  Inventário · {openReport.locationName}
                </DialogTitle>
                <DialogDescription>
                  {fmtDate(openReport.date)} ·{" "}
                  {new Date(openReport.date).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {openReport.movements.length} divergência(s)
                </DialogDescription>
              </DialogHeader>

              {isManager && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                    <p className="text-xs text-destructive">Total de faltas</p>
                    <p className="font-semibold text-destructive">
                      {fmtBRL(openReport.lossValue)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Total de sobras
                    </p>
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {fmtBRL(openReport.surplusValue)}
                    </p>
                  </div>
                </div>
              )}

              <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      {isManager && <TableHead className="text-right">Valor</TableHead>}
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openReport.movements.map((m) => {
                      const item = data!.items.find(
                        (i) => i.id === m.item_id,
                      );
                      const isLoss = !!m.from_location_id;
                      const value =
                        Number(m.quantity) * Number(item?.cost_price ?? 0);
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">
                            {item?.name ?? "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              isLoss
                                ? "text-destructive"
                                : "text-emerald-600 dark:text-emerald-400",
                            )}
                          >
                            {isLoss ? "-" : "+"}
                            {Number(m.quantity).toLocaleString("pt-BR", {
                              maximumFractionDigits: 3,
                            })}{" "}
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {(item?.unit || "un").toUpperCase()}
                            </span>
                          </TableCell>
                          {isManager && (
                            <TableCell
                              className={cn(
                                "text-right tabular-nums",
                                isLoss
                                  ? "text-destructive"
                                  : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {fmtBRL(value)}
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                isLoss
                                  ? "border-destructive/40 text-destructive"
                                  : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {isLoss ? "Falta" : "Sobra"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmRevertId(m.id)}
                              disabled={revertMutation.isPending}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              Desfazer
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ReasonConfirmDialog
        open={!!confirmRevertId}
        onOpenChange={(o) => !o && setConfirmRevertId(null)}
        title="Desfazer este ajuste?"
        description="O saldo do estoque será revertido ao valor exato anterior a este ajuste e a movimentação será removida do histórico. A ação ficará registrada no log de auditoria."
        confirmLabel="Desfazer ajuste"
        destructive
        pending={revertMutation.isPending}
        onConfirm={(reason) => {
          if (confirmRevertId) revertMutation.mutate({ movementId: confirmRevertId, reason });
        }}
      />

      <ReasonConfirmDialog
        open={!!confirmRevertProdId}
        onOpenChange={(o) => !o && setConfirmRevertProdId(null)}
        title="Estornar esta produção/processamento?"
        description="Os insumos serão devolvidos ao estoque de origem, os lotes gerados serão removidos e o custo médio dos itens recalculado. Bloqueado se algum lote já tiver sido consumido."
        confirmLabel="Confirmar estorno"
        destructive
        pending={revertProdMutation.isPending}
        onConfirm={(reason) => {
          if (confirmRevertProdId) revertProdMutation.mutate({ movementId: confirmRevertProdId, reason });
        }}
      />

      <ReasonConfirmDialog
        open={!!confirmRevertProdId}
        onOpenChange={(o) => !o && setConfirmRevertProdId(null)}
        title="Estornar esta produção/processamento?"
        description="Os insumos serão devolvidos ao estoque de origem, os lotes gerados serão removidos e o custo médio dos itens recalculado. Bloqueado se algum lote já tiver sido consumido."
        confirmLabel="Confirmar estorno"
        destructive
        pending={revertProdMutation.isPending}
        onConfirm={(reason) => {
          if (confirmRevertProdId) revertProdMutation.mutate({ movementId: confirmRevertProdId, reason });
        }}
      />
    </div>
  );
}
