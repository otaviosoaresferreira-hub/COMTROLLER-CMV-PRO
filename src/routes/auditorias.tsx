import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  ClipboardCheck,
  ChevronDown,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useManagerMode } from "@/lib/manager-mode";

export const Route = createFileRoute("/auditorias")({
  component: AuditoriasPage,
});

function AuditoriasPage() {
  const { isManager } = useManagerMode();

  const { data, isLoading } = useQuery({
    enabled: isManager,
    queryKey: ["shift-audits"],
    queryFn: async () => {
      const [audits, entries, items, locations] = await Promise.all([
        supabase
          .from("shift_audits")
          .select("id,audit_date,location_id,shift_label,notes,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("shift_audit_entries")
          .select(
            "id,audit_id,item_id,opening_qty,received_qty,sales_qty,staff_qty,waste_qty,final_count_qty,variance_qty",
          ),
        supabase.from("items").select("id,name,unit,is_free").eq("is_free", false),
        supabase.from("locations").select("id,name"),
      ]);
      if (audits.error) throw audits.error;
      if (entries.error) throw entries.error;
      if (items.error) throw items.error;
      if (locations.error) throw locations.error;
      return {
        audits: audits.data,
        entries: entries.data,
        items: items.data,
        locations: locations.data,
      };
    },
  });

  if (!isManager) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Acesso restrito ao gestor</h1>
        <p className="text-sm text-muted-foreground">
          Ative o Modo Gestor no topo da tela para visualizar o histórico de
          auditorias de turno.
        </p>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao início
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Gestão
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">
              Histórico de auditorias de turno
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-3 px-4 pt-4">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Carregando…
          </p>
        ) : !data || data.audits.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">
              Nenhuma auditoria registrada ainda
            </p>
            <p className="text-xs text-muted-foreground">
              As auditorias aparecem aqui assim que o turno fizer o fechamento.
            </p>
          </div>
        ) : (
          data.audits.map((a) => (
            <AuditCard
              key={a.id}
              audit={a}
              entries={data.entries.filter((e) => e.audit_id === a.id)}
              items={data.items}
              locations={data.locations}
            />
          ))
        )}
      </main>
    </div>
  );
}

interface CardProps {
  audit: {
    id: string;
    audit_date: string;
    location_id: string;
    shift_label: string | null;
    notes: string | null;
    created_at: string;
  };
  entries: {
    id: string;
    item_id: string;
    opening_qty: number;
    received_qty: number;
    sales_qty: number;
    staff_qty: number;
    waste_qty: number;
    final_count_qty: number;
    variance_qty: number;
  }[];
  items: { id: string; name: string; unit: string }[];
  locations: { id: string; name: string }[];
}

function AuditCard({ audit, entries, items, locations }: CardProps) {
  const [open, setOpen] = useState(false);
  const location = locations.find((l) => l.id === audit.location_id);

  const totals = useMemo(() => {
    const variances = entries.filter((e) => Math.abs(Number(e.variance_qty)) > 0.001);
    return { totalEntries: entries.length, withVariance: variances.length };
  }, [entries]);

  const date = new Date(audit.audit_date);
  const created = new Date(audit.created_at);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {location?.name ?? "Local"}{" "}
              {audit.shift_label && (
                <span className="text-muted-foreground">· {audit.shift_label}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {date.toLocaleDateString("pt-BR")} · registrado{" "}
              {created.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {totals.totalEntries} {totals.totalEntries === 1 ? "item" : "itens"}
            </Badge>
            {totals.withVariance > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {totals.withVariance} desvio(s)
              </Badge>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Item</TableHead>
                <TableHead className="text-right">Inicial</TableHead>
                <TableHead className="text-right">Receb.</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead className="text-right">Descarte</TableHead>
                <TableHead className="text-right">Final</TableHead>
                <TableHead className="pr-4 text-right">Desvio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const item = items.find((i) => i.id === e.item_id);
                const v = Number(e.variance_qty);
                const isOff = Math.abs(v) > 0.001;
                return (
                  <TableRow key={e.id} className={cn(isOff && "bg-destructive/5")}>
                    <TableCell className="pl-4 font-medium">
                      {item?.name ?? "Item"}{" "}
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {item?.unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.opening_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.received_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.sales_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.staff_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.waste_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.final_count_qty).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell
                      className={cn(
                        "pr-4 text-right font-semibold tabular-nums",
                        isOff && "text-destructive",
                      )}
                    >
                      {v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {audit.notes && (
            <p className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <strong>Obs:</strong> {audit.notes}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
