import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySubcategorySelect } from "@/components/category-subcategory-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Zap,
  Scale,
  Package,
  Layers,
  Info,
  Trash2,
  Pencil,
  Save,
  X,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Category = { id: string; name: string; parent_id?: string | null };
type EntryMode = "WEIGHT" | "UNIT" | "SHARED";
type WeightUnit = "KG" | "L";
type SharedMode = "FIXED" | "VARIABLE";

type DraftItem = {
  uid: string;
  name: string;
  mode: EntryMode;
  weightUnit: WeightUnit;
  sharedMode: SharedMode;
  price: string;
  baseWeight: string;
  contabilizaCmv: boolean;
  categoryId: string;
  categoryName: string;
};

interface Props {
  categories?: Category[] | null;
  orgId?: string | null;
}

const MODE_OPTIONS: Array<{
  value: EntryMode;
  label: string;
  icon: typeof Scale;
  tooltip: string;
}> = [
  {
    value: "WEIGHT",
    label: "Por Quilo / Litro",
    icon: Scale,
    tooltip:
      "Para itens medidos apenas por peso ou volume (carnes a granel, óleo, leite). O custo é por KG/L.",
  },
  {
    value: "UNIT",
    label: "Por Unidade",
    icon: Package,
    tooltip:
      "Ideal para Embalagens, descartáveis e bebidas. O custo é calculado por unidade física.",
  },
  {
    value: "SHARED",
    label: "Unidade Compartilhada",
    icon: Layers,
    tooltip:
      "Para itens que você conta por unidade, mas o custo é pelo peso. Ex: Baldes, Peças de Carne.",
  },
];

function genUid() {
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function QuickAddItems({ categories, orgId }: Props) {
  const qc = useQueryClient();
  const safeCategories = Array.isArray(categories) ? categories : [];
  const [open, setOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  // Form fields
  const [categoryId, setCategoryId] = useState<string>("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<EntryMode>("WEIGHT");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("KG");
  const [sharedMode, setSharedMode] = useState<SharedMode>("FIXED");
  const [price, setPrice] = useState("");
  const [baseWeight, setBaseWeight] = useState("");
  const [contabilizaCmv, setContabilizaCmv] = useState(true);

  // Draft list (não salvo ainda)
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [editingUid, setEditingUid] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => nameRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const resetForm = () => {
    setName("");
    setPrice("");
    setBaseWeight("");
    setMode("WEIGHT");
    setWeightUnit("KG");
    setSharedMode("FIXED");
    setContabilizaCmv(true);
    setEditingUid(null);
  };

  const categoryNameOf = (catId: string) => {
    const cat = safeCategories.find((c) => c.id === catId);
    if (!cat) return "Sem categoria";
    const parent = cat.parent_id;
    if (!parent) return cat.name;
    const p = safeCategories.find((c) => c.id === parent);
    return p ? `${p.name} > ${cat.name}` : cat.name;
  };

  const sharedFixedNeedsBase = mode === "SHARED" && sharedMode === "FIXED";
  const formInvalid =
    !name.trim() || (sharedFixedNeedsBase && !baseWeight.trim());

  const addOrUpdateDraft = () => {
    if (formInvalid) return;
    const draft: DraftItem = {
      uid: editingUid ?? genUid(),
      name: name.trim(),
      mode,
      weightUnit,
      sharedMode,
      price,
      baseWeight,
      contabilizaCmv,
      categoryId,
      categoryName: categoryNameOf(categoryId),
    };
    setDrafts((prev) => {
      if (editingUid) {
        return prev.map((d) => (d.uid === editingUid ? draft : d));
      }
      return [draft, ...prev];
    });
    resetForm();
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const removeDraft = (uid: string) => {
    setDrafts((prev) => prev.filter((d) => d.uid !== uid));
    if (editingUid === uid) resetForm();
  };

  const startEdit = (d: DraftItem) => {
    setEditingUid(d.uid);
    setName(d.name);
    setMode(d.mode);
    setWeightUnit(d.weightUnit);
    setSharedMode(d.sharedMode);
    setPrice(d.price);
    setBaseWeight(d.baseWeight);
    setContabilizaCmv(d.contabilizaCmv);
    setCategoryId(d.categoryId);
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addOrUpdateDraft();
    }
  };

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Organização não identificada para salvar o item");
      if (drafts.length === 0) throw new Error("Nenhum item para salvar");

      const payloads = drafts.map((d) => {
        const shared = d.mode === "SHARED";
        const dbUnit =
          d.mode === "UNIT" ? "UN" : d.mode === "WEIGHT" ? d.weightUnit : "KG";
        const cost = d.price ? Number(d.price.replace(",", ".")) : 0;
        const baseKg = d.baseWeight ? Number(d.baseWeight.replace(",", ".")) : 0;
        const weightVariable = shared && d.sharedMode === "VARIABLE";
        if (shared && d.sharedMode === "FIXED" && (!Number.isFinite(baseKg) || baseKg <= 0)) {
          throw new Error(`Informe o Peso por Unidade (KG) para "${d.name}"`);
        }
        const baseG = shared && baseKg > 0 ? baseKg * 1000 : 0;
        return {
          org_id: orgId,
          name: d.name,
          unit: dbUnit,
          cost_price: Number.isFinite(cost) ? cost : 0,
          shared_unit_enabled: shared,
          weight_variable: weightVariable,
          is_active: true,
          contabiliza_cmv: d.contabilizaCmv,
          ...(shared ? { standard_weight_g: baseG, avg_weight_g: baseG } : {}),
          ...(d.categoryId ? { category_id: d.categoryId } : {}),
        };
      });

      const { error } = await supabase.from("items").insert(payloads);
      if (error) throw error;
      return payloads.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} ${count === 1 ? "item cadastrado" : "itens cadastrados"} com sucesso!`);
      setDrafts([]);
      resetForm();
      qc.invalidateQueries({ queryKey: ["central"] });
      setOpen(false);
    },
    onError: (e: Error) => {
      toast.error(e.message || "Erro ao salvar");
    },
  });

  const requestClose = (next: boolean) => {
    if (!next && drafts.length > 0) {
      setConfirmCloseOpen(true);
      return;
    }
    setOpen(next);
    if (!next) resetForm();
  };

  const discardAndClose = () => {
    setDrafts([]);
    resetForm();
    setConfirmCloseOpen(false);
    setOpen(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Cadastro Rápido
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-0 p-0 backdrop-blur-sm">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/10 text-primary">
              <Zap className="h-3.5 w-3.5" />
            </span>
            Cadastro Rápido
            {drafts.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 gap-1 px-1.5">
                {drafts.length} pendente{drafts.length === 1 ? "" : "s"}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {/* Categoria + Subcategoria */}
          <div className="space-y-1.5">
            <CategorySubcategorySelect
              value={categoryId}
              onChange={setCategoryId}
              labelTop="Categoria (aplicada a todos abaixo)"
            />
          </div>

          {/* Tipo de Cadastro */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tipo de cadastro
            </Label>
            <TooltipProvider delayDuration={200}>
              <div className="grid grid-cols-3 gap-2">
                {MODE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = mode === opt.value;
                  return (
                    <Tooltip key={opt.value}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setMode(opt.value)}
                          className={cn(
                            "group flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition",
                            active
                              ? "border-primary bg-primary/5 text-primary shadow-sm"
                              : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="text-[11px] font-medium leading-tight">
                            {opt.label}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                        {opt.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>

          {/* Linha principal */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px]">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Nome do insumo *
              </Label>
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onKey}
                placeholder="Ex: Carne moída"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Unidade</Label>
              {mode === "WEIGHT" ? (
                <Select value={weightUnit} onValueChange={(v) => setWeightUnit(v as WeightUnit)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KG">KG</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-9 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                  {mode === "UNIT" ? "UN" : "KG"}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {mode === "UNIT"
                  ? "Custo /UN"
                  : mode === "SHARED"
                    ? "Custo /KG"
                    : `Custo /${weightUnit}`}
              </Label>
              <Input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={onKey}
                inputMode="decimal"
                placeholder="0,00"
              />
            </div>
          </div>

          {/* Configuração Unidade Compartilhada */}
          {mode === "SHARED" && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-2 text-xs">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-muted-foreground">
                  O saldo do estoque é mantido em <strong>KG</strong>, mas você
                  conta por <strong>unidades</strong>. Defina abaixo se o peso
                  por unidade é fixo ou variável.
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

              {sharedMode === "FIXED" ? (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Peso por Unidade (KG) *
                  </Label>
                  <Input
                    value={baseWeight}
                    onChange={(e) => setBaseWeight(e.target.value)}
                    onKeyDown={onKey}
                    inputMode="decimal"
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="Ex: 3.000"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Peso de referência (KG) — opcional
                  </Label>
                  <Input
                    value={baseWeight}
                    onChange={(e) => setBaseWeight(e.target.value)}
                    onKeyDown={onKey}
                    inputMode="decimal"
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="Ex: 1.200"
                  />
                </div>
              )}
            </div>
          )}

          {/* Toggle CMV */}
          <div
            className={cn(
              "flex items-start justify-between gap-3 rounded-md border p-3 transition-colors",
              contabilizaCmv
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-amber-500/40 bg-amber-500/10",
            )}
          >
            <div className="space-y-0.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    contabilizaCmv ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                Contabilizar no cálculo de CMV?
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Desative para itens que não são alimentos.
              </p>
            </div>
            <Switch
              checked={contabilizaCmv}
              onCheckedChange={setContabilizaCmv}
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              <kbd className="rounded border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
              {editingUid ? "atualiza o item" : "adiciona à lista"}.
            </p>
            <div className="flex gap-2">
              {editingUid && (
                <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  Cancelar edição
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={editingUid ? "default" : "outline"}
                onClick={addOrUpdateDraft}
                disabled={formInvalid}
              >
                {editingUid ? (
                  <>
                    <Save className="mr-1 h-3.5 w-3.5" />
                    Atualizar item
                  </>
                ) : (
                  <>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Adicionar à lista
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Tabela de drafts */}
          {drafts.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Itens a cadastrar ({drafts.length})
                </span>
                <button
                  type="button"
                  onClick={() => setDrafts([])}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Limpar tudo
                </button>
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-auto">
                {drafts.map((d) => {
                  const isEditing = editingUid === d.uid;
                  const unitLabel =
                    d.mode === "UNIT"
                      ? "UN"
                      : d.mode === "SHARED"
                        ? d.sharedMode === "VARIABLE"
                          ? "Compart. (var)"
                          : "Compart. (fixo)"
                        : d.weightUnit;
                  return (
                    <li
                      key={d.uid}
                      className={cn(
                        "flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors",
                        isEditing && "bg-primary/5",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => startEdit(d)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title="Clique para editar"
                      >
                        <span className="truncate font-medium">{d.name}</span>
                        <span className="truncate text-muted-foreground">
                          · {d.categoryName}
                        </span>
                        {d.price && (
                          <span className="shrink-0 text-muted-foreground">
                            · R$ {d.price}
                          </span>
                        )}
                      </button>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {unitLabel}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => startEdit(d)}
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeDraft(d.uid)}
                        title="Excluir da lista"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer fixo */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-background/80 px-5 py-3 backdrop-blur">
          <span className="text-[11px] text-muted-foreground">
            {drafts.length === 0
              ? "Nenhum item adicionado ainda."
              : `${drafts.length} ${drafts.length === 1 ? "item pronto" : "itens prontos"} para gravar.`}
          </span>
          <Button
            type="button"
            onClick={() => saveAllMutation.mutate()}
            disabled={drafts.length === 0 || saveAllMutation.isPending}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {saveAllMutation.isPending ? "Salvando…" : "Confirmar e Salvar Cadastro"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Existem itens não salvos</AlertDialogTitle>
          <AlertDialogDescription>
            Você tem {drafts.length} {drafts.length === 1 ? "item" : "itens"} na lista que ainda não foram salvos no banco de dados. Deseja descartar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction
            onClick={discardAndClose}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Descartar tudo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
