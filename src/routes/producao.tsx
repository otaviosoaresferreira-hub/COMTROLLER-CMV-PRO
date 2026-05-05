import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { revertProductionMovement } from "@/server/movements.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductionDialog } from "@/components/production-dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
import {
  ArrowLeft,
  ChefHat,
  MapPin,
  Clock,
  Package,
  Scale,
  DollarSign,
  Pencil,
  History,
  CalendarRange,
  Trash2,
} from "lucide-react";
import { useManagerMode } from "@/lib/manager-mode";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export const Route = createFileRoute("/producao")({
  component: ProducaoPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

const fmtKg = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const fmtUn = (n: number) =>
  n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 1,
  });

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateBR(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type FilterKey = "today" | "yesterday" | "3d" | "week" | "custom" | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "3d", label: "Últimos 3 dias" },
  { key: "week", label: "Última semana" },
  { key: "all", label: "Tudo" },
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function getRange(filter: FilterKey, custom: DateRange | undefined): { from: Date; to: Date } | null {
  const now = new Date();
  if (filter === "all") return null;
  if (filter === "today") return { from: startOfDay(now), to: endOfDay(now) };
  if (filter === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOfDay(y), to: endOfDay(y) };
  }
  if (filter === "3d") {
    const f = new Date(now);
    f.setDate(f.getDate() - 2);
    return { from: startOfDay(f), to: endOfDay(now) };
  }
  if (filter === "week") {
    const f = new Date(now);
    f.setDate(f.getDate() - 6);
    return { from: startOfDay(f), to: endOfDay(now) };
  }
  if (filter === "custom" && custom?.from) {
    return { from: startOfDay(custom.from), to: endOfDay(custom.to ?? custom.from) };
  }
  return null;
}

function ProducaoPage() {
  const { isManager } = useManagerMode();
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("week");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);

  const deleteProduction = useMutation({
    mutationFn: async (movementId: string) => {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || !authData.session?.access_token) {
        throw new Error("Sessão expirada. Entre novamente para estornar.");
      }
      return revertProductionMovement({
        data: { movementId },
        headers: { Authorization: `Bearer ${authData.session.access_token}` },
      });
    },
    onSuccess: () => {
      toast.success("Produção estornada. Estoque e CMV restaurados.");
      qc.invalidateQueries();
      setDeleteId(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteId(null);
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["producoes"],
    queryFn: async () => {
      const [movs, items, locs, recipes] = await Promise.all([
        supabase
          .from("movements")
          .select("*")
          .eq("type", "production_in")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("items").select("id,name,unit,avg_weight_g,standard_weight_g"),
        supabase.from("locations").select("id,name"),
        supabase.from("recipes").select("id,name,unit_weight_g,yield_unit"),
      ]);
      if (movs.error) throw movs.error;
      if (items.error) throw items.error;
      if (locs.error) throw locs.error;
      if (recipes.error) throw recipes.error;
      return { movs: movs.data, items: items.data, locs: locs.data, recipes: recipes.data };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const parseBR = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));
    return data.movs.map((m) => {
      const item = data.items.find((i) => i.id === m.item_id);
      const loc = data.locs.find((l) => l.id === m.to_location_id);
      const note = m.note ?? "";

      const isEdited = /\[EDITADO\]/i.test(note);

      const costMatch = note.match(/Custo total\s+R\$\s*([\d.,]+)/i);
      const cost = costMatch ? parseBR(costMatch[1]) : null;

      const unitCostMatch = note.match(/Custo unitário\s+R\$\s*([\d.,]+)/i);
      const noteUnitCost = unitCostMatch ? parseBR(unitCostMatch[1]) : null;

      const cpkMatch = note.match(/Custo\/kg\s+R\$\s*([\d.,]+)/i);
      const noteCostPerKg = cpkMatch ? parseBR(cpkMatch[1]) : null;

      const cpuMatch = note.match(/Custo\/un\s+R\$\s*([\d.,]+)/i);
      const noteCostPerUn = cpuMatch ? parseBR(cpuMatch[1]) : null;

      const pesoMatch = note.match(/Peso\s+([\d.,]+)\s*kg/i);
      const notePesoKg = pesoMatch ? parseBR(pesoMatch[1]) : null;

      const unidadesMatch = note.match(/Unidades\s+([\d.,]+)/i);
      const noteUnidades = unidadesMatch ? parseBR(unidadesMatch[1]) : null;

      // Peso unitário REAL gravado pela ProductionDialog: "Peso unitário 196 g/un"
      // ou "Peso unitário 0,196 kg/un". Tem prioridade máxima sobre avg/std.
      const realUnitMatch = note.match(/Peso\s+unit[áa]rio\s+([\d.,]+)\s*(g|kg)\s*\/\s*un/i);
      let realUnitKg: number | null = null;
      if (realUnitMatch) {
        const v = parseBR(realUnitMatch[1]);
        realUnitKg = realUnitMatch[2].toLowerCase() === "kg" ? v : v / 1000;
      }

      const recipeMatch = note.match(/Produção(?:\s*\(.*?\))?:\s*([^|]+)/);
      const recipeNameRaw = recipeMatch ? recipeMatch[1].trim() : (item?.name ?? "Produção");
      const recipeName = recipeNameRaw.replace(/\s*\[EDITADO\]\s*/i, "").trim();

      const baseUnit = (item?.unit ?? "un").toUpperCase();
      const quantity = Number(m.quantity);

      const recipeMatched = data.recipes.find(
        (r) => r.name.trim().toLowerCase() === recipeName.trim().toLowerCase(),
      );
      const recipeUnitG = Number(recipeMatched?.unit_weight_g ?? 0);
      const avgG = Number(item?.avg_weight_g ?? 0);
      const stdG = Number(item?.standard_weight_g ?? 0);
      // Hierarquia: 1) peso unitário real desta leva (note) → 2) avg/std → 3) ficha técnica
      const wKg =
        realUnitKg && realUnitKg > 0
          ? realUnitKg
          : avgG > 0
            ? avgG / 1000
            : stdG > 0
              ? stdG / 1000
              : recipeUnitG > 0
                ? recipeUnitG / 1000
                : 0;

      let qtyKg = 0;
      let qtyUn = 0;
      if (baseUnit === "KG") {
        qtyKg = quantity;
        if (notePesoKg !== null && notePesoKg > 0) qtyKg = notePesoKg;
        if (noteUnidades !== null && noteUnidades > 0) qtyUn = noteUnidades;
        else if (wKg > 0) qtyUn = qtyKg / wKg;
      } else if (baseUnit === "UN") {
        qtyUn = quantity;
        if (noteUnidades !== null && noteUnidades > 0) qtyUn = noteUnidades;
        if (notePesoKg !== null && notePesoKg > 0) qtyKg = notePesoKg;
        else if (wKg > 0) qtyKg = qtyUn * wKg;
      } else {
        qtyKg = quantity;
      }

      const costPerKg =
        noteCostPerKg !== null ? noteCostPerKg : cost !== null && qtyKg > 0 ? cost / qtyKg : null;
      const costPerUn =
        noteCostPerUn !== null ? noteCostPerUn : cost !== null && qtyUn > 0 ? cost / qtyUn : null;
      const unitCost =
        noteUnitCost !== null
          ? noteUnitCost
          : cost !== null && quantity > 0
            ? cost / quantity
            : null;

      const hasUnits = qtyUn > 0;

      return {
        id: m.id,
        date: m.created_at,
        recipeName,
        itemName: item?.name,
        baseUnit,
        quantity,
        qtyKg,
        qtyUn,
        hasUnits,
        // Peso por unidade real desta leva (kg/un) — fonte: note > avg > std > ficha
        unitWeightKg: wKg,
        location: loc?.name ?? "—",
        cost,
        unitCost,
        costPerKg,
        costPerUn,
        isEdited,
      };
    });
  }, [data]);

  // Apply temporal filter
  const filteredRows = useMemo(() => {
    const range = getRange(filter, customRange);
    if (!range) return rows;
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    return rows.filter((r) => {
      const t = new Date(r.date).getTime();
      return t >= fromMs && t <= toMs;
    });
  }, [rows, filter, customRange]);

  // Group by recipe name (subproduct)
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filteredRows>();
    for (const r of filteredRows) {
      const key = r.recipeName || "Produção";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([name, items]) => {
        const totalKg = items.reduce((a, b) => a + (b.qtyKg ?? 0), 0);
        const totalUn = items.reduce((a, b) => a + (b.qtyUn ?? 0), 0);
        const totalCost = items.reduce((a, b) => a + (b.cost ?? 0), 0);
        return { name, items, totalKg, totalUn, totalCost, count: items.length };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [filteredRows]);

  const totalCost = filteredRows.reduce((acc, r) => acc + (r.cost ?? 0), 0);

  const customLabel =
    customRange?.from
      ? customRange.to
        ? `${fmtDateBR(customRange.from)} – ${fmtDateBR(customRange.to)}`
        : fmtDateBR(customRange.from)
      : "Personalizado";

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ChefHat className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Módulo de produção
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">Produções</h1>
          </div>
          <ProductionDialog />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {/* Temporal filters */}
        <section className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Filtro de período
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                onClick={() => setFilter(f.key)}
                className="h-8"
              >
                {f.label}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={filter === "custom" ? "default" : "outline"}
                  className="h-8"
                >
                  {filter === "custom" ? customLabel : "Personalizado"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r);
                    if (r?.from) setFilter("custom");
                  }}
                  numberOfMonths={1}
                />
              </PopoverContent>
            </Popover>
          </div>
        </section>

        {/* Summary */}
        {isManager && filteredRows.length > 0 && (
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Produções no período
              </p>
              <p className="text-2xl font-bold tabular-nums">{filteredRows.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Custo acumulado
              </p>
              <p className="text-2xl font-bold tabular-nums">{fmtBRL(totalCost)}</p>
            </div>
          </section>
        )}

        {/* Accordion by subproduct */}
        <section className="rounded-2xl border border-border bg-card shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhuma produção no período selecionado</p>
              <p className="text-xs text-muted-foreground">
                Ajuste o filtro de período ou registre uma nova produção.
              </p>
            </div>
          ) : (
            <Accordion type="multiple" className="w-full">
              {grouped.map((g) => (
                <AccordionItem key={g.name} value={g.name} className="border-b last:border-b-0">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                          <ChefHat className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 text-left">
                          <p className="truncate text-sm font-semibold">{g.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {g.count} {g.count === 1 ? "produção" : "produções"} ·{" "}
                            {fmtKg(g.totalKg)} kg
                            {g.totalUn > 0 ? ` · ${fmtUn(g.totalUn)} un` : ""}
                          </p>
                        </div>
                      </div>
                      {isManager && g.totalCost > 0 && (
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          {fmtBRL(g.totalCost)}
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-0 pb-0">
                    <ul className="divide-y divide-border border-t border-border">
                      {g.items.map((r) => (
                        <li key={r.id} className="relative">
                          <button
                            type="button"
                            onClick={() => setEditId(r.id)}
                            className="group block w-full px-4 py-3 pr-12 text-left transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <Badge variant="secondary" className="gap-1 font-normal">
                                    <MapPin className="h-3 w-3" /> {r.location}
                                  </Badge>
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {fmtDateTime(r.date)}
                                  </span>
                                  {r.isEdited && (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                                    >
                                      <History className="h-3 w-3" /> Editado
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                {isManager && r.cost !== null && (
                                  <>
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      Custo total
                                    </p>
                                    <p className="text-sm font-bold tabular-nums">
                                      {fmtBRL(r.cost)}
                                    </p>
                                  </>
                                )}
                                <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                                  <Pencil className="h-3 w-3" /> editar
                                </div>
                              </div>
                            </div>

                            <div
                              className={cn(
                                "mt-3 grid gap-2",
                                r.hasUnits ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2",
                              )}
                            >
                              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  <Scale className="h-3 w-3" /> Peso total produzido
                                </p>
                                <p className="text-sm font-semibold tabular-nums">
                                  {r.qtyKg > 0 ? `${fmtKg(r.qtyKg)} kg` : "—"}
                                </p>
                                {r.hasUnits && r.unitWeightKg > 0 && (
                                  <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                                    {fmtUn(r.qtyUn)} un de{" "}
                                    {r.unitWeightKg.toLocaleString("pt-BR", {
                                      minimumFractionDigits: 3,
                                      maximumFractionDigits: 3,
                                    })}{" "}
                                    kg
                                  </p>
                                )}
                              </div>

                              {isManager && (
                                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    <DollarSign className="h-3 w-3" /> Custo / kg
                                  </p>
                                  <p className="text-sm font-semibold tabular-nums">
                                    {r.costPerKg !== null ? fmtBRL(r.costPerKg) : "—"}
                                  </p>
                                </div>
                              )}

                              {r.hasUnits && (
                                <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary/80">
                                    <Package className="h-3 w-3" /> Quantidade produzida
                                  </p>
                                  <p className="text-sm font-bold tabular-nums text-primary">
                                    {fmtUn(r.qtyUn)} un
                                  </p>
                                  {r.unitWeightKg > 0 && (
                                    <p className="mt-0.5 text-[10px] text-primary/70 tabular-nums">
                                      Rend. real:{" "}
                                      {r.unitWeightKg.toLocaleString("pt-BR", {
                                        minimumFractionDigits: 3,
                                        maximumFractionDigits: 3,
                                      })}{" "}
                                      kg/un
                                    </p>
                                  )}
                                </div>
                              )}

                              {isManager && r.hasUnits && (
                                <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary/80">
                                    <DollarSign className="h-3 w-3" /> Custo / un
                                  </p>
                                  <p className="text-sm font-bold tabular-nums text-primary">
                                    {r.costPerUn !== null ? fmtBRL(r.costPerUn) : "—"}
                                  </p>
                                </div>
                              )}
                            </div>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Excluir produção"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteId(r.id);
                            }}
                            className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </section>
      </main>

      {editId && (
        <ProductionDialog
          editMovementId={editId}
          hideTrigger
          open={true}
          onOpenChange={(v) => {
            if (!v) setEditId(null);
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produção?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja realmente excluir esta produção? Os insumos serão devolvidos ao estoque e o
              produto final será removido. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProduction.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteProduction.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteId) deleteProduction.mutate(deleteId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProduction.isPending ? "Excluindo…" : "Excluir e estornar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
