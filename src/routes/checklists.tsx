import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgId } from "@/lib/use-org-id";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ClipboardCheck, Plus, Camera, Trash2, Play, CheckCircle2, Clock, AlertTriangle, Image as ImageIcon, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/checklists")({
  component: ChecklistsPage,
});

type RunStatus = "pending" | "in_progress" | "completed";

function ChecklistsPage() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const { data: templates } = useQuery({
    queryKey: ["checklist_templates", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_templates").select("*")
        .eq("org_id", orgId!).eq("is_active", true).order("name");
      if (error) throw error; return data;
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["checklist_runs", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_runs")
        .select("id,status,run_date,due_at,completed_at,template_id,checklist_templates(name)")
        .eq("org_id", orgId!)
        .order("run_date", { ascending: false }).limit(50);
      if (error) throw error; return data;
    },
  });

  if (activeRunId) {
    return <RunView runId={activeRunId} onBack={() => setActiveRunId(null)} />;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" /> Checklists
          </h1>
          <p className="text-sm text-muted-foreground">Rotinas operacionais com comprovação por foto</p>
        </div>
        <NewTemplateDialog orgId={orgId} />
      </div>

      <Card>
        <CardHeader><CardTitle>Modelos ativos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(templates ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum modelo. Crie o primeiro acima.</p>
          )}
          {(templates ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="font-medium">{t.name}</p>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={async () => {
                  if (!orgId) return;
                  const { data: items } = await supabase
                    .from("checklist_template_items").select("*")
                    .eq("template_id", t.id).order("position");
                  const { data: run, error } = await supabase
                    .from("checklist_runs").insert({
                      org_id: orgId, template_id: t.id, status: "in_progress",
                    }).select("id").single();
                  if (error || !run) { toast.error(error?.message ?? "Erro"); return; }
                  if (items && items.length) {
                    await supabase.from("checklist_run_items").insert(items.map((i) => ({
                      org_id: orgId, run_id: run.id, template_item_id: i.id,
                      position: i.position, text: i.text, requires_photo: i.requires_photo,
                    })));
                  }
                  qc.invalidateQueries({ queryKey: ["checklist_runs"] });
                  setActiveRunId(run.id);
                }}>
                  <Play className="h-4 w-4 mr-1" /> Iniciar
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => {
                  await supabase.from("checklist_templates").update({ is_active: false }).eq("id", t.id);
                  qc.invalidateQueries({ queryKey: ["checklist_templates"] });
                }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Execuções recentes</CardTitle>
          <CardDescription>Toque em uma execução para retomar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(runs ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma execução ainda.</p>
          )}
          {(runs ?? []).map((r) => {
            const isLate = r.status !== "completed" && r.due_at && new Date(r.due_at) < new Date();
            const status: RunStatus = r.status as RunStatus;
            return (
              <button key={r.id} onClick={() => setActiveRunId(r.id)}
                className="w-full text-left flex items-center justify-between border rounded-lg p-3 hover:bg-accent/30">
                <div>
                  <p className="font-medium">{(r.checklist_templates as { name?: string } | null)?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{r.run_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} late={!!isLate} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status, late }: { status: RunStatus; late: boolean }) {
  if (late) return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Atrasado</Badge>;
  if (status === "completed") return <Badge className="bg-green-600 hover:bg-green-700"><CheckCircle2 className="h-3 w-3 mr-1" />Concluído</Badge>;
  if (status === "in_progress") return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Em andamento</Badge>;
  return <Badge variant="outline">Pendente</Badge>;
}

function NewTemplateDialog({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [items, setItems] = useState<{ text: string; requires_photo: boolean }[]>([
    { text: "", requires_photo: false },
  ]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !name.trim()) return;
    const valid = items.filter((i) => i.text.trim());
    if (valid.length === 0) { toast.error("Adicione pelo menos um item"); return; }
    const { data: tpl, error } = await supabase
      .from("checklist_templates").insert({
        org_id: orgId, name: name.trim(), description: desc.trim() || null,
      }).select("id").single();
    if (error || !tpl) { toast.error(error?.message ?? "Erro"); return; }
    await supabase.from("checklist_template_items").insert(valid.map((it, idx) => ({
      org_id: orgId, template_id: tpl.id, position: idx,
      text: it.text.trim(), requires_photo: it.requires_photo,
    })));
    toast.success("Checklist criado");
    setOpen(false); setName(""); setDesc(""); setItems([{ text: "", requires_photo: false }]);
    qc.invalidateQueries({ queryKey: ["checklist_templates"] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-1" /> Novo Checklist</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo Checklist</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Fechamento de Cozinha" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Itens</Label>
            {items.map((it, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <Input value={it.text} onChange={(e) => {
                  const cp = [...items]; cp[idx].text = e.target.value; setItems(cp);
                }} placeholder={`Item ${idx + 1}`} />
                <label className="flex items-center gap-1 text-xs whitespace-nowrap pt-2">
                  <Checkbox checked={it.requires_photo} onCheckedChange={(v) => {
                    const cp = [...items]; cp[idx].requires_photo = !!v; setItems(cp);
                  }} />
                  <Camera className="h-3.5 w-3.5" />
                </label>
                <Button type="button" size="icon" variant="ghost" onClick={() => {
                  setItems(items.filter((_, i) => i !== idx));
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setItems([...items, { text: "", requires_photo: false }]);
            }}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar item
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit">Criar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RunView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const orgId = useOrgId();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: run } = useQuery({
    queryKey: ["checklist_run", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_runs")
        .select("*,checklist_templates(name)")
        .eq("id", runId).single();
      if (error) throw error; return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["checklist_run_items", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_run_items").select("*")
        .eq("run_id", runId).order("position");
      if (error) throw error; return data;
    },
  });

  const allDone = (items ?? []).every((i) => i.is_done);

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>← Voltar</Button>
        {run && <StatusBadge status={run.status as RunStatus} late={false} />}
      </div>
      <div>
        <h1 className="text-xl font-bold">{(run?.checklist_templates as { name?: string } | null)?.name}</h1>
        <p className="text-xs text-muted-foreground">{run?.run_date}</p>
      </div>

      <div className="space-y-2">
        {(items ?? []).map((it) => (
          <RunItemRow key={it.id} item={it} orgId={orgId} userId={user?.id ?? null} runId={runId} />
        ))}
      </div>

      {allDone && run?.status !== "completed" && (
        <Button className="w-full" size="lg" onClick={async () => {
          await supabase.from("checklist_runs").update({
            status: "completed", completed_at: new Date().toISOString(),
          }).eq("id", runId);
          qc.invalidateQueries({ queryKey: ["checklist_run", runId] });
          qc.invalidateQueries({ queryKey: ["checklist_runs"] });
          toast.success("Checklist concluído!");
        }}>
          <CheckCircle2 className="h-4 w-4 mr-2" /> Finalizar checklist
        </Button>
      )}
    </div>
  );
}

function RunItemRow({
  item, orgId, userId, runId,
}: {
  item: { id: string; text: string; requires_photo: boolean; is_done: boolean; photo_path: string | null; note: string | null };
  orgId: string | null;
  userId: string | null;
  runId: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Resolve signed URL when photo exists
  useEffect(() => {
    if (item.photo_path) {
      supabase.storage.from("checklist-photos")
        .createSignedUrl(item.photo_path, 3600)
        .then(({ data }) => setPhotoUrl(data?.signedUrl ?? null));
    } else {
      setPhotoUrl(null);
    }
  }, [item.photo_path]);

  const toggleDone = async (v: boolean) => {
    if (v && item.requires_photo && !item.photo_path) {
      toast.error("Este item exige foto antes de marcar como concluído.");
      return;
    }
    await supabase.from("checklist_run_items").update({
      is_done: v,
      done_at: v ? new Date().toISOString() : null,
      done_by: v ? userId : null,
    }).eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["checklist_run_items", runId] });
  };

  const onPhoto = async (file: File) => {
    if (!orgId) return;
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${orgId}/${runId}/${item.id}.${ext}`;
    const { error } = await supabase.storage.from("checklist-photos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) { toast.error(error.message); setUploading(false); return; }
    await supabase.from("checklist_run_items").update({ photo_path: path }).eq("id", item.id);
    const { data } = await supabase.storage.from("checklist-photos").createSignedUrl(path, 3600);
    setPhotoUrl(data?.signedUrl ?? null);
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["checklist_run_items", runId] });
    toast.success("Foto anexada");
  };

  return (
    <div className={`border rounded-lg p-3 space-y-2 ${item.is_done ? "bg-accent/20" : ""}`}>
      <div className="flex items-start gap-3">
        <Checkbox checked={item.is_done} onCheckedChange={(v) => toggleDone(!!v)} className="mt-1" />
        <p className={`flex-1 text-sm ${item.is_done ? "line-through text-muted-foreground" : ""}`}>
          {item.text}
          {item.requires_photo && (
            <Badge variant="outline" className="ml-2"><Camera className="h-3 w-3 mr-1" />Foto</Badge>
          )}
        </p>
        <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {photoUrl ? <ImageIcon className="h-4 w-4 text-primary" /> : <Camera className="h-4 w-4" />}
        </Button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); }} />
      </div>
      {photoUrl && (
        <a href={photoUrl} target="_blank" rel="noreferrer">
          <img src={photoUrl} alt="Comprovação" className="h-24 w-24 object-cover rounded border" />
        </a>
      )}
    </div>
  );
}
