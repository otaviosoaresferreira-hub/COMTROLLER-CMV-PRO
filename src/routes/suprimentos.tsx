import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ShoppingCart,
  MessageCircle,
  PackagePlus,
  AlertTriangle,
  Phone,
  Settings,
  Circle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getSuppliesData } from "@/server/supplies.functions";
import { useManagerMode } from "@/lib/manager-mode";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/suprimentos")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  component: SuppliesPage,
});

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(n);

const fmtNum = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);

function SuppliesPage() {
  const { isManager } = useManagerMode();
  const qc = useQueryClient();
  const { data: payload, isLoading } = useQuery({
    queryKey: ["supplies"],
    queryFn: async () => {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      return getSuppliesData({ headers: { Authorization: `Bearer ${token}` } });
    },
  });
  const [coverageOverride, setCoverageOverride] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const targetDays =
    coverageOverride ?? payload?.targetCoverageDays ?? 7;

  const rows = useMemo(() => {
    if (!payload) return [];
    const nowMs = Date.now();
    const central = payload.centralLocationId;

    // estoque atual no central
    const stockByItem = new Map<string, number>();
    payload.stock.forEach((s) => {
      if (s.location_id === central) {
        stockByItem.set(s.item_id, (stockByItem.get(s.item_id) ?? 0) + s.current_stock);
      }
    });

    // saídas por item (7d/30d/90d)
    const out7 = new Map<string, number>();
    const out30 = new Map<string, number>();
    const out90 = new Map<string, number>();
    payload.outgoing.forEach((m) => {
      const ageDays = (nowMs - new Date(m.created_at).getTime()) / 86400000;
      if (ageDays <= 90) out90.set(m.item_id, (out90.get(m.item_id) ?? 0) + m.quantity);
      if (ageDays <= 30) out30.set(m.item_id, (out30.get(m.item_id) ?? 0) + m.quantity);
      if (ageDays <= 7) out7.set(m.item_id, (out7.get(m.item_id) ?? 0) + m.quantity);
    });

    // últimos preços por item
    const lastCostByItem = new Map<string, { cost: number; date: string }>();
    payload.recentInvoiceItems.forEach((r) => {
      const date = r.issue_date ?? "";
      const prev = lastCostByItem.get(r.item_id);
      if (!prev || date > prev.date) {
        lastCostByItem.set(r.item_id, { cost: r.stock_unit_cost, date });
      }
    });

    // fornecedores por item (preferenciais primeiro)
    const supByItem = new Map<string, string[]>();
    payload.itemSuppliers
      .slice()
      .sort((a, b) => Number(b.is_preferred) - Number(a.is_preferred))
      .forEach((row) => {
        const arr = supByItem.get(row.item_id) ?? [];
        arr.push(row.supplier_id);
        supByItem.set(row.item_id, arr);
      });

    // lead time por item: pega o MAIOR lead time entre fornecedores vinculados (pessimista)
    const leadTimeByItem = new Map<string, number>();
    payload.itemSuppliers.forEach((row) => {
      const sup = payload.suppliers.find((s) => s.id === row.supplier_id);
      const lt = sup?.lead_time_days ?? 2;
      const prev = leadTimeByItem.get(row.item_id) ?? 0;
      if (lt > prev) leadTimeByItem.set(row.item_id, lt);
    });

    return payload.items
      .filter((i) => i.is_active && !i.is_operational && !i.is_system && !i.is_free)
      .map((item) => {
        const current = stockByItem.get(item.id) ?? 0;
        const o7 = out7.get(item.id) ?? 0;
        const o30 = out30.get(item.id) ?? 0;
        const o90 = out90.get(item.id) ?? 0;
        const dailyAvg7 = o7 / 7;
        const dailyAvg30 = o30 / 30;
        const dailyAvg90 = o90 / 90;
        // melhor estimativa: prioriza 7d se houver consumo, senão 30d, senão 90d
        const dailyAvg = dailyAvg7 > 0 ? dailyAvg7 : dailyAvg30 > 0 ? dailyAvg30 : dailyAvg90;
        const coverageDays = dailyAvg > 0 ? current / dailyAvg : null;
        const leadTime = leadTimeByItem.get(item.id) ?? 2;

        // qtd sugerida: (consumo diário * ciclo de compra) - estoque atual; respeita mínimo
        const targetQty = dailyAvg * targetDays;
        const fromAvg = Math.max(0, targetQty - current);
        const fromMin = item.min_stock > 0 ? Math.max(0, item.min_stock * 2 - current) : 0;
        const suggested = Math.max(fromAvg, fromMin);

        const belowMin = item.min_stock > 0 && current <= item.min_stock;
        // RUPTURA IMINENTE: cobertura < lead time
        const ruptureRisk = coverageDays !== null && coverageDays < leadTime;
        // status semáforo
        let status: "red" | "yellow" | "green" = "green";
        if (ruptureRisk || belowMin) status = "red";
        else if (coverageDays !== null && coverageDays <= leadTime + 3) status = "yellow";

        const needsOrder =
          suggested > 0 && (status !== "green" || (dailyAvg > 0 && coverageDays !== null && coverageDays <= targetDays));

        const lastCost = lastCostByItem.get(item.id)?.cost ?? item.cost_price;

        return {
          itemId: item.id,
          name: item.name,
          unit: item.unit,
          current,
          minStock: item.min_stock,
          dailyAvg7,
          dailyAvg30,
          dailyAvg90,
          coverageDays,
          leadTime,
          suggested,
          lastCost,
          supplierIds: supByItem.get(item.id) ?? [],
          belowMin,
          ruptureRisk,
          status,
          needsOrder,
        };
      });
  }, [payload, targetDays]);

  // agrupa itens por fornecedor (apenas os que precisam de pedido)
  const grouped = useMemo(() => {
    if (!payload) return [];
    const byId = new Map<string, typeof rows>();
    const noSupplier: typeof rows = [];
    rows
      .filter((r) => r.needsOrder)
      .forEach((r) => {
        if (r.supplierIds.length === 0) {
          noSupplier.push(r);
          return;
        }
        const sid = r.supplierIds[0];
        const arr = byId.get(sid) ?? [];
        arr.push(r);
        byId.set(sid, arr);
      });
    const groups = Array.from(byId.entries()).map(([sid, items]) => {
      const supplier = payload.suppliers.find((s) => s.id === sid)!;
      return { supplier, items };
    });
    if (noSupplier.length > 0) {
      groups.push({
        supplier: {
          id: "__none__",
          name: "Sem fornecedor vinculado",
          whatsapp_phone: null,
          contact_name: null,
          document: null,
          lead_time_days: 0,
        },
        items: noSupplier,
      });
    }
    return groups.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name));
  }, [rows, payload]);

  const buildWhatsappLink = (
    supplierName: string,
    phone: string | null,
    items: typeof rows,
  ) => {
    if (!payload) return "#";
    const buyer = payload.buyerName?.trim() || "comprador";
    const restaurant = payload.orgName || "restaurante";
    const greetingTpl =
      payload.whatsappGreeting?.trim() ||
      "Olá {fornecedor}, aqui é o {comprador} do {restaurante}. Gostaria de pedir:";
    const greeting = greetingTpl
      .replace(/\{fornecedor\}/gi, supplierName)
      .replace(/\{comprador\}/gi, buyer)
      .replace(/\{restaurante\}/gi, restaurant);
    const list = items
      .map(
        (it) =>
          `• ${it.name}: ${fmtNum(Math.ceil(it.suggested))} ${it.unit.toUpperCase()}`,
      )
      .join("\n");
    const msg = `${greeting}\n\n${list}`;
    const cleanedPhone = (phone ?? "").replace(/\D/g, "");
    return `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(msg)}`;
  };

  if (!isManager) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">
        Disponível apenas no Modo Gestor.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Gestão de Suprimentos
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">
              Necessidade de Compra
            </h1>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/fornecedores">
              <Phone className="mr-2 h-4 w-4" /> Fornecedores
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" /> Preferências
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 pt-4">
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="cov" className="text-xs text-muted-foreground">
              Cobertura alvo:
            </Label>
            <Input
              id="cov"
              type="number"
              min={1}
              max={60}
              value={targetDays}
              onChange={(e) => setCoverageOverride(Number(e.target.value) || 7)}
              className="h-8 w-20"
            />
            <span className="text-xs text-muted-foreground">dias</span>
          </div>
          <p className="ml-auto text-xs text-muted-foreground">
            Sugerimos quantidades para cobrir {targetDays} dias com base na média de
            saída recente.
          </p>
        </section>

        {/* Cards de fornecedores que precisam de atenção */}
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : grouped.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <PackagePlus className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Tudo em dia!</p>
              <p className="text-xs text-muted-foreground">
                Nenhum item precisa de reposição com base no consumo atual.
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-4 md:grid-cols-2">
            {grouped.map(({ supplier, items }) => {
              const total = items.reduce(
                (acc, it) => acc + Math.ceil(it.suggested) * (it.lastCost ?? 0),
                0,
              );
              const hasPhone = supplier.id !== "__none__" && !!supplier.whatsapp_phone;
              return (
                <Card key={supplier.id} className="overflow-hidden">
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{supplier.name}</CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {items.length} {items.length === 1 ? "item" : "itens"} •{" "}
                        {fmtBRL(total)} estimado
                      </p>
                    </div>
                    {hasPhone ? (
                      <Button asChild size="sm" className="shrink-0 gap-1">
                        <a
                          href={buildWhatsappLink(
                            supplier.name,
                            supplier.whatsapp_phone,
                            items,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle className="h-4 w-4" />
                          WhatsApp
                        </a>
                      </Button>
                    ) : supplier.id !== "__none__" ? (
                      <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
                        <Link to="/fornecedores">
                          <Phone className="h-4 w-4" /> Cadastrar telefone
                        </Link>
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="pl-4">Item</TableHead>
                          <TableHead className="text-right">Atual</TableHead>
                          <TableHead className="text-right">Sugerido</TableHead>
                          <TableHead className="pr-4 text-right">Cobertura</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((it) => (
                          <TableRow key={it.itemId}>
                            <TableCell className="pl-4 font-medium">
                              <div className="flex items-center gap-1.5">
                                <Circle
                                  className={cn(
                                    "h-2.5 w-2.5 shrink-0 fill-current",
                                    it.status === "red" && "text-destructive",
                                    it.status === "yellow" && "text-warning",
                                    it.status === "green" && "text-success",
                                  )}
                                  aria-label={`Status: ${it.status}`}
                                />
                                {it.name}
                                {it.ruptureRisk && (
                                  <AlertTriangle
                                    className="h-3 w-3 text-destructive"
                                    aria-label="Ruptura iminente"
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtNum(it.current)} {it.unit.toUpperCase()}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {fmtNum(Math.ceil(it.suggested))} {it.unit.toUpperCase()}
                            </TableCell>
                            <TableCell className="pr-4 text-right tabular-nums">
                              {it.coverageDays === null
                                ? "—"
                                : `${Math.floor(it.coverageDays)}d`}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}

        {/* Tabela detalhada de durabilidade */}
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Projeção de durabilidade</h2>
            <p className="text-xs text-muted-foreground">
              Quantos dias o estoque atual dura conforme o consumo médio.
            </p>
          </div>
          <div className="max-h-[480px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="pl-4">Item</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Mín.</TableHead>
                  <TableHead className="text-right">Méd. 7d</TableHead>
                  <TableHead className="text-right">Méd. 30d</TableHead>
                  <TableHead className="text-right">Méd. 90d</TableHead>
                  <TableHead className="text-right">Lead</TableHead>
                  <TableHead className="pr-4 text-right">Duração</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .slice()
                  .sort((a, b) => {
                    const ca = a.coverageDays ?? Infinity;
                    const cb = b.coverageDays ?? Infinity;
                    return ca - cb;
                  })
                  .map((r) => (
                    <TableRow
                      key={r.itemId}
                      className={cn(
                        r.status === "yellow" && "bg-warning/10",
                        r.status === "red" && "bg-destructive/10",
                      )}
                    >
                      <TableCell className="pl-4 font-medium">
                        <div className="flex items-center gap-1.5">
                          <Circle
                            className={cn(
                              "h-2.5 w-2.5 shrink-0 fill-current",
                              r.status === "red" && "text-destructive",
                              r.status === "yellow" && "text-warning",
                              r.status === "green" && "text-success",
                            )}
                          />
                          {r.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.current)} {r.unit.toUpperCase()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtNum(r.minStock)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.dailyAvg7)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.dailyAvg30)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.dailyAvg90)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.leadTime}d
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">
                        {r.coverageDays === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge
                            variant={
                              r.status === "red"
                                ? "destructive"
                                : r.status === "yellow"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {Math.floor(r.coverageDays)}d
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          Para registrar a chegada da mercadoria, vá ao{" "}
          <Link to="/central" search={{} as never} className="underline">
            Estoque Central
          </Link>{" "}
          e use <strong>Registrar Entrada</strong> (XML ou manual).
        </p>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        orgId={payload?.orgId ?? null}
        initialBuyer={payload?.buyerName ?? ""}
        initialGreeting={payload?.whatsappGreeting ?? ""}
        initialDays={payload?.targetCoverageDays ?? 7}
        onSaved={() => qc.invalidateQueries({ queryKey: ["supplies"] })}
      />
    </div>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  orgId,
  initialBuyer,
  initialGreeting,
  initialDays,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string | null;
  initialBuyer: string;
  initialGreeting: string;
  initialDays: number;
  onSaved: () => void;
}) {
  const [buyer, setBuyer] = useState(initialBuyer);
  const [greeting, setGreeting] = useState(initialGreeting);
  const [days, setDays] = useState(initialDays);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Sem organização");
      const { error } = await supabase
        .from("organizations")
        .update({
          buyer_name: buyer.trim() || null,
          whatsapp_greeting: greeting.trim() || null,
          target_coverage_days: Math.max(1, Math.min(60, Number(days) || 7)),
        })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferências salvas.");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Preferências de Suprimentos</DialogTitle>
          <DialogDescription>
            Personalize a mensagem enviada aos fornecedores.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="buyer">Nome do comprador</Label>
            <Input
              id="buyer"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              placeholder="Ex.: Otávio"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="greet">Saudação (WhatsApp)</Label>
            <Input
              id="greet"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Olá {fornecedor}, aqui é o {comprador} do {restaurante}. Gostaria de pedir:"
            />
            <p className="text-[10px] text-muted-foreground">
              Use os marcadores {"{fornecedor}"}, {"{comprador}"} e {"{restaurante}"}.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="days">Cobertura alvo padrão (dias)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={60}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 7)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
