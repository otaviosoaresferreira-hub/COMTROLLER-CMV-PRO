import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgId } from "@/lib/use-org-id";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ChartBar, Settings2, Plus, Trash2, TrendingUp, TrendingDown, Wallet, Receipt, Percent,
} from "lucide-react";

export const Route = createFileRoute("/dre")({
  component: DREPage,
});

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function startOfMonth() {
  const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
}
function endOfMonth() {
  const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return e.toISOString().slice(0, 10);
}

function DREPage() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(endOfMonth());

  const { data: channels } = useQuery({
    queryKey: ["revenue_channels", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_channels").select("*").eq("org_id", orgId!).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: revenues } = useQuery({
    queryKey: ["revenue_entries", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_entries").select("*")
        .eq("org_id", orgId!).gte("entry_date", from).lte("entry_date", to)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: expenses } = useQuery({
    queryKey: ["expenses", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses").select("*")
        .eq("org_id", orgId!).gte("expense_date", from).lte("expense_date", to)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Movements custom = approximate CMV (saídas operacionais)
  const { data: cmvAgg } = useQuery({
    queryKey: ["cmv_period", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movements")
        .select("total_cost,type,created_at")
        .eq("org_id", orgId!)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .in("type", ["consume", "production", "sale"]);
      if (error) throw error;
      return (data ?? []).reduce((s, m) => s + Number(m.total_cost ?? 0), 0);
    },
  });

  const totals = useMemo(() => {
    const channelMap = new Map<string, number>();
    (channels ?? []).forEach((c) => channelMap.set(c.id, Number(c.fee_percent ?? 0)));
    let gross = 0; let fees = 0;
    (revenues ?? []).forEach((r) => {
      const g = Number(r.gross_amount ?? 0);
      gross += g;
      fees += g * (channelMap.get(r.channel_id) ?? 0) / 100;
    });
    let fixed = 0, variable = 0;
    (expenses ?? []).forEach((e) => {
      const v = Number(e.amount ?? 0);
      if (e.kind === "variable") variable += v; else fixed += v;
    });
    const cmv = Number(cmvAgg ?? 0);
    const net = gross - fees - cmv - fixed - variable;
    return { gross, fees, cmv, fixed, variable, net };
  }, [channels, revenues, expenses, cmvAgg]);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ChartBar className="h-6 w-6 text-primary" /> DRE
          </h1>
          <p className="text-sm text-muted-foreground">Demonstrativo de resultados do período</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
          </div>
          <ChannelsDialog orgId={orgId} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <SummaryCard icon={TrendingUp} label="Faturamento Bruto" value={totals.gross} tone="positive" />
        <SummaryCard icon={Percent} label="Taxas (Canais)" value={-totals.fees} tone="negative" />
        <SummaryCard icon={Receipt} label="CMV" value={-totals.cmv} tone="negative" />
        <SummaryCard icon={Wallet} label="Gastos (Fixos+Var.)" value={-(totals.fixed + totals.variable)} tone="negative" />
        <SummaryCard
          icon={totals.net >= 0 ? TrendingUp : TrendingDown}
          label="Lucro Líquido" value={totals.net}
          tone={totals.net >= 0 ? "positive" : "negative"} highlight
        />
      </div>

      <Tabs defaultValue="revenue">
        <TabsList>
          <TabsTrigger value="revenue">Faturamento</TabsTrigger>
          <TabsTrigger value="expenses">Despesas</TabsTrigger>
        </TabsList>
        <TabsContent value="revenue" className="space-y-4">
          <RevenueForm orgId={orgId} channels={channels ?? []} />
          <Card>
            <CardHeader><CardTitle>Lançamentos do período</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(revenues ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
              )}
              {(revenues ?? []).map((r) => {
                const ch = channels?.find((c) => c.id === r.channel_id);
                const fee = Number(r.gross_amount ?? 0) * Number(ch?.fee_percent ?? 0) / 100;
                return (
                  <div key={r.id} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm">
                    <div>
                      <p className="font-medium">{ch?.name ?? "—"} <span className="text-muted-foreground">· {r.entry_date}</span></p>
                      {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{BRL(Number(r.gross_amount))}</p>
                      <p className="text-xs text-muted-foreground">Taxa: {BRL(fee)}</p>
                    </div>
                    <Button size="icon" variant="ghost" onClick={async () => {
                      await supabase.from("revenue_entries").delete().eq("id", r.id);
                      qc.invalidateQueries({ queryKey: ["revenue_entries"] });
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="expenses" className="space-y-4">
          <ExpenseForm orgId={orgId} />
          <Card>
            <CardHeader><CardTitle>Despesas do período</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(expenses ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma despesa.</p>
              )}
              {(expenses ?? []).map((e) => (
                <div key={e.id} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm">
                  <div>
                    <p className="font-medium">{e.description} <Badge variant="outline" className="ml-2">{e.kind === "fixed" ? "Fixo" : "Variável"}</Badge></p>
                    <p className="text-xs text-muted-foreground">{e.expense_date}{e.note ? ` · ${e.note}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{BRL(Number(e.amount))}</p>
                    <Button size="icon" variant="ghost" onClick={async () => {
                      await supabase.from("expenses").delete().eq("id", e.id);
                      qc.invalidateQueries({ queryKey: ["expenses"] });
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone, highlight,
}: {
  icon: typeof ChartBar;
  label: string;
  value: number;
  tone: "positive" | "negative";
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary" : ""}>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs">
          <Icon className="h-3.5 w-3.5" /> {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className={`text-xl font-bold ${tone === "negative" ? "text-destructive" : "text-foreground"}`}>
          {BRL(value)}
        </p>
      </CardContent>
    </Card>
  );
}

function ChannelsDialog({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fee, setFee] = useState("0");

  const { data: channels } = useQuery({
    queryKey: ["revenue_channels", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_channels").select("*").eq("org_id", orgId!).order("name");
      if (error) throw error; return data;
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Settings2 className="h-4 w-4 mr-2" /> Taxas por canal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Canais e Taxas</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {(channels ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <Input defaultValue={c.name} onBlur={async (e) => {
                if (e.target.value !== c.name) {
                  await supabase.from("revenue_channels").update({ name: e.target.value }).eq("id", c.id);
                  qc.invalidateQueries({ queryKey: ["revenue_channels"] });
                }
              }} />
              <Input type="number" step="0.01" defaultValue={c.fee_percent} className="w-24"
                onBlur={async (e) => {
                  await supabase.from("revenue_channels").update({ fee_percent: Number(e.target.value) }).eq("id", c.id);
                  qc.invalidateQueries({ queryKey: ["revenue_channels"] });
                }} />
              <span className="text-xs">%</span>
              <Button size="icon" variant="ghost" onClick={async () => {
                await supabase.from("revenue_channels").delete().eq("id", c.id);
                qc.invalidateQueries({ queryKey: ["revenue_channels"] });
              }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t">
            <Input placeholder="Novo canal (ex: iFood)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input type="number" step="0.01" placeholder="%" value={fee} onChange={(e) => setFee(e.target.value)} className="w-24" />
            <Button onClick={async () => {
              if (!name.trim() || !orgId) return;
              const { error } = await supabase.from("revenue_channels").insert({
                org_id: orgId, name: name.trim(), fee_percent: Number(fee) || 0,
              });
              if (error) { toast.error(error.message); return; }
              setName(""); setFee("0");
              qc.invalidateQueries({ queryKey: ["revenue_channels"] });
            }}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevenueForm({ orgId, channels }: { orgId: string | null; channels: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [channelId, setChannelId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !channelId) { toast.error("Selecione o canal"); return; }
    const { error } = await supabase.from("revenue_entries").insert({
      org_id: orgId, channel_id: channelId, entry_date: date,
      gross_amount: Number(amount) || 0, note: note || null,
    });
    if (error) { toast.error(error.message); return; }
    setAmount(""); setNote("");
    qc.invalidateQueries({ queryKey: ["revenue_entries"] });
    toast.success("Faturamento lançado");
  };

  return (
    <Card>
      <CardHeader><CardTitle>Lançar faturamento</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-2 md:grid-cols-5">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              {channels.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" step="0.01" placeholder="Valor bruto" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Observação" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit"><Plus className="h-4 w-4 mr-1" />Lançar</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ExpenseForm({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"fixed" | "variable">("fixed");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !desc.trim()) return;
    const { error } = await supabase.from("expenses").insert({
      org_id: orgId, description: desc.trim(), amount: Number(amount) || 0,
      kind, expense_date: date,
    });
    if (error) { toast.error(error.message); return; }
    setDesc(""); setAmount("");
    qc.invalidateQueries({ queryKey: ["expenses"] });
    toast.success("Despesa lançada");
  };

  return (
    <Card>
      <CardHeader><CardTitle>Lançar despesa</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-2 md:grid-cols-5">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input placeholder="Descrição (Aluguel, Luz...)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Input type="number" step="0.01" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select value={kind} onValueChange={(v) => setKind(v as "fixed" | "variable")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixo</SelectItem>
              <SelectItem value="variable">Variável</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit"><Plus className="h-4 w-4 mr-1" />Lançar</Button>
        </form>
      </CardContent>
    </Card>
  );
}
