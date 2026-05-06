import { useEffect, useState } from "react";
import { writeAuditLog } from "@/lib/audit-log";
import { useOrgId } from "@/lib/use-org-id";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronsUpDown, Plus, Save, X, Link2, Lock, ShieldAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CategorySubcategorySelect } from "@/components/category-subcategory-select";
import { CategoryTagsEditor } from "@/components/category-tags-editor";
import { useManagerMode } from "@/lib/manager-mode";
import { AdjustmentJustificationDialog } from "@/components/adjustment-justification-dialog";
import { createAdjustmentRequest } from "@/lib/adjustment-requests";

interface Props {
  itemId: string | null;
  open: boolean;
  onClose: () => void;
}

const UNIT_OPTIONS = ["UN", "KG", "G", "L", "ML", "CX", "DZ"];
const SHARED_UNIT_OPTIONS = ["KG", "L", "UN"];

export function ItemEditDialog({ itemId, open, onClose }: Props) {
  const qc = useQueryClient();
  const { isManager } = useManagerMode();
  const orgId = useOrgId();
  const [justifyOpen, setJustifyOpen] = useState(false);
  const { data, isLoading } = useQuery({
    enabled: open && !!itemId,
    refetchOnMount: "always",
    staleTime: 0,
    queryKey: ["item-edit", itemId],
    queryFn: async () => {
      if (!itemId) throw new Error("ID inválido");
      const [itemRes, catRes, mapRes, invItemsRes, stockRes, locsRes] = await Promise.all([
        supabase.from("items").select("*").eq("id", itemId).single(),
        supabase.from("categories").select("id,name").order("name"),
        supabase
          .from("xml_item_mappings")
          .select("id,xml_name,multiplier,updated_at")
          .eq("item_id", itemId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("invoice_items")
          .select("xml_name,created_at")
          .eq("item_id", itemId)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("stock_levels")
          .select("id,location_id,current_stock")
          .eq("item_id", itemId),
        supabase.from("locations").select("id,name"),
      ]);
      if (itemRes.error) throw itemRes.error;
      if (catRes.error) throw catRes.error;
      if (mapRes.error) throw mapRes.error;
      if (invItemsRes.error) throw invItemsRes.error;
      if (stockRes.error) throw stockRes.error;
      if (locsRes.error) throw locsRes.error;

      // Merge: xml_item_mappings (vínculos manuais) + nomes historicamente
      // recebidos em invoice_items para este item_id (xProd da NF).
      type Mapping = {
        id: string;
        xml_name: string;
        multiplier: number;
        updated_at: string;
        source: "manual" | "history";
      };
      const merged: Mapping[] = (mapRes.data ?? []).map((m) => ({
        id: m.id,
        xml_name: m.xml_name,
        multiplier: Number(m.multiplier ?? 1),
        updated_at: m.updated_at,
        source: "manual" as const,
      }));
      const knownKeys = new Set(
        merged.map((m) => (m.xml_name ?? "").trim().toLowerCase()),
      );
      (invItemsRes.data ?? []).forEach((row) => {
        const n = (row.xml_name ?? "").trim();
        const key = n.toLowerCase();
        if (!n || knownKeys.has(key)) return;
        knownKeys.add(key);
        merged.push({
          id: `history-${key}`,
          xml_name: n,
          multiplier: 1,
          updated_at: row.created_at,
          source: "history" as const,
        });
      });

      const central = (locsRes.data ?? []).find(
        (l) => String(l.name ?? "").trim().toLowerCase() === "estoque central",
      );
      const centralStock = central
        ? Number(
            (stockRes.data ?? []).find((s) => s.location_id === central.id)?.current_stock ?? 0,
          )
        : 0;
      const totalStock = (stockRes.data ?? []).reduce(
        (a, b) => a + Number(b.current_stock ?? 0),
        0,
      );

      return {
        item: itemRes.data,
        categories: catRes.data ?? [],
        mappings: merged,
        centralLocationId: central?.id ?? null,
        centralStock,
        totalStock,
      };
    },
  });

  const item = data?.item;

  // Form state
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("UN");
  const [originalUnit, setOriginalUnit] = useState("UN");
  const [categoryId, setCategoryId] = useState<string>("none");
  const [sharedEnabled, setSharedEnabled] = useState(false);
  const [isOperational, setIsOperational] = useState(false);
  const [standardWeight, setStandardWeight] = useState("");
  const [avgWeight, setAvgWeight] = useState("");
  const [minStock, setMinStock] = useState("");
  const [contabilizaCmv, setContabilizaCmv] = useState(true);
  const [sharedMode, setSharedMode] = useState<"FIXED" | "VARIABLE">("FIXED");
  const [newXmlName, setNewXmlName] = useState("");

  const [suggestOpen, setSuggestOpen] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name ?? "");
      setUnit((item.unit ?? "UN").toUpperCase());
      setOriginalUnit((item.unit ?? "UN").toUpperCase());
      setCategoryId(item.category_id ?? "none");
      setSharedEnabled(item.shared_unit_enabled === true);
      setIsOperational((item as { is_operational?: boolean }).is_operational === true);
      // Convert g -> kg para edição. Exibir com no máximo 3 casas decimais.
      const fmt3 = (g: number) => {
        const kg = Number(g) / 1000;
        // Remove trailing zeros mantendo até 3 casas
        return kg ? Number(kg.toFixed(3)).toString() : "";
      };
      setStandardWeight(item.standard_weight_g ? fmt3(Number(item.standard_weight_g)) : "");
      setAvgWeight(item.avg_weight_g ? fmt3(Number(item.avg_weight_g)) : "");
      setMinStock(item.min_stock ? String(item.min_stock) : "");
      setContabilizaCmv(
        (item as { contabiliza_cmv?: boolean }).contabiliza_cmv !== false,
      );
      setSharedMode(
        (item as { weight_variable?: boolean }).weight_variable ? "VARIABLE" : "FIXED",
      );
      setNewXmlName("");
    }
  }, [item]);

  const unitChanged = unit !== originalUnit;

  // Recipe usage check (for impact warning + CMV lock)
  const { data: recipeUsage } = useQuery({
    enabled: open && !!itemId,
    queryKey: ["item-edit-usage", itemId],
    queryFn: async () => {
      if (!itemId) return { ingredientCount: 0, producedCount: 0, productionMovements: 0 };
      const [{ count: ingCount }, { count: prodRecipeCount }, { count: prodMovCount }] =
        await Promise.all([
          supabase
            .from("recipe_ingredients")
            .select("id", { count: "exact", head: true })
            .eq("item_id", itemId),
          supabase
            .from("recipes")
            .select("id", { count: "exact", head: true })
            .eq("produced_item_id", itemId),
          supabase
            .from("movements")
            .select("id", { count: "exact", head: true })
            .eq("item_id", itemId)
            .in("type", ["production_in", "production_out"]),
        ]);
      return {
        ingredientCount: ingCount ?? 0,
        producedCount: prodRecipeCount ?? 0,
        productionMovements: prodMovCount ?? 0,
      };
    },
  });

  // Trava de segurança: não permite alterar a categoria de custo (CMV)
  // se o item já participa de fichas técnicas ou já tem registros de produção,
  // para preservar a integridade dos relatórios.
  const cmvLocked =
    !!recipeUsage &&
    (recipeUsage.ingredientCount > 0 ||
      recipeUsage.producedCount > 0 ||
      recipeUsage.productionMovements > 0);

  // Sugestões: nomes de XML já vistos em notas, ainda sem vínculo (em qualquer item)
  const { data: xmlSuggestions } = useQuery({
    enabled: open,
    refetchOnMount: "always",
    staleTime: 0,
    queryKey: ["item-edit-xml-suggestions"],
    queryFn: async () => {
      const [invRes, mapRes] = await Promise.all([
        supabase.from("invoice_items").select("xml_name").limit(1000),
        supabase.from("xml_item_mappings").select("xml_name").limit(2000),
      ]);
      const mapped = new Set(
        (mapRes.data ?? []).map((m) => (m.xml_name ?? "").trim().toLowerCase()),
      );
      const seen = new Set<string>();
      const out: string[] = [];
      (invRes.data ?? []).forEach((r) => {
        const n = (r.xml_name ?? "").trim();
        const k = n.toLowerCase();
        if (!n || mapped.has(k) || seen.has(k)) return;
        seen.add(k);
        out.push(n);
      });
      return out.sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
  });

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["item-edit", itemId] }),
      qc.invalidateQueries({ queryKey: ["item-edit-xml-suggestions"] }),
      qc.invalidateQueries({ queryKey: ["central"], refetchType: "active" }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
      qc.invalidateQueries({ queryKey: ["fichas"] }),
      qc.invalidateQueries({ queryKey: ["stock-levels"] }),
      qc.invalidateQueries({ queryKey: ["items"] }),
    ]);
  };

  const buildPayload = () => {
    if (!itemId) throw new Error("ID inválido");
    if (!name.trim()) throw new Error("Nome é obrigatório");
    const stdKg = Number(standardWeight.replace(",", ".")) || 0;
    const avgKg = Number(avgWeight.replace(",", ".")) || 0;
    const minS = Number(minStock.replace(",", ".")) || 0;
    const stdW = stdKg * 1000;
    const avgW = avgKg * 1000;
    const updatePayload: Record<string, unknown> = {
      name: name.trim(),
      unit: unit.toLowerCase(),
      category_id: categoryId === "none" ? null : categoryId,
      shared_unit_enabled: sharedEnabled,
      weight_variable: sharedEnabled ? sharedMode === "VARIABLE" : false,
      standard_weight_g: stdW,
      avg_weight_g: avgW,
      min_stock: isOperational ? 0 : minS,
      is_operational: isOperational,
      ...(cmvLocked ? {} : { contabiliza_cmv: contabilizaCmv }),
    };
    if (isOperational) updatePayload.cost_price = 0;
    return updatePayload;
  };

  const buildCurrent = (): Record<string, unknown> => {
    if (!item) return {};
    return {
      name: item.name,
      unit: item.unit,
      category_id: item.category_id,
      shared_unit_enabled: item.shared_unit_enabled,
      weight_variable: (item as { weight_variable?: boolean }).weight_variable ?? false,
      standard_weight_g: Number(item.standard_weight_g ?? 0),
      avg_weight_g: Number(item.avg_weight_g ?? 0),
      min_stock: Number(item.min_stock ?? 0),
      is_operational: (item as { is_operational?: boolean }).is_operational ?? false,
      contabiliza_cmv: (item as { contabiliza_cmv?: boolean }).contabiliza_cmv ?? true,
      cost_price: Number(item.cost_price ?? 0),
    };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updatePayload = buildPayload();
      const previous = buildCurrent();
      const { error } = await supabase
        .from("items")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(updatePayload as any)
        .eq("id", itemId!);
      if (error) throw error;
      if (orgId && itemId) {
        const changed: Record<string, unknown> = {};
        const before: Record<string, unknown> = {};
        Object.keys(updatePayload).forEach((k) => {
          if (JSON.stringify((updatePayload as Record<string, unknown>)[k]) !== JSON.stringify(previous[k])) {
            changed[k] = (updatePayload as Record<string, unknown>)[k];
            before[k] = previous[k] ?? null;
          }
        });
        if (Object.keys(changed).length > 0) {
          await writeAuditLog({
            orgId,
            module: "items",
            entityType: "item",
            entityId: itemId,
            action: "update",
            oldValue: before,
            newValue: changed,
          });
        }
      }
      return { unitChanged };
    },
    onSuccess: async (res) => {
      if (res.unitChanged) {
        toast.success("Insumo atualizado. O saldo foi preservado sem recálculo automático.");
      } else {
        toast.success("Insumo atualizado");
      }
      await invalidateAll();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestMutation = useMutation({
    mutationFn: async (justification: string) => {
      const newPayload = buildPayload();
      const current = buildCurrent();
      // Diff: keep only changed fields
      const changed: Record<string, unknown> = {};
      const currentDiff: Record<string, unknown> = {};
      Object.keys(newPayload).forEach((k) => {
        if (JSON.stringify(newPayload[k]) !== JSON.stringify(current[k])) {
          changed[k] = newPayload[k];
          currentDiff[k] = current[k] ?? null;
        }
      });
      if (Object.keys(changed).length === 0) {
        throw new Error("Nenhuma alteração para solicitar");
      }
      await createAdjustmentRequest({
        kind: "item_edit",
        itemId: itemId!,
        currentValue: currentDiff,
        newValue: changed,
        justification,
      });
    },
    onSuccess: () => {
      toast.success("Solicitação enviada ao gestor para aprovação");
      setJustifyOpen(false);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Upsert manual: se já existe (case-insensitive), atualiza item_id/multiplier; senão insere.
  const addMappingMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("ID inválido");
      const xmlName = newXmlName.trim();
      if (!xmlName) throw new Error("Informe o nome do XML");
      const mult = 1;

      const { data: existing, error: selErr } = await supabase
        .from("xml_item_mappings")
        .select("id")
        .ilike("xml_name", xmlName)
        .maybeSingle();
      if (selErr) throw selErr;

      if (existing?.id) {
        const { error } = await supabase
          .from("xml_item_mappings")
          .update({
            item_id: itemId,
            xml_name: xmlName,
            multiplier: mult,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
        return { updated: true };
      }
      const { error } = await supabase.from("xml_item_mappings").insert({
        item_id: itemId,
        xml_name: xmlName,
        multiplier: mult,
      });
      if (error) throw error;
      return { updated: false };
    },
    onMutate: async () => {
      const xmlName = newXmlName.trim();
      const mult = 1;
      // Optimistic: adiciona ao histórico e remove das sugestões
      await qc.cancelQueries({ queryKey: ["item-edit", itemId] });
      await qc.cancelQueries({ queryKey: ["item-edit-xml-suggestions"] });

      const prevData = qc.getQueryData<typeof data>(["item-edit", itemId]);
      const prevSugs = qc.getQueryData<string[]>(["item-edit-xml-suggestions"]);

      if (prevData) {
        const optimisticMapping = {
          id: `optimistic-${Date.now()}`,
          xml_name: xmlName,
          multiplier: mult,
          updated_at: new Date().toISOString(),
        };
        qc.setQueryData(["item-edit", itemId], {
          ...prevData,
          mappings: [
            optimisticMapping,
            ...prevData.mappings.filter(
              (m) => m.xml_name.trim().toLowerCase() !== xmlName.toLowerCase(),
            ),
          ],
        });
      }
      if (prevSugs) {
        qc.setQueryData(
          ["item-edit-xml-suggestions"],
          prevSugs.filter((s) => s.trim().toLowerCase() !== xmlName.toLowerCase()),
        );
      }
      return { prevData, prevSugs };
    },
    onSuccess: (res) => {
      toast.success(res.updated ? "Vínculo atualizado" : "Vínculo adicionado");
      setNewXmlName("");
      invalidateAll();
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prevData) qc.setQueryData(["item-edit", itemId], ctx.prevData);
      if (ctx?.prevSugs) qc.setQueryData(["item-edit-xml-suggestions"], ctx.prevSugs);
      toast.error(e.message);
    },
  });

  const removeMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase.from("xml_item_mappings").delete().eq("id", mappingId);
      if (error) throw error;
    },
    onMutate: async (mappingId: string) => {
      await qc.cancelQueries({ queryKey: ["item-edit", itemId] });
      const prevData = qc.getQueryData<typeof data>(["item-edit", itemId]);
      if (prevData) {
        qc.setQueryData(["item-edit", itemId], {
          ...prevData,
          mappings: prevData.mappings.filter((m) => m.id !== mappingId),
        });
      }
      return { prevData };
    },
    onSuccess: () => {
      toast.success("Vínculo removido");
      invalidateAll();
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prevData) qc.setQueryData(["item-edit", itemId], ctx.prevData);
      toast.error(e.message);
    },
  });

  // Transição Peso Fixo ↔ Peso Variável:
  // REGRA: NÃO converte, NÃO multiplica, NÃO divide. Apenas troca a etiqueta da unidade
  // e o flag `shared_unit_enabled`. O saldo numérico em stock_levels permanece intacto.
  // Caches de peso médio/padrão são zerados para impedir conversões fantasma futuras.
  const handleSharedToggle = (v: boolean) => {
    setSharedEnabled(v);
    setUnit(v ? "KG" : "UN");
    setAvgWeight("");
    setStandardWeight("");
  };

  const unitIsKg = unit.toUpperCase() === "KG";
  const effectiveSharedEnabled = sharedEnabled;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Insumo</DialogTitle>
          <DialogDescription>
            Altere o cadastro completo do insumo. As alterações refletem no estoque central e nos
            cálculos de fichas técnicas.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !item ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-5">
            {/* Identidade */}
            <section className="space-y-3">
              <div className="space-y-2">
                <Label>Nome do Insumo</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Carne Moída Bovina"
                />
              </div>

              <div className="space-y-2">
                <Label>Unidade Principal</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(sharedEnabled ? SHARED_UNIT_OPTIONS : UNIT_OPTIONS).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <CategorySubcategorySelect
                value={categoryId === "none" ? "" : categoryId}
                onChange={(v) => setCategoryId(v || "none")}
              />
              {itemId && (
                <CategoryTagsEditor itemId={itemId} primaryCategoryId={categoryId === "none" ? null : categoryId} />
              )}

              {unitChanged && recipeUsage && recipeUsage.ingredientCount > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    Alterar a unidade pode afetar {recipeUsage.ingredientCount} ficha
                    {recipeUsage.ingredientCount > 1 ? "s" : ""} técnica
                    {recipeUsage.ingredientCount > 1 ? "s" : ""} que usa
                    {recipeUsage.ingredientCount > 1 ? "m" : ""} este insumo. Revise após salvar.
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Estoque Mínimo</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="0"
                  disabled={isOperational}
                />
                {isOperational && (
                  <p className="text-[11px] text-muted-foreground">
                    Insumos operacionais não exigem estoque mínimo.
                  </p>
                )}
              </div>

              <div
                className={cn(
                  "flex items-start justify-between gap-3 rounded-md border p-3 transition-colors",
                  cmvLocked
                    ? "border-border bg-muted/40"
                    : contabilizaCmv
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-amber-500/40 bg-amber-500/10",
                )}
              >
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5 text-sm font-semibold">
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        cmvLocked
                          ? "bg-muted-foreground/50"
                          : contabilizaCmv
                            ? "bg-emerald-500"
                            : "bg-amber-500",
                      )}
                    />
                    Contabilizar no cálculo de CMV?
                    {cmvLocked && (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
                              aria-label="Travado"
                            >
                              <Lock className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px] text-xs">
                            Este item possui histórico de movimentação e sua categoria de custo
                            não pode ser alterada para preservar a integridade dos relatórios.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Desative para itens que não são alimentos, como material de limpeza ou descartáveis.
                  </p>
                </div>
                <Switch
                  checked={contabilizaCmv}
                  onCheckedChange={setContabilizaCmv}
                  disabled={cmvLocked}
                  className="data-[state=checked]:bg-emerald-600"
                />
              </div>

            </section>

            <Separator />

            {/* Fatores de Conversão */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Fatores de Conversão</h3>
                  <p className="text-xs text-muted-foreground">
                    Configure o peso em kg usado apenas quando a operação for por unidades.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                    <Label className="text-xs">Peso variável (un. compartilhada)</Label>
                  <Switch
                      checked={effectiveSharedEnabled}
                    onCheckedChange={handleSharedToggle}
                  />
                </div>
              </div>

              {effectiveSharedEnabled && (
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-primary">
                      Unidade compartilhada: contado em UN com peso médio em KG.
                    </p>
                    <p className="text-muted-foreground">
                      Defina abaixo se o peso por unidade é fixo ou variável.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSharedMode("FIXED")}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-xs transition",
                        sharedMode === "FIXED"
                          ? "border-primary bg-background shadow-sm"
                          : "border-border bg-background/50 text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      <div className="font-semibold text-foreground">Peso Fixo</div>
                      <div className="text-[11px] text-muted-foreground">
                        Ex: Balde de 3 kg, Pacote de 5 kg
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSharedMode("VARIABLE")}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-xs transition",
                        sharedMode === "VARIABLE"
                          ? "border-primary bg-background shadow-sm"
                          : "border-border bg-background/50 text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      <div className="font-semibold text-foreground">Peso Variável</div>
                      <div className="text-[11px] text-muted-foreground">
                        Ex: Peça de Picanha, Costela
                      </div>
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>
                    {effectiveSharedEnabled
                      ? "Peso Base por Unidade (KG)"
                      : unitIsKg
                        ? "Peso por Porção/Unidade (KG)"
                        : "Peso Sugerido por Unidade (KG)"}
                    {effectiveSharedEnabled && <span className="text-destructive"> *</span>}
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    value={standardWeight}
                    onChange={(e) => setStandardWeight(e.target.value)}
                    placeholder={effectiveSharedEnabled ? "Ex: 0.180" : "Ex: 0,820"}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {effectiveSharedEnabled
                      ? "Para itens que chegam em KG, este valor será usado para sugerir a quantidade de unidades na nota fiscal."
                      : unitIsKg
                        ? "Referência para porções/unidades; não recalcula o saldo em KG."
                        : `Peso de 1 ${unit} em quilogramas para sugerir UN ↔ KG.`}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Peso Médio Atual (KG)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    value={avgWeight}
                    onChange={(e) => setAvgWeight(e.target.value)}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      if (!Number.isFinite(n) || n === 0) return;
                      setAvgWeight(Number(n.toFixed(3)).toString());
                    }}
                    placeholder="Calculado das entradas"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Exibido com até 3 casas decimais (ex: 0,196 kg). Atualizado automaticamente nas entradas das notas fiscais.
                  </p>
                </div>
              </div>
            </section>

            <Separator />

            {/* Vínculos XML */}
            <section className="space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Link2 className="h-4 w-4" /> Histórico de Vínculos (XML)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Nomes que vêm em notas fiscais e estão vinculados a este insumo.
                </p>
              </div>

              {data?.mappings.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  Nenhum nome de XML vinculado ainda. Vincule abaixo ou importe uma nota.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data?.mappings.map((m) => {
                    const isHistory = (m as { source?: string }).source === "history";
                    return (
                      <span
                        key={m.id}
                        className={cn(
                          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                          isHistory
                            ? "border-dashed border-border bg-muted/40 text-muted-foreground"
                            : "border-border bg-secondary text-secondary-foreground",
                        )}
                        title={isHistory ? "Detectado no histórico de notas" : "Vínculo manual"}
                      >
                        <span className="truncate">{m.xml_name}</span>
                        {isHistory ? (
                          <span className="text-[10px] uppercase tracking-wide opacity-70">
                            NF
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeMappingMutation.mutate(m.id)}
                            disabled={removeMappingMutation.isPending}
                            className="text-destructive hover:opacity-80"
                            aria-label="Remover vínculo"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2 rounded-md border border-border p-3">
                <Label className="text-xs">Adicionar vínculo manualmente</Label>
                <p className="text-[11px] text-muted-foreground">
                  Selecione o nome que aparece na nota fiscal. A conversão entre unidades é
                  calculada automaticamente pelo Peso Padrão (KG) configurado acima.
                </p>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={suggestOpen}
                        className="w-full justify-between font-normal"
                      >
                        <span className={cn("truncate", !newXmlName && "text-muted-foreground")}>
                          {newXmlName || "Buscar / digitar nome do XML…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command
                        filter={(value, search) =>
                          value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                        }
                      >
                        <CommandInput
                          placeholder="Buscar ou digitar novo nome…"
                          value={newXmlName}
                          onValueChange={setNewXmlName}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <div className="px-3 py-2 text-xs">
                              {newXmlName.trim() ? (
                                <button
                                  type="button"
                                  className="text-primary underline-offset-2 hover:underline"
                                  onClick={() => setSuggestOpen(false)}
                                >
                                  Usar “{newXmlName.trim()}” como novo vínculo
                                </button>
                              ) : (
                                "Nenhuma sugestão disponível."
                              )}
                            </div>
                          </CommandEmpty>
                          {(xmlSuggestions ?? []).length > 0 && (
                            <CommandGroup heading="Nomes de XML não vinculados">
                              {(xmlSuggestions ?? []).slice(0, 50).map((s) => (
                                <CommandItem
                                  key={s}
                                  value={s}
                                  onSelect={() => {
                                    setNewXmlName(s);
                                    setSuggestOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-3.5 w-3.5",
                                      newXmlName === s ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  <span className="truncate">{s}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => addMappingMutation.mutate()}
                    disabled={addMappingMutation.isPending || !newXmlName.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}

        {!isManager && !isLoading && item && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Modo Operacional:</strong> alterações no cadastro do insumo precisam de
              aprovação do gestor. Sua edição será enviada como solicitação.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (isManager) {
                saveMutation.mutate();
              } else {
                try {
                  buildPayload();
                  setJustifyOpen(true);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }
            }}
            disabled={saveMutation.isPending || isLoading}
            className="gap-2"
          >
            {isManager ? <Save className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {saveMutation.isPending
              ? "Salvando…"
              : isManager
                ? "Salvar Alterações"
                : "Solicitar ao Gestor"}
          </Button>
        </DialogFooter>
      </DialogContent>



      <AdjustmentJustificationDialog
        open={justifyOpen}
        onClose={() => setJustifyOpen(false)}
        onConfirm={async (j) => requestMutation.mutateAsync(j)}
        pending={requestMutation.isPending}
        title="Solicitar edição de insumo"
        description="A edição do cadastro precisa ser aprovada por um gestor antes de ser aplicada."
        summary={<span>Insumo: <strong>{name}</strong></span>}
      />
    </Dialog>
  );
}
