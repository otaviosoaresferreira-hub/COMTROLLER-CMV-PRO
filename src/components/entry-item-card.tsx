import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Trash2, Sparkles, Link2, HelpCircle, AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CategorySubcategorySelect } from "@/components/category-subcategory-select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type EntryUnit = "UN" | "KG" | "L";
const UNIT_OPTIONS: EntryUnit[] = ["UN", "KG", "L"];

export type EntryItemRef = {
  id: string;
  name: string;
  unit: string;
  shared_unit_enabled?: boolean;
  weight_variable?: boolean;
  standard_weight_g?: number;
};

/**
 * Estado unificado de um item em entrada (Manual / XML / Foto).
 * Todos os campos numéricos são strings (input controlled).
 */
export type EntryCardData = {
  /** "existing" = vinculado a item do org_id; "new" = novo cadastro. */
  mode: "existing" | "new";
  itemId: string;
  pickerOpen?: boolean;

  // Identificação (novo)
  newName: string;
  newUnit: EntryUnit;
  newCategoryId: string;

  // Controle mestre
  newContabilizaCmv: boolean;
  newSharedEnabled: boolean;
  newWeightVariable: boolean;
  /** Peso base por unidade — em KG (string PT-BR ou EN). */
  newStandardWeightKg: string;

  // Motor de cálculo
  /** Quantidade comprada (em embalagens, ou direto na unidade). */
  quantity: string;
  /** Unidades/KG por embalagem. Default "1". */
  packQty: string;
  /** Valor total da linha (R$). */
  totalValue: string;

  // Lote — Unidade Compartilhada
  sharedUnits: string;
  sharedTotalKg: string;
  /**
   * Peso por unidade DESTE LOTE (kg/un). Independente do Peso Base do cadastro.
   * Em "Peso Fixo" fica travado no Peso Base. Em "Peso Variável" é livre.
   */
  lotWeightKg: string;

  // Rodapé
  expiryDate: string;
  lotNumber: string;
};

const parseDec = (s: string): number => Number((s ?? "").toString().replace(",", ".")) || 0;
const fmt3 = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
    : "0";
/** Máscara de exibição (PT-BR) com até N decimais, sem perder a precisão do estado. */
const maskDec = (s: string, decimals: number): string => {
  if (s == null || s === "") return "";
  const raw = s.toString().trim();
  // se for uma expressão em curso (termina em vírgula/ponto), preserva
  if (/[.,]$/.test(raw)) return raw.replace(".", ",");
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return raw;
  // Trunca decimais somente para EXIBIÇÃO (sem alterar o estado).
  return n.toLocaleString("pt-BR", { maximumFractionDigits: decimals });
};
const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export function normalizeEntryUnit(u: string | null | undefined): EntryUnit {
  const v = (u ?? "").trim().toUpperCase();
  if (v === "KG") return "KG";
  if (v === "L" || v === "LT" || v === "LITRO") return "L";
  return "UN";
}

export function makeBlankEntryCard(): EntryCardData {
  return {
    mode: "existing",
    itemId: "",
    pickerOpen: false,
    newName: "",
    newUnit: "UN",
    newCategoryId: "",
    newContabilizaCmv: true,
    newSharedEnabled: false,
    newWeightVariable: false,
    newStandardWeightKg: "",
    quantity: "",
    packQty: "1",
    totalValue: "",
    sharedUnits: "",
    sharedTotalKg: "",
    lotWeightKg: "",
    expiryDate: "",
    lotNumber: "",
  };
}

/**
 * Calcula a quantidade final que entrará no estoque, conforme a unidade efetiva.
 * - Compartilhado: stockQty (KG) = unidades × peso base (kg).
 * - Não compartilhado: stockQty = quantidade × packQty.
 */
export function computeEntryTotals(
  data: EntryCardData,
  selected?: EntryItemRef,
): {
  effectiveUnit: EntryUnit;
  sharedActive: boolean;
  weightVariable: boolean;
  standardKg: number;
  qty: number;
  pack: number;
  units: number;
  totalKg: number;
  stockQty: number;
  totalValue: number;
  unitCost: number;
} {
  const sharedActive =
    data.mode === "existing" ? !!selected?.shared_unit_enabled : data.newSharedEnabled;
  const weightVariable =
    data.mode === "existing" ? !!selected?.weight_variable : data.newWeightVariable;
  const effectiveUnit: EntryUnit =
    data.mode === "existing"
      ? normalizeEntryUnit(selected?.unit ?? "UN")
      : sharedActive
        ? "UN"
        : data.newUnit;

  const standardKg =
    data.mode === "existing"
      ? Number(selected?.standard_weight_g ?? 0) / 1000
      : parseDec(data.newStandardWeightKg);

  // Peso por unidade DESTE LOTE — usa o lote se preenchido, senão cai no Peso Base.
  const lotKg = parseDec(data.lotWeightKg) || standardKg;

  const qty = parseDec(data.quantity);
  const pack = parseDec(data.packQty) || 1;
  const units = parseDec(data.sharedUnits);
  const totalKg = parseDec(data.sharedTotalKg);
  const totalValue = parseDec(data.totalValue);

  let stockQty = 0;
  if (sharedActive) {
    stockQty = totalKg > 0 ? totalKg : units * (lotKg || 0);
  } else {
    stockQty = qty * pack;
  }
  const unitCost = stockQty > 0 ? totalValue / stockQty : 0;

  return {
    effectiveUnit,
    sharedActive,
    weightVariable,
    standardKg,
    qty,
    pack,
    units,
    totalKg,
    stockQty,
    totalValue,
    unitCost,
  };
}

/**
 * Calculadora bidirecional (regra de três ativa) para o bloco SHARED.
 *
 *   Qtd. Unidades  ×  Peso do Lote (kg/un)  =  Peso Total (kg)
 *
 * Regras:
 * - Se 2 dos 3 campos tiverem valor > 0 → calcula o terceiro automaticamente.
 * - Se o usuário apagar um campo e os outros dois ainda tiverem valor → recalcula
 *   o apagado imediatamente (campo nunca fica zerado se há dados suficientes).
 * - Mantém precisão total no estado (sem arredondar). A máscara de exibição
 *   ocorre apenas no Input (vide `maskDec`).
 */
export function applyBidirectional(
  data: EntryCardData,
  field: "units" | "lot" | "total",
  rawValue: string,
): Partial<EntryCardData> {
  const patch: Partial<EntryCardData> = {};
  if (field === "units") patch.sharedUnits = rawValue;
  if (field === "lot") patch.lotWeightKg = rawValue;
  if (field === "total") patch.sharedTotalKg = rawValue;

  // Valores efetivos pós-edição
  const valUnits = field === "units" ? parseDec(rawValue) : parseDec(data.sharedUnits);
  const valLot = field === "lot" ? parseDec(rawValue) : parseDec(data.lotWeightKg);
  const valTotal = field === "total" ? parseDec(rawValue) : parseDec(data.sharedTotalKg);

  // Precisão total no estado — máscara ocorre só na exibição.
  const toState = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return "";
    return n.toLocaleString("en-US", { maximumFractionDigits: 12, useGrouping: false });
  };

  // Prioridade fixa por campo editado (sem rastrear histórico):
  // - units alterado  → recalcula total (se tiver lot)
  // - lot alterado    → recalcula total (se tiver units)
  // - total alterado  → recalcula lot   (se tiver units)
  // Caso o "alvo" não tenha entradas suficientes, tenta recalcular outro campo
  // que esteja vazio para nunca deixar zerado quando há 2 valores.
  if (field === "units") {
    if (valUnits > 0 && valLot > 0) patch.sharedTotalKg = toState(valUnits * valLot);
    else if (valUnits > 0 && valTotal > 0) patch.lotWeightKg = toState(valTotal / valUnits);
  } else if (field === "lot") {
    if (valUnits > 0 && valLot > 0) patch.sharedTotalKg = toState(valUnits * valLot);
    else if (valLot > 0 && valTotal > 0)
      patch.sharedUnits = String(Math.max(0, Math.round(valTotal / valLot)));
  } else if (field === "total") {
    if (valUnits > 0 && valTotal > 0) patch.lotWeightKg = toState(valTotal / valUnits);
    else if (valLot > 0 && valTotal > 0)
      patch.sharedUnits = String(Math.max(0, Math.round(valTotal / valLot)));
  }

  return patch;
}

interface Props {
  index: number;
  data: EntryCardData;
  items: EntryItemRef[];
  canRemove: boolean;
  onChange: (patch: Partial<EntryCardData>) => void;
  onRemove: () => void;
  /** Esconde o switch de modo (existing/new) — útil para XML que sempre traz o nome da nota. */
  hideModeSwitch?: boolean;
}

export function EntryItemCard({
  index,
  data,
  items,
  canRemove,
  onChange,
  onRemove,
  hideModeSwitch = false,
}: Props) {
  const selected = useMemo(
    () => items.find((i) => i.id === data.itemId),
    [items, data.itemId],
  );

  // Sugestão automática: ao vincular a um Insumo Existente que possui Peso Base
  // cadastrado (standard_weight_g), pré-popula o "Peso do Lote Atual" da CALCULADORA
  // — sem nunca tocar no Peso Base do cadastro original.
  const lastLoadedItemId = useRef<string>("");
  useEffect(() => {
    if (data.mode !== "existing") return;
    if (!selected || !selected.shared_unit_enabled) return;
    if (lastLoadedItemId.current === selected.id) return;
    lastLoadedItemId.current = selected.id;
    const stdKg = Number(selected.standard_weight_g ?? 0) / 1000;
    if (stdKg > 0 && !data.lotWeightKg) {
      onChange({
        lotWeightKg: stdKg.toLocaleString("en-US", {
          maximumFractionDigits: 6,
          useGrouping: false,
        }),
      });
    }
  }, [selected, data.mode, data.lotWeightKg, onChange]);

  const t = computeEntryTotals(data, selected);
  const packLabel = t.sharedActive
    ? "kg/un"
    : t.effectiveUnit === "KG"
      ? "kg/emb"
      : t.effectiveUnit === "L"
        ? "L/emb"
        : "un/emb";
  const totalLabel = t.sharedActive ? "kg" : t.effectiveUnit;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-3 rounded-lg border border-border bg-card p-3 shadow-sm">
      {/* Header: índice + estado de vínculo + remover */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Item #{index + 1}
          </span>
          {data.mode === "existing" && selected ? (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Link2 className="h-3 w-3" /> Vinculado
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-primary/40 text-[10px] text-primary">
              <Sparkles className="h-3 w-3" /> Novo insumo
            </Badge>
          )}
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Modo */}
      {!hideModeSwitch && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={data.mode === "existing" ? "default" : "outline"}
            size="sm"
            onClick={() => onChange({ mode: "existing" })}
          >
            Insumo existente
          </Button>
          <Button
            type="button"
            variant={data.mode === "new" ? "default" : "outline"}
            size="sm"
            onClick={() => onChange({ mode: "new", itemId: "" })}
          >
            Novo insumo
          </Button>
        </div>
      )}

      {/* LINHA 1 — Nome + Unidade */}
      {data.mode === "existing" ? (
        <div className="space-y-1">
          <Label className="text-xs">Buscar insumo</Label>
          <Popover
            open={!!data.pickerOpen}
            onOpenChange={(v) => onChange({ pickerOpen: v })}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                className="w-full justify-between font-normal"
              >
                <span className={cn("truncate", !selected && "text-muted-foreground")}>
                  {selected
                    ? `${selected.name} (${normalizeEntryUnit(selected.unit)})`
                    : "Selecione um item"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Buscar item..." />
                <CommandList>
                  <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
                  <CommandGroup>
                    {items.map((i) => (
                      <CommandItem
                        key={i.id}
                        value={`${i.name} ${normalizeEntryUnit(i.unit)}`}
                        onSelect={() => onChange({ itemId: i.id, pickerOpen: false })}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            data.itemId === i.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {i.name} ({normalizeEntryUnit(i.unit)})
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <div className="space-y-3">
          {/* L1: Nome + Unidade */}
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome do insumo *</Label>
              <Input
                value={data.newName}
                onChange={(e) => onChange({ newName: e.target.value })}
                placeholder="Ex.: Tomate italiano"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unidade</Label>
              <Select
                value={data.newUnit}
                onValueChange={(v) => onChange({ newUnit: v as EntryUnit })}
                disabled={data.newSharedEnabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* L2: Categoria/Subcategoria */}
          <CategorySubcategorySelect
            value={data.newCategoryId}
            onChange={(v) => onChange({ newCategoryId: v })}
          />

          {/* L3: switches lado a lado */}
          <div className="grid grid-cols-2 gap-2">
            <SwitchTile
              label="Contabilizar CMV"
              checked={data.newContabilizaCmv}
              onChange={(v) => onChange({ newContabilizaCmv: v })}
              tone={data.newContabilizaCmv ? "ok" : "warn"}
              tooltip="Ative para itens que compõem o custo dos pratos. Desative para materiais de limpeza ou descartáveis."
            />
            <SwitchTile
              label="Unidade Compartilhada"
              checked={data.newSharedEnabled}
              onChange={(v) =>
                onChange({
                  newSharedEnabled: v,
                  newUnit: v ? "UN" : data.newUnit,
                })
              }
              tooltip="Habilita o controle dual (UN/KG). Ideal para converter peso em porções ou peças em peso líquido, garantindo precisão total no inventário e no custo real."
            />
          </div>

          {/* L4: condicional Peso Fixo/Variável + Peso Base */}
          {data.newSharedEnabled && (
            <div className="grid grid-cols-[auto_1fr] items-end gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <ToggleGroup
                  type="single"
                  value={data.newWeightVariable ? "var" : "fix"}
                  onValueChange={(v) => {
                    if (!v) return;
                    const isVar = v === "var";
                    const patch: Partial<EntryCardData> = { newWeightVariable: isVar };
                    // Peso Fixo: trava o peso do lote = Peso Base
                    if (!isVar && data.newStandardWeightKg) {
                      patch.lotWeightKg = data.newStandardWeightKg;
                      // recalcula total se houver unidades
                      const u = parseDec(data.sharedUnits);
                      const lk = parseDec(data.newStandardWeightKg);
                      if (u > 0 && lk > 0) {
                        patch.sharedTotalKg = (u * lk).toLocaleString("en-US", {
                          maximumFractionDigits: 12,
                          useGrouping: false,
                        });
                      }
                    }
                    onChange(patch);
                  }}
                  className="justify-start"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem
                        value="fix"
                        size="sm"
                        className="h-9 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary border"
                      >
                        Peso Fixo
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
                      Trava o Peso do Lote no Peso Base. Qtd × Peso Base = Total automaticamente.
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem
                        value="var"
                        size="sm"
                        className="h-9 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary border"
                      >
                        Peso Variável
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
                      Libera o Peso do Lote para edição. O custo médio reflete o peso real recebido sem alterar o Peso Base.
                    </TooltipContent>
                  </Tooltip>
                </ToggleGroup>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Peso Base (kg/un) *</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0"
                  placeholder="0,000"
                  value={data.newStandardWeightKg}
                  onChange={(e) => {
                    const v = e.target.value;
                    const patch: Partial<EntryCardData> = { newStandardWeightKg: v };
                    // Em Peso Fixo, o lote acompanha o Peso Base.
                    if (!data.newWeightVariable) {
                      patch.lotWeightKg = v;
                      const u = parseDec(data.sharedUnits);
                      const lk = parseDec(v);
                      if (u > 0 && lk > 0) {
                        patch.sharedTotalKg = (u * lk).toLocaleString("en-US", {
                          maximumFractionDigits: 12,
                          useGrouping: false,
                        });
                      }
                    }
                    onChange(patch);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* MOTOR DE CÁLCULOS */}
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cálculo de entrada
          </p>
          <HelpTip text="Calculadora Inteligente: Altere qualquer campo para que o sistema ajuste os outros automaticamente." />
        </div>

        {t.sharedActive ? (
          // SHARED: Qtd × Peso do Lote = Total kg (bidirecional)
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-2">
            <FormulaInput
              label="Qtd. Unidades"
              value={data.sharedUnits}
              onChange={(v) =>
                onChange(applyBidirectional(data, "units", v.replace(/[^\d]/g, "")))
              }
              step="1"
              inputMode="numeric"
              suffix="un"
            />
            <Op>×</Op>
            <FormulaInput
              label={`Peso do Lote Atual (${packLabel})`}
              value={data.lotWeightKg}
              onChange={(v) => onChange(applyBidirectional(data, "lot", v))}
              step="0.001"
              suffix="kg"
              displayDecimals={3}
            />
            <Op>=</Op>
            <FormulaInput
              label="Peso Total"
              value={data.sharedTotalKg}
              onChange={(v) => onChange(applyBidirectional(data, "total", v))}
              step="0.001"
              suffix="kg"
              highlight
              displayDecimals={3}
              hint={
                parseDec(data.sharedUnits) > 0 && parseDec(data.lotWeightKg) > 0
                  ? `${parseDec(data.lotWeightKg).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg/un`
                  : undefined
              }
            />
          </div>
        ) : (
          // NÃO-SHARED: Quantidade × Un/Emb = Total
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-2">
            <FormulaInput
              label="Quantidade"
              value={data.quantity}
              onChange={(v) =>
                onChange({
                  quantity:
                    t.effectiveUnit === "UN" && parseDec(data.packQty) === 1
                      ? v.replace(/[^\d]/g, "")
                      : v,
                })
              }
              step={t.effectiveUnit === "UN" ? "1" : "0.001"}
              inputMode={t.effectiveUnit === "UN" ? "numeric" : "decimal"}
              suffix="emb"
            />
            <Op>×</Op>
            <FormulaInput
              label={packLabel}
              value={data.packQty}
              onChange={(v) => onChange({ packQty: v })}
              step={t.effectiveUnit === "UN" ? "1" : "0.001"}
              inputMode={t.effectiveUnit === "UN" ? "numeric" : "decimal"}
              suffix={t.effectiveUnit === "UN" ? "un" : t.effectiveUnit.toLowerCase()}
            />
            <Op>=</Op>
            <ResultBox
              label="Total"
              value={`${fmt3(t.stockQty)} ${totalLabel}`}
            />
          </div>
        )}

        {/* Valor Total */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Valor Total (R$) *</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={data.totalValue}
              onChange={(e) => onChange({ totalValue: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Custo unitário</Label>
            <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-muted/50 px-3 text-sm font-semibold tabular-nums">
              <span>{t.unitCost > 0 ? `${fmtBRL(t.unitCost)} / ${totalLabel}` : "—"}</span>
              {t.sharedActive && t.totalValue > 0 && (
                <span className="flex flex-col items-end text-[10px] font-normal leading-tight text-muted-foreground">
                  {t.totalKg > 0 && (
                    <span>{fmtBRL(t.totalValue / t.totalKg)}/kg</span>
                  )}
                  {t.units > 0 && (
                    <span>{fmtBRL(t.totalValue / t.units)}/un</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RODAPÉ — Validade + Lote */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Validade do lote</Label>
          <Input
            type="date"
            value={data.expiryDate}
            onChange={(e) => onChange({ expiryDate: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nº do lote</Label>
          <Input
            placeholder="Ex: L240501"
            value={data.lotNumber}
            onChange={(e) => onChange({ lotNumber: e.target.value })}
          />
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

// ---------- subcomponentes ----------

function SwitchTile({
  label,
  checked,
  onChange,
  tone = "neutral",
  tooltip,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: "neutral" | "ok" | "warn";
  tooltip?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors",
        tone === "ok" && checked && "border-emerald-500/40 bg-emerald-500/10",
        tone === "warn" && !checked && "border-amber-500/40 bg-amber-500/10",
        tone === "neutral" && "border-border bg-muted/30",
      )}
    >
      <span className="flex items-center gap-1 text-xs font-medium leading-tight">
        {label}
        {tooltip && <HelpTip text={tooltip} />}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function FormulaInput({
  label,
  value,
  onChange,
  step,
  inputMode = "decimal",
  suffix,
  readOnly,
  highlight,
  displayDecimals,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  inputMode?: "decimal" | "numeric";
  suffix?: string;
  readOnly?: boolean;
  highlight?: boolean;
  /** Máscara: nº de casas exibidas no Input (não altera o estado). */
  displayDecimals?: number;
  /** Texto secundário pequeno embaixo do label (ex.: "0,180 kg/un"). */
  hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  // Quando focado, mostra o valor cru (precisão total). Sem foco, aplica máscara.
  const display =
    focused || displayDecimals == null ? value : maskDec(value, displayDecimals);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {hint && (
          <span className="text-[10px] tabular-nums text-muted-foreground/80">
            {hint}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          type="text"
          inputMode={inputMode}
          step={step}
          placeholder="0"
          value={display}
          readOnly={readOnly}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "pr-9 tabular-nums",
            readOnly && "bg-muted/50",
            highlight && "border-primary/50 bg-primary/5 font-semibold",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ResultBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex h-9 items-center justify-end rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-bold tabular-nums text-primary">
        {value}
      </div>
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-9 items-end justify-center pb-2 text-base font-semibold text-muted-foreground">
      {children}
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Ajuda"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
