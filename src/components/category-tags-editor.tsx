import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCategoriesWithHidden, categoryPath } from "@/lib/categories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  itemId: string;
  /** Categoria principal (items.category_id) — exibida como "Principal" e não removível aqui. */
  primaryCategoryId?: string | null;
}

/**
 * Editor de tags adicionais de categoria para um item.
 * A categoria principal continua em `items.category_id`; estas são marcações extras.
 */
export function CategoryTagsEditor({ itemId, primaryCategoryId }: Props) {
  const qc = useQueryClient();
  const { data: catData } = useCategoriesWithHidden();
  const visible = catData?.visible ?? [];
  const [open, setOpen] = useState(false);

  const { data: tags = [] } = useQuery({
    queryKey: ["item-categories", itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_categories")
        .select("id,category_id")
        .eq("item_id", itemId);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; category_id: string }>;
    },
    enabled: !!itemId,
  });

  const tagIds = useMemo(() => new Set(tags.map((t) => t.category_id)), [tags]);

  const addMut = useMutation({
    mutationFn: async (categoryId: string) => {
      const { error } = await supabase
        .from("item_categories")
        .insert({ item_id: itemId, category_id: categoryId });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["item-categories", itemId] });
      await qc.invalidateQueries({ queryKey: ["central"], refetchType: "active" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase
        .from("item_categories")
        .delete()
        .eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["item-categories", itemId] });
      await qc.invalidateQueries({ queryKey: ["central"], refetchType: "active" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Categorias disponíveis = visíveis menos a principal e as já marcadas
  const available = visible.filter(
    (c) => c.id !== primaryCategoryId && !tagIds.has(c.id),
  );

  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Categorias adicionais (tags)
      </Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {primaryCategoryId && (
          <Badge variant="default" className="gap-1">
            {categoryPath(primaryCategoryId, visible) || "Principal"}
            <span className="ml-1 text-[9px] uppercase opacity-80">principal</span>
          </Badge>
        )}
        {tags.map((t) => (
          <Badge key={t.id} variant="secondary" className="gap-1">
            {categoryPath(t.category_id, visible)}
            <button
              type="button"
              onClick={() => removeMut.mutate(t.id)}
              className="ml-0.5 rounded hover:bg-muted-foreground/20"
              aria-label="Remover tag"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2">
              <Plus className="h-3 w-3" /> Adicionar
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {available.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  Nenhuma categoria disponível
                </p>
              ) : (
                available.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      addMut.mutate(c.id);
                      setOpen(false);
                    }}
                    className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    {categoryPath(c.id, visible)}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Filtros por categoria buscam tanto a principal quanto as tags.
      </p>
    </div>
  );
}
