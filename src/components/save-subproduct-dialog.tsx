import { useEffect, useMemo, useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrgId } from "@/lib/use-org-id";

type ItemCategory = { id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipeId: string;
  recipeName: string;
  /** Custo total de produção da ficha (já calculado pela tela). */
  totalCost: number;
  /** Rendimento (em yield_unit) — usado para custo unitário do item. */
  yieldQuantity: number;
  yieldUnit: string;
  /** Item já vinculado (recipe.produced_item_id), se existir. */
  producedItemId: string | null;
}

/**
 * Pergunta "Este item vai para o estoque como um produção interna?".
 * Cria/atualiza um item em `items` marcado como `is_subproduct=true`,
 * com custo unitário derivado da ficha técnica, e vincula o item à ficha
 * via `recipes.produced_item_id`.
 *
 * Default da categoria: "Produções Internas". O usuário pode escolher
 * outra categoria oficial (ex: "Proteínas" para uma calabresa fatiada).
 */
export function SaveSubproductDialog({
  open,
  onOpenChange,
  recipeId,
  recipeName,
  totalCost,
  yieldQuantity,
  yieldUnit,
  producedItemId,
}: Props) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const [name, setName] = useState(recipeName);
  const [unit, setUnit] = useState<string>(() => yieldUnit || "UN");
  const [categoryId, setCategoryId] = useState<string>("");

  const yieldQtyNum = Number(yieldQuantity) || 1;
  const unitCost = useMemo(
    () => (yieldQtyNum > 0 ? totalCost / yieldQtyNum : 0),
    [totalCost, yieldQtyNum],
  );

  const { data: categories } = useQuery({
    queryKey: ["item-categories-for-subproduct", orgId],
    enabled: open && !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name")
        .eq("org_id", orgId!)
        .order("name");
      if (error) throw error;
      // Esconde a categoria interna "Sistema"
      return (data ?? []).filter(
        (c) => c.name.trim().toLowerCase() !== "sistema",
      ) as ItemCategory[];
    },
  });

  // Default = Produções Internas
  useEffect(() => {
    if (!open) return;
    setName(recipeName);
    setUnit(yieldUnit || "UN");
    if (categories && categories.length > 0 && !categoryId) {
      const prod = categories.find(
        (c) => c.name.trim().toLowerCase() === "produções internas",
      );
      setCategoryId(prod?.id ?? categories[0].id);
    }
  }, [open, recipeName, yieldUnit, categories, categoryId]);

  const saveM = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe o nome do item");
      if (!categoryId) throw new Error("Escolha uma categoria");
      if (!orgId) throw new Error("Organização não identificada — recarregue a página.");

      let itemId = producedItemId;

      if (itemId) {
        // Atualiza item existente: nome, unidade, categoria, custo
        const { error } = await supabase
          .from("items")
          .update({
            name: trimmed,
            unit,
            category_id: categoryId,
            cost_price: unitCost,
            is_subproduct: true,
            is_active: true,
          })
          .eq("id", itemId);
        if (error) throw error;
      } else {
        // Cria novo item produção interna
        const { data, error } = await supabase
          .from("items")
          .insert({
            org_id: orgId,
            name: trimmed,
            unit,
            category_id: categoryId,
            cost_price: unitCost,
            sale_price: 0,
            min_stock: 0,
            is_active: true,
            is_subproduct: true,
          })
          .select("id")
          .single();
        if (error) throw error;
        itemId = data.id;

        // Vincula o item criado à ficha
        const { error: linkErr } = await supabase
          .from("recipes")
          .update({ produced_item_id: itemId })
          .eq("id", recipeId);
        if (linkErr) throw linkErr;
      }
    },
    onSuccess: () => {
      toast.success(
        producedItemId
          ? "Produção Interna atualizado no estoque"
          : "Produção Interna criado no estoque",
      );
      qc.invalidateQueries({ queryKey: ["fichas"] });
      qc.invalidateQueries({ queryKey: ["central"] });
      qc.invalidateQueries({ queryKey: ["sidebar-categories"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {producedItemId ? "Atualizar produção interna" : "Salvar como produção interna"}
          </DialogTitle>
          <DialogDescription>
            Este item vai para o estoque como um produção interna, com o custo
            calculado pela ficha técnica. Você pode escolher a categoria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do item</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Unidade</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UN">UN</SelectItem>
                  <SelectItem value="KG">KG</SelectItem>
                  <SelectItem value="L">L</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Custo unitário</Label>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm tabular-nums">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(isFinite(unitCost) ? unitCost : 0)}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Por padrão, vai para <strong>Produções Internas</strong>. Você
              pode escolher outra (ex: Proteínas para uma carne já fatiada).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || !categoryId}
          >
            {producedItemId ? "Atualizar produção interna" : "Salvar produção interna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
