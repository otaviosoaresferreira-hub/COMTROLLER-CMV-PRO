import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tags, Plus, Pencil, Trash2, Eye, EyeOff, Lock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useOrgId } from "@/lib/use-org-id";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/categorias")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Categorias — Controller CMV Pro" },
      {
        name: "description",
        content: "Crie, organize e oculte categorias e subcategorias de insumos.",
      },
    ],
  }),
  component: CategoriasPage,
});

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  is_system: boolean;
};

function CategoriasPage() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ["categories-admin", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [catRes, hidRes, itemsRes] = await Promise.all([
        supabase
          .from("categories")
          .select("id,name,parent_id,is_system")
          .eq("org_id", orgId!)
          .order("name"),
        supabase
          .from("hidden_system_categories")
          .select("category_id")
          .eq("org_id", orgId!),
        supabase
          .from("items")
          .select("category_id")
          .eq("org_id", orgId!)
          .not("category_id", "is", null),
      ]);
      if (catRes.error) throw catRes.error;
      if (hidRes.error) throw hidRes.error;
      if (itemsRes.error) throw itemsRes.error;
      const usage = new Map<string, number>();
      (itemsRes.data ?? []).forEach((r) => {
        const id = r.category_id as string | null;
        if (!id) return;
        usage.set(id, (usage.get(id) ?? 0) + 1);
      });
      return {
        all: (catRes.data ?? []) as Category[],
        hiddenIds: new Set((hidRes.data ?? []).map((r) => r.category_id as string)),
        usage,
      };
    },
  });

  const all = data?.all ?? [];
  const hiddenIds = data?.hiddenIds ?? new Set<string>();
  const usage = data?.usage ?? new Map<string, number>();

  const parents = useMemo(() => all.filter((c) => !c.parent_id), [all]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Category[]>();
    all.forEach((c) => {
      if (c.parent_id) {
        const arr = map.get(c.parent_id) ?? [];
        arr.push(c);
        map.set(c.parent_id, arr);
      }
    });
    return map;
  }, [all]);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formName, setFormName] = useState("");
  const [formParent, setFormParent] = useState<string>("__none__");

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openNew = (parentId?: string | null) => {
    setEditing(null);
    setFormName("");
    setFormParent(parentId ?? "__none__");
    setEditorOpen(true);
  };
  const openEdit = (cat: Category) => {
    setEditing(cat);
    setFormName(cat.name);
    setFormParent(cat.parent_id ?? "__none__");
    setEditorOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const name = formName.trim();
      if (!name) throw new Error("Nome obrigatório");
      if (!orgId) throw new Error("Organização não identificada");
      const parent_id = formParent === "__none__" ? null : formParent;
      if (editing) {
        const { error } = await supabase
          .from("categories")
          .update({ name, parent_id })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("categories")
          .insert({ name, parent_id, org_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Categoria atualizada" : "Categoria criada");
      setEditorOpen(false);
      qc.invalidateQueries({ queryKey: ["categories-admin", orgId] });
      qc.invalidateQueries({ queryKey: ["categories-full", orgId] });
      qc.invalidateQueries({ queryKey: ["central"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteId) throw new Error("ID inválido");
      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", deleteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria excluída");
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["categories-admin", orgId] });
      qc.invalidateQueries({ queryKey: ["categories-full", orgId] });
      qc.invalidateQueries({ queryKey: ["central"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleHidden = useMutation({
    mutationFn: async (cat: Category) => {
      if (!orgId) throw new Error("Organização não identificada");
      if (hiddenIds.has(cat.id)) {
        const { error } = await supabase
          .from("hidden_system_categories")
          .delete()
          .eq("org_id", orgId)
          .eq("category_id", cat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("hidden_system_categories")
          .insert({ org_id: orgId, category_id: cat.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories-admin", orgId] });
      qc.invalidateQueries({ queryKey: ["categories-full", orgId] });
      qc.invalidateQueries({ queryKey: ["central"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletingCategory = useMemo(
    () => all.find((c) => c.id === deleteId) ?? null,
    [all, deleteId],
  );

  // Para o select de "Categoria Pai" no editor: só mostra pais (sem parent_id)
  // e exclui a própria categoria sendo editada.
  const parentOptions = parents.filter((p) => !editing || p.id !== editing.id);
  // Se a categoria sendo editada já é pai (tem filhas), não pode virar filha → trava
  const editingHasChildren =
    editing != null && (childrenByParent.get(editing.id) ?? []).length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Tags className="h-6 w-6" /> Categorias e Subcategorias
          </h1>
          <p className="text-sm text-muted-foreground">
            Organize seus insumos em até 2 níveis. As categorias iniciais são
            criadas automaticamente e podem ser editadas ou removidas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openNew(null)} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Nova categoria
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suas categorias</CardTitle>
          <CardDescription>
            Categorias ocultas continuam vinculadas aos itens existentes, mas
            não aparecem nos selects de novos cadastros.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
          ) : parents.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma categoria cadastrada ainda.
              </p>
              <Button onClick={() => openNew(null)} size="sm">
                Criar categoria
              </Button>
            </div>
          ) : (
            parents.map((p) => {
              const isHidden = hiddenIds.has(p.id);
              const subs = childrenByParent.get(p.id) ?? [];
              const usageCount = usage.get(p.id) ?? 0;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-lg border border-border bg-card",
                    isHidden && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2 p-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.is_system && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Lock className="h-2.5 w-2.5" /> Sistema
                          </Badge>
                        )}
                        {isHidden && (
                          <Badge variant="secondary" className="text-[10px]">
                            Oculta
                          </Badge>
                        )}
                        {usageCount > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {usageCount} item{usageCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => openNew(p.id)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Subcategoria
                      </Button>
                      {p.is_system ? (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleHidden.mutate(p)}
                                aria-label={isHidden ? "Mostrar" : "Ocultar"}
                              >
                                {isHidden ? (
                                  <Eye className="h-4 w-4" />
                                ) : (
                                  <EyeOff className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              {isHidden
                                ? "Mostrar nos seletores"
                                : "Ocultar dos seletores (não exclui)"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(p)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteId(p.id)}
                            aria-label="Excluir"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {subs.length > 0 && (
                    <div className="border-t border-border bg-muted/20 px-3 py-2 space-y-1">
                      {subs.map((s) => {
                        const subHidden = hiddenIds.has(s.id);
                        const subUsage = usage.get(s.id) ?? 0;
                        return (
                          <div
                            key={s.id}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5",
                              subHidden && "opacity-60",
                            )}
                          >
                            <span className="text-muted-foreground/60">↳</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm">{s.name}</span>
                                {s.is_system && (
                                  <Badge variant="outline" className="gap-1 text-[10px]">
                                    <Lock className="h-2.5 w-2.5" /> Sistema
                                  </Badge>
                                )}
                                {subHidden && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    Oculta
                                  </Badge>
                                )}
                                {subUsage > 0 && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {subUsage} item{subUsage > 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                            </div>
                            {s.is_system ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleHidden.mutate(s)}
                                aria-label={subHidden ? "Mostrar" : "Ocultar"}
                              >
                                {subHidden ? (
                                  <Eye className="h-4 w-4" />
                                ) : (
                                  <EyeOff className="h-4 w-4" />
                                )}
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openEdit(s)}
                                  aria-label="Editar"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setDeleteId(s.id)}
                                  aria-label="Excluir"
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar categoria" : "Nova categoria"}
            </DialogTitle>
            <DialogDescription>
              Deixe "Categoria Pai" vazio para criar uma categoria principal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex.: Carnes Bovinas"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria Pai (opcional)</Label>
              <Select
                value={formParent}
                onValueChange={setFormParent}
                disabled={editingHasChildren}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— Categoria principal —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Categoria principal —</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingHasChildren && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Esta categoria já possui subcategorias e por isso não pode
                  virar uma subcategoria.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !formName.trim()}
            >
              {saveMutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingCategory && (usage.get(deletingCategory.id) ?? 0) > 0
                ? `Esta categoria está vinculada a ${usage.get(deletingCategory.id)} item(s). Eles ficarão sem categoria.`
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
