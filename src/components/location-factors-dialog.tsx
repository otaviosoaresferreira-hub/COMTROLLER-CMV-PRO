import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, X, Sliders, PackageX } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locationId: string;
  locationName: string;
}

type Row = {
  itemId: string;
  name: string;
  unit: string;
  categoryId: string | null;
  categoryName: string;
  factor: string;
  note: string;
  existingId: string | null;
  originalFactor: number | null;
  originalNote: string | null;
};

export function LocationFactorsDialog({
  open,
  onOpenChange,
  locationId,
  locationName,
}: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [openCategory, setOpenCategory] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["location-factors", locationId],
    enabled: open && !!locationId,
    queryFn: async () => {
      const [items, factors, categories] = await Promise.all([
        supabase
          .from("items")
          .select("id,name,unit,category_id,is_active")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("location_item_factors")
          .select("id,item_id,factor,note")
          .eq("location_id", locationId),
        supabase.from("categories").select("id,name"),
      ]);
      if (items.error) throw items.error;
      if (factors.error) throw factors.error;
      if (categories.error) throw categories.error;
      return { items: items.data, factors: factors.data, categories: categories.data };
    },
  });

  useEffect(() => {
    if (!data) return;
    const factorByItem = new Map(
      data.factors.map((f) => [f.item_id, f] as const),
    );
    const catName = (id: string | null) =>
      data.categories.find((c) => c.id === id)?.name ?? "Sem categoria";
    setRows(
      data.items
        // 🔒 Restrição: somente itens medidos em KG
        .filter((it) => (it.unit || "").toLowerCase() === "kg")
        .map((it) => {
          const f = factorByItem.get(it.id);
          return {
            itemId: it.id,
            name: it.name,
            unit: it.unit,
            categoryId: it.category_id,
            categoryName: catName(it.category_id),
            factor: f ? String(Number(f.factor)) : "",
            note: f?.note ?? "",
            existingId: f?.id ?? null,
            originalFactor: f ? Number(f.factor) : null,
            originalNote: f?.note ?? null,
          };
        }),
    );
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    filtered.forEach((r) => {
      const key = r.categoryName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries())
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
        configured: items.filter((i) => i.factor.trim() !== "").length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const updateRow = (itemId: string, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)),
    );
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const toUpsert: {
        location_id: string;
        item_id: string;
        factor: number;
        note: string | null;
      }[] = [];
      const toDelete: string[] = [];

      for (const r of rows) {
        const trimmed = r.factor.trim().replace(",", ".");
        const noteTrimmed = r.note.trim();
        const hasFactor = trimmed !== "";

        if (!hasFactor) {
          if (r.existingId) toDelete.push(r.existingId);
          continue;
        }

        const factor = Number(trimmed);
        if (!isFinite(factor) || factor <= 0) {
          throw new Error(`Fator inválido para ${r.name}`);
        }

        const changed =
          r.existingId === null ||
          factor !== r.originalFactor ||
          (noteTrimmed || null) !== (r.originalNote || null);

        if (!changed) continue;

        toUpsert.push({
          location_id: locationId,
          item_id: r.itemId,
          factor,
          note: noteTrimmed || null,
        });
      }

      if (toUpsert.length > 0) {
        const { error } = await supabase
          .from("location_item_factors")
          .upsert(toUpsert, { onConflict: "location_id,item_id" });
        if (error) throw error;
      }

      if (toDelete.length > 0) {
        const { error } = await supabase
          .from("location_item_factors")
          .delete()
          .in("id", toDelete);
        if (error) throw error;
      }

      return { upserted: toUpsert.length, deleted: toDelete.length };
    },
    onSuccess: (r) => {
      const total = r.upserted + r.deleted;
      if (total === 0) {
        toast.info("Nenhuma alteração para salvar");
      } else {
        toast.success(`Fatores atualizados (${total})`);
      }
      qc.invalidateQueries({ queryKey: ["location-factors", locationId] });
      qc.invalidateQueries({ queryKey: ["location-factors-map"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-primary" /> Fatores de correção
          </DialogTitle>
          <DialogDescription>
            Disponível apenas para itens em <strong>KG</strong>. Deixe em branco para usar 1,000.
            Ex.: 0,85 = 15% de perda; 2,50 = ganho no cozimento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-hidden flex flex-col">
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar item…"
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

          <div className="flex-1 overflow-auto rounded-2xl border border-border bg-card">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : grouped.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <PackageX className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nenhum item em KG encontrado</p>
                <p className="text-xs text-muted-foreground">
                  Fator de correção é exclusivo para itens medidos em quilogramas.
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
                {grouped.map((g) => (
                  <AccordionItem key={g.name} value={g.name} className="border-0">
                    <AccordionTrigger className="px-4 py-4 hover:no-underline">
                      <div className="flex flex-1 items-center justify-between pr-2">
                        <span className="text-base font-semibold">{g.name}</span>
                        <div className="flex items-center gap-2">
                          {g.configured > 0 && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              {g.configured} ajustado{g.configured > 1 ? "s" : ""}
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
                          const hasFactor = r.factor.trim() !== "";
                          return (
                            <li key={r.itemId} className="space-y-2 px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{r.name}</p>
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    KG
                                  </p>
                                </div>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.001"
                                  min="0"
                                  value={r.factor}
                                  onChange={(e) =>
                                    updateRow(r.itemId, { factor: e.target.value })
                                  }
                                  placeholder="1,000"
                                  className={cn(
                                    "h-9 w-24 text-right tabular-nums",
                                    hasFactor && "border-primary/50",
                                  )}
                                />
                              </div>
                              <Input
                                value={r.note}
                                onChange={(e) =>
                                  updateRow(r.itemId, { note: e.target.value })
                                }
                                placeholder="Observação (ex.: perda no descasque)"
                                className="h-8 text-xs"
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>

          <p className="shrink-0 text-xs text-muted-foreground">
            Aplicado automaticamente nas transferências do Central para <strong>{locationName}</strong>.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || isLoading}
          >
            {mutation.isPending ? "Salvando…" : "Salvar fatores"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
