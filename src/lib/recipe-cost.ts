// Conversão simplificada de unidades para cálculo de custo.
// Considera que cost_price está armazenado como R$ por unidade base do item (UN, KG ou L).
// Quando ingrediente usa subunidade (ex: G para item em KG, ML para L), converte.

export type Unit = "UN" | "KG" | "L" | "G" | "ML" | "PORCAO";

export function convertToBase(qty: number, fromUnit: Unit, baseUnit: Unit): number {
  if (fromUnit === baseUnit) return qty;
  if (baseUnit === "KG" && fromUnit === "G") return qty / 1000;
  if (baseUnit === "L" && fromUnit === "ML") return qty / 1000;
  if (baseUnit === "G" && fromUnit === "KG") return qty * 1000;
  if (baseUnit === "ML" && fromUnit === "L") return qty * 1000;
  // Fallback: assume mesma escala
  return qty;
}

export function normalizeUnit(u: string | null | undefined): Unit {
  const v = (u ?? "").trim().toUpperCase();
  if (v === "KG") return "KG";
  if (v === "G" || v === "GR" || v === "GRAMA") return "G";
  if (v === "L" || v === "LT" || v === "LITRO") return "L";
  if (v === "ML") return "ML";
  if (v === "PORCAO" || v === "PORÇÃO") return "PORCAO";
  return "UN";
}

export const INGREDIENT_UNITS: Unit[] = ["UN", "KG", "G", "L", "ML"];
