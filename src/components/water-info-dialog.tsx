import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Droplets, Infinity as InfinityIcon, Lock, Plus, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrgId } from "@/lib/use-org-id";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Nome a exibir (Água ou nome do item livre). */
  itemName?: string;
  /** Indica se é o item Água (não permite editar nome). */
  isWater?: boolean;
  /** Id do item (necessário para renomear itens livres). */
  itemId?: string;
}

export function WaterInfoDialog({
  open,
  onOpenChange,
  itemName = "Água",
  isWater = true,
  itemId,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [renameMode, setRenameMode] = useState(false);
  const [editName, setEditName] = useState(itemName);
  const qc = useQueryClient();

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      if (!itemId) throw new Error("Item inválido");
      const trimmed = newName.trim();
      if (!trimmed) throw new Error("Nome obrigatório");
      const { error } = await supabase
        .from("items")
        .update({ name: trimmed })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nome atualizado");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["fichas"] });
      setRenameMode(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = (v: boolean) => {
    if (!v) {
      setShowCreate(false);
      setRenameMode(false);
      setEditName(itemName);
    }
    onOpenChange(v);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500 text-white">
                {isWater ? (
                  <Droplets className="h-5 w-5" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isWater ? "Item de Sistema" : "Item Livre"}
                </p>
                <DialogTitle className="truncate">{itemName}</DialogTitle>
              </div>
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> Protegido
              </Badge>
            </div>
            <DialogDescription className="sr-only">
              Informações do item especial {itemName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Renomear (apenas itens livres) */}
            {!isWater && itemId && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                {renameMode ? (
                  <div className="space-y-2">
                    <Label className="text-xs">Novo nome</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Ex: Caldo de Legumes"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRenameMode(false);
                          setEditName(itemName);
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => renameMutation.mutate(editName)}
                        disabled={renameMutation.isPending}
                      >
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRenameMode(true)}
                    className="w-full"
                  >
                    Renomear este item livre
                  </Button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Saldo
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-2xl font-semibold text-sky-600">
                  <InfinityIcon className="h-5 w-5" />
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Custo
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">R$ 0,00</p>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
              <p className="leading-relaxed">
                {isWater ? (
                  <>
                    A <strong>Água</strong> é um insumo fixo, com saldo infinito e custo zero.
                  </>
                ) : (
                  <>
                    Item livre criado para uso em fichas técnicas (ex: caldos, bases de
                    reaproveitamento). Estoque infinito e custo zero.
                  </>
                )}
              </p>
              <ul className="space-y-1">
                <li>• Disponível em qualquer ficha técnica.</li>
                <li>• Não entra em notas, transferências ou movimentações.</li>
                <li>• Não impacta o CMV.</li>
              </ul>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" />
              Adicionar Novo Item Livre
            </Button>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button asChild variant="ghost">
              <Link to="/fichas">
                <ChefHat className="h-4 w-4" />
                Ir para Fichas
              </Link>
            </Button>
            <Button onClick={() => handleClose(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewFreeItemDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}

function NewFreeItemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("UN");
  const qc = useQueryClient();
  const orgId = useOrgId();

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe o nome do item livre");
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");
      const { error } = await supabase.from("items").insert({
        org_id: orgId,
        name: trimmed,
        unit: unit || "UN",
        cost_price: 0,
        sale_price: 0,
        is_active: true,
        is_system: true,
        is_free: true,
        min_stock: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item livre criado");
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["fichas"] });
      setName("");
      setUnit("UN");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo Item Livre</DialogTitle>
          <DialogDescription>
            Itens livres herdam o comportamento da Água: estoque infinito, custo zero
            e disponíveis em qualquer ficha técnica.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="free-name">Nome</Label>
            <Input
              id="free-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Caldo de Legumes, Base de Carne"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="free-unit">Unidade (opcional)</Label>
            <Input
              id="free-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value.toUpperCase())}
              placeholder="UN, KG, L…"
              maxLength={6}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            Criar item livre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
