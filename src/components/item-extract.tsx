import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useManagerMode } from "@/lib/manager-mode";

type Batch = {
  id: string;
  lot_number: string | null;
  initial_qty: number;
  current_qty: number;
  unit_cost: number;
  avg_weight_g: number;
  expiry_date: string | null;
  created_at: string;
  invoice_id: string | null;
};

type Movement = {
  id: string;
  type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  created_at: string;
  from_location_id: string | null;
  to_location_id: string | null;
  note: string | null;
};

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function reasonLabel(type: string): { label: string; tone: "default" | "destructive" | "secondary" } {
  switch (type) {
    case "transfer":
      return { label: "Transferência", tone: "secondary" };
    case "production_in":
      return { label: "Produção (entrada)", tone: "default" };
    case "production_out":
      return { label: "Produção (consumo)", tone: "secondary" };
    case "sale":
      return { label: "Venda", tone: "destructive" };
    case "adjustment":
      return { label: "Ajuste", tone: "secondary" };
    case "waste":
      return { label: "Perda", tone: "destructive" };
    case "entry":
      return { label: "Entrada NF", tone: "default" };
    default:
      return { label: type, tone: "secondary" };
  }
}

export function ItemExtract({ itemId, locationId }: { itemId: string; locationId?: string | null }) {
  const { isManager } = useManagerMode();
  const { data: batches } = useQuery({
    queryKey: ["item-extract-batches", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_batches")
        .select("id,lot_number,initial_qty,current_qty,unit_cost,avg_weight_g,expiry_date,created_at,invoice_id")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Batch[];
    },
  });

  const { data: movements } = useQuery({
    queryKey: ["item-extract-movs", itemId, locationId ?? ""],
    enabled: !!itemId,
    queryFn: async () => {
      const q = supabase
        .from("movements")
        .select("id,type,quantity,unit_cost,total_cost,created_at,from_location_id,to_location_id,note")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(200);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Movement[];
      // Saídas a partir do local atual quando houver
      return locationId
        ? rows.filter((m) => m.from_location_id === locationId || m.to_location_id === locationId)
        : rows;
    },
  });

  const exits = (movements ?? []).filter(
    (m) => locationId ? m.from_location_id === locationId : m.from_location_id !== null,
  );

  return (
    <Tabs defaultValue="entradas" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="entradas" className="gap-1.5 text-xs">
          <ArrowDownToLine className="h-3.5 w-3.5" /> Entradas
        </TabsTrigger>
        <TabsTrigger value="saidas" className="gap-1.5 text-xs">
          <ArrowUpFromLine className="h-3.5 w-3.5" /> Saídas
        </TabsTrigger>
      </TabsList>

      <TabsContent value="entradas" className="mt-3">
        {!batches || batches.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem entradas registradas.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">Lote</TableHead>
                  <TableHead className="text-xs text-right">Inicial / Saldo</TableHead>
                  <TableHead className="text-xs text-right">Peso médio</TableHead>
                  {isManager && <TableHead className="text-xs text-right">Custo</TableHead>}
                  <TableHead className="text-xs">Validade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs">{fmtDate(b.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{b.lot_number || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {Number(b.initial_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                      <span className="text-muted-foreground">
                        {" "}/ {Number(b.current_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {Number(b.avg_weight_g) > 0 ? `${Math.round(Number(b.avg_weight_g))} g` : "—"}
                    </TableCell>
                    {isManager && (
                      <TableCell className="text-right tabular-nums text-xs">{fmtBRL(Number(b.unit_cost))}</TableCell>
                    )}
                    <TableCell className="text-xs">
                      {b.expiry_date
                        ? new Date(b.expiry_date + "T00:00:00").toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="saidas" className="mt-3">
        {!exits || exits.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem saídas registradas.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">Motivo</TableHead>
                  <TableHead className="text-xs text-right">Qtde</TableHead>
                  {isManager && <TableHead className="text-xs text-right">Custo</TableHead>}
                  <TableHead className="text-xs">Obs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exits.map((m) => {
                  const r = reasonLabel(m.type);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs">{fmtDate(m.created_at)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={r.tone}>{r.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {Number(m.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                      </TableCell>
                      {isManager && (
                        <TableCell className="text-right tabular-nums text-xs">
                          {Number(m.total_cost) > 0 ? fmtBRL(Number(m.total_cost)) : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={m.note ?? ""}>
                        {m.note || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
