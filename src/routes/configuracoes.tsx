import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, Image as ImageIcon, Palette, ShieldCheck, Upload, Trash2, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";
import { useBranding, DEFAULT_PRIMARY, DEFAULT_BACKGROUND } from "@/lib/branding";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Controller CMV Pro" },
      { name: "description", content: "Identidade da empresa, personalização visual e segurança." },
    ],
  }),
  component: ConfiguracoesPage,
});

export function maskCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  let out = digits;
  if (digits.length > 2) out = digits.slice(0, 2) + "." + digits.slice(2);
  if (digits.length > 5) out = out.slice(0, 6) + "." + out.slice(6);
  if (digits.length > 8) out = out.slice(0, 10) + "/" + out.slice(10);
  if (digits.length > 12) out = out.slice(0, 15) + "-" + out.slice(15);
  return out;
}

function ConfiguracoesPage() {
  const branding = useBranding();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fantasyName, setFantasyName] = useState(branding.fantasyName);
  const [legalName, setLegalName] = useState(branding.legalName);
  const [cnpj, setCnpj] = useState(branding.cnpj);

  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const handleIdentitySave = () => {
    branding.update({ fantasyName: fantasyName.trim(), legalName: legalName.trim(), cnpj: cnpj.trim() });
    toast.success("Identidade da empresa atualizada");
  };

  const handleLogoFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Imagem muito grande. Use até 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      branding.update({ logoDataUrl: String(reader.result) });
      toast.success("Logo atualizada");
    };
    reader.onerror = () => toast.error("Falha ao ler imagem");
    reader.readAsDataURL(file);
  };

  const handlePasswordChange = async () => {
    if (newPwd.length < 6) {
      toast.error("A senha deve ter ao menos 6 caracteres");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("As senhas não conferem");
      return;
    }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setSavingPwd(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewPwd("");
    setConfirmPwd("");
    toast.success("Senha atualizada com sucesso");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Personalize a identidade da empresa, a aparência do sistema e seus dados de acesso.
        </p>
      </header>

      {/* Identidade da Empresa */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Identidade da Empresa
          </CardTitle>
          <CardDescription>Esses dados aparecem no cabeçalho do sistema.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fantasy">Nome Fantasia</Label>
            <Input id="fantasy" value={fantasyName} onChange={(e) => setFantasyName(e.target.value)} placeholder="Ex.: Restaurante Bom Sabor" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal">Razão Social</Label>
            <Input id="legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Ex.: Bom Sabor LTDA" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input
              id="cnpj"
              value={cnpj}
              inputMode="numeric"
              maxLength={18}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleIdentitySave}>Salvar identidade</Button>
          </div>
        </CardContent>
      </Card>

      {/* Logo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-4 w-4" /> Personalização de Cabeçalho
          </CardTitle>
          <CardDescription>
            Faça upload do mockup/logo (PNG sem fundo recomendado, até 2 MB).
            A logo aparece no cabeçalho superior junto ao Nome Fantasia em destaque e o CNPJ logo abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-muted/40">
              {branding.logoDataUrl ? (
                <img src={branding.logoDataUrl} alt="Logo atual" className="h-full w-full rounded-lg object-contain p-1" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" /> {branding.logoDataUrl ? "Trocar logo" : "Enviar logo"}
              </Button>
              {branding.logoDataUrl && (
                <Button variant="ghost" size="sm" onClick={() => branding.update({ logoDataUrl: null })}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Temas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4" /> Temas
          </CardTitle>
          <CardDescription>
            As escolhas atualizam as cores globais do sistema instantaneamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cor de Fundo</Label>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {BG_OPTIONS.map((opt) => {
                const active = branding.bgTheme === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => branding.update({ bgTheme: opt.key as BgTheme })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-all",
                      active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground/40",
                    )}
                  >
                    <span
                      className="h-10 w-full rounded border border-border"
                      style={{ background: opt.swatch }}
                    />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cor dos Botões</Label>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {BTN_OPTIONS.map((opt) => {
                const active = branding.btnTheme === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => branding.update({ btnTheme: opt.key as BtnTheme })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-all",
                      active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground/40",
                    )}
                  >
                    <span
                      className="h-10 w-full rounded border border-border"
                      style={{ background: opt.swatch }}
                    />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Voltar para o tema padrão (Fundo Branco e Botões Verdes).
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                branding.update({ bgTheme: "branco", btnTheme: "verde" });
                toast.success("Tema padrão restaurado");
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Redefinir para Padrão
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Perfil & Segurança */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Perfil e Segurança
          </CardTitle>
          <CardDescription>Visualize seu acesso e atualize sua senha quando precisar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>E-mail de login</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <Separator />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-pwd">Nova senha</Label>
              <Input id="new-pwd" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pwd">Confirmar nova senha</Label>
              <Input id="confirm-pwd" type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handlePasswordChange} disabled={savingPwd || !newPwd}>
              {savingPwd ? "Atualizando..." : "Atualizar senha"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
