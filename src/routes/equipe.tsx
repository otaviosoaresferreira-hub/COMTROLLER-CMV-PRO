import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/equipe")({
  component: EquipePage,
});

type Role = "owner" | "manager" | "staff";

function EquipePage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");

  const { data: orgs } = useQuery({
    queryKey: ["my-orgs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("org_id, role, organizations(id, name)");
      if (error) throw error;
      return data;
    },
  });

  const myOrg = orgs?.[0];
  const orgId = myOrg?.org_id;
  const myRole = myOrg?.role as Role | undefined;
  const isOwner = myRole === "owner";

  const { data: members } = useQuery({
    enabled: !!orgId,
    queryKey: ["org-members", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("org_id", orgId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: invites } = useQuery({
    enabled: !!orgId && isOwner,
    queryKey: ["org-invites", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invites")
        .select("id, email, role, accepted_at, created_at")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("organization_invites").insert({
        org_id: orgId!,
        email,
        role,
        invited_by: u.user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Convite criado");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };

  if (!orgs) return <div className="p-6">Carregando...</div>;
  if (!myOrg) return <div className="p-6">Você ainda não pertence a nenhuma organização.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="text-sm text-muted-foreground">
          Restaurante: <strong>{(myOrg.organizations as { name: string } | null)?.name}</strong> · Seu papel: <Badge variant="outline">{myRole}</Badge>
        </p>
      </div>

      {isOwner && (
        <Card className="p-4">
          <h2 className="font-semibold">Convidar membro</h2>
          <form onSubmit={onInvite} className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px_auto]">
            <div>
              <Label htmlFor="invite-email" className="sr-only">E-mail</Label>
              <Input id="invite-email" type="email" placeholder="email@exemplo.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">Gerente</SelectItem>
                <SelectItem value="staff">Equipe</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={invite.isPending}>Convidar</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            O convidado precisa criar conta com o mesmo e-mail. (Aceitação automática de convite ainda não está ativa — por enquanto, após o cadastro, você pode adicioná-lo manualmente abaixo.)
          </p>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-semibold">Membros ({members?.length ?? 0})</h2>
        <ul className="mt-3 space-y-2">
          {members?.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div>
                <code className="text-xs">{m.user_id}</code>
                <Badge className="ml-2" variant="outline">{m.role}</Badge>
              </div>
              {isOwner && m.role !== "owner" && (
                <Button size="icon" variant="ghost" onClick={() => removeMember.mutate(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isOwner && invites && invites.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold">Convites pendentes</h2>
          <ul className="mt-3 space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>{i.email} · <Badge variant="outline">{i.role}</Badge></span>
                <span className="text-xs text-muted-foreground">{i.accepted_at ? "aceito" : "pendente"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
