import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCategoriesWithHidden, splitParentsChildren } from "@/lib/categories";

interface Props {
  /** ID atualmente selecionado (pode ser pai ou filha). "" significa nenhum. */
  value: string;
  /** Callback com o ID final escolhido (filha tem prioridade; senão pai; senão ""). */
  onChange: (categoryId: string) => void;
  labelTop?: string;
  labelChild?: string;
  size?: "default" | "sm";
  /** Permite "Sem categoria" como opção. Default true. */
  allowEmpty?: boolean;
}

/** Dois selects dependentes: Categoria + Subcategoria. */
export function CategorySubcategorySelect({
  value,
  onChange,
  labelTop = "Categoria",
  labelChild = "Subcategoria",
  size = "default",
  allowEmpty = true,
}: Props) {
  const { data } = useCategoriesWithHidden();
  const visible = data?.visible ?? [];
  const { parents, childrenByParent } = useMemo(
    () => splitParentsChildren(visible),
    [visible],
  );

  // Descobre qual é o pai e qual é a filha selecionada a partir de "value".
  const selected = visible.find((c) => c.id === value);
  const parentId = selected
    ? selected.parent_id ?? selected.id
    : "";
  const childId = selected && selected.parent_id ? selected.id : "";

  const subOptions = parentId
    ? childrenByParent.get(parentId) ?? []
    : [];

  const triggerCls = size === "sm" ? "h-9" : "";

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {labelTop}
        </Label>
        <Select
          value={parentId || "__none__"}
          onValueChange={(v) => {
            if (v === "__none__") {
              onChange("");
            } else {
              onChange(v);
            }
          }}
        >
          <SelectTrigger className={triggerCls}>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {allowEmpty && (
              <SelectItem value="__none__">Sem categoria</SelectItem>
            )}
            {parents.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Nenhuma categoria cadastrada
              </div>
            )}
            {parents.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {labelChild}
        </Label>
        <Select
          value={childId || "__none__"}
          onValueChange={(v) => {
            if (v === "__none__") {
              // Volta para só o pai
              onChange(parentId);
            } else {
              onChange(v);
            }
          }}
          disabled={!parentId || subOptions.length === 0}
        >
          <SelectTrigger className={triggerCls}>
            <SelectValue
              placeholder={
                !parentId
                  ? "Escolha a categoria"
                  : subOptions.length === 0
                    ? "Sem subcategorias"
                    : "Opcional"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— Nenhuma —</SelectItem>
            {subOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
