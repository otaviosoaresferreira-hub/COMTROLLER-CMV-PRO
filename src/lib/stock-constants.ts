// Lookup do Estoque Central é feito pelo nome (sistema dinâmico).
// O ID é resolvido em runtime a partir da tabela locations.
export const CENTRAL_LOCATION_NAME = "Estoque Central";

// Nome do item Água de Produção (item especial de sistema, sempre presente).
// Estoque infinito, custo zero, somente para fichas técnicas (caldos, bases).
// Diferente de "Água Mineral", que é um produto de revenda normal.
export const WATER_ITEM_NAME = "Água (Produção)";

// Nome da categoria oculta usada para abrigar insumos internos do sistema
// (ex.: Água de Produção). Filtrada da sidebar e dos seletores de produto.
export const SYSTEM_CATEGORY_NAME = "Sistema";

// Categorias-base imutáveis do sistema.
// A categoria "Produção Interna" é especial: itens nela representam preparações
// produzidas internamente (custo vem da ficha técnica, não de compra).
export const SYSTEM_CATEGORY_NAMES = [
  "Proteínas",
  "Laticínios",
  "Hortifruti",
  "Estoque Seco",
  "Bebidas",
  "Descartáveis",
  "Limpeza",
  "Produção Interna",
] as const;

export const SUBRECIPE_CATEGORY_NAME = "Produção Interna";

export function findCentralLocation<T extends { id: string; name: string }>(
  locations: readonly T[] | null | undefined,
): T | undefined {
  if (!locations) return undefined;
  const target = CENTRAL_LOCATION_NAME.trim().toLowerCase();
  return locations.find((l) => String(l?.name ?? "").trim().toLowerCase() === target);
}

type ItemFlags = {
  name?: string | null;
  is_system?: boolean | null;
  is_free?: boolean | null;
} | null | undefined;

/** True para o item especial "Água (Produção)" (sempre presente, nome fixo).
 *  Aceita também variantes legadas ("Água"/"Agua") por compatibilidade. */
export function isWaterItem(item: ItemFlags): boolean {
  if (!item) return false;
  const n = String(item.name ?? "").trim().toLowerCase();
  return (
    n === "água (produção)" ||
    n === "agua (producao)" ||
    n === "água" ||
    n === "agua"
  );
}

/** True para qualquer item livre criado pelo usuário (herda comportamento da Água). */
export function isUserFreeItem(item: ItemFlags): boolean {
  if (!item) return false;
  return item.is_free === true && !isWaterItem(item);
}

/** True para qualquer item com comportamento livre: Água OU itens livres. */
export function isFreeItem(item: ItemFlags): boolean {
  if (!item) return false;
  return item.is_free === true || isWaterItem(item);
}
