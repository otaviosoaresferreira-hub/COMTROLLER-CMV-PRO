import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageBase64: z.string().min(100, "Imagem inválida"),
  mimeType: z.string().default("image/jpeg"),
});

export type OcrInvoiceItem = {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type OcrInvoiceResult = {
  supplierName: string;
  number: string;
  issueDate: string; // YYYY-MM-DD
  totalValue: number;
  items: OcrInvoiceItem[];
};

const SYSTEM_PROMPT = `Você é um assistente que extrai dados estruturados de fotos de notas fiscais e cupons fiscais brasileiros (NF-e, NFC-e, cupom de mercado).

Regras:
- Leia toda a imagem com atenção, mesmo se estiver torta ou em baixa qualidade.
- Identifique o fornecedor/emitente, número, data de emissão e valor total.
- Liste TODOS os itens/produtos com: descrição completa, unidade (UN/KG/L), quantidade, preço unitário e preço total.
- Use ponto como separador decimal nos números (não use vírgula).
- Se algum campo estiver ilegível, devolva 0 para números e string vazia para texto.
- Nunca invente itens.
- Responda SOMENTE chamando a função extract_invoice.`;

const TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "extract_invoice",
    description: "Extrai dados estruturados de uma nota/cupom fiscal a partir de imagem.",
    parameters: {
      type: "object",
      properties: {
        supplier_name: { type: "string", description: "Razão social do fornecedor/emitente" },
        number: { type: "string", description: "Número da nota ou cupom" },
        issue_date: { type: "string", description: "Data de emissão no formato YYYY-MM-DD" },
        total_value: { type: "number", description: "Valor total da nota em reais" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              unit: { type: "string", description: "UN, KG, L, PC, CX, etc." },
              quantity: { type: "number" },
              unit_price: { type: "number" },
              total_price: { type: "number" },
            },
            required: ["name", "unit", "quantity", "unit_price", "total_price"],
            additionalProperties: false,
          },
        },
      },
      required: ["supplier_name", "number", "issue_date", "total_value", "items"],
      additionalProperties: false,
    },
  },
};

export const ocrInvoiceImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<OcrInvoiceResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OCR indisponível: chave Lovable AI não configurada no servidor.",
      );
    }

    const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extraia os dados desta nota/cupom fiscal e chame a função extract_invoice.",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [TOOL_DEF],
        tool_choice: { type: "function", function: { name: "extract_invoice" } },
      }),
    });

    if (resp.status === 429) {
      throw new Error("Muitas requisições — aguarde alguns segundos e tente novamente.");
    }
    if (resp.status === 402) {
      throw new Error("Créditos esgotados na Lovable AI. Adicione saldo nas configurações.");
    }
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Falha no OCR (${resp.status}): ${txt.slice(0, 200)}`);
    }

    const json = (await resp.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{ function?: { arguments?: string } }>;
          content?: string;
        };
      }>;
    };

    const argsRaw =
      json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
      json.choices?.[0]?.message?.content ??
      "";

    if (!argsRaw) {
      throw new Error("OCR não retornou dados estruturados");
    }

    let parsed: {
      supplier_name?: string;
      number?: string;
      issue_date?: string;
      total_value?: number;
      items?: Array<{
        name?: string;
        unit?: string;
        quantity?: number;
        unit_price?: number;
        total_price?: number;
      }>;
    };
    try {
      parsed = JSON.parse(argsRaw);
    } catch {
      throw new Error("OCR retornou resposta em formato inválido");
    }

    const num = (v: unknown) => {
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };

    const items: OcrInvoiceItem[] = (parsed.items ?? [])
      .map((it) => ({
        name: String(it.name ?? "").trim(),
        unit: String(it.unit ?? "UN").trim().toUpperCase(),
        quantity: num(it.quantity),
        unitPrice: num(it.unit_price),
        totalPrice: num(it.total_price),
      }))
      .filter((it) => it.name.length > 0);

    return {
      supplierName: String(parsed.supplier_name ?? "").trim(),
      number: String(parsed.number ?? "").trim(),
      issueDate: String(parsed.issue_date ?? "").slice(0, 10),
      totalValue: num(parsed.total_value),
      items,
    };
  });
