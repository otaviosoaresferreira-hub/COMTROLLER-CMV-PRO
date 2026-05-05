import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { formatGrams, formatKg, formatUn } from "@/lib/shared-unit";

type Batch = {
  id: string;
  lot_number: string | null;
  current_qty: number;
  units_qty?: number | null;
  avg_weight_g: number;
  expiry_date: string | null;
  created_at: string;
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

/**
 * Lista de lotes ativos de um item, ordenados por FEFO→FIFO (mesma ordem
 * usada pelas RPCs de consumo). Mostra [Lote | Unidades | Peso Real do Lote]
 * para que o usuário veja exatamente de onde o estoque será abatido.
 *
 * Não calcula média global — cada lote é exibido com seu peso real.
 */
export function BatchPreviewList({
  itemId,
  itemBaseUnit,
  sharedUnit = false,
}: {
  itemId: string;
  itemBaseUnit: "kg" | "un";
  sharedUnit?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["batch-preview", itemId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_active_batches", {
        _item_id: itemId,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Batch[]).filter((b) => Number(b.current_qty) > 0);
    },
    enabled: !!itemId,
    staleTime: 5_000,
  });

  if (!itemId) return null;
  if (isLoading) {
    return <p className="text-[11px] text-muted-foreground">Carregando lotes…</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Nenhum lote rastreado para este item.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-2 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-foreground">
          Lotes disponíveis (consumo FEFO → FIFO)
        </p>
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
          {data.length} {data.length === 1 ? "lote" : "lotes"}
        </Badge>
      </div>
      <ul className="space-y-1">
        {data.map((b, idx) => {
          const totalKg = (Number(b.avg_weight_g || 0) * Number(b.current_qty || 0)) / 1000;
          return (
            <li
              key={b.id}
              className="flex items-center justify-between gap-2 text-[11px] tabular-nums"
            >
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <span className="text-muted-foreground">#{idx + 1}</span>
                <span className="font-mono truncate">
                  {b.lot_number || `lote ${b.id.slice(0, 6)}`}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{fmtDate(b.expiry_date)}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {sharedUnit && Number(b.units_qty) > 0 ? (
                  <span>
                    <strong>{formatUn(Number(b.units_qty))}</strong>{" "}
                    <span className="text-muted-foreground">un</span>
                  </span>
                ) : (
                  <span>
                    <strong>
                      {itemBaseUnit === "kg"
                        ? formatKg(Number(b.current_qty))
                        : formatUn(Number(b.current_qty))}
                    </strong>{" "}
                    <span className="text-muted-foreground">{itemBaseUnit}</span>
                  </span>
                )}
                {Number(b.avg_weight_g) > 0 && (
                  <span className="text-muted-foreground">
                    {formatGrams(Number(b.avg_weight_g))}/un · {formatKg(totalKg)} kg
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-muted-foreground italic">
        Cada lote mantém seu próprio peso. Não há média global.
      </p>
    </div>
  );
}
