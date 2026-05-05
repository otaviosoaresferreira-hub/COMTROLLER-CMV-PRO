import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useManagerMode } from "@/lib/manager-mode";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export function ManagerModeToggle() {
  const { isManager, enable, disable } = useManagerMode();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  if (isManager) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          disable();
          toast.success("Modo Operacional ativado");
        }}
        className="gap-2"
      >
        <Lock className="h-4 w-4 text-primary" />
        Gestor
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Lock className="h-4 w-4" />
        Operacional
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Modo Gestor</DialogTitle>
            <DialogDescription>
              Digite a senha para visualizar custos, preços e margens.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (enable(password)) {
                toast.success("Modo Gestor ativado");
                setOpen(false);
                setPassword("");
              } else {
                toast.error("Senha incorreta");
                setPassword("");
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="pwd">Senha</Label>
              <Input
                id="pwd"
                type="password"
                inputMode="numeric"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••"
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full">
                Entrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
