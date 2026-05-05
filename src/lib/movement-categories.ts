/**
 * Categorias de saída de estoque.
 *
 * Estes valores são gravados em `movements.reason_category` e em
 * `movement_incidents.reason_category` quando a operação não tinha saldo
 * suficiente. Mantemos uma lista fechada para que relatórios de CMV consigam
 * agrupar perdas com confiança.
 */
export type OutputKind = "waste" | "staff_meal";

/** Categoria de razão (sub-tipo) que detalha o motivo do descarte. */
export type ReasonCategory = "process_loss" | "expired" | "staff" | "other";

export const OUTPUT_KIND_META: Record<
  OutputKind,
  { label: string; movementType: string; defaultReason: ReasonCategory }
> = {
  waste: {
    label: "Descarte",
    movementType: "waste",
    defaultReason: "process_loss",
  },
  staff_meal: {
    label: "Alimentação (refeição da equipe)",
    movementType: "consumption",
    defaultReason: "staff",
  },
};

/** Razões mostradas para Descartes. Alimentação fixa em `staff`. */
export const WASTE_REASONS: Array<{ value: ReasonCategory; label: string; help?: string }> = [
  {
    value: "process_loss",
    label: "Perda de processo",
    help: "Quebra, derrame, queima, erro de preparo.",
  },
  {
    value: "expired",
    label: "Vencido / fora de padrão",
    help: "Validade expirada ou produto sem condições de uso.",
  },
  {
    value: "other",
    label: "Outro",
    help: "Use o campo de observação para detalhar.",
  },
];

export function reasonLabel(reason: ReasonCategory | null | undefined): string {
  if (!reason) return "—";
  switch (reason) {
    case "process_loss":
      return "Perda de processo";
    case "expired":
      return "Vencido";
    case "staff":
      return "Alimentação (equipe)";
    case "other":
      return "Outro";
  }
}

export function outputKindLabel(kind: OutputKind): string {
  return OUTPUT_KIND_META[kind].label;
}
