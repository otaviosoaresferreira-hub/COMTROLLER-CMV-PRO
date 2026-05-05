// Parser para NF-e e NFC-e (layout SEFAZ Brasil)
// Lê o XML e retorna a lista de produtos encontrados em <det><prod>

export type ParsedNFeItem = {
  name: string; // xProd
  unit: string; // uCom (normalizado)
  quantity: number; // qCom
  unitPrice: number; // vUnCom
  totalPrice: number; // vProd (quando presente, usado como referência)
  ncm: string; // NCM (8 dígitos) — usado para sugerir não-CMV
};

/**
 * Heurística: NCMs típicos de material de consumo (limpeza, escritório,
 * descartáveis). Quando o item recebido em XML cair em um destes capítulos,
 * sugerimos desativar "Contabilizar no CMV". Default sempre permanece TRUE;
 * é apenas um sinal para o usuário revisar.
 *
 * Capítulos NCM (2 primeiros dígitos):
 *  - 33: Óleos essenciais, perfumaria, cosméticos, higiene
 *  - 34: Sabões, ceras, produtos de limpeza
 *  - 38: Produtos químicos diversos (desinfetantes industriais)
 *  - 39: Plásticos (descartáveis, embalagens)
 *  - 48: Papel (guardanapos, papel toalha, escritório)
 *  - 96: Vassouras, escovas, artefatos de uso doméstico
 */
const NON_CMV_NCM_PREFIXES = ["33", "34", "38", "39", "48", "96"];

export function suggestNonCmvFromNcm(ncm: string | null | undefined): boolean {
  const clean = (ncm ?? "").replace(/\D/g, "");
  if (clean.length < 2) return false;
  const prefix = clean.slice(0, 2);
  return NON_CMV_NCM_PREFIXES.includes(prefix);
}

function normalizeUnit(u: string | null | undefined): "UN" | "KG" | "L" {
  const v = (u ?? "").trim().toUpperCase();
  if (v === "KG" || v === "QUILO" || v === "QUILOS") return "KG";
  if (v === "L" || v === "LT" || v === "LITRO" || v === "LITROS") return "L";
  return "UN";
}

function getText(el: Element | null, tag: string): string {
  if (!el) return "";
  const node = el.getElementsByTagName(tag)[0];
  return node?.textContent?.trim() ?? "";
}

export function parseNFeXml(xmlText: string): ParsedNFeItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Verifica erro de parse
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) {
    const detail = parseErr.textContent?.trim().slice(0, 200) || "estrutura XML malformada";
    throw new Error(`XML não pôde ser lido: ${detail}`);
  }

  // <det> contém os itens (NF-e e NFC-e usam o mesmo schema base)
  const dets = Array.from(doc.getElementsByTagName("det"));
  if (dets.length === 0) {
    throw new Error(
      "Nenhum item encontrado. Verifique se o arquivo é uma NF-e ou NFC-e válida.",
    );
  }

  const items: ParsedNFeItem[] = [];
  for (const det of dets) {
    const prod = det.getElementsByTagName("prod")[0];
    if (!prod) continue;

    const name = getText(prod, "xProd");
    const unit = normalizeUnit(getText(prod, "uCom"));
    const quantity = Number((getText(prod, "qCom") || "0").replace(",", "."));
    const unitPrice = Number(
      (getText(prod, "vUnCom") || "0").replace(",", "."),
    );
    const totalPrice = Number(
      (getText(prod, "vProd") || "0").replace(",", "."),
    );
    const ncm = getText(prod, "NCM");

    if (!name || !quantity) continue;

    items.push({ name, unit, quantity, unitPrice, totalPrice, ncm });
  }

  if (items.length === 0) {
    throw new Error("Nenhum item válido encontrado no XML.");
  }

  return items;
}
