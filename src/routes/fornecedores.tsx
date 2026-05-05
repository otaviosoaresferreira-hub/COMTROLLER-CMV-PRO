import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Plus, Phone, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useManagerMode } from "@/lib/manager-mode";
import { useOrgId } from "@/lib/use-org-id";
import { writeAuditLog } from "@/lib/audit-log";
import { ReasonConfirmDialog } from "@/components/reason-confirm-dialog";

export const Route = createFileRoute("/fornecedores")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  component: SuppliersPage,
});

type Supplier = {
  id: string;
  name: string;
  document: string | null;
  whatsapp_phone: string | null;
  contact_name: string | null;
  notes: string | null;
  lead_time_days: number;
};

type PriceRow = {
  id: string;
  supplier_id: string | null;
  issue_date: string | null;
  item_id: string | null;
  xml_name: string;
  stock_unit_cost: number;
};

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);

const fmtDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR").format(new Date(iso + "T00:00:00"))
    : "—";

function SuppliersPage() {
  const { isManager } = useManagerMode();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyOf, setHistoryOf] = useState<Supplier | null>(null);
  const [deleteOf, setDeleteOf] = useState<Supplier | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,document,whatsapp_phone,contact_name,notes,lead_time_days")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  const { data: priceHistory = [] } = useQuery({
    queryKey: ["supplier-prices", historyOf?.id],
    enabled: !!historyOf,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_items")
        .select(
          "id,item_id,xml_name,stock_unit_cost,invoices!inner(supplier_id,issue_date)",
        )
        .eq("invoices.supplier_id", historyOf!.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const rawInv = (row as { invoices?: unknown }).invoices;
        const inv = (Array.isArray(rawInv) ? rawInv[0] : rawInv) as
          | { supplier_id: string | null; issue_date: string | null }
          | null
          | undefined;
        return {
          id: row.id,
          supplier_id: inv?.supplier_id ?? null,
          issue_date: inv?.issue_date ?? null,
          item_id: row.item_id,
          xml_name: row.xml_name,
          stock_unit_cost: Number(row.stock_unit_cost ?? 0),
        } as PriceRow;
      });
    },
  });

  const remove = useMutation({
    mutationFn: async ({ supplier, reason }: { supplier: Supplier; reason: string }) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", supplier.id);
      if (error) throw error;
      if (orgId) {
        await writeAuditLog({
          orgId,
          module: "suppliers",
          entityType: "supplier",
          entityId: supplier.id,
          action: "delete",
          reason,
          oldValue: supplier,
        });
      }
    },
    onSuccess: () => {
      toast.success("Fornecedor removido.");
      setDeleteOf(null);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
            <Link to="/suprimentos">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Phone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Suprimentos
            </p>
            <h1 className="truncate text-base font-semibold leading-tight">
              Fornecedores
            </h1>
          </div>
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" /> Novo
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 pt-4">
        {suppliers.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhum fornecedor cadastrado.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {suppliers.map((s) => (
              <Card key={s.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{s.name}</CardTitle>
                    {s.document && (
                      <p className="text-xs text-muted-foreground">CNPJ: {s.document}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteOf(s)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-sm">
                  {s.contact_name && (
                    <p className="text-xs text-muted-foreground">
                      Contato: {s.contact_name}
                    </p>
                  )}
                  {s.whatsapp_phone ? (
                    <p className="text-xs">WhatsApp: {s.whatsapp_phone}</p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      Sem telefone cadastrado
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setHistoryOf(s)}
                  >
                    Ver histórico de preços
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <SupplierDialog
        open={creating || !!editing}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
        supplier={editing}
        orgId={orgId}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["suppliers"] });
          qc.invalidateQueries({ queryKey: ["supplies"] });
        }}
      />

      <PriceHistoryDialog
        supplier={historyOf}
        rows={priceHistory}
        onClose={() => setHistoryOf(null)}
      />

      <ReasonConfirmDialog
        open={!!deleteOf}
        onOpenChange={(v) => !v && setDeleteOf(null)}
        title="Remover fornecedor"
        description={`Confirme a remoção de "${deleteOf?.name ?? ""}". Os históricos das notas serão preservados.`}
        confirmLabel="Remover"
        onConfirm={(reason) => {
          if (deleteOf) remove.mutate({ supplier: deleteOf, reason });
        }}
      />
    </div>
  );
}

function SupplierDialog({
  open,
  onOpenChange,
  supplier,
  orgId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  supplier: Supplier | null;
  orgId: string | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [document, setDocument] = useState(supplier?.document ?? "");
  const [phone, setPhone] = useState(supplier?.whatsapp_phone ?? "");
  const [contact, setContact] = useState(supplier?.contact_name ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [leadTime, setLeadTime] = useState<number>(supplier?.lead_time_days ?? 2);

  // reset quando abre
  useMemo(() => {
    if (open) {
      setName(supplier?.name ?? "");
      setDocument(supplier?.document ?? "");
      setPhone(supplier?.whatsapp_phone ?? "");
      setContact(supplier?.contact_name ?? "");
      setNotes(supplier?.notes ?? "");
      setLeadTime(supplier?.lead_time_days ?? 2);
    }
  }, [open, supplier]);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Sem organização");
      if (!name.trim()) throw new Error("Informe o nome do fornecedor.");
      const payload = {
        name: name.trim(),
        document: document.trim() || null,
        whatsapp_phone: phone.trim() || null,
        contact_name: contact.trim() || null,
        notes: notes.trim() || null,
        lead_time_days: Math.max(0, Math.min(60, Number(leadTime) || 0)),
      };
      if (supplier) {
        const { error } = await supabase
          .from("suppliers")
          .update(payload)
          .eq("id", supplier.id);
        if (error) throw error;
        await writeAuditLog({
          orgId,
          module: "suppliers",
          entityType: "supplier",
          entityId: supplier.id,
          action: "update",
          oldValue: supplier,
          newValue: payload,
        });
      } else {
        const { data, error } = await supabase
          .from("suppliers")
          .insert({ ...payload, org_id: orgId })
          .select("id")
          .single();
        if (error) throw error;
        await writeAuditLog({
          orgId,
          module: "suppliers",
          entityType: "supplier",
          entityId: data?.id ?? null,
          action: "create",
          newValue: payload,
        });
      }
    },
    onSuccess: () => {
      toast.success(supplier ? "Fornecedor atualizado." : "Fornecedor criado.");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{supplier ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          <DialogDescription>
            Inclua o telefone com DDI/DDD para o link do WhatsApp funcionar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sup-name">Nome*</Label>
            <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-doc">CNPJ</Label>
            <Input
              id="sup-doc"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-phone">WhatsApp (com DDI)</Label>
            <Input
              id="sup-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="55 11 98888-7777"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-contact">Contato</Label>
            <Input
              id="sup-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-lead">Lead Time (dias para entrega)</Label>
            <Input
              id="sup-lead"
              type="number"
              min={0}
              max={60}
              value={leadTime}
              onChange={(e) => setLeadTime(Number(e.target.value) || 0)}
            />
            <p className="text-[10px] text-muted-foreground">
              Usado para calcular alertas de ruptura iminente.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-notes">Observações</Label>
            <Input
              id="sup-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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

function PriceHistoryDialog({
  supplier,
  rows,
  onClose,
}: {
  supplier: Supplier | null;
  rows: PriceRow[];
  onClose: () => void;
}) {
  return (
    <Dialog open={!!supplier} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Histórico de preços — {supplier?.name}</DialogTitle>
          <DialogDescription>
            Preços praticados em notas processadas (mais recentes primeiro).
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma nota processada para este fornecedor ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDate(r.issue_date)}
                    </TableCell>
                    <TableCell className="font-medium">{r.xml_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtBRL(r.stock_unit_cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
