import { useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, AlertTriangle, Zap, Warehouse, Building2, MapPin } from "lucide-react";
import {
  LOCATION_TYPE_META,
  allowedParentTypes,
  type LocationType,
} from "@/lib/location-hierarchy";

type OperationType = "self_service" | "a_la_carte";
type StockMode = "traditional" | "direct";

type LocationOption = {
  id: string;
  name: string;
  location_type: LocationType;
  parent_id: string | null;
};

export function NewDestinationDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [locationType, setLocationType] = useState<LocationType>("operation");
  const [parentId, setParentId] = useState<string>(""); // "" = sem pai (apenas válido p/ CD)
  const [operationType, setOperationType] = useState<OperationType>("a_la_carte");
  const [stockMode, setStockMode] = useState<StockMode>("traditional");
  const qc = useQueryClient();

  const { data: locations } = useQuery({
    queryKey: ["new-destination-locations"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,location_type,parent_id")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationOption[];
    },
  });

  // Pais possíveis para o tipo escolhido
  const parentCandidates = useMemo(() => {
    if (!locations) return [];
    const allowed = allowedParentTypes(locationType);
    if (allowed.length === 0) return [];
    return locations.filter((l) => allowed.includes(l.location_type));
  }, [locations, locationType]);

  const reset = () => {
    setName("");
    setLocationType("operation");
    setParentId("");
    setOperationType("a_la_carte");
    setStockMode("traditional");
  };

  // Quando muda o tipo, valida o pai
  const handleTypeChange = (t: LocationType) => {
    setLocationType(t);
    if (t === "cd") {
      setParentId("");
    } else if (parentId) {
      const p = locations?.find((l) => l.id === parentId);
      if (!p || !allowedParentTypes(t).includes(p.location_type)) {
        setParentId("");
      }
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe um nome para o local");
      if (trimmed.toLowerCase().includes("central"))
        throw new Error("Esse nome é reservado para o Estoque Central");

      if (locationType !== "cd" && !parentId) {
        throw new Error(
          locationType === "unit"
            ? "Selecione o CD ao qual esta Unidade pertence"
            : "Selecione o CD ou Unidade onde esta Operação fica",
        );
      }

      const { data: existing, error: checkErr } = await supabase
        .from("locations")
        .select("id")
        .ilike("name", trimmed);
      if (checkErr) throw checkErr;
      if (existing && existing.length > 0)
        throw new Error("Já existe um local com esse nome");

      const { error } = await supabase.from("locations").insert({
        name: trimmed,
        location_type: locationType,
        parent_id: locationType === "cd" ? null : parentId,
        // operation_type/stock_mode só fazem sentido para Operação,
        // mas mantemos default seguro nos demais.
        operation_type: locationType === "operation" ? operationType : "a_la_carte",
        stock_mode: locationType === "operation" ? stockMode : "traditional",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const meta = LOCATION_TYPE_META[locationType];
      toast.success(`${meta.short} criado`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["new-destination-locations"] });
      reset();
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isOperation = locationType === "operation";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/40 px-4 py-6 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:bg-primary/5 hover:text-primary"
      >
        <Plus className="h-5 w-5" />
        Adicionar Localização
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Localização</DialogTitle>
            <DialogDescription>
              Defina o tipo, a hierarquia e como esta localização vai consumir o estoque.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* TIPO DE LOCALIZAÇÃO */}
            <div className="space-y-2">
              <Label>Tipo de localização</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["cd", "unit", "operation"] as LocationType[]).map((t) => {
                  const meta = LOCATION_TYPE_META[t];
                  const Icon = meta.icon;
                  const active = locationType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTypeChange(t)}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {meta.short}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {locationType === "cd" &&
                  "Centro de Distribuição: recebe NFs e abastece Unidades/Operações."}
                {locationType === "unit" &&
                  "Unidade/Franquia: recebe transferências do CD e atende suas Operações."}
                {locationType === "operation" &&
                  "Operação/Setor: ponto final onde acontecem vendas, descartes e auditorias."}
              </p>
            </div>

            {/* NOME */}
            <div className="space-y-2">
              <Label htmlFor="dest-name">Nome</Label>
              <Input
                id="dest-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  locationType === "cd"
                    ? "Ex: CD São Paulo"
                    : locationType === "unit"
                      ? "Ex: Unidade Pinheiros"
                      : "Ex: Cozinha Noite, Bar Principal"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !mutation.isPending) mutation.mutate();
                }}
              />
            </div>

            {/* PAI (somente para Unidade/Operação) */}
            {locationType !== "cd" && (
              <div className="space-y-2">
                <Label htmlFor="dest-parent">
                  {locationType === "unit" ? "CD pai" : "Localização pai (CD ou Unidade)"}
                </Label>
                {parentCandidates.length === 0 ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Nenhum {locationType === "unit" ? "CD" : "CD ou Unidade"} cadastrado.
                      Crie primeiro um nível superior.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger id="dest-parent">
                      <SelectValue placeholder="Selecione o pai…" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentCandidates.map((p) => {
                        const Icon =
                          p.location_type === "cd" ? Warehouse : Building2;
                        return (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="inline-flex items-center gap-1.5">
                              <Icon className="h-3.5 w-3.5" />
                              {p.name}
                              <span className="text-[10px] uppercase text-muted-foreground">
                                {LOCATION_TYPE_META[p.location_type].short}
                              </span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* CONFIGURAÇÕES DE OPERAÇÃO (somente para tipo Operação) */}
            {isOperation && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="dest-op-type">Tipo de operação</Label>
                  <Select
                    value={operationType}
                    onValueChange={(v) => setOperationType(v as OperationType)}
                  >
                    <SelectTrigger id="dest-op-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a_la_carte">
                        Operação de Cardápio (vendas individuais)
                      </SelectItem>
                      <SelectItem value="self_service">
                        Operação de Quilo (buffet por peso)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Define como o desperdício será calculado neste local.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-amber-500" />
                        <Label htmlFor="stock-mode" className="text-sm font-semibold">
                          Venda Direta (Estoque Unificado)
                        </Label>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Quando ativo, vendas e baixas saem direto do Estoque Central, sem
                        transferências para esta operação.
                      </p>
                    </div>
                    <Switch
                      id="stock-mode"
                      checked={stockMode === "direct"}
                      onCheckedChange={(c) => setStockMode(c ? "direct" : "traditional")}
                    />
                  </div>

                  {stockMode === "direct" && (
                    <Alert
                      variant="destructive"
                      className="border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle className="text-xs font-semibold">
                        Atenção: rastreabilidade reduzida
                      </AlertTitle>
                      <AlertDescription className="text-xs">
                        No modo Venda Direta, as baixas ocorrem direto no Estoque Central. Isso
                        agiliza o processo, mas reduz a precisão da auditoria, pois não será
                        possível distinguir perdas no centro de produção de perdas na operação
                        final.
                      </AlertDescription>
                    </Alert>
                  )}

                  {stockMode === "traditional" && (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">Modo Tradicional:</span>{" "}
                      insumos precisam ser transferidos do Central para esta operação antes de
                      serem consumidos. Auditoria completa por etapa.
                    </p>
                  )}
                </div>
              </>
            )}

            {!isOperation && (
              <Alert className="border-sky-500/30 bg-sky-500/5">
                <MapPin className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {locationType === "cd"
                    ? "Centros de Distribuição recebem entradas de NF e abastecem Unidades/Operações via transferência."
                    : "Unidades recebem transferências do CD e abastecem Operações filhas. Você poderá adicionar Operações dentro desta Unidade depois de criá-la."}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? "Criando…" : "Criar localização"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
