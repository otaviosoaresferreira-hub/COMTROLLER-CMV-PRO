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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldAlert } from "lucide-react";

const REASONS = [
  "Quebra de insumo",
  "Erro de pesagem no recebimento",
  "Erro de contagem",
  "Perda / Avaria",
  "Vencimento",
  "Devolução ao fornecedor",
  "Consumo da equipe",
  "Outro",
];

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (justification: string) => Promise<void> | void;
  title?: string;
  description?: string;
  summary?: React.ReactNode;
  pending?: boolean;
};

export function AdjustmentJustificationDialog({
  open,
  onClose,
  onConfirm,
  title = "Solicitar ajuste ao gestor",
  description = "Esta alteração precisa ser aprovada por um gestor antes de afetar o estoque.",
  summary,
  pending,
}: Props) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
    }
  }, [open]);

  const justification =
    reason === "Outro"
      ? note.trim()
      : note.trim()
        ? `${reason} — ${note.trim()}`
        : reason;
  const canSubmit = justification.length >= 3;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {summary && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            {summary}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motivo…" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Justificativa {reason === "Outro" ? "(obrigatória)" : "(opcional)"}
            </Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Detalhe o que aconteceu para o gestor avaliar…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={!canSubmit || pending}
            onClick={() => onConfirm(justification)}
          >
            {pending ? "Enviando…" : "Enviar para aprovação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
