import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Search,
  X,
  ClipboardCheck,
  AlertTriangle,
  PackageX,
  Sliders,
  ArrowLeftRight,
  CheckSquare,
  Wallet,
  SlidersHorizontal,
  History,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ProductionDialog } from "@/components/production-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { ShiftAuditDialog } from "@/components/shift-audit-dialog";
import { LocationFactorsDialog } from "@/components/location-factors-dialog";
import { RegisterOutputDialog } from "@/components/register-output-dialog";
import { useManagerMode } from "@/lib/manager-mode";
import { useOrgId } from "@/lib/use-org-id";
import { Trash2 as TrashIcon } from "lucide-react";
import { toast } from "sonner";
import {
  getBreadcrumb,
  LOCATION_TYPE_META,
  type LocationType,
  type LocationNode,
} from "@/lib/location-hierarchy";
import { ChevronRight } from "lucide-react";
import { DiscrepancyAuditAlerts } from "@/components/discrepancy-audit-alerts";

export const Route = createFileRoute("/local/$locationId")({
  component: LocalPage,
});

type ItemRow = {
  id: string;
  name: string;
  unit: string; // unidade primária (kg/un)
  categoryId: string | null;
  categoryName: string;
  costPrice: number;
  minStock: number;
  // shared-unit
  sharedUnit: boolean;
  avgWeightG: number; // peso médio (g)
  hasUnitDrawer: boolean;
  // saldo neste local (sempre na unidade primária)
  quantity: number;
  // exibição
  displayUnit: "KG" | "UN";
  displayQuantity: number;
  totalUnits: number;
  totalWeightKg: number;
  totalValue: number;
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtUn = (n: number) =>
  Math.floor(Number(n) || 0).toLocaleString("pt-BR");

const fmtKg = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const fmtQty = (n: number, unit: string) =>
  unit.toUpperCase() === "UN" ? fmtUn(n) : fmtKg(n);

function LocalPage() {
  const { locationId } = Route.useParams();
  const { isManager } = useManagerMode();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["local", locationId],
    queryFn: async () => {
      const [items, location, locations, stock, categories, batches] = await Promise.all([
        supabase
          .from("items")
          .select(
            "id,name,unit,min_stock,cost_price,category_id,is_active,shared_unit_enabled,standard_weight_g,avg_weight_g,is_operational",
          )
          .eq("is_active", true)
          .eq("is_free", false),
        supabase
          .from("locations")
          .select("id,name,stock_mode,location_type,parent_id,operation_type")
          .eq("id", locationId)
          .single(),
        supabase
          .from("locations")
          .select("id,name,stock_mode,location_type,parent_id"),
        supabase
          .from("stock_levels")
          .select("item_id,location_id,current_stock,expiry_date"),
        supabase.from("categories").select("id,name"),
        supabase.from("item_batches").select("item_id,units_qty"),
      ]);
      if (items.error) throw items.error;
      if (location.error) throw location.error;
      if (locations.error) throw locations.error;
      if (stock.error) throw stock.error;
      if (categories.error) throw categories.error;
      if (batches.error) throw batches.error;
      return {
        items: items.data,
        location: location.data,
        locations: locations.data,
        stock: stock.data,
        categories: categories.data,
        batches: batches.data,
      };
    },
  });

  if (!isLoading && !data?.location) throw notFound();

  const [search, setSearch] = useState("");
  const [zerosVisible, setZerosVisible] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [factorsOpen, setFactorsOpen] = useState(false);
  const [openCategory, setOpenCategory] = useState<string>("");

  // Modo lote (mantido para seleção opcional via checkbox)
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchPanelOpen, setBatchPanelOpen] = useState(false);
  const [globalTransferOpen, setGlobalTransferOpen] = useState(false);

  // Transferência individual
  const [transferItem, setTransferItem] = useState<ItemRow | null>(null);

  // Ajuste manual & histórico
  const [adjustItem, setAdjustItem] = useState<ItemRow | null>(null);
  const [historyItem, setHistoryItem] = useState<ItemRow | null>(null);

  // Registro de saída categorizada (Descarte / Alimentação)
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputKind, setOutputKind] = useState<"waste" | "staff_meal">("waste");
  const orgId = useOrgId();

  const isCentral = data?.location?.name.toLowerCase().includes("central");

  // Monta todas as linhas (na praça atual) com displayQuantity igual ao Estoque Central
  const allRows: ItemRow[] = useMemo(() => {
    if (!data) return [];
    const unitsByItem = new Map<string, number>();
    data.batches.forEach((b) => {
      unitsByItem.set(b.item_id, (unitsByItem.get(b.item_id) ?? 0) + Number(b.units_qty ?? 0));
    });
    const catName = (id: string | null) =>
      data.categories.find((c) => c.id === id)?.name ?? "Sem categoria";

    return data.items.map((item) => {
      const level = data.stock.find(
        (s) => s.item_id === item.id && s.location_id === locationId,
      );
      const quantity = Number(level?.current_stock ?? 0);
      const sharedUnit = item.shared_unit_enabled === true;
      const avgWeightG = Number(item.avg_weight_g ?? 0);
      const standardWeightG = Number(item.standard_weight_g ?? 0);
      const weightG = avgWeightG > 0 ? avgWeightG : standardWeightG;
      const primaryUnit = (item.unit || "un").toUpperCase();
      const batchUnits = unitsByItem.get(item.id) ?? 0;
      const hasUnitDrawer = sharedUnit || batchUnits > 0;
      // Para itens compartilhados a unidade primária é KG; quantity está em KG.
      const totalWeightKg = primaryUnit === "KG" ? quantity : quantity * (weightG / 1000);
      const derivedUnits = weightG > 0 ? totalWeightKg / (weightG / 1000) : 0;
      const totalUnits = primaryUnit === "UN" ? quantity : derivedUnits;
      const displayUnit: "KG" | "UN" = hasUnitDrawer
        ? primaryUnit === "UN"
          ? "UN"
          : "KG"
        : (primaryUnit as "KG" | "UN");
      const displayQuantity = hasUnitDrawer
        ? displayUnit === "UN"
          ? totalUnits
          : totalWeightKg
        : quantity;
      const isOperational = (item as { is_operational?: boolean }).is_operational === true;
      const costPrice = isOperational ? 0 : Number(item.cost_price ?? 0);
      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        categoryId: item.category_id,
        categoryName: catName(item.category_id),
        costPrice,
        minStock: Number(item.min_stock ?? 0),
        sharedUnit,
        avgWeightG: weightG,
        hasUnitDrawer,
        quantity,
        displayUnit,
        displayQuantity,
        totalUnits,
        totalWeightKg,
        // Custo é por KG para shared (cost_price assumido em KG); para UN, custo por UN.
        totalValue: primaryUnit === "KG" ? totalWeightKg * costPrice : totalUnits * costPrice,
      };
    });
  }, [data, locationId]);

  // Filtro por busca + zerados
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (!zerosVisible && r.displayQuantity === 0) return false;
      return true;
    });
  }, [allRows, search, zerosVisible]);

  // Agrupa por categoria
  const grouped = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    filteredRows.forEach((r) => {
      const key = r.categoryName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries())
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRows]);

  const totalValue = useMemo(
    () => allRows.reduce((sum, r) => sum + r.totalValue, 0),
    [allRows],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedIds(new Set());
  };

  // ============= Mutations de transferência =============
  type TransferLine = {
    item: ItemRow;
    /** Quantidade a transferir, sempre na UNIDADE PRIMÁRIA do item */
    primaryQty: number;
    /** Como o usuário digitou (KG ou UN) — para nota e log */
    inputUnit: "KG" | "UN";
    inputQty: number;
  };

  const performTransfer = useMutation({
    mutationFn: async ({
      lines,
      destinationId,
    }: {
      lines: TransferLine[];
      destinationId: string;
    }) => {
      if (!destinationId) throw new Error("Selecione um destino");
      if (destinationId === locationId) throw new Error("Origem e destino devem ser diferentes");
      if (lines.length === 0) throw new Error("Adicione ao menos um item");

      for (const ln of lines) {
        if (!ln.primaryQty || ln.primaryQty <= 0) {
          throw new Error(`Quantidade inválida para ${ln.item.name}`);
        }
        const fromLevel = data!.stock.find(
          (s) => s.item_id === ln.item.id && s.location_id === locationId,
        );
        const toLevel = data!.stock.find(
          (s) => s.item_id === ln.item.id && s.location_id === destinationId,
        );
        const newFrom = Number(fromLevel?.current_stock ?? 0) - ln.primaryQty;
        const newTo = Number(toLevel?.current_stock ?? 0) + ln.primaryQty;

        const { error: e1 } = await supabase
          .from("stock_levels")
          .upsert(
            {
              item_id: ln.item.id,
              location_id: locationId,
              current_stock: newFrom,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "item_id,location_id" },
          );
        if (e1) throw e1;

        const { error: e2 } = await supabase
          .from("stock_levels")
          .upsert(
            {
              item_id: ln.item.id,
              location_id: destinationId,
              current_stock: newTo,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "item_id,location_id" },
          );
        if (e2) throw e2;

        const note =
          ln.item.hasUnitDrawer && ln.inputUnit === "UN"
            ? `Transferência ${fmtUn(ln.inputQty)} UN (≈ ${fmtKg(ln.primaryQty)} kg)`
            : null;

        const { error: e3 } = await supabase.from("movements").insert({
          item_id: ln.item.id,
          from_location_id: locationId,
          to_location_id: destinationId,
          quantity: ln.primaryQty,
          type: "transfer",
          unit_cost: ln.item.costPrice,
          total_cost: ln.item.costPrice * ln.primaryQty,
          note,
        });
        if (e3) throw e3;
      }
    },
    onSuccess: () => {
      toast.success("Transferência realizada");
      qc.invalidateQueries({ queryKey: ["local"] });
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
      setTransferItem(null);
      setBatchPanelOpen(false);
      exitBatchMode();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const destinations = useMemo(
    () => (data?.locations ?? []).filter((l) => l.id !== locationId),
    [data, locationId],
  );

  const selectedRows = useMemo(
    () => allRows.filter((r) => selectedIds.has(r.id)),
    [allRows, selectedIds],
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          {(() => {
            const loc = data?.location;
            const type = (loc?.location_type ?? "operation") as LocationType;
            const meta = LOCATION_TYPE_META[type];
            const HeaderIcon = meta.icon;
            const breadcrumb = loc
              ? getBreadcrumb(loc as unknown as LocationNode, (data?.locations ?? []) as unknown as LocationNode[])
              : [];
            const ancestors = breadcrumb.slice(0, -1);
            return (
              <>
                <div className={`grid h-10 w-10 place-items-center rounded-xl ${meta.tone}`}>
                  <HeaderIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>{meta.label}</span>
                    {ancestors.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-0.5 truncate">
                          {ancestors.map((a, idx) => (
                            <span key={a.id} className="flex items-center gap-0.5 truncate">
                              <Link
                                to="/local/$locationId"
                                params={{ locationId: a.id }}
                                className="truncate hover:text-primary hover:underline"
                              >
                                {a.name}
                              </Link>
                              {idx < ancestors.length - 1 && (
                                <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                              )}
                            </span>
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="truncate text-base font-semibold leading-tight">
                    {loc?.name ?? "Local"}
                  </h1>
                </div>
              </>
            );
          })()}
          {!isCentral && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => setFactorsOpen(true)}
              aria-label="Fatores de correção"
              title="Fatores de correção"
            >
              <Sliders className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <DiscrepancyAuditAlerts locationId={locationId} />
        {/* Valor total (modo gestor) */}
        {isManager && (
          <section className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Valor Total em Estoque
              </p>
              <p className="text-xl font-bold tabular-nums">{fmtBRL(totalValue)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Itens
              </p>
              <p className="text-base font-semibold tabular-nums">
                {allRows.filter((r) => r.displayQuantity !== 0).length}
              </p>
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3">
          <Button variant="default" className="h-12 gap-2" onClick={() => setCountOpen(true)}>
            <ClipboardCheck className="h-4 w-4" /> Auditoria de turno
          </Button>
          <ProductionDialog
            defaultLocationId={locationId}
            triggerVariant="outline"
            triggerClassName="h-12 w-full"
          />
        </section>

        {/* Transferência em lote — abre modal com TODOS os itens para digitar quantidades */}
        <section className="flex flex-wrap items-center gap-2">
          {batchMode ? (
            <>
              <Button
                size="sm"
                variant="default"
                className="gap-2"
                disabled={selectedIds.size === 0}
                onClick={() => setBatchPanelOpen(true)}
              >
                <ArrowLeftRight className="h-4 w-4" />
                Enviar {selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}
              </Button>
              <Button size="sm" variant="ghost" onClick={exitBatchMode}>
                Cancelar seleção
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="default"
                className="gap-2"
                onClick={() => setGlobalTransferOpen(true)}
              >
                <ArrowLeftRight className="h-4 w-4" />
                Transferência em Lote
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => setBatchMode(true)}
              >
                <CheckSquare className="h-4 w-4" />
                Selecionar itens
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive"
                onClick={() => {
                  setOutputKind("waste");
                  setOutputOpen(true);
                }}
              >
                <TrashIcon className="h-4 w-4" />
                Descarte
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setOutputKind("staff_meal");
                  setOutputOpen(true);
                }}
              >
                Alimentação
              </Button>
            </>
          )}
        </section>

        <section className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar item neste local…"
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

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={zerosVisible ? "default" : "outline"}
              onClick={() => setZerosVisible((v) => !v)}
              className="h-8"
            >
              {zerosVisible ? "Ocultar zerados" : "Mostrar zerados"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {filteredRows.length} {filteredRows.length === 1 ? "item" : "itens"}
            </span>
          </div>
        </section>

        {/* Categorias em acordeão */}
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <PackageX className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum item encontrado</p>
              <p className="text-xs text-muted-foreground">
                {zerosVisible
                  ? "Ajuste a busca para ver mais itens."
                  : "Marque 'Mostrar zerados' para ver todos os insumos."}
              </p>
            </div>
          ) : (
            <Accordion
              type="single"
              collapsible
              value={openCategory}
              onValueChange={setOpenCategory}
              className="divide-y divide-border"
            >
              {grouped.map((g) => {
                const negativos = g.items.filter((i) => i.displayQuantity < 0).length;
                return (
                  <AccordionItem key={g.name} value={g.name} className="border-0">
                    <AccordionTrigger className="px-4 py-4 hover:no-underline">
                      <div className="flex flex-1 items-center justify-between pr-2">
                        <span className="text-base font-semibold">{g.name}</span>
                        <div className="flex items-center gap-2">
                          {negativos > 0 && (
                            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                              {negativos} neg.
                            </span>
                          )}
                          <span className="text-xs font-normal text-muted-foreground">
                            {g.items.length}
                          </span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-0 pb-0">
                      <ul className="divide-y divide-border bg-muted/20">
                        {g.items.map((r) => {
                          const negative = r.displayQuantity < 0;
                          const checked = selectedIds.has(r.id);
                          return (
                            <li
                              key={r.id}
                              className={cn(
                                "flex items-center gap-3 px-4 py-3 transition",
                                negative && "bg-destructive/10",
                                batchMode && "cursor-pointer hover:bg-muted/40",
                              )}
                              onClick={() => {
                                if (batchMode) toggleSelect(r.id);
                              }}
                            >
                              {batchMode && (
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleSelect(r.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-5 w-5"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{r.name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Saldo:{" "}
                                  <span
                                    className={cn(
                                      "font-semibold tabular-nums",
                                      negative && "text-destructive",
                                    )}
                                  >
                                    {negative && (
                                      <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                                    )}
                                    {fmtQty(r.displayQuantity, r.displayUnit)} {r.displayUnit}
                                  </span>
                                  {r.hasUnitDrawer && r.avgWeightG > 0 && (
                                    <span className="ml-1 text-muted-foreground">
                                      (~{fmtUn(r.totalUnits)} UN /{" "}
                                      {fmtKg(r.totalWeightKg)} kg)
                                    </span>
                                  )}
                                </p>
                              </div>
                              {!batchMode && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setHistoryItem(r);
                                    }}
                                    title="Histórico (7 dias)"
                                  >
                                    <History className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAdjustItem(r);
                                    }}
                                    title="Ajuste manual"
                                  >
                                    <SlidersHorizontal className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-9 gap-1.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTransferItem(r);
                                    }}
                                    disabled={r.displayQuantity <= 0}
                                  >
                                    <ArrowLeftRight className="h-3.5 w-3.5" />
                                    Transferir
                                  </Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </section>
      </main>

      <ShiftAuditDialog
        open={countOpen}
        onOpenChange={setCountOpen}
        locationId={locationId}
        locationName={data?.location?.name ?? ""}
      />

      <LocationFactorsDialog
        open={factorsOpen}
        onOpenChange={setFactorsOpen}
        locationId={locationId}
        locationName={data?.location?.name ?? ""}
      />

      {orgId && (
        <RegisterOutputDialog
          open={outputOpen}
          onOpenChange={setOutputOpen}
          locationId={locationId}
          orgId={orgId}
          defaultKind={outputKind}
        />
      )}

      {/* Modal de transferência granular individual */}
      <SingleTransferDialog
        item={transferItem}
        destinations={destinations}
        onClose={() => setTransferItem(null)}
        onConfirm={(line, destinationId) =>
          performTransfer.mutate({ lines: [line], destinationId })
        }
        isPending={performTransfer.isPending}
      />

      {/* Painel de transferência em lote — mostra selecionados ou todos com saldo */}
      <BatchTransferPanel
        open={batchPanelOpen}
        onOpenChange={setBatchPanelOpen}
        items={
          batchMode && selectedRows.length > 0
            ? selectedRows
            : allRows.filter((r) => r.displayQuantity > 0)
        }
        destinations={destinations}
        onConfirm={(lines, destinationId) =>
          performTransfer.mutate({ lines, destinationId })
        }
        isPending={performTransfer.isPending}
      />

      {/* Gerenciador de Movimentação Global — destino padrão = praça atual; origem = Central */}
      {data && (
        <TransferDialog
          hideTrigger
          open={globalTransferOpen}
          onOpenChange={setGlobalTransferOpen}
          items={data.items.filter(
            (i) => !(i as { is_operational?: boolean }).is_operational,
          )}
          locations={data.locations}
          stockLevels={data.stock}
          defaultDestinationId={locationId}
        />
      )}

      {/* Ajuste manual */}
      <AdjustStockDialog
        item={adjustItem}
        locationId={locationId}
        onClose={() => setAdjustItem(null)}
      />

      {/* Histórico de movimentações (7 dias) */}
      <ItemHistoryDialog
        item={historyItem}
        locationId={locationId}
        onClose={() => setHistoryItem(null)}
      />
    </div>
  );
}

// =============================================================
// Modal de transferência individual (granular, com KG/UN)
// =============================================================

type TransferLineOutput = {
  item: ItemRow;
  primaryQty: number;
  inputUnit: "KG" | "UN";
  inputQty: number;
};

function SingleTransferDialog({
  item,
  destinations,
  onClose,
  onConfirm,
  isPending,
}: {
  item: ItemRow | null;
  destinations: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (line: TransferLineOutput, destinationId: string) => void;
  isPending: boolean;
}) {
  const [destId, setDestId] = useState<string>("");
  const [unit, setUnit] = useState<"KG" | "UN">("KG");
  const [qty, setQty] = useState<string>("");

  useEffect(() => {
    if (item) {
      const central = destinations.find((d) => d.name.toLowerCase().includes("central"));
      setDestId(central?.id ?? destinations[0]?.id ?? "");
      setUnit(item.displayUnit);
      setQty("");
    }
  }, [item, destinations]);

  if (!item) return null;

  const weightKg = item.avgWeightG / 1000;
  const qtyNum = Number(qty);
  const valid = !Number.isNaN(qtyNum) && qtyNum > 0;
  // Conversão para a unidade primária (que é como o saldo está armazenado)
  const primaryUnit = (item.unit || "un").toUpperCase();
  let primaryQty = 0;
  if (valid) {
    if (primaryUnit === "KG") {
      // saldo armazenado em KG
      primaryQty = unit === "KG" ? qtyNum : qtyNum * weightKg;
    } else {
      // saldo armazenado em UN
      primaryQty = unit === "UN" ? qtyNum : weightKg > 0 ? qtyNum / weightKg : 0;
    }
  }
  const exceeds = primaryQty > item.quantity;

  const handleQtyChange = (v: string) => {
    if (v === "") {
      setQty("");
      return;
    }
    const n = Number(v);
    if (Number.isNaN(n)) return;
    if (unit === "UN") {
      // máximo 1 casa decimal
      setQty(String(Math.round(n * 10) / 10));
    } else {
      setQty(v);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            Saldo aqui:{" "}
            <span className="font-semibold tabular-nums">
              {fmtQty(item.displayQuantity, item.displayUnit)} {item.displayUnit}
            </span>
            {item.hasUnitDrawer && item.avgWeightG > 0 && (
              <>
                {" "}
                ({fmtUn(item.totalUnits)} UN / {fmtKg(item.totalWeightKg)} kg)
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Destino</Label>
            <Select value={destId} onValueChange={setDestId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {item.hasUnitDrawer && item.avgWeightG > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Inserir em</Label>
              <div className="inline-flex h-10 items-center rounded-lg bg-muted p-1">
                {(["KG", "UN"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      setUnit(u);
                      setQty("");
                    }}
                    className={cn(
                      "h-8 rounded-md px-4 text-sm font-medium transition",
                      unit === u
                        ? "bg-background text-foreground shadow"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Quantidade ({unit})</Label>
            <Input
              type="number"
              inputMode="decimal"
              step={unit === "UN" ? "0.1" : "0.001"}
              min="0"
              value={qty}
              onChange={(e) => handleQtyChange(e.target.value)}
              placeholder="0"
              className="h-12 text-lg tabular-nums"
              autoFocus
            />
            {valid && item.hasUnitDrawer && item.avgWeightG > 0 && (
              <p className="text-xs text-muted-foreground">
                Equivale a:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {unit === "UN"
                    ? `${fmtKg(qtyNum * weightKg)} kg`
                    : `${fmtUn(weightKg > 0 ? qtyNum / weightKg : 0)} UN`}
                </span>
              </p>
            )}
            {exceeds && (
              <p className="text-xs text-destructive">
                ⚠ Maior que o saldo disponível — o saldo ficará negativo.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={!valid || !destId || isPending}
            onClick={() =>
              onConfirm(
                {
                  item,
                  primaryQty,
                  inputUnit: unit,
                  inputQty: qtyNum,
                },
                destId,
              )
            }
          >
            {isPending ? "Enviando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================
// Painel de transferência em lote
// =============================================================

function BatchTransferPanel({
  open,
  onOpenChange,
  items,
  destinations,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: ItemRow[];
  destinations: { id: string; name: string }[];
  onConfirm: (lines: TransferLineOutput[], destinationId: string) => void;
  isPending: boolean;
}) {
  const [destId, setDestId] = useState<string>("");
  const [entries, setEntries] = useState<
    Record<string, { unit: "KG" | "UN"; qty: string }>
  >({});

  useEffect(() => {
    if (open) {
      const central = destinations.find((d) => d.name.toLowerCase().includes("central"));
      setDestId(central?.id ?? destinations[0]?.id ?? "");
      const next: Record<string, { unit: "KG" | "UN"; qty: string }> = {};
      items.forEach((i) => {
        next[i.id] = { unit: i.displayUnit, qty: "" };
      });
      setEntries(next);
    }
  }, [open, items, destinations]);

  const lines: TransferLineOutput[] = useMemo(() => {
    return items
      .map((item) => {
        const e = entries[item.id];
        if (!e) return null;
        const n = Number(e.qty);
        if (Number.isNaN(n) || n <= 0) return null;
        const primaryUnit = (item.unit || "un").toUpperCase();
        const wKg = item.avgWeightG / 1000;
        let primaryQty = 0;
        if (primaryUnit === "KG") {
          primaryQty = e.unit === "KG" ? n : n * wKg;
        } else {
          primaryQty = e.unit === "UN" ? n : wKg > 0 ? n / wKg : 0;
        }
        return {
          item,
          primaryQty,
          inputUnit: e.unit,
          inputQty: n,
        } as TransferLineOutput;
      })
      .filter(Boolean) as TransferLineOutput[];
  }, [entries, items]);

  const updateQty = (id: string, raw: string) => {
    setEntries((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      let next = raw;
      if (cur.unit === "UN" && raw !== "") {
        const n = Number(raw);
        if (!Number.isNaN(n)) next = String(Math.round(n * 10) / 10);
      }
      return { ...prev, [id]: { ...cur, qty: next } };
    });
  };

  const updateUnit = (id: string, unit: "KG" | "UN") => {
    setEntries((prev) => ({
      ...prev,
      [id]: { unit, qty: "" },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transferência em Lote</DialogTitle>
          <DialogDescription>
            Defina a quantidade a enviar de cada item para o mesmo destino.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Destino</Label>
            <Select value={destId} onValueChange={setDestId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((item) => {
              const e = entries[item.id];
              if (!e) return null;
              const wKg = item.avgWeightG / 1000;
              const n = Number(e.qty);
              const primaryUnit = (item.unit || "un").toUpperCase();
              const primaryQty = !Number.isNaN(n)
                ? primaryUnit === "KG"
                  ? e.unit === "KG"
                    ? n
                    : n * wKg
                  : e.unit === "UN"
                    ? n
                    : wKg > 0
                      ? n / wKg
                      : 0
                : 0;
              const exceeds = primaryQty > item.quantity;
              return (
                <li key={item.id} className="space-y-2 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {fmtQty(item.displayQuantity, item.displayUnit)} {item.displayUnit}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.hasUnitDrawer && item.avgWeightG > 0 ? (
                      <div className="inline-flex h-10 items-center rounded-md bg-muted p-1">
                        {(["KG", "UN"] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => updateUnit(item.id, u)}
                            className={cn(
                              "h-8 rounded px-3 text-xs font-medium transition",
                              e.unit === u
                                ? "bg-background text-foreground shadow"
                                : "text-muted-foreground",
                            )}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="rounded-md bg-muted px-3 py-2 text-xs font-medium uppercase">
                        {e.unit}
                      </span>
                    )}
                    <Input
                      type="number"
                      inputMode="decimal"
                      step={e.unit === "UN" ? "0.1" : "0.001"}
                      min="0"
                      value={e.qty}
                      onChange={(ev) => updateQty(item.id, ev.target.value)}
                      placeholder="0"
                      className={cn(
                        "h-10 flex-1 text-base tabular-nums",
                        exceeds && "border-destructive text-destructive",
                      )}
                    />
                  </div>
                  {item.hasUnitDrawer && item.avgWeightG > 0 && n > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      ≈{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {e.unit === "UN"
                          ? `${fmtKg(n * wKg)} kg`
                          : `${fmtUn(wKg > 0 ? n / wKg : 0)} UN`}
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={lines.length === 0 || !destId || isPending}
            onClick={() => onConfirm(lines, destId)}
          >
            {isPending
              ? "Enviando…"
              : `Confirmar (${lines.length}/${items.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================
// Modal de ajuste manual de saldo
// =============================================================
const ADJUST_REASONS = [
  "Perda",
  "Quebra / Avaria",
  "Erro de contagem",
  "Consumo equipe",
  "Devolução",
  "Outro",
];

function AdjustStockDialog({
  item,
  locationId,
  onClose,
}: {
  item: ItemRow | null;
  locationId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [newQty, setNewQty] = useState<string>("");
  const [reason, setReason] = useState<string>(ADJUST_REASONS[0]);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (item) {
      setNewQty(String(item.displayQuantity));
      setReason(ADJUST_REASONS[0]);
      setNote("");
    }
  }, [item]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Item inválido");
      const n = Number(newQty);
      if (Number.isNaN(n)) throw new Error("Quantidade inválida");

      const primaryUnit = (item.unit || "un").toUpperCase();
      const wKg = item.avgWeightG / 1000;
      // Converter newQty (na displayUnit) para a unidade primária
      let primaryQty = n;
      if (item.hasUnitDrawer && item.avgWeightG > 0) {
        if (primaryUnit === "KG" && item.displayUnit === "UN") {
          primaryQty = n * wKg;
        } else if (primaryUnit === "UN" && item.displayUnit === "KG") {
          primaryQty = wKg > 0 ? n / wKg : 0;
        }
      }
      const delta = primaryQty - item.quantity;

      const { error: e1 } = await supabase
        .from("stock_levels")
        .upsert(
          {
            item_id: item.id,
            location_id: locationId,
            current_stock: primaryQty,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
      if (e1) throw e1;

      const { error: e2 } = await supabase.from("movements").insert({
        item_id: item.id,
        from_location_id: delta < 0 ? locationId : null,
        to_location_id: delta > 0 ? locationId : null,
        quantity: Math.abs(delta),
        type: "adjustment",
        unit_cost: item.costPrice,
        total_cost: item.costPrice * Math.abs(delta),
        note: `${reason}${note ? ` — ${note}` : ""}`,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Saldo ajustado");
      qc.invalidateQueries({ queryKey: ["local"] });
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!item) return null;
  const n = Number(newQty);
  const valid = !Number.isNaN(n);
  const delta = valid ? n - item.displayQuantity : 0;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            Ajuste — {item.name}
          </DialogTitle>
          <DialogDescription>
            Saldo atual:{" "}
            <span className="font-semibold tabular-nums">
              {fmtQty(item.displayQuantity, item.displayUnit)} {item.displayUnit}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Novo saldo ({item.displayUnit})</Label>
            <Input
              type="number"
              inputMode="decimal"
              step={item.displayUnit === "UN" ? "0.1" : "0.001"}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="h-12 text-lg tabular-nums"
              autoFocus
            />
            {valid && delta !== 0 && (
              <p
                className={cn(
                  "text-xs font-semibold tabular-nums",
                  delta < 0 ? "text-destructive" : "text-emerald-500",
                )}
              >
                {delta > 0 ? "+" : ""}
                {fmtQty(delta, item.displayUnit)} {item.displayUnit}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Observação (opcional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Detalhes do ajuste…"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={!valid || delta === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Salvando…" : "Confirmar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================
// Histórico de movimentações (7 dias)
// =============================================================
function ItemHistoryDialog({
  item,
  locationId,
  onClose,
}: {
  item: ItemRow | null;
  locationId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["item-history", item?.id, locationId],
    enabled: !!item,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const [moves, locs] = await Promise.all([
        supabase
          .from("movements")
          .select(
            "id,created_at,type,quantity,from_location_id,to_location_id,note,unit_cost",
          )
          .eq("item_id", item!.id)
          .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false }),
        supabase.from("locations").select("id,name,stock_mode,is_shared"),
      ]);
      if (moves.error) throw moves.error;
      if (locs.error) throw locs.error;
      return { moves: moves.data, locs: locs.data };
    },
  });

  if (!item) return null;

  const locName = (id: string | null) =>
    id ? data?.locs.find((l) => l.id === id)?.name ?? "—" : "—";

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Histórico — {item.name}
          </DialogTitle>
          <DialogDescription>Últimos 7 dias nesta praça.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : !data || data.moves.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <PackageX className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium">Sem movimentações</p>
              <p className="text-xs text-muted-foreground">
                Nenhuma entrada ou saída registrada nos últimos 7 dias.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.moves.map((m) => {
                const isIn = m.to_location_id === locationId;
                const qty = Number(m.quantity ?? 0);
                const date = new Date(m.created_at);
                return (
                  <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                    <div
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                        isIn
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {isIn ? (
                        <ArrowDown className="h-4 w-4" />
                      ) : (
                        <ArrowUp className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold capitalize">
                          {m.type === "transfer"
                            ? "Transferência"
                            : m.type === "adjustment"
                              ? "Ajuste"
                              : m.type === "production"
                                ? "Produção"
                                : m.type}
                        </p>
                        <p
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            isIn ? "text-emerald-500" : "text-destructive",
                          )}
                        >
                          {isIn ? "+" : "−"}
                          {fmtQty(qty, item.unit.toUpperCase())}{" "}
                          {item.unit.toUpperCase()}
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {date.toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {isIn ? `de ${locName(m.from_location_id)}` : `para ${locName(m.to_location_id)}`}
                      </p>
                      {m.note && (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          “{m.note}”
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
