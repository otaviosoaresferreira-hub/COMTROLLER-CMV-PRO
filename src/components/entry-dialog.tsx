import { useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus, FileCode2, Pencil, Check, ChevronsUpDown, Upload, Trash2, Loader2, Camera } from "lucide-react";
import { ocrInvoiceImage, type OcrInvoiceResult, type OcrInvoiceItem } from "@/server/ocr-invoice.functions";
import { useManagerMode } from "@/lib/manager-mode";
import { parseNFeXml, suggestNonCmvFromNcm, type ParsedNFeItem } from "@/lib/nfe-parser";
import { Switch } from "@/components/ui/switch";
import { weightedAvgWeight } from "@/lib/shared-unit";
import { useOrgId } from "@/lib/use-org-id";
import { CategorySubcategorySelect } from "@/components/category-subcategory-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Unit = "UN" | "KG" | "L";
const UNIT_OPTIONS: Unit[] = ["UN", "KG", "L"];

function normalizeUnit(u: string | null | undefined): Unit {
  const v = (u ?? "").trim().toUpperCase();
  if (v === "KG") return "KG";
  if (v === "L" || v === "LT" || v === "LITRO") return "L";
  return "UN";
}

type Item = {
  id: string;
  name: string;
  unit: string;
  shared_unit_enabled?: boolean;
  standard_weight_g?: number;
  avg_weight_g?: number;
  cost_price?: number;
  weight_variable?: boolean;
};
type StockLevel = {
  item_id: string;
  location_id: string;
  current_stock: number;
  expiry_date?: string | null;
};

interface Props {
  items: Item[];
  centralId: string;
  stockLevels: StockLevel[];
  categories: { id: string; name: string }[];
}

export function EntryDialog({ items, centralId, stockLevels, categories }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"manual" | "xml" | "photo">("manual");


  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        className="h-14 flex-1 gap-2 text-base shadow-sm"
      >
        <PackagePlus className="h-5 w-5" />
        Registrar Entrada
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90vh] max-w-4xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Registrar Entrada</DialogTitle>
            <DialogDescription>
              Adicione mercadorias ao Estoque Central.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "manual" | "xml" | "photo")}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="manual" className="gap-2">
                <Pencil className="h-4 w-4" /> Manual
              </TabsTrigger>
              <TabsTrigger value="xml" className="gap-2">
                <FileCode2 className="h-4 w-4" /> XML
              </TabsTrigger>
              <TabsTrigger value="photo" className="gap-2">
                <Camera className="h-4 w-4" /> Câmera/Foto
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4 pt-4">
              <ManualEntryTab
                items={items}
                centralId={centralId}
                stockLevels={stockLevels}
                categories={categories}
                onDone={() => setOpen(false)}
              />
            </TabsContent>

            <TabsContent value="xml" className="space-y-4 pt-4">
              <XmlImportTab
                items={items}
                centralId={centralId}
                stockLevels={stockLevels}
                categories={categories}
                onDone={() => setOpen(false)}
              />
            </TabsContent>

            <TabsContent value="photo" className="space-y-4 pt-4">
              <PhotoImportTab
                items={items}
                centralId={centralId}
                stockLevels={stockLevels}
                categories={categories}
                onDone={() => setOpen(false)}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// XML Import Tab — versão completa com Vincular / Cadastrar / Unidade Compartilhada
// ============================================================

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const parseDecimal = (value: string | number | null | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number((value ?? "").replace(",", ".")) || 0;
};

const toInputDecimal = (value: number, maximumFractionDigits = 4): string => {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", {
    useGrouping: false,
    maximumFractionDigits,
  }).format(value);
};

const toDisplayDecimal = (value: number, fractionDigits = 3): string => {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

// Trunca (não arredonda) para N casas decimais. Ex.: 0,2235 com 3 casas → "0,223".
// Usado no resultado real de divisões (peso variável) para evitar arredondamento "para cima"
// que distorce o CMV (22,350 / 100 = 0,2235 → exibe 0,223 e NÃO 0,224).
const toTruncatedDecimal = (value: number, fractionDigits = 3): string => {
  if (!Number.isFinite(value)) return "";
  const factor = Math.pow(10, fractionDigits);
  const truncated = Math.trunc(value * factor) / factor;
  return truncated.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

type ConvDirection = "mult" | "div";
type MappingRow = {
  parsed: ParsedNFeItem;
  mode: "existing" | "new";
  itemId: string;
  newName: string;
  newUnit: Unit;
  newCategoryId: string;
  multiplier: string; // mantido para persistência (xml_item_mappings); derivado de totalStockQty quando preenchido
  convDirection: ConvDirection;
  stockQtyOverride: string;
  totalStockQty: string; // PESO/QTD TOTAL na unidade do estoque (ex: 1.5 quando balança marca 1,5kg p/ 10 maços)
  newSharedEnabled: boolean;
  /** Sub-modo do compartilhado: peso fixo (padrão) vs variável (peça). */
  newWeightVariable: boolean;
  newStandardWeightG: string;
  sharedUnits: string;
  sharedTotalKg: string;
  /** Quando definido, atualiza standard_weight_g do item na confirmação (calculadora). */
  updateStandardWeightG?: number;
  /** Contabilizar no cálculo de CMV — para itens novos. Sugerido FALSE para
   *  NCMs típicos de material de consumo (ex: limpeza, descartáveis). */
  newContabilizaCmv: boolean;
  /** Indica que a sugestão veio de NCM (para mostrar dica visual). */
  newContabilizaCmvSuggested?: boolean;
  /** Data de validade do lote (YYYY-MM-DD). Opcional. */
  expiryDate: string;
  /** Número/identificação do lote (opcional, default = número da nota). */
  lotNumber: string;
};

// Lógica: usuário digita o TOTAL na unidade do estoque (peso da balança).
// Se totalStockQty > 0 → essa é a quantidade que entra; multiplier = total / parsedQty.
// Se vazio → assume parsedQty (1:1, sem conversão).
function computeStockQty(parsedQty: number, totalStockQty: number): number {
  if (totalStockQty && totalStockQty > 0) return totalStockQty;
  return parsedQty;
}

function deriveMultiplier(parsedQty: number, totalStockQty: number): number {
  if (totalStockQty && totalStockQty > 0 && parsedQty > 0) return totalStockQty / parsedQty;
  return 1;
}

function normName(s: string): string {
  return s.toLowerCase().trim();
}

type SeedPayload = {
  items: ParsedNFeItem[];
  supplierName: string;
  number: string;
  issueDate: string;
  totalValue: number;
  fileName: string;
};

function XmlImportTab({
  items,
  centralId,
  stockLevels,
  categories,
  onDone,
  seed,
  hideUploader,
}: {
  items: Item[];
  centralId: string;
  stockLevels: StockLevel[];
  categories: { id: string; name: string }[];
  onDone: () => void;
  seed?: SeedPayload | null;
  hideUploader?: boolean;
}) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [parsing, setParsing] = useState(false);

  // Cabeçalho da nota
  const [supplierName, setSupplierName] = useState("");
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [totalValue, setTotalValue] = useState(0);
  const [xmlRaw, setXmlRaw] = useState("");

  const reset = () => {
    setFileName("");
    setRows([]);
    setSupplierName("");
    setNumber("");
    setIssueDate("");
    setAccessKey("");
    setTotalValue(0);
    setXmlRaw("");
  };

  const applySeed = async (s: SeedPayload) => {
    setParsing(true);
    try {
      setSupplierName(s.supplierName);
      setNumber(s.number);
      setIssueDate(s.issueDate);
      setAccessKey("");
      setTotalValue(s.totalValue || s.items.reduce((a, p) => a + (Number(p.totalPrice) || 0), 0));
      setXmlRaw("");
      setFileName(s.fileName);

      const xmlNames = s.items.map((p) => p.name);
      const memory = new Map<string, { item_id: string; multiplier: number }>();
      if (xmlNames.length > 0) {
        const { data: stored } = await supabase
          .from("xml_item_mappings")
          .select("xml_name,item_id,multiplier")
          .in("xml_name", xmlNames);
        (stored ?? []).forEach((m) =>
          memory.set(normName(m.xml_name), {
            item_id: m.item_id,
            multiplier: Number(m.multiplier),
          }),
        );
      }

      const numToInput = (n: number) => toInputDecimal(n, 4);
      const suggestTotalStockQty = (parsedQty: number, item: Item | undefined) => {
        if (!item || item.shared_unit_enabled) return "";
        const stdKg = Number(item.standard_weight_g ?? 0) / 1000;
        if (!(stdKg > 0) || stdKg === 1) return "";
        return numToInput(parsedQty * stdKg);
      };

      setRows(
        s.items.map<MappingRow>((p) => {
          const ncmSuggestNonCmv = suggestNonCmvFromNcm(p.ncm);
          const remembered = memory.get(normName(p.name));
          if (remembered && items.some((i) => i.id === remembered.item_id)) {
            const linked = items.find((i) => i.id === remembered.item_id);
            const mult = Number(remembered.multiplier) || 1;
            return {
              parsed: p,
              mode: "existing",
              itemId: remembered.item_id,
              newName: p.name,
              newUnit: normalizeUnit(p.unit),
              newCategoryId: "",
              multiplier: String(mult),
              convDirection: "mult",
              stockQtyOverride: "",
              totalStockQty: suggestTotalStockQty(p.quantity, linked),
              newSharedEnabled: false,
              newWeightVariable: false,
              newStandardWeightG: "",
              sharedUnits: "",
              sharedTotalKg: "",
              newContabilizaCmv: !ncmSuggestNonCmv,
              newContabilizaCmvSuggested: ncmSuggestNonCmv,
              expiryDate: "",
              lotNumber: "",
            };
          }
          const guess = items.find(
            (i) =>
              normName(i.name) === normName(p.name) ||
              normName(p.name).includes(normName(i.name)),
          );
          return {
            parsed: p,
            mode: guess ? "existing" : "new",
            itemId: guess?.id ?? "",
            newName: p.name,
            newUnit: normalizeUnit(p.unit),
            newCategoryId: "",
            multiplier: "1",
            convDirection: "mult",
            stockQtyOverride: "",
            totalStockQty: suggestTotalStockQty(p.quantity, guess),
            newSharedEnabled: false,
            newWeightVariable: false,
            newStandardWeightG: "",
            sharedUnits: "",
            sharedTotalKg: "",
            newContabilizaCmv: !ncmSuggestNonCmv,
            newContabilizaCmvSuggested: ncmSuggestNonCmv,
              expiryDate: "",
              lotNumber: "",
          };
        }),
      );
    } finally {
      setParsing(false);
    }
  };

  const lastSeedRef = useRef<SeedPayload | null>(null);
  useEffect(() => {
    if (seed && seed !== lastSeedRef.current) {
      lastSeedRef.current = seed;
      applySeed(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const text = await file.text();
      const parsed = parseNFeXml(text);

      const xmlDoc = new DOMParser().parseFromString(text, "text/xml");
      const ide = xmlDoc.getElementsByTagName("ide")[0];
      const emit = xmlDoc.getElementsByTagName("emit")[0];
      const total = xmlDoc.getElementsByTagName("ICMSTot")[0];
      const infNFe = xmlDoc.getElementsByTagName("infNFe")[0];
      const getT = (el: Element | null, tag: string) =>
        el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
      const toNum = (s: string) => Number((s || "0").replace(",", ".")) || 0;

      // Chave NFe (44 dígitos) — pode vir em <chNFe> (protocolo) ou no atributo Id de <infNFe>
      const chNFeText = getT(xmlDoc.documentElement, "chNFe");
      const idAttr = infNFe?.getAttribute("Id")?.replace(/^NFe/i, "") ?? "";
      const nfeKey = (chNFeText && /^[0-9]{44}$/.test(chNFeText))
        ? chNFeText
        : (/^[0-9]{44}$/.test(idAttr) ? idAttr : "");

      // Bloqueia se a chave já foi importada antes E ainda está processada
      if (nfeKey) {
        const { data: existing, error: dupErr } = await supabase
          .from("invoices")
          .select("id,number,supplier_name,issue_date,status")
          .eq("nfe_key", nfeKey)
          .maybeSingle();
        if (dupErr) {
          throw new Error(`Erro ao consultar duplicidade na tabela invoices: ${dupErr.message} (code ${dupErr.code ?? "?"})`);
        }
        if (existing) {
          toast.info(
            `Esta nota já foi processada (Nº ${existing.number ?? "—"}${existing.supplier_name ? ` • ${existing.supplier_name}` : ""}). Para reimportar, estorne em "Notas Processadas".`,
          );
          setParsing(false);
          return;
        }
      }

      setSupplierName(getT(emit, "xNome"));
      setNumber(getT(ide, "nNF"));
      const dEmi = getT(ide, "dhEmi") || getT(ide, "dEmi");
      setIssueDate(dEmi ? dEmi.slice(0, 10) : "");
      setAccessKey(nfeKey || idAttr);
      // <vNF> dentro de <ICMSTot>; se não houver, usa a soma dos <vProd>
      const vNF = toNum(getT(total, "vNF"));
      const sumVProd = parsed.reduce((acc, p) => acc + (Number(p.totalPrice) || 0), 0);
      setTotalValue(vNF > 0 ? vNF : sumVProd);
      setXmlRaw(text);
      setFileName(file.name);

      const xmlNames = parsed.map((p) => p.name);
      const { data: stored } = await supabase
        .from("xml_item_mappings")
        .select("xml_name,item_id,multiplier")
        .in("xml_name", xmlNames);
      const memory = new Map<string, { item_id: string; multiplier: number }>();
      (stored ?? []).forEach((m) =>
        memory.set(normName(m.xml_name), {
          item_id: m.item_id,
          multiplier: Number(m.multiplier),
        }),
      );

      // Formata número para input type="number" (usa PONTO como decimal).
      const numToInput = (n: number) => toInputDecimal(n, 4);

      // Sugere totalStockQty = parsed.quantity * (standard_weight_g/1000)
      // quando o insumo vinculado tem peso padrão configurado e diferente de 1kg.
      const suggestTotalStockQty = (parsedQty: number, item: Item | undefined) => {
        if (!item || item.shared_unit_enabled) return "";
        const stdKg = Number(item.standard_weight_g ?? 0) / 1000;
        if (!(stdKg > 0) || stdKg === 1) return "";
        return numToInput(parsedQty * stdKg);
      };

      // Aplica memória do multiplicador (A × B): pré-calcula totalStockQty
      // = parsedQty × multiplier × pesoSugeridoKg (se houver).
      const applyRememberedMultiplier = (
        parsedQty: number,
        item: Item | undefined,
        mult: number,
      ): string => {
        if (!item || item.shared_unit_enabled) return "";
        if (!(mult > 0)) return "";
        const stdKg = Number(item.standard_weight_g ?? 0) / 1000;
        const realUnits = parsedQty * mult;
        const total = stdKg > 0 && stdKg !== 1 ? realUnits * stdKg : realUnits;
        if (mult === 1 && (stdKg <= 0 || stdKg === 1)) return "";
        return numToInput(total);
      };

      // Para itens com Unidade Compartilhada: pré-preenche Qtd e Peso Total
      // com base no multiplicador lembrado e no peso padrão cadastrado.
      const suggestSharedBatch = (
        parsedQty: number,
        parsedUnit: string,
        item: Item | undefined,
        mult: number,
      ): { units: string; kg: string } => {
        if (!item || !item.shared_unit_enabled) return { units: "", kg: "" };
        const xmlUnit = normalizeUnit(parsedUnit);
        if (item.weight_variable && (xmlUnit === "KG" || xmlUnit === "L")) {
          return { units: "", kg: numToInput(parsedQty) };
        }
        const stdG = Number(item.standard_weight_g ?? 0);
        const realUnits = Math.max(0, parsedQty * (mult > 0 ? mult : 1));
        if (realUnits <= 0 || stdG <= 0) return { units: "", kg: "" };
        const totalKg = (realUnits * stdG) / 1000;
        return {
          units: toInputDecimal(realUnits, 4),
          kg: numToInput(totalKg),
        };
      };

      setRows(
        parsed.map<MappingRow>((p) => {
          const ncmSuggestNonCmv = suggestNonCmvFromNcm(p.ncm);
          const remembered = memory.get(normName(p.name));
          if (remembered && items.some((i) => i.id === remembered.item_id)) {
            const linked = items.find((i) => i.id === remembered.item_id);
            const mult = Number(remembered.multiplier) || 1;
            return {
              parsed: p,
              mode: "existing",
              itemId: remembered.item_id,
              newName: p.name,
              newUnit: normalizeUnit(p.unit),
              newCategoryId: "",
              multiplier: String(mult),
              convDirection: "mult",
              stockQtyOverride: "",
              totalStockQty: suggestTotalStockQty(p.quantity, linked),
              newSharedEnabled: false,
              newWeightVariable: false,
              newStandardWeightG: "",
              sharedUnits: "",
              sharedTotalKg: "",
              newContabilizaCmv: !ncmSuggestNonCmv,
              newContabilizaCmvSuggested: ncmSuggestNonCmv,
              expiryDate: "",
              lotNumber: "",
            };
          }
          const guess = items.find(
            (i) =>
              normName(i.name) === normName(p.name) ||
              normName(p.name).includes(normName(i.name)),
          );
          return {
            parsed: p,
            mode: guess ? "existing" : "new",
            itemId: guess?.id ?? "",
            newName: p.name,
            newUnit: normalizeUnit(p.unit),
            newCategoryId: "",
            multiplier: "1",
            convDirection: "mult",
            stockQtyOverride: "",
            totalStockQty: suggestTotalStockQty(p.quantity, guess),
            newSharedEnabled: false,
            newWeightVariable: false,
            newStandardWeightG: "",
            sharedUnits: "",
            sharedTotalKg: "",
            newContabilizaCmv: !ncmSuggestNonCmv,
            newContabilizaCmvSuggested: ncmSuggestNonCmv,
              expiryDate: "",
              lotNumber: "",
          };
        }),
      );
      toast.success(`${parsed.length} ${parsed.length === 1 ? "item lido" : "itens lidos"} do XML`);
    } catch (err) {
      toast.error((err as Error).message);
      reset();
    } finally {
      setParsing(false);
    }
  };

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const allLinked = rows.every((r) => {
    if (r.mode === "existing" && !r.itemId) return false;
    if (r.mode === "new" && !r.newName.trim()) return false;
    const target = r.mode === "existing" ? itemMap.get(r.itemId) : null;
    const isShared =
      r.mode === "existing" ? !!target?.shared_unit_enabled : r.newSharedEnabled;
    if (isShared) {
      const u = Number(r.sharedUnits.replace(",", ".")) || 0;
      const kg = Number(r.sharedTotalKg.replace(",", ".")) || 0;
      if (u <= 0 || kg <= 0) return false;
      if (
        r.mode === "new" &&
        !r.newWeightVariable &&
        !(parseDecimal(r.newStandardWeightG) > 0)
      )
        return false;
    }
    return true;
  });

  const computedTotal = rows.reduce(
    (acc, r) => acc + Number(r.parsed.totalPrice || 0),
    0,
  );

  const updateRow = (idx: number, next: MappingRow) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? next : r)));

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Organização não identificada — recarregue a página");
      if (!centralId) throw new Error("Estoque Central não encontrado");
      if (rows.length === 0) throw new Error("Importe um XML primeiro");

      type Resolved = {
        row: MappingRow;
        targetItemId: string;
        stockQty: number;
        stockUnitCost: number;
        conversionMultiplier: number;
        sharedActiveOnTarget: boolean;
        standardWeightG: number;
        batchUnits: number;
        batchTotalG: number;
        batchAvgG: number;
      };

      const resolved: Resolved[] = [];

      for (const r of rows) {
        let targetItemId = r.itemId;
        const typedTotal = Number(r.totalStockQty.replace(",", ".")) || 0;
        const existing = targetItemId ? itemMap.get(targetItemId) : undefined;
        const sharedActiveOnTarget =
          r.mode === "existing"
            ? !!existing?.shared_unit_enabled
            : r.newSharedEnabled;
        const typedMultiplier = Number(r.multiplier.replace(",", ".")) || 1;
        const mult = sharedActiveOnTarget || typedTotal <= 0
          ? typedMultiplier
          : deriveMultiplier(r.parsed.quantity, typedTotal);

        let stockQty: number;
        let batchUnits = 0;
        let batchTotalG = 0;
        let batchAvgG = 0;
        const standardWeightG = sharedActiveOnTarget
          ? r.mode === "existing"
            ? Number(existing?.standard_weight_g ?? 0)
            : Number(r.newStandardWeightG.replace(",", ".")) || 0
          : 0;

        if (sharedActiveOnTarget) {
          batchUnits = Number(r.sharedUnits.replace(",", ".")) || 0;
          const kg = Number(r.sharedTotalKg.replace(",", ".")) || 0;
          if (batchUnits <= 0)
            throw new Error(`"${r.parsed.name}": informe a Quantidade de Unidades`);
          if (kg <= 0)
            throw new Error(`"${r.parsed.name}": informe o Peso Total (KG)`);
          if (!Number.isInteger(batchUnits))
            throw new Error(`"${r.parsed.name}": Unidades deve ser inteira`);
          if (r.mode === "new" && !r.newWeightVariable && standardWeightG <= 0)
            throw new Error(`"${r.parsed.name}": informe o Peso Padrão por Unidade (kg)`);
          batchTotalG = kg * 1000;
          batchAvgG = batchTotalG / batchUnits;
          stockQty = kg;
        } else {
          stockQty = computeStockQty(r.parsed.quantity, typedTotal);
          if (!(stockQty > 0))
            throw new Error(`"${r.parsed.name}": Quantidade Final inválida`);
        }

        const stockUnitCost = stockQty > 0 ? r.parsed.totalPrice / stockQty : 0;

        if (r.mode === "new" || !targetItemId) {
          const insertUnit = sharedActiveOnTarget ? "UN" : r.newUnit;
          const { data: created, error } = await supabase
            .from("items")
            .insert({
              org_id: orgId,
              name: r.newName.trim() || r.parsed.name,
              unit: insertUnit,
              category_id: r.newCategoryId || null,
              cost_price: stockUnitCost,
              shared_unit_enabled: sharedActiveOnTarget,
              weight_variable: sharedActiveOnTarget ? r.newWeightVariable : false,
              standard_weight_g: sharedActiveOnTarget ? standardWeightG : 0,
              avg_weight_g: sharedActiveOnTarget
                ? r.newWeightVariable && batchAvgG > 0
                  ? batchAvgG
                  : standardWeightG
                : 0,
              contabiliza_cmv: r.newContabilizaCmv !== false,
            })
            .select("id")
            .single();
          if (error) throw error;
          targetItemId = created.id;
        }

        if (!targetItemId) throw new Error(`Item "${r.parsed.name}" sem vínculo`);

        await supabase.from("xml_item_mappings").upsert(
          {
            org_id: orgId,
            xml_name: r.parsed.name,
            item_id: targetItemId,
            multiplier: mult,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "xml_name" },
        );

        resolved.push({
          row: r,
          targetItemId,
          stockQty,
          stockUnitCost,
          conversionMultiplier: mult,
          sharedActiveOnTarget,
          standardWeightG,
          batchUnits,
          batchTotalG,
          batchAvgG,
        });
      }

      // Cria a invoice (com guarda extra contra duplicidade da chave NFe)
      const nfeKey = accessKey && /^[0-9]{44}$/.test(accessKey) ? accessKey : null;
      if (nfeKey) {
        const { data: dup, error: dupErr } = await supabase
          .from("invoices")
          .select("id,number,status")
          .eq("nfe_key", nfeKey)
          .maybeSingle();
        if (dupErr) {
          throw new Error(`Erro ao verificar duplicidade NFe: ${dupErr.message} (code ${dupErr.code ?? "?"})`);
        }
        if (dup) {
          const e = new Error(
            `Esta nota já foi processada (Nº ${dup.number ?? "—"}). Para reimportar, estorne em "Notas Processadas".`,
          ) as Error & { duplicate?: boolean };
          e.duplicate = true;
          throw e;
        }
      }
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          org_id: orgId,
          supplier_name: supplierName || null,
          number: number || null,
          access_key: accessKey || null,
          nfe_key: nfeKey,
          issue_date: issueDate || null,
          total_value: totalValue,
          status: "processed",
          source: xmlRaw ? "xml" : "manual",
          xml_raw: xmlRaw || null,
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (invErr) {
        throw new Error(
          `Falha ao criar nota na tabela invoices: ${invErr.message} ` +
          `(code ${invErr.code ?? "?"}${invErr.details ? `, details: ${invErr.details}` : ""}` +
          `${invErr.hint ? `, hint: ${invErr.hint}` : ""})`,
        );
      }

      const itemsPayload = resolved.map((res) => ({
        org_id: orgId,
        invoice_id: inv.id,
        item_id: res.targetItemId,
        xml_name: res.row.parsed.name,
        xml_unit: res.row.parsed.unit,
        xml_quantity: res.row.parsed.quantity,
        xml_unit_price: res.row.parsed.unitPrice,
        xml_total_price: res.row.parsed.totalPrice,
        multiplier: res.conversionMultiplier,
        stock_quantity: res.stockQty,
        stock_unit_cost: res.stockUnitCost,
      }));
      const { error: iiErr } = await supabase
        .from("invoice_items")
        .insert(itemsPayload);
      if (iiErr) throw iiErr;

      // Atualiza estoque + custo médio + peso médio + movements + lotes
      for (const res of resolved) {
        const currentLevel = stockLevels.find(
          (s) => s.item_id === res.targetItemId && s.location_id === centralId,
        );
        const currentQty = Math.max(0, Number(currentLevel?.current_stock ?? 0));
        const currentItem = itemMap.get(res.targetItemId);
        const currentCost = Number(currentItem?.cost_price ?? 0);
        const currentAvgG = Number(currentItem?.avg_weight_g ?? 0);

        const newQty = Number(currentLevel?.current_stock ?? 0) + res.stockQty;
        const totalUnits = currentQty + res.stockQty;
        const weightedCost =
          totalUnits > 0
            ? (currentQty * currentCost + res.stockQty * res.stockUnitCost) /
              totalUnits
            : res.stockUnitCost;

        const { error: e1 } = await supabase.from("stock_levels").upsert(
          {
            org_id: orgId,
            item_id: res.targetItemId,
            location_id: centralId,
            current_stock: newQty,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
        if (e1) throw e1;

        const itemUpdate: { cost_price: number; avg_weight_g?: number } = {
          cost_price: weightedCost,
        };
        if (res.sharedActiveOnTarget) {
          const currentUnits = currentAvgG > 0
            ? currentQty / (currentAvgG / 1000)
            : currentQty / Math.max(0.001, Number(currentItem?.standard_weight_g ?? 0) / 1000);
          itemUpdate.avg_weight_g = weightedAvgWeight(
            currentUnits,
            currentAvgG,
            res.batchUnits,
            res.batchAvgG,
          );
        }
        // Calculadora: usuário pediu para atualizar peso de referência do cadastro.
        if (
          res.sharedActiveOnTarget &&
          typeof res.row.updateStandardWeightG === "number" &&
          res.row.updateStandardWeightG > 0
        ) {
          (itemUpdate as { standard_weight_g?: number }).standard_weight_g =
            res.row.updateStandardWeightG;
        }
        const { error: e2 } = await supabase
          .from("items")
          .update(itemUpdate)
          .eq("id", res.targetItemId);
        if (e2) throw e2;

        const noteBatch = res.sharedActiveOnTarget
          ? ` • Lote: ${res.batchUnits} un • ${(res.batchTotalG / 1000).toFixed(3)} kg`
          : "";
        const { data: mov, error: e3 } = await supabase
          .from("movements")
          .insert({
            org_id: orgId,
            item_id: res.targetItemId,
            to_location_id: centralId,
            quantity: res.stockQty,
            type: "entry",
            unit_cost: res.stockUnitCost,
            // CRÍTICO: usa o valor EXATO do XML (não recalcula via unit*qty para evitar drift de float)
            total_cost: res.row.parsed.totalPrice,
            invoice_id: inv.id,
            notes: `NF ${number || "—"} • ${supplierName || ""}`,
            note: `NF ${number || "—"} • ${supplierName || ""} • Custo médio: ${fmtBRL(weightedCost)}${noteBatch}`,
          })
          .select("id")
          .single();
        if (e3) throw e3;

        // Cria lote para TODOS os itens (rastreabilidade FEFO).
        // Para itens com Unidade Compartilhada, mantém units/peso médio do lote.
        const { error: eb } = await supabase.from("item_batches").insert({
          org_id: orgId,
          item_id: res.targetItemId,
          source: "entry",
          units_qty: res.sharedActiveOnTarget ? res.batchUnits : res.stockQty,
          total_weight_g: res.sharedActiveOnTarget ? res.batchTotalG : 0,
          avg_weight_g: res.sharedActiveOnTarget ? res.batchAvgG : 0,
          initial_qty: res.stockQty,
          current_qty: res.stockQty,
          unit_cost: res.stockUnitCost,
          expiry_date: res.row.expiryDate || null,
          lot_number: res.row.lotNumber?.trim() || number || null,
          invoice_id: inv.id,
          movement_id: mov?.id ?? null,
          // Snapshot da regra Fixo/Variável no momento da entrada — imutável.
          weight_variable_at_entry: res.sharedActiveOnTarget ? !!res.row.newWeightVariable : false,
          note: `NF ${number || "—"}`,
        });
        if (eb) throw eb;
      }
    },
    onSuccess: () => {
      toast.success("Nota processada e estoque atualizado");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notas"] });
      reset();
      onDone();
    },
    onError: (err: Error & { duplicate?: boolean }) => {
      if (err.duplicate) {
        toast.info(err.message);
        reset();
        onDone();
        return;
      }
      toast.error(err.message);
    },
  });

  // ---------- Render ----------
  if (rows.length === 0) {
    if (hideUploader) {
      return (
        <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {parsing ? "Processando imagem…" : "Aguardando foto da nota…"}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <label
          htmlFor="xml-file-input"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
        >
          {parsing ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground" />
          )}
          <p className="text-sm font-medium">
            {parsing ? "Lendo arquivo…" : "Clique para enviar o XML da NF-e / NFC-e"}
          </p>
          <p className="text-xs text-muted-foreground">
            Apenas arquivos .xml (padrão SEFAZ)
          </p>
          <input
            id="xml-file-input"
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            disabled={parsing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho da nota */}
      <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{fileName}</p>
          <p className="text-[11px] text-muted-foreground">
            {rows.length} {rows.length === 1 ? "item encontrado" : "itens encontrados"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={importMutation.isPending}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Trocar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Fornecedor</Label>
          <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nº da Nota</Label>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Data de emissão</Label>
          <Input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor total (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={totalValue}
            onChange={(e) => setTotalValue(Number(e.target.value))}
          />
        </div>
      </div>

      {/* De-Para de itens */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-semibold">Vínculo dos itens da nota</p>
          <span className="text-[11px] text-muted-foreground">
            Total XML:{" "}
            <span className="font-semibold text-foreground">{fmtBRL(computedTotal)}</span>
          </span>
        </div>
        <div className="max-h-[50vh] divide-y divide-border overflow-y-auto">
          {rows.map((r, idx) => (
            <RowEditor
              key={`${r.parsed.name}-${idx}`}
              row={r}
              items={items}
              categories={categories}
              onChange={(next) => updateRow(idx, next)}
            />
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending || !allLinked}
          className="w-full gap-2"
        >
          {importMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Confirmar importação ({rows.length})
        </Button>
      </DialogFooter>
    </div>
  );
}

// ============================================================
// LiveFormula — fórmula viva inline: [parsedQty] x [multiplier] = [realUnits]
// (sem cliques, sem expandir; campos entre colchetes são editáveis)
// ============================================================

function LiveFormula({
  parsedQty,
  parsedUnit,
  baseUnit,
  stdKgPerUnit,
  multiplier,
  totalStockQty,
  isShared = false,
  isVariable = false,
  sharedUnits = "",
  sharedTotalKg = "",
  onChange,
  onSharedChange,
}: {
  parsedQty: number;
  parsedUnit: string;
  baseUnit: string;
  stdKgPerUnit: number;
  multiplier: string;
  totalStockQty: string;
  isShared?: boolean;
  isVariable?: boolean;
  sharedUnits?: string;
  sharedTotalKg?: string;
  onChange: (next: { multiplier: string; totalStockQty: string }) => void;
  onSharedChange?: (next: {
    sharedUnits: string;
    sharedTotalKg: string;
    multiplier?: string;
    totalStockQty?: string;
  }) => void;
}) {
  // Formata para o `value` de <input type="number">: usa PONTO como decimal
  // (a localização pt-BR com vírgula faria o input rejeitar silenciosamente).
  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return "";
    return toInputDecimal(n, 4);
  };

  const parsedUnitNorm = normalizeUnit(parsedUnit);
  const baseUnitNorm = normalizeUnit(baseUnit);
  const hasStdWeight = stdKgPerUnit > 0 && stdKgPerUnit !== 1;

  // Caso "Carne": nota já vem em KG (ou L) e o estoque é a mesma unidade ponderável.
  // Multiplicador fica escondido — KG da nota é soberano.
  const invoiceMatchesBaseWeight =
    parsedUnitNorm === baseUnitNorm && (baseUnitNorm === "KG" || baseUnitNorm === "L");

  // Caso "Balança": nota em UN, estoque em KG, mas SEM peso padrão confiável.
  const needsScale =
    !invoiceMatchesBaseWeight && baseUnitNorm === "KG" && parsedUnitNorm !== "KG" && !hasStdWeight;

  // ===== MODO COMPARTILHADO — RESET TOTAL =====
  // Duas funções puras, isoladas, sem variáveis compartilhadas:
  //
  //  calcularPesoFixo({ qtdXml, fator, pesoBase })       → Cenário 1 (XML em UN)
  //    Ex: 3 caixas × 20 un/caixa = 60 un; 60 × 0,900 = 54,000 kg
  //
  //  calcularPesoVariavel({ pesoXmlKg, unidades })       → Cenário 2 (XML em KG)
  //    Ex: 22,350 kg ÷ 224 un = 0,0997 kg/un (exibe 0,099)
  //
  // Regras de ouro:
  //  - XML é IMUTÁVEL (read-only).
  //  - Cálculo interno: 4 casas decimais.
  //  - Exibição: 3 casas (4ª oculta).
  //  - Inputs são strings cruas, limpáveis (aceita vazio, vírgula ou ponto).
  if (isShared && onSharedChange) {
    const invoiceInWeight = parsedUnitNorm === "KG" || parsedUnitNorm === "L";
    const isVariableWeightMode = isVariable && invoiceInWeight;
    const qtdXml = parsedQty; // imutável

    // ===== Funções puras isoladas =====
    function calcularPesoFixo(params: { qtdXml: number; fator: number; pesoBase: number }) {
      const fator = params.fator > 0 ? params.fator : 1;
      const unidadesTotais = params.qtdXml * fator;
      const pesoTotalKg = unidadesTotais * (params.pesoBase > 0 ? params.pesoBase : 0);
      return { unidadesTotais, pesoTotalKg };
    }
    function calcularPesoVariavel(params: { pesoXmlKg: number; unidades: number }) {
      const pesoMedio =
        params.unidades > 0 && params.pesoXmlKg > 0 ? params.pesoXmlKg / params.unidades : 0;
      return { pesoMedio, unidadesTotais: params.unidades, pesoTotalKg: params.pesoXmlKg };
    }

    // ===== Estados locais INDEPENDENTES =====
    // Cenário 1 — Fator de conversão (un por embalagem do XML).
    // Reaproveita o `multiplier` que já é persistido por fornecedor.
    const [fatorStr, setFatorStr] = useState<string>(multiplier ?? "");
    // Cenário 1 — Peso base unitário (kg/un). Seed: padrão cadastrado se houver.
    const seedPesoBase = hasStdWeight ? toInputDecimal(stdKgPerUnit, 4) : "";
    const [pesoBaseStr, setPesoBaseStr] = useState<string>(seedPesoBase);
    // Cenário 2 — Unidades contadas pelo usuário.
    const [unidadesVarStr, setUnidadesVarStr] = useState<string>(sharedUnits ?? "");

    const touchedFator = useRef(false);
    const touchedPesoBase = useRef(false);
    const touchedUnidades = useRef(false);

    // Re-semeia quando o item muda (e o usuário ainda não tocou os campos).
    useEffect(() => {
      if (!touchedPesoBase.current) {
        setPesoBaseStr(hasStdWeight ? toInputDecimal(stdKgPerUnit, 4) : "");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stdKgPerUnit, hasStdWeight]);

    useEffect(() => {
      if (!touchedFator.current) setFatorStr(multiplier ?? "");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [multiplier]);

    // RESET TOTAL ao alternar Peso Fixo ↔ Peso Variável:
    // limpa qualquer resquício de cálculo do modo anterior.
    const prevModeRef = useRef<boolean>(isVariableWeightMode);
    useEffect(() => {
      if (prevModeRef.current !== isVariableWeightMode) {
        prevModeRef.current = isVariableWeightMode;
        setFatorStr("");
        setPesoBaseStr(hasStdWeight ? toInputDecimal(stdKgPerUnit, 4) : "");
        setUnidadesVarStr("");
        touchedFator.current = false;
        touchedPesoBase.current = false;
        touchedUnidades.current = false;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVariableWeightMode]);

    // ===== Cálculo (escolhe cenário) =====
    const fatorNum = parseDecimal(fatorStr);
    const pesoBaseNum = parseDecimal(pesoBaseStr);
    const unidadesVarNum = parseDecimal(unidadesVarStr);

    const fixoOut = calcularPesoFixo({ qtdXml, fator: fatorNum, pesoBase: pesoBaseNum });
    const varOut = calcularPesoVariavel({ pesoXmlKg: qtdXml, unidades: unidadesVarNum });

    const unidadesTotais = isVariableWeightMode ? varOut.unidadesTotais : fixoOut.unidadesTotais;
    const pesoTotalKg = isVariableWeightMode ? varOut.pesoTotalKg : fixoOut.pesoTotalKg;
    const perUnitKg = isVariableWeightMode ? varOut.pesoMedio : pesoBaseNum;

    // Exibição:
    //  - Variável: SEMPRE mostra o resultado real (peso XML ÷ unidades), TRUNCADO em 3 casas
    //    (não arredonda — 0,2235 vira "0,223", nunca "0,224"). O valor digitado em
    //    "Peso Médio por Unidade" é apenas referência e aparece como badge discreto ao lado.
    //  - Fixo: mantém string crua do usuário (peso base editável).
    const perUnitStr = isVariableWeightMode
      ? perUnitKg > 0
        ? toTruncatedDecimal(perUnitKg, 3)
        : ""
      : pesoBaseStr;
    // Valor de referência (cadastro/digitado manualmente) para o modo variável.
    const refKg = isVariableWeightMode ? parseDecimal(pesoBaseStr) : 0;

    // ===== Sincronização com parent (4 casas internas) =====
    const formatUnitsForParent = (n: number) => {
      if (!Number.isFinite(n) || n <= 0) return "";
      if (Number.isInteger(n)) return String(n);
      return toInputDecimal(n, 4);
    };
    const nextUnitsStr = formatUnitsForParent(unidadesTotais);
    const nextKgStr = pesoTotalKg > 0 ? toInputDecimal(pesoTotalKg, 4) : "";
    const nextMultiplier = isVariableWeightMode ? (multiplier ?? "") : fatorStr;

    useEffect(() => {
      const sameShared =
        nextUnitsStr === sharedUnits && nextKgStr === sharedTotalKg;
      const sameMult = nextMultiplier === multiplier;
      if (sameShared && sameMult) return;
      onSharedChange({
        sharedUnits: nextUnitsStr,
        sharedTotalKg: nextKgStr,
        multiplier: nextMultiplier,
        totalStockQty,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nextUnitsStr, nextKgStr, nextMultiplier]);

    // ===== Handlers (inputs limpáveis) =====
    const handleFatorChange = (val: string) => {
      touchedFator.current = true;
      setFatorStr(val.replace(/[^\d.,]/g, ""));
    };
    const handlePesoBaseChange = (val: string) => {
      touchedPesoBase.current = true;
      setPesoBaseStr(val.replace(/[^\d.,]/g, ""));
    };
    const handleUnidadesChange = (val: string) => {
      touchedUnidades.current = true;
      setUnidadesVarStr(val.replace(/[^\d.,]/g, ""));
    };

    const deviationPct =
      hasStdWeight && perUnitKg > 0 ? ((perUnitKg - stdKgPerUnit) / stdKgPerUnit) * 100 : 0;
    const showWarn = !isVariable && hasStdWeight && Math.abs(deviationPct) >= 5;

    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {isVariableWeightMode ? (
          <>
            {/* CENÁRIO 2 — Peso Variável (XML em KG): [PesoTotal travado] ÷ [Unidades] = [Peso Médio] */}
            <Input
              className="h-7 w-24 px-1.5 text-center font-semibold tabular-nums bg-muted/50 cursor-not-allowed"
              type="text"
              inputMode="decimal"
              readOnly
              value={toDisplayDecimal(qtdXml, 3)}
              title="Peso total da nota (kg) — travado, valor do XML."
            />
            <span className="text-muted-foreground">kg</span>
            <span className="text-muted-foreground font-semibold">÷</span>
            <Input
              className="h-7 w-16 px-1.5 text-center font-semibold tabular-nums"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={unidadesVarStr}
              onChange={(e) => handleUnidadesChange(e.target.value)}
              title="Quantidade de unidades / peças contadas."
            />
            <span className="text-muted-foreground">un</span>
            <span className="text-muted-foreground">=</span>
            <Input
              className="h-7 w-20 px-1.5 text-center tabular-nums bg-muted/50 cursor-not-allowed"
              type="text"
              inputMode="decimal"
              readOnly
              placeholder="0,000"
              value={perUnitStr}
              title="Resultado real: peso do XML ÷ unidades contadas (truncado em 3 casas, sem arredondar)."
            />
            <span className="text-muted-foreground">kg/un</span>
            {refKg > 0 && (
              <span
                className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title="Peso de referência cadastrado/digitado — apenas comparação, não entra no cálculo."
              >
                ref. {toDisplayDecimal(refKg, 3)} kg/un
              </span>
            )}
          </>
        ) : invoiceInWeight ? (
          <>
            {/* XML em KG sem ser variável (ex.: carne em peça única) — comporta-se como antes */}
            <Input
              className="h-7 w-24 px-1.5 text-center font-semibold tabular-nums bg-muted/50 cursor-not-allowed"
              type="text"
              inputMode="decimal"
              readOnly
              value={toDisplayDecimal(qtdXml, 3)}
              title="Peso total da nota (kg) — travado, valor do XML."
            />
            <span className="text-muted-foreground">kg</span>
            <span className="text-muted-foreground font-semibold">÷</span>
            <Input
              className="h-7 w-16 px-1.5 text-center font-semibold tabular-nums"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={unidadesVarStr}
              onChange={(e) => handleUnidadesChange(e.target.value)}
              title="Quantidade de unidades reais."
            />
            <span className="text-muted-foreground">un</span>
            <span className="text-muted-foreground">=</span>
            <Input
              className="h-7 w-20 px-1.5 text-center tabular-nums"
              type="text"
              inputMode="decimal"
              placeholder="0,000"
              value={perUnitStr}
              onChange={(e) => handlePesoBaseChange(e.target.value)}
              title="Peso médio por unidade (kg)."
            />
            <span className="text-muted-foreground">kg/un</span>
          </>
        ) : (
          <>
            {/* CENÁRIO 1 — Peso Fixo (XML em UN):
                [QtdXML imutável] × [Fator] = [Unidades]   |   × [PesoBase] = [Total kg]
                Ex: 3 × 20 = 60 un  |  × 0,900 = 54,000 kg */}
            <span
              className="rounded bg-muted px-1.5 py-0.5 tabular-nums text-foreground"
              title="Quantidade lida do XML (imutável)"
            >
              {qtdXml.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {parsedUnit}
            </span>
            <span className="text-muted-foreground font-semibold">×</span>
            <Input
              className="h-7 w-14 px-1.5 text-center tabular-nums"
              type="text"
              inputMode="decimal"
              placeholder="1"
              value={fatorStr}
              onChange={(e) => handleFatorChange(e.target.value)}
              title="Fator de conversão (unidades por embalagem do XML). Ex: 20 un por caixa."
            />
            <span className="text-muted-foreground">un/emb</span>
            <span className="text-muted-foreground">=</span>
            <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold tabular-nums text-foreground">
              {unidadesTotais > 0 ? (Number.isInteger(unidadesTotais) ? unidadesTotais.toLocaleString("pt-BR") : toDisplayDecimal(unidadesTotais, 3)) : "0"} un
            </span>
            <span className="text-muted-foreground">×</span>
            <Input
              className="h-7 w-20 px-1.5 text-center tabular-nums"
              type="text"
              inputMode="decimal"
              placeholder="0,000"
              value={perUnitStr}
              onChange={(e) => handlePesoBaseChange(e.target.value)}
              title="Peso por unidade (kg). Ex: 0,900."
            />
            <span className="text-muted-foreground">kg/un</span>
            <span className="text-muted-foreground">=</span>
            <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold tabular-nums text-foreground">
              {pesoTotalKg > 0 ? toDisplayDecimal(pesoTotalKg, 3) : "0,000"} kg
            </span>
          </>
        )}
        {perUnitKg > 0 && unidadesTotais > 0 && isVariable && (
          <span
            className="ml-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400"
            title="Peso médio deste lote — usado para converter KG ↔ UN."
          >
            méd. {toTruncatedDecimal(perUnitKg, 3)} kg/un
          </span>
        )}
        {showWarn && (
          <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            embalagens divergentes: {deviationPct >= 0 ? "+" : ""}
            {deviationPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs padrão{" "}
            {toDisplayDecimal(stdKgPerUnit, 3)} kg/un
          </span>
        )}
      </div>
    );
  }

  // ===== MODO CARNE (KG → KG): nota é soberana =====
  if (invoiceMatchesBaseWeight) {
    const total = parsedQty;
    useEffect(() => {
      const target = fmt(total);
      if (totalStockQty !== target || multiplier !== "1") {
        onChange({ multiplier: "1", totalStockQty: target });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [total]);
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold tabular-nums text-foreground">
          {total.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {baseUnitNorm.toLowerCase()}
        </span>
      </div>
    );
  }

  // ===== MODO BALANÇA (UN → KG, sem peso padrão) =====
  if (needsScale) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums text-foreground">
          {parsedQty.toLocaleString("pt-BR")} {parsedUnit}
        </span>
        <span className="text-muted-foreground">→</span>
        <Input
          className="h-7 w-24 px-1.5 text-center font-semibold tabular-nums ring-1 ring-primary/40 focus-visible:ring-primary"
          type="number"
          inputMode="decimal"
          step="0.001"
          min="0"
          placeholder="0,000"
          value={totalStockQty}
          onChange={(e) => onChange({ multiplier: "1", totalStockQty: e.target.value })}
          title="Peso real da balança — este valor é soberano sobre qualquer estimativa."
        />
        <span className="font-medium">kg</span>
        <span className="text-[10px] text-muted-foreground italic">peso da balança é soberano</span>
      </div>
    );
  }

  // ===== MODO ÓLEO / PADRÃO (UN × Multiplicador → KG ou UN) =====
  const multNum = Number((multiplier || "").replace(",", ".")) || 1;
  const realUnits = parsedQty * multNum;
  const expectedTotal = hasStdWeight ? realUnits * stdKgPerUnit : realUnits;
  const displayUnit = hasStdWeight ? baseUnitNorm.toLowerCase() : "un";
  const totalNum = Number((totalStockQty || "").replace(",", ".")) || 0;

  // Pró-ativo: se Total estiver vazio/zerado e houver Peso Padrão, preenche imediatamente.
  // Se o usuário editou manualmente um valor diferente, respeita.
  useEffect(() => {
    if (!hasStdWeight) return;
    const target = fmt(expectedTotal);
    const isEmpty = !totalStockQty || totalNum === 0;
    const matchesAuto = Math.abs(totalNum - expectedTotal) < 1e-6;
    if ((isEmpty || matchesAuto) && totalStockQty !== target) {
      onChange({ multiplier: multiplier || "1", totalStockQty: target });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedTotal, hasStdWeight, totalStockQty]);

  const onMultChange = (val: string) => {
    const m = Number(val.replace(",", ".")) || 0;
    const units = parsedQty * (m || 1);
    const total = hasStdWeight ? units * stdKgPerUnit : units;
    onChange({ multiplier: val, totalStockQty: fmt(total) });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums text-foreground">
        {parsedQty.toLocaleString("pt-BR")} {parsedUnit}
      </span>
      <span className="text-muted-foreground">×</span>
      <Input
        className="h-7 w-14 px-1.5 text-center tabular-nums"
        type="number"
        inputMode="decimal"
        step="1"
        min="0"
        placeholder="1"
        value={multiplier}
        onChange={(e) => onMultChange(e.target.value)}
        title="Multiplicador (lembrado por fornecedor)."
      />
      <span className="text-muted-foreground">=</span>
      <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold tabular-nums text-foreground">
        {realUnits.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} un
      </span>
      {hasStdWeight && (() => {
        const diverges =
          totalNum > 0 &&
          expectedTotal > 0 &&
          Math.abs(totalNum - expectedTotal) / expectedTotal > 0.02;
        const deviationPct = expectedTotal > 0 ? ((totalNum - expectedTotal) / expectedTotal) * 100 : 0;
        return (
          <>
            <span className="text-muted-foreground">|</span>
            <Input
              className={cn(
                "h-7 w-24 px-1.5 text-center font-semibold tabular-nums",
                diverges
                  ? "ring-2 ring-amber-500 focus-visible:ring-amber-500 bg-amber-50 dark:bg-amber-950/30"
                  : "ring-1 ring-primary/40 focus-visible:ring-primary",
              )}
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              placeholder="0,000"
              value={totalStockQty}
              onChange={(e) => onChange({ multiplier: multiplier || "1", totalStockQty: e.target.value })}
              title="Peso real informado — este valor é soberano sobre o sugerido."
            />
            <span className="font-medium">{displayUnit}</span>
            <span className="ml-1 text-[10px] text-muted-foreground">
              📌 sugerido {fmt(expectedTotal)} {displayUnit}
              <span className="ml-0.5">(padrão {stdKgPerUnit.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg/un)</span>
            </span>
            {diverges && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                {deviationPct >= 0 ? "+" : ""}
                {deviationPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs sugerido — usando valor digitado
              </span>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ============================================================
// (Calculadora de Lote pop-up removida — substituída pela fórmula
//  inline editável dentro de LiveFormula no modo compartilhado.)
// ============================================================

// ============================================================
// Row Editor — Vincular / Cadastrar Novo / Unidade Compartilhada
// ============================================================

function RowEditor({
  row,
  items,
  categories,
  onChange,
}: {
  row: MappingRow;
  items: Item[];
  categories: { id: string; name: string }[];
  onChange: (next: MappingRow) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedItem = items.find((i) => i.id === row.itemId);

  // String crua para o input de peso médio/base (kg) — permite digitar "0", "0,", "0,1", "0,18" livremente
  const [stdWeightKgStr, setStdWeightKgStr] = useState<string>(() => {
    const g = parseDecimal(row.newStandardWeightG);
    return g > 0 ? toInputDecimal(g / 1000, 4) : "";
  });
  const stdWeightTouched = useRef(false);
  // Sincroniza quando o valor externo muda (ex: troca de produto) e o usuário não está editando
  useEffect(() => {
    if (stdWeightTouched.current) return;
    const g = parseDecimal(row.newStandardWeightG);
    const next = g > 0 ? toInputDecimal(g / 1000, 4) : "";
    setStdWeightKgStr((prev) => (prev === next ? prev : next));
  }, [row.newStandardWeightG]);
  const typedTotal = Number(row.totalStockQty.replace(",", ".")) || 0;
  const stockQty = computeStockQty(row.parsed.quantity, typedTotal);
  const derivedMult = deriveMultiplier(row.parsed.quantity, typedTotal);
  const unitCost = stockQty > 0 ? row.parsed.totalPrice / stockQty : 0;
  const isShared =
    row.mode === "existing"
      ? !!selectedItem?.shared_unit_enabled
      : row.newSharedEnabled;
  const standardW =
    row.mode === "existing"
      ? Number(selectedItem?.standard_weight_g ?? 0)
      : Number(row.newStandardWeightG.replace(",", ".")) || 0;
  const batchUnits = Number(row.sharedUnits.replace(",", ".")) || 0;
  const batchKg = Number(row.sharedTotalKg.replace(",", ".")) || 0;
  const batchAvgG =
    batchUnits > 0 && batchKg > 0 ? (batchKg * 1000) / batchUnits : 0;

  // Auto-sugestão de Peso Total (KG) = Qtd. Unidades × Peso Padrão por Unidade.
  // Mantém preditivo: se o campo está vazio ou bate com a última sugestão automática,
  // sobrescreve. Se o usuário digitou um valor diferente (exceção real do lote), respeita.
  const lastAutoKgRef = useRef<string>("");
  useEffect(() => {
    if (!isShared) return;
    if (!(standardW > 0) || !(batchUnits > 0)) return;
    const expectedKg = (batchUnits * standardW) / 1000;
    const next = toInputDecimal(expectedKg, 3);
    const current = row.sharedTotalKg ?? "";
    const currentNum = Number(current.replace(",", ".")) || 0;
    const isEmpty = !current || currentNum === 0;
    const matchesLastAuto = current === lastAutoKgRef.current;
    if ((isEmpty || matchesLastAuto) && current !== next) {
      lastAutoKgRef.current = next;
      onChange({ ...row, sharedTotalKg: next });
    } else if (current === next) {
      lastAutoKgRef.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShared, standardW, batchUnits]);

  return (
    <div className="space-y-3 px-3 py-3">
      {/* Linha do XML — sempre mostra valores financeiros */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.parsed.name}</p>
          <p className="text-[11px] text-muted-foreground">
            XML: {row.parsed.quantity.toLocaleString("pt-BR")} {row.parsed.unit} •{" "}
            <span className={cn("font-semibold", row.parsed.totalPrice > 0 ? "text-foreground" : "text-destructive")}>
              {fmtBRL(row.parsed.totalPrice)}
            </span>{" "}
            ({fmtBRL(row.parsed.unitPrice)}/un)
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={row.mode === "existing" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => onChange({ ...row, mode: "existing" })}
          >
            Vincular
          </Button>
          <Button
            size="sm"
            variant={row.mode === "new" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => onChange({ ...row, mode: "new" })}
          >
            Cadastrar novo
          </Button>
        </div>
      </div>

      {row.mode === "existing" ? (
        <>
        <div className="space-y-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                size="sm"
                className={cn(
                  "h-9 w-full justify-between font-normal",
                  !selectedItem && "text-muted-foreground",
                )}
              >
                <span className="truncate text-xs">
                  {selectedItem
                    ? `${selectedItem.name} (${normalizeUnit(selectedItem.unit)})`
                    : "Selecione um item do estoque"}
                </span>
                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[--radix-popover-trigger-width] min-w-[260px] p-0"
              align="start"
            >
              <Command>
                <CommandInput placeholder="Buscar item…" />
                <CommandList>
                  <CommandEmpty>Nenhum item.</CommandEmpty>
                  <CommandGroup>
                    {items.map((i) => (
                      <CommandItem
                        key={i.id}
                        value={i.name}
                        onSelect={() => {
                          const next = items.find((it) => it.id === i.id);
                          let nextTotal = row.totalStockQty;
                          let nextMultiplier = row.multiplier || "1";
                          if (next && !next.shared_unit_enabled) {
                            const stdKg = Number(next.standard_weight_g ?? 0) / 1000;
                            if (stdKg > 0 && stdKg !== 1) {
                              const mult = Number((nextMultiplier || "1").replace(",", ".")) || 1;
                              const computed = row.parsed.quantity * mult * stdKg;
                              nextTotal = toInputDecimal(computed, 4);
                            }
                          }
                          onChange({
                            ...row,
                            itemId: i.id,
                            multiplier: nextMultiplier,
                            totalStockQty: nextTotal,
                          });
                          setPickerOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            row.itemId === i.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {i.name} ({normalizeUnit(i.unit)})
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedItem && (() => {
            const itemBaseUnit = normalizeUnit(selectedItem.unit);
            const stdKgPerUnit = isShared
              ? Number(selectedItem.standard_weight_g ?? 0) / 1000
              : Number(selectedItem.standard_weight_g ?? 0) / 1000;
            // (calculadora pop-up removida — fórmula inline cobre todos os casos)
            return (
              <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
                {isShared && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-semibold uppercase",
                        selectedItem.weight_variable
                          ? "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {selectedItem.weight_variable ? "Peso Variável" : "Peso Fixo"}
                    </span>
                    <span className="text-muted-foreground">
                      {selectedItem.weight_variable
                        ? "média do lote — sem aviso de divergência"
                        : "padrão cadastrado — alerta se divergir"}
                    </span>
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <LiveFormula
                      parsedQty={row.parsed.quantity}
                      parsedUnit={row.parsed.unit}
                      baseUnit={itemBaseUnit}
                      stdKgPerUnit={stdKgPerUnit}
                      multiplier={row.multiplier}
                      totalStockQty={row.totalStockQty}
                      isShared={isShared}
                      isVariable={!!selectedItem.weight_variable}
                      sharedUnits={row.sharedUnits}
                      sharedTotalKg={row.sharedTotalKg}
                      onChange={({ multiplier, totalStockQty }) =>
                        onChange({ ...row, multiplier, totalStockQty })
                      }
                      onSharedChange={({ sharedUnits, sharedTotalKg, multiplier, totalStockQty }) =>
                        onChange({
                          ...row,
                          sharedUnits,
                          sharedTotalKg,
                          multiplier: multiplier ?? row.multiplier,
                          totalStockQty: totalStockQty ?? row.totalStockQty,
                        })
                      }
                    />
                  </div>
                  {/* Calculadora pop-up removida — a linha do XML agora é a calculadora inline. */}
                </div>

                {!isShared && stockQty > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Custo:{" "}
                    <span className="font-semibold text-foreground">{fmtBRL(unitCost)}</span>/{itemBaseUnit.toLowerCase()}
                  </p>
                )}
                {isShared && unitCost > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Custo:{" "}
                    <span className="font-semibold text-foreground">{fmtBRL(row.parsed.totalPrice / Math.max(1, Number(row.sharedUnits) || 1))}</span>/un
                    {typeof row.updateStandardWeightG === "number" && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Padrão será atualizado para {(row.updateStandardWeightG).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g/un
                      </span>
                    )}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_90px_140px]">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">
                Nome no estoque
              </Label>
              <Input
                className="h-9"
                value={row.newName}
                onChange={(e) => onChange({ ...row, newName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">
                Unidade
              </Label>
              <Select
                value={row.newUnit}
                onValueChange={(v) => onChange({ ...row, newUnit: v as Unit })}
                disabled={row.newSharedEnabled}
              >
                <SelectTrigger className="h-9">
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
            <div className="space-y-1 col-span-2">
              <CategorySubcategorySelect
                value={row.newCategoryId || ""}
                onChange={(v) => onChange({ ...row, newCategoryId: v })}
                size="sm"
              />
            </div>
          </div>

          {!row.newSharedEnabled && (
            <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
              <LiveFormula
                parsedQty={row.parsed.quantity}
                parsedUnit={row.parsed.unit}
                baseUnit={row.newUnit}
                stdKgPerUnit={Number(row.newStandardWeightG.replace(",", ".")) / 1000}
                multiplier={row.multiplier}
                totalStockQty={row.totalStockQty}
                onChange={({ multiplier, totalStockQty }) =>
                  onChange({ ...row, multiplier, totalStockQty })
                }
              />
              {stockQty > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Entrada de{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {stockQty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {row.newUnit}
                  </span>
                  {typedTotal > 0 && (
                    <>
                      {" "}(fator {derivedMult.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}/{row.parsed.unit})
                    </>
                  )}
                  {" • "}Custo:{" "}
                  <span className="font-semibold text-foreground">{fmtBRL(unitCost)}</span>/{row.newUnit}
                </p>
              )}
            </div>
          )}

          {/* Toggle Unidade Compartilhada */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <Label className="text-xs font-medium">Unidade Compartilhada</Label>
              <p className="text-[11px] text-muted-foreground">
                Exemplo: Carne Moída (KG) ↔ Hambúrguer (UN). Inteirado em unidade com peso médio.
              </p>
            </div>
            <Switch
              checked={row.newSharedEnabled}
              onCheckedChange={(v) =>
                onChange({
                  ...row,
                  newSharedEnabled: v,
                  newUnit: v ? "UN" : row.newUnit,
                })
              }
            />
          </div>

          {/* Toggle financeiro: Contabilizar no CMV */}
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors",
              row.newContabilizaCmv
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-amber-500/40 bg-amber-500/10",
            )}
          >
            <div className="min-w-0">
              <Label className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    row.newContabilizaCmv ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                Contabilizar no cálculo de CMV?
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {row.newContabilizaCmvSuggested
                  ? "NCM identificado como material de consumo (ex: limpeza, descartáveis). Sugerimos desativar."
                  : "Desative para itens que não são alimentos, como material de limpeza ou descartáveis."}
              </p>
            </div>
            <Switch
              checked={row.newContabilizaCmv}
              onCheckedChange={(v) => onChange({ ...row, newContabilizaCmv: v })}
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>

          {row.newSharedEnabled && (
            <div className="space-y-2">
              {/* Botões: Peso Fixo vs Peso Variável */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ ...row, newWeightVariable: false })}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-xs transition",
                    !row.newWeightVariable
                      ? "border-primary bg-background shadow-sm"
                      : "border-border bg-background/50 text-muted-foreground hover:border-primary/40",
                  )}
                >
                  <div className="font-semibold text-foreground">Peso Fixo</div>
                  <div className="text-[11px] text-muted-foreground">
                    Ex: Óleo, Requeijão, Latas. Avisa divergência.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...row, newWeightVariable: true })}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-xs transition",
                    row.newWeightVariable
                      ? "border-primary bg-background shadow-sm"
                      : "border-border bg-background/50 text-muted-foreground hover:border-primary/40",
                  )}
                >
                  <div className="font-semibold text-foreground">Peso Variável</div>
                  <div className="text-[11px] text-muted-foreground">
                    Ex: Carne, peças. Calcula média do lote.
                  </div>
                </button>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  {row.newWeightVariable
                    ? "Peso Médio por Unidade (kg)"
                    : "Peso Base por Unidade (kg) *"}
                </Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 0,180"
                  value={stdWeightKgStr}
                  onFocus={() => { stdWeightTouched.current = true; }}
                  onBlur={() => { stdWeightTouched.current = false; }}
                  onChange={(e) => {
                    // Aceita apenas dígitos, ponto e vírgula. Permite "", "0", "0,", "0,1", "0,18", etc.
                    const raw = e.target.value.replace(/[^\d.,]/g, "");
                    setStdWeightKgStr(raw);
                    const kg = parseDecimal(raw);
                    onChange({
                      ...row,
                      newStandardWeightG: raw === "" ? "" : toInputDecimal(kg * 1000, 4),
                    });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {row.newWeightVariable
                    ? "Referência editável. O cálculo real continua sendo peso do XML ÷ unidades contadas."
                    : "Valor base. Se a nota divergir, o estoque é marcado como 'Embalagens Divergentes'."}
                </p>
              </div>

              {(row.newWeightVariable || Number(row.newStandardWeightG.replace(",", ".")) > 0) && (
                <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
                  <LiveFormula
                    parsedQty={row.parsed.quantity}
                    parsedUnit={row.parsed.unit}
                    baseUnit="UN"
                    stdKgPerUnit={Number(row.newStandardWeightG.replace(",", ".")) / 1000}
                    multiplier={row.multiplier}
                    totalStockQty={row.totalStockQty}
                    isShared={true}
                    isVariable={row.newWeightVariable}
                    sharedUnits={row.sharedUnits}
                    sharedTotalKg={row.sharedTotalKg}
                    onChange={({ multiplier, totalStockQty }) =>
                      onChange({ ...row, multiplier, totalStockQty })
                    }
                      onSharedChange={({ sharedUnits, sharedTotalKg, multiplier, totalStockQty }) =>
                        onChange({
                          ...row,
                          sharedUnits,
                          sharedTotalKg,
                          multiplier: multiplier ?? row.multiplier,
                          totalStockQty: totalStockQty ?? row.totalStockQty,
                        })
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lote: validade + identificador (opcionais, alimentam FEFO) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Validade do lote (opcional)</Label>
          <Input
            type="date"
            className="h-8"
            value={row.expiryDate}
            onChange={(e) => onChange({ ...row, expiryDate: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Nº do lote (opcional)</Label>
          <Input
            className="h-8"
            placeholder="Padrão: número da nota"
            value={row.lotNumber}
            onChange={(e) => onChange({ ...row, lotNumber: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Manual Entry Tab — entrada em lote (múltiplos itens)
// ============================================================

import {
  EntryItemCard,
  makeBlankEntryCard,
  computeEntryTotals,
  type EntryCardData,
} from "@/components/entry-item-card";

type ManualRow = EntryCardData & { uid: string };

function makeBlankManualRow(): ManualRow {
  return { uid: Math.random().toString(36).slice(2), ...makeBlankEntryCard() };
}

function ManualEntryTab({
  items,
  centralId,
  stockLevels,
  categories,
  onDone,
}: {
  items: Item[];
  centralId: string;
  stockLevels: StockLevel[];
  categories: { id: string; name: string }[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { isManager } = useManagerMode();
  const [supplierName, setSupplierName] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<ManualRow[]>(() => [makeBlankManualRow()]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const updateRow = (uid: string, patch: Partial<ManualRow>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const removeRow = (uid: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.uid !== uid) : prev));
  const addRow = () => setRows((prev) => [...prev, makeBlankManualRow()]);

  const totalAll = rows.reduce(
    (acc, r) => acc + (Number(r.totalValue.replace(",", ".")) || 0),
    0,
  );

  const submit = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Organização não identificada — recarregue a página");
      if (!centralId) throw new Error("Estoque Central não encontrado");
      if (rows.length === 0) throw new Error("Adicione ao menos um item");

      type Resolved = {
        row: ManualRow;
        targetItemId: string;
        unit: Unit;
        stockQty: number;
        totalValue: number;
        unitCost: number;
        sharedActive: boolean;
        standardWeightG: number;
        batchUnits: number;
        batchTotalG: number;
        batchAvgG: number;
      };

      const resolved: Resolved[] = [];

      for (const r of rows) {
        const totalValueNum = Number(r.totalValue.replace(",", ".")) || 0;
        if (totalValueNum <= 0)
          throw new Error(`Linha "${r.newName || itemMap.get(r.itemId)?.name || "?"}": informe o Valor Total`);

        let targetItemId = r.itemId;
        const existing = targetItemId ? itemMap.get(targetItemId) : undefined;
        const sharedActive =
          r.mode === "existing"
            ? !!existing?.shared_unit_enabled
            : r.newSharedEnabled;
        const unit: Unit =
          r.mode === "existing"
            ? normalizeUnit(existing?.unit ?? "UN")
            : sharedActive
              ? "UN"
              : r.newUnit;
        const standardWeightG = sharedActive
          ? r.mode === "existing"
            ? Number(existing?.standard_weight_g ?? 0)
            : (Number((r.newStandardWeightKg || "").replace(",", ".")) || 0) * 1000
          : 0;

        let stockQty: number;
        let batchUnits = 0;
        let batchTotalG = 0;
        let batchAvgG = 0;

        if (sharedActive) {
          batchUnits = Number(r.sharedUnits.replace(",", ".")) || 0;
          const kg = Number(r.sharedTotalKg.replace(",", ".")) || 0;
          if (kg <= 0)
            throw new Error(`"${r.newName || existing?.name}": informe Peso Total (KG)`);
          if (r.mode === "new" && standardWeightG <= 0)
            throw new Error(`"${r.newName}": informe Peso Padrão por Unidade (kg)`);
          // Permite entrada apenas por KG: deriva unidades a partir do peso padrão.
          if (batchUnits <= 0) {
            if (standardWeightG > 0) {
              batchUnits = Math.max(1, Math.round((kg * 1000) / standardWeightG));
            } else {
              throw new Error(`"${r.newName || existing?.name}": informe Qtd. de Unidades ou Peso Padrão`);
            }
          }
          if (!Number.isInteger(batchUnits))
            batchUnits = Math.round(batchUnits);
          batchTotalG = kg * 1000;
          batchAvgG = batchTotalG / batchUnits;
          stockQty = kg;
        } else {
          stockQty = Number(r.quantity.replace(",", ".")) || 0;
          if (stockQty <= 0)
            throw new Error(`"${r.newName || existing?.name}": Quantidade inválida`);
          if (unit === "UN" && !Number.isInteger(stockQty))
            throw new Error(`"${r.newName || existing?.name}": para UN, quantidade deve ser inteira`);
        }

        const unitCost = totalValueNum / stockQty;

        if (r.mode === "new" || !targetItemId) {
          if (!r.newName.trim()) throw new Error("Informe o nome do novo insumo");
          const insertUnit = sharedActive ? "UN" : r.newUnit;
          const { data: created, error } = await supabase
            .from("items")
            .insert({
              org_id: orgId,
              name: r.newName.trim(),
              unit: insertUnit,
              category_id: r.newCategoryId || null,
              cost_price: unitCost,
              shared_unit_enabled: sharedActive,
              weight_variable: sharedActive ? r.newWeightVariable : false,
              standard_weight_g: sharedActive ? standardWeightG : 0,
              avg_weight_g: sharedActive ? standardWeightG : 0,
              contabiliza_cmv: r.newContabilizaCmv !== false,
            })
            .select("id")
            .single();
          if (error) throw error;
          targetItemId = created.id;
        }

        resolved.push({
          row: r,
          targetItemId,
          unit,
          stockQty,
          totalValue: totalValueNum,
          unitCost,
          sharedActive,
          standardWeightG,
          batchUnits,
          batchTotalG,
          batchAvgG,
        });
      }

      // Cria invoice manual (cabeçalho único)
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          org_id: orgId,
          supplier_name: supplierName || null,
          issue_date: issueDate || null,
          total_value: totalAll,
          status: "processed",
          source: "manual",
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (invErr) throw invErr;

      const itemsPayload = resolved.map((res) => ({
        org_id: orgId,
        invoice_id: inv.id,
        item_id: res.targetItemId,
        xml_name: res.row.newName || itemMap.get(res.targetItemId)?.name || "",
        xml_unit: res.unit,
        xml_quantity: res.stockQty,
        xml_unit_price: res.unitCost,
        xml_total_price: res.totalValue,
        multiplier: 1,
        stock_quantity: res.stockQty,
        stock_unit_cost: res.unitCost,
      }));
      const { error: iiErr } = await supabase.from("invoice_items").insert(itemsPayload);
      if (iiErr) throw iiErr;

      // Atualiza estoque + custo médio + lotes
      for (const res of resolved) {
        const currentLevel = stockLevels.find(
          (s) => s.item_id === res.targetItemId && s.location_id === centralId,
        );
        const currentQty = Math.max(0, Number(currentLevel?.current_stock ?? 0));
        const currentItem = itemMap.get(res.targetItemId);
        const currentCost = Number(currentItem?.cost_price ?? 0);
        const currentAvgG = Number(currentItem?.avg_weight_g ?? 0);

        const newQty = Number(currentLevel?.current_stock ?? 0) + res.stockQty;
        const totalUnits = currentQty + res.stockQty;
        const weightedCost =
          totalUnits > 0
            ? (currentQty * currentCost + res.stockQty * res.unitCost) / totalUnits
            : res.unitCost;

        const { error: e1 } = await supabase.from("stock_levels").upsert(
          {
            org_id: orgId,
            item_id: res.targetItemId,
            location_id: centralId,
            current_stock: newQty,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id,location_id" },
        );
        if (e1) throw e1;

        const itemUpdate: { cost_price: number; avg_weight_g?: number } = {
          cost_price: weightedCost,
        };
        if (res.sharedActive) {
          const currentUnits = currentAvgG > 0
            ? currentQty / (currentAvgG / 1000)
            : currentQty / Math.max(0.001, Number(currentItem?.standard_weight_g ?? 0) / 1000);
          itemUpdate.avg_weight_g = weightedAvgWeight(
            currentUnits,
            currentAvgG,
            res.batchUnits,
            res.batchAvgG,
          );
        }
        const { error: e2 } = await supabase
          .from("items")
          .update(itemUpdate)
          .eq("id", res.targetItemId);
        if (e2) throw e2;

        const noteBatch = res.sharedActive
          ? ` • Lote: ${res.batchUnits} un • ${(res.batchTotalG / 1000).toFixed(3)} kg`
          : "";
        const { data: mov, error: e3 } = await supabase
          .from("movements")
          .insert({
            org_id: orgId,
            item_id: res.targetItemId,
            to_location_id: centralId,
            quantity: res.stockQty,
            type: "entry",
            note: `Entrada manual${supplierName ? ` • ${supplierName}` : ""} • ${fmtBRL(res.totalValue)}${noteBatch}`,
          })
          .select("id")
          .single();
        if (e3) throw e3;

        const { error: eb } = await supabase.from("item_batches").insert({
          org_id: orgId,
          item_id: res.targetItemId,
          source: "entry",
          units_qty: res.sharedActive ? res.batchUnits : res.stockQty,
          total_weight_g: res.sharedActive ? res.batchTotalG : 0,
          avg_weight_g: res.sharedActive ? res.batchAvgG : 0,
          initial_qty: res.stockQty,
          current_qty: res.stockQty,
          unit_cost: res.unitCost,
          expiry_date: res.row.expiryDate || null,
          lot_number: res.row.lotNumber?.trim() || null,
          movement_id: mov?.id ?? null,
          weight_variable_at_entry: res.sharedActive ? !!res.row.newWeightVariable : false,
          note: "Entrada manual",
        });
        if (eb) throw eb;
      }
    },
    onSuccess: () => {
      toast.success("Entradas registradas");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      {/* Cabeçalho único */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Fornecedor (opcional)</Label>
          <Input
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Nome do fornecedor"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Data de entrada</Label>
          <Input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </div>
      </div>

      {/* Lista de itens */}
      <div className="space-y-3">
        {rows.map((r, idx) => (
          <EntryItemCard
            key={r.uid}
            index={idx}
            data={r}
            items={items}
            canRemove={rows.length > 1}
            onChange={(patch) => updateRow(r.uid, patch)}
            onRemove={() => removeRow(r.uid)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" onClick={addRow} className="gap-2">
          <PackagePlus className="h-4 w-4" />
          Adicionar Item
        </Button>
        <div className="text-sm">
          Total: <span className="font-semibold tabular-nums">{fmtBRL(totalAll)}</span>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => submit.mutate()}
          disabled={submit.isPending}
          className="w-full"
        >
          {submit.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Registrando…
            </>
          ) : (
            `Confirmar entrada (${rows.length} ${rows.length === 1 ? "item" : "itens"})`
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ManualRowEditor({
  index,
  row,
  items,
  categories,
  isManager,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  row: ManualRow;
  items: Item[];
  categories: { id: string; name: string }[];
  isManager: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<ManualRow>) => void;
  onRemove: () => void;
}) {
  const selected = items.find((i) => i.id === row.itemId);
  const sharedActive =
    row.mode === "existing" ? !!selected?.shared_unit_enabled : row.newSharedEnabled;
  const unit: Unit =
    row.mode === "existing"
      ? normalizeUnit(selected?.unit ?? "UN")
      : sharedActive
        ? "UN"
        : row.newUnit;
  const isInteger = unit === "UN";

  const totalValueNum = Number(row.totalValue.replace(",", ".")) || 0;
  const qtyNum = sharedActive
    ? Number(row.sharedUnits.replace(",", ".")) || 0
    : Number(row.quantity.replace(",", ".")) || 0;
  const unitCost = qtyNum > 0 && totalValueNum > 0 ? totalValueNum / qtyNum : 0;
  const batchAvgG = sharedActive
    ? (() => {
        const u = Number(row.sharedUnits.replace(",", ".")) || 0;
        const kg = Number(row.sharedTotalKg.replace(",", ".")) || 0;
        return u > 0 && kg > 0 ? (kg * 1000) / u : 0;
      })()
    : 0;
  const costPerKg = sharedActive && totalValueNum > 0 && row.sharedTotalKg
    ? totalValueNum / (Number(row.sharedTotalKg.replace(",", ".")) || 1)
    : 0;

  // Peso padrão por unidade (g) — para itens existentes vem do cadastro;
  // para novos vem do formulário (newStandardWeightG, em gramas).
  const standardW = sharedActive
    ? row.mode === "existing"
      ? Number(selected?.standard_weight_g ?? 0)
      : Number(row.newStandardWeightG.replace(",", ".")) || 0
    : 0;
  const batchUnits = Number(row.sharedUnits.replace(",", ".")) || 0;
  const batchKg = Number(row.sharedTotalKg.replace(",", ".")) || 0;

  // Peso unitário do lote (KG/un) — campo editável, pré-preenchido com o padrão do cadastro.
  // Permite ajuste do peso médio para este lote específico, com sincronização bidirecional
  // entre Qtd. Unidades, Peso Unitário e Peso Total.
  const [unitWeightKgStr, setUnitWeightKgStr] = useState<string>("");
  const lastSyncSourceRef = useRef<"unit" | "total" | null>(null);

  // Pré-preenche peso unitário ao ativar shared / trocar item.
  useEffect(() => {
    if (!sharedActive) {
      setUnitWeightKgStr("");
      lastSyncSourceRef.current = null;
      return;
    }
    const seedKg =
      batchUnits > 0 && batchKg > 0
        ? batchKg / batchUnits
        : standardW > 0
          ? standardW / 1000
          : 0;
    setUnitWeightKgStr(seedKg > 0 ? toInputDecimal(seedKg, 4) : "");
    lastSyncSourceRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedActive, row.itemId, standardW]);

  const unitWeightKg = Number((unitWeightKgStr || "").replace(",", ".")) || 0;

  // Quando muda Qtd. Unidades ou Peso Unitário, recalcula Peso Total.
  useEffect(() => {
    if (!sharedActive) return;
    if (!(unitWeightKg > 0) || !(batchUnits > 0)) return;
    if (lastSyncSourceRef.current === "total") {
      lastSyncSourceRef.current = null;
      return;
    }
    const expectedKg = batchUnits * unitWeightKg;
    const next = toInputDecimal(expectedKg, 3);
    if (row.sharedTotalKg !== next) {
      lastSyncSourceRef.current = "unit";
      onChange({ sharedTotalKg: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedActive, batchUnits, unitWeightKg]);

  const handleTotalKgChange = (v: string) => {
    lastSyncSourceRef.current = "total";
    onChange({ sharedTotalKg: v });
    const kg = Number(v.replace(",", ".")) || 0;
    if (batchUnits > 0 && kg > 0) {
      setUnitWeightKgStr(toInputDecimal(kg / batchUnits, 4));
    }
  };

  const handleUnitWeightChange = (v: string) => {
    lastSyncSourceRef.current = "unit";
    setUnitWeightKgStr(v);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          Item #{index + 1}
        </span>
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
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={row.mode === "existing" ? "default" : "outline"}
          size="sm"
          onClick={() => onChange({ mode: "existing" })}
        >
          Insumo existente
        </Button>
        <Button
          type="button"
          variant={row.mode === "new" ? "default" : "outline"}
          size="sm"
          onClick={() => onChange({ mode: "new", itemId: "" })}
        >
          Novo insumo
        </Button>
      </div>

      {row.mode === "existing" ? (
        <div className="space-y-1">
          <Label className="text-xs">Buscar insumo</Label>
          <Popover
            open={row.pickerOpen}
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
                    ? `${selected.name} (${normalizeUnit(selected.unit)})`
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
                        value={`${i.name} ${normalizeUnit(i.unit)}`}
                        onSelect={() => onChange({ itemId: i.id, pickerOpen: false })}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            row.itemId === i.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {i.name} ({normalizeUnit(i.unit)})
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Nome do insumo *</Label>
              <Input
                value={row.newName}
                onChange={(e) => onChange({ newName: e.target.value })}
                placeholder="Ex.: Tomate italiano"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unidade</Label>
              <Select
                value={row.newUnit}
                onValueChange={(v) => onChange({ newUnit: v as Unit })}
                disabled={row.newSharedEnabled}
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

          <div className="space-y-1">
            <CategorySubcategorySelect
              value={row.newCategoryId || ""}
              onChange={(v) => onChange({ newCategoryId: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="min-w-0 flex-1">
              <Label className="text-xs font-medium">Ativar Unidade Compartilhada</Label>
              <p className="text-[11px] text-muted-foreground">
                Gerido em UN com peso médio.
              </p>
            </div>
            <Switch
              checked={row.newSharedEnabled}
              onCheckedChange={(v) =>
                onChange({
                  newSharedEnabled: v,
                  newUnit: v ? "UN" : row.newUnit,
                })
              }
            />
          </div>

          {/* Toggle financeiro: Contabilizar no CMV (cadastro manual) */}
          <div
            className={cn(
              "flex items-start justify-between gap-3 rounded-md border px-3 py-2 transition-colors",
              row.newContabilizaCmv
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-amber-500/40 bg-amber-500/10",
            )}
          >
            <div className="min-w-0 flex-1">
              <Label className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    row.newContabilizaCmv ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                Contabilizar no cálculo de CMV?
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Desative para itens que não são alimentos, como material de limpeza ou descartáveis.
              </p>
            </div>
            <Switch
              checked={row.newContabilizaCmv}
              onCheckedChange={(v) => onChange({ newContabilizaCmv: v })}
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>

          {row.newSharedEnabled && (
            <div className="space-y-1">
              <Label className="text-xs">Peso Padrão por Unidade (kg) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="ex: 1,850"
                value={
                  row.newStandardWeightG
                    ? String(Number(row.newStandardWeightG.replace(",", ".")) / 1000)
                    : ""
                }
                onChange={(e) => {
                  const kg = parseDecimal(e.target.value);
                  onChange({ newStandardWeightG: toInputDecimal(kg * 1000, 4) });
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Quantidade + valor */}
      {sharedActive ? (
        <div className="space-y-2 rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Lote (Unidade Compartilhada)
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Qtd. Unidades</Label>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                placeholder="auto"
                value={row.sharedUnits}
                onChange={(e) =>
                  onChange({ sharedUnits: e.target.value.replace(/[^\d]/g, "") })
                }
              />
              {standardW > 0 && !row.sharedUnits && batchKg > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  ≈ {Math.max(1, Math.round((batchKg * 1000) / standardW))} un
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Peso Unitário (KG)</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="0,000"
                value={unitWeightKgStr}
                onChange={(e) => handleUnitWeightChange(e.target.value)}
              />
              {standardW > 0 && (() => {
                const stdKg = standardW / 1000;
                const diverges =
                  unitWeightKg > 0 &&
                  Math.abs(unitWeightKg - stdKg) / stdKg > 0.02;
                return (
                  <p className={cn(
                    "text-[10px]",
                    diverges ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground",
                  )}>
                    Padrão: {stdKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg
                  </p>
                );
              })()}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Peso Total (KG) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="0,000"
                value={row.sharedTotalKg}
                onChange={(e) => handleTotalKgChange(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor Total (R$) *</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={row.totalValue}
              onChange={(e) => onChange({ totalValue: e.target.value })}
            />
          </div>
          {(batchAvgG > 0 || costPerKg > 0) && (
            <div className="rounded bg-background px-2 py-1 text-[11px] text-muted-foreground">
              {batchAvgG > 0 && (
                <>
                  Peso médio:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {(batchAvgG / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg/un
                  </span>
                </>
              )}
              {costPerKg > 0 && (
                <>
                  {batchAvgG > 0 && " • "}Custo:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {fmtBRL(costPerKg)} / KG
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Quantidade ({unit})</Label>
            <Input
              type="number"
              inputMode={isInteger ? "numeric" : "decimal"}
              step={isInteger ? "1" : "0.001"}
              min="0"
              placeholder={isInteger ? "0" : "0,000"}
              value={row.quantity}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ quantity: isInteger ? v.replace(/[^\d]/g, "") : v });
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor Total (R$) *</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={row.totalValue}
              onChange={(e) => onChange({ totalValue: e.target.value })}
            />
          </div>
        </div>
      )}

      {unitCost > 0 && !sharedActive && (
        <div className="rounded-md bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          Preço unitário:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {fmtBRL(unitCost)} / {unit}
          </span>
        </div>
      )}

      {/* Lote: validade + identificador (opcionais, alimentam FEFO) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Validade do lote (opcional)</Label>
          <Input
            type="date"
            value={row.expiryDate}
            onChange={(e) => onChange({ expiryDate: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nº do lote (opcional)</Label>
          <Input
            placeholder="Ex: L240501"
            value={row.lotNumber}
            onChange={(e) => onChange({ lotNumber: e.target.value })}
          />
        </div>
      </div>

      {!isManager && row.mode === "new" && (
        <p className="text-[10px] text-muted-foreground">
          Dica: ative o modo gerente para campos avançados.
        </p>
      )}
    </div>
  );
}

// ============================================================
// Photo Import Tab — OCR via Lovable AI, depois reusa XmlImportTab
// ============================================================

function PhotoImportTab({
  items,
  centralId,
  stockLevels,
  categories,
  onDone,
}: {
  items: Item[];
  centralId: string;
  stockLevels: StockLevel[];
  categories: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [ocr, setOcr] = useState<OcrInvoiceResult | null>(null);
  const [seed, setSeed] = useState<SeedPayload | null>(null);
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const reset = () => {
    setOcr(null);
    setSeed(null);
    setFileName("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const handleFile = async (file: File) => {
    setProcessing(true);
    try {
      setFileName(file.name);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));

      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      const base64 = btoa(bin);

      const result = await ocrInvoiceImage({
        data: { imageBase64: base64, mimeType: file.type || "image/jpeg" },
      });
      if (!result.items || result.items.length === 0) {
        throw new Error("Nenhum item identificado na imagem. Tente outra foto.");
      }
      setOcr(result);
      toast.success(`${result.items.length} ${result.items.length === 1 ? "item lido" : "itens lidos"} da foto`);
    } catch (err) {
      toast.error((err as Error).message);
      reset();
    } finally {
      setProcessing(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<OcrInvoiceItem>) => {
    setOcr((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }
        : prev,
    );
  };

  const removeItem = (idx: number) => {
    setOcr((prev) => (prev ? { ...prev, items: prev.items.filter((_, i) => i !== idx) } : prev));
  };

  const confirmAndContinue = () => {
    if (!ocr) return;
    const payload: SeedPayload = {
      supplierName: ocr.supplierName,
      number: ocr.number,
      issueDate: ocr.issueDate,
      totalValue: ocr.totalValue,
      fileName: fileName || "foto.jpg",
      items: ocr.items.map((it) => ({
        name: it.name,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        ncm: "",
      })),
    };
    setSeed(payload);
  };

  if (seed) {
    return (
      <XmlImportTab
        items={items}
        centralId={centralId}
        stockLevels={stockLevels}
        categories={categories}
        onDone={onDone}
        seed={seed}
        hideUploader
      />
    );
  }

  if (!ocr) {
    return (
      <div className="space-y-3">
        <label
          htmlFor="photo-file-input"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
        >
          {processing ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Camera className="h-8 w-8 text-muted-foreground" />
          )}
          <p className="text-sm font-medium">
            {processing ? "Lendo foto da nota…" : "Tirar foto ou enviar imagem da nota/cupom"}
          </p>
          <p className="text-xs text-muted-foreground">
            JPG ou PNG • a IA extrai os itens automaticamente
          </p>
          <input
            id="photo-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            disabled={processing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          {previewUrl && (
            <img src={previewUrl} alt="" className="h-10 w-10 rounded object-cover" />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{fileName}</p>
            <p className="text-[11px] text-muted-foreground">
              {ocr.items.length} {ocr.items.length === 1 ? "item identificado" : "itens identificados"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <Trash2 className="mr-1 h-4 w-4" /> Trocar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Fornecedor</Label>
          <Input
            value={ocr.supplierName}
            onChange={(e) => setOcr({ ...ocr, supplierName: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nº da Nota</Label>
          <Input value={ocr.number} onChange={(e) => setOcr({ ...ocr, number: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Data de emissão</Label>
          <Input
            type="date"
            value={ocr.issueDate}
            onChange={(e) => setOcr({ ...ocr, issueDate: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor total (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={ocr.totalValue}
            onChange={(e) => setOcr({ ...ocr, totalValue: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-semibold">
            Confira os itens lidos da foto (edite o que estiver errado)
          </p>
        </div>
        <div className="max-h-[45vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-16">Un</TableHead>
                <TableHead className="w-20">Qtd</TableHead>
                <TableHead className="w-24">Vl. Un</TableHead>
                <TableHead className="w-24">Total</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocr.items.map((it, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={it.name}
                      onChange={(e) => updateItem(idx, { name: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={it.unit}
                      onChange={(e) => updateItem(idx, { unit: e.target.value.toUpperCase() })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      type="number"
                      step="0.001"
                      value={it.quantity}
                      onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      type="number"
                      step="0.01"
                      value={it.unitPrice}
                      onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      type="number"
                      step="0.01"
                      value={it.totalPrice}
                      onChange={(e) => updateItem(idx, { totalPrice: Number(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeItem(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={confirmAndContinue}
          disabled={ocr.items.length === 0}
          className="w-full"
        >
          Continuar para Vínculo de Produtos ({ocr.items.length})
        </Button>
      </DialogFooter>
    </div>
  );
}
