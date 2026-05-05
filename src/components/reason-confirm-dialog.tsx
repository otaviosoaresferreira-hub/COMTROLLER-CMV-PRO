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
import { AlertTriangle } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  summary?: React.ReactNode;
  minLength?: number;
};

/**
 * Modal global para qualquer ação destrutiva/sensível (excluir, estornar,
 * restaurar). Exige um motivo escrito que será salvo em audit_logs.
 */
export function ReasonConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Confirmar ação",
  description = "Esta ação será registrada no histórico de auditoria.",
  confirmLabel = "Confirmar",
  destructive = true,
  pending = false,
  summary,
  minLength = 5,
}: Props) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= minLength && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className={
                destructive ? "h-4 w-4 text-destructive" : "h-4 w-4 text-amber-600"
              }
            />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {summary && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            {summary}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">
            Motivo da alteração <span className="text-destructive">*</span>
          </Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Descreva por que esta ação está sendo executada (mín. 5 caracteres)…"
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            O motivo ficará registrado no log de auditoria junto com seu usuário e a data/hora.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!canSubmit}
            onClick={() => onConfirm(trimmed)}
          >
            {pending ? "Processando…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
