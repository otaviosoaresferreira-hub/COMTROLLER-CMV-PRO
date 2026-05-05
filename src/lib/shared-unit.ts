// Utilidades para itens com "Unidade Compartilhada" (gerido em UN com peso médio).

export type SharedUnitInfo = {
  enabled: boolean;
  standardWeightG: number; // peso padrão por unidade (g)
  avgWeightG: number; // peso médio global atual ponderado (g)
};

/**
 * Recalcula o peso médio global ponderado após uma nova entrada de lote.
 * Fórmula: ((unidades_atuais × média_atual) + (unidades_novas × média_novo_lote))
 *          / (unidades_atuais + unidades_novas)
 */
export function weightedAvgWeight(
  currentUnits: number,
  currentAvgG: number,
  newUnits: number,
  newAvgG: number,
): number {
  const total = currentUnits + newUnits;
  if (total <= 0) return newAvgG > 0 ? newAvgG : currentAvgG;
  if (currentUnits <= 0 || currentAvgG <= 0) return newAvgG;
  return (currentUnits * currentAvgG + newUnits * newAvgG) / total;
}

export type DeviationLevel = "ok" | "warn" | "alert";

/**
 * Indicador de desvio do peso médio em relação ao padrão cadastrado.
 * ±10% = warn (amarelo), ±20% = alert (vermelho), <10% = ok (verde).
 */
export function deviationLevel(standardG: number, currentG: number): DeviationLevel {
  if (!standardG || standardG <= 0 || !currentG || currentG <= 0) return "ok";
  const pct = Math.abs(currentG - standardG) / standardG;
  if (pct >= 0.2) return "alert";
  if (pct >= 0.1) return "warn";
  return "ok";
}

/** Diferença % assinada (positivo = acima do padrão). */
export function deviationPercent(standardG: number, currentG: number): number {
  if (!standardG || standardG <= 0 || !currentG || currentG <= 0) return 0;
  return ((currentG - standardG) / standardG) * 100;
}

export function formatGrams(g: number): string {
  if (!Number.isFinite(g) || g <= 0) return "—";
  if (g >= 1000) return `${(g / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
  return `${Math.round(g)} g`;
}

/**
 * Arredondamento "snap 0,5" para unidades inteiras/meias.
 * round(x * 2) / 2 → 29.996 → 30; 30.4 → 30.5; 30.7 → 30.5; 30.8 → 31.
 * Use SEMPRE para exibir e salvar quantidades em UN de itens compartilhados,
 * eliminando dízimas vindas de divisões KG ÷ peso médio.
 */
export function roundUn(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 2) / 2;
}

/**
 * Formata UN seguindo a regra do 0,5: inteiros sem decimal, meios com ",5".
 * Ex.: 30 → "30", 30.5 → "30,5". Aplica roundUn antes da formatação.
 */
export function formatUn(value: number): string {
  const v = roundUn(value);
  if (Number.isInteger(v)) return v.toLocaleString("pt-BR");
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Formata KG com até 3 casas, sem dízimas residuais (>= 1g de precisão). */
export function formatKg(value: number): string {
  if (!Number.isFinite(value)) return "0";
  // Snap em 1g (0.001 kg) para eliminar artefatos de ponto flutuante
  const v = Math.round(value * 1000) / 1000;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
