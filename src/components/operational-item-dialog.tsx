import { useEffect, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, Plus, Trash2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Quando informado, edita; senão, cria novo. */
  itemId?: string | null;
  initialName?: string;
  initialUnit?: string;
  /** Disparado ao clicar em "+ Novo" dentro do modal de edição. */
  onCreateNew?: () => void;
}

const UNIT_OPTIONS = ["KG", "UN"];

/**
 * Modal ultra-simplificado para Insumos Operacionais (custo zero / estoque infinito).
 * Apenas dois campos: Nome e Unidade. Salva automaticamente como is_operational=true.
 */
export function OperationalItemDialog({
  open,
  onClose,
  itemId,
  initialName,
  initialUnit,
  onCreateNew,
}: Props) {
  const qc = useQueryClient();
  const isEdit = !!itemId;

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("UN");

  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      const u = (initialUnit ?? "UN").toUpperCase();
      setUnit(UNIT_OPTIONS.includes(u) ? u : "UN");
    }
  }, [open, initialName, initialUnit]);

  const saveMutation = useMutation({
    mutationFn: async (opts: { addAnother: boolean }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe o nome do insumo");
      const payload = {
        name: trimmed,
        unit: unit.toLowerCase(),
        is_operational: true,
        cost_price: 0,
        min_stock: 0,
      };
      if (isEdit && itemId) {
        const { error } = await supabase
          .from("items")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(payload as any)
          .eq("id", itemId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("items")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert(payload as any);
        if (error) throw error;
      }
      return opts;
    },
    onSuccess: (opts) => {
      toast.success(isEdit ? "Insumo atualizado" : "Insumo operacional criado");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["fichas"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      if (opts.addAnother) {
        // Mantém o modal aberto e limpa para criar outro rapidamente
        setName("");
        setUnit("UN");
      } else {
        onClose();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // "Água" é fixa do sistema e não pode ser excluída
  const isProtected =
    isEdit && (initialName ?? "").trim().toLowerCase() === "água";

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("ID inválido");
      if (isProtected) throw new Error("A Água é um item fixo do sistema.");
      // Verifica se há uso em fichas técnicas
      const { count: usage } = await supabase
        .from("recipe_ingredients")
        .select("id", { count: "exact", head: true })
        .eq("item_id", itemId);
      if ((usage ?? 0) > 0) {
        throw new Error(
          `Não é possível excluir: este insumo está em uso em ${usage} ficha(s) técnica(s). Remova-o das fichas primeiro.`,
        );
      }
      // Limpa estoque (caso exista) e exclui
      const { error: e1 } = await supabase
        .from("stock_levels")
        .delete()
        .eq("item_id", itemId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("items")
        .delete()
        .eq("id", itemId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Insumo operacional excluído");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["fichas"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAddAnother = () => {
    // No modo edição, fecha e abre o fluxo "novo"
    setName("");
    setUnit("UN");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar Insumo Operacional" : "Novo Insumo Operacional"}
          </DialogTitle>
          <DialogDescription>
            Itens operacionais (ex: Água, Caldo de Legumes) têm custo R$ 0,00 e
            estoque infinito. Servem apenas para compor o peso e o rendimento
            das fichas técnicas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="op-name">Nome</Label>
            <Input
              id="op-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Caldo de Legumes"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Unidade de Medida</Label>
            <Select value={unit} onValueChange={setUnit}>
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

          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Este item é <strong>intransferível</strong> e não aceita ajustes
              de saldo. Ele serve apenas para compor o rendimento das fichas
              técnicas.
              {isProtected && (
                <>
                  {" "}
                  <strong>Água</strong> é um item fixo do sistema e não pode
                  ser excluído.
                </>
              )}
            </span>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            {isEdit && !isProtected && (
              <Button
                variant="outline"
                className="gap-1 text-destructive hover:text-destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      `Excluir definitivamente "${name}"? Esta ação não pode ser desfeita.`,
                    )
                  ) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                title="Excluir este insumo operacional"
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {isEdit ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  onCreateNew?.();
                }}
                title="Criar outro insumo operacional"
              >
                <Plus className="mr-1 h-4 w-4" />
                Novo
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => saveMutation.mutate({ addAnother: true })}
                disabled={saveMutation.isPending}
                title="Salvar e criar outro insumo operacional"
              >
                <Plus className="mr-1 h-4 w-4" />
                Salvar e adicionar outro
              </Button>
            )}
            <Button
              onClick={() => saveMutation.mutate({ addAnother: false })}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
