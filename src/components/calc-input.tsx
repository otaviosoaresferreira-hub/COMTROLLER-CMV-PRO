import * as React from "react";
import { Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Avalia uma expressão matemática simples e segura.
 * Aceita dígitos, operadores + - * / ( ) , . e espaços.
 * Vírgula é tratada como separador decimal (PT-BR).
 * Retorna número finito ou null.
 */
export function evalExpression(raw: string): number | null {
  if (!raw) return null;
  const expr = raw.replace(/,/g, ".").trim();
  if (!expr) return null;
  // whitelist
  if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${expr});`);
    const v = fn();
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** Detecta se o texto contém um operador (logo, é uma expressão a avaliar). */
export function looksLikeExpression(s: string): boolean {
  return /[+\-*/()]/.test(s.replace(/^-/, "")); // ignora sinal de negativo inicial
}

type CalcInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onValueChange: (next: string) => void;
  /** Casa decimais para arredondar o resultado ao aplicar (padrão 3). */
  decimals?: number;
  /** Permite negativos? Padrão false (estoque). */
  allowNegative?: boolean;
  /** Classe extra no wrapper. */
  wrapperClassName?: string;
};

/**
 * Input numérico com calculadora flutuante (Popover) e suporte a expressões.
 * - Digite uma expressão (ex.: "10*12+5") e pressione Enter ou desfoque para avaliar.
 * - No mobile, use o ícone de calculadora para abrir o teclado.
 */
export function CalcInput({
  value,
  onValueChange,
  decimals = 3,
  allowNegative = false,
  className,
  wrapperClassName,
  onBlur,
  onKeyDown,
  ...inputProps
}: CalcInputProps) {
  const [open, setOpen] = React.useState(false);
  const [calcExpr, setCalcExpr] = React.useState("");

  const round = React.useCallback(
    (n: number) => {
      const f = Math.pow(10, decimals);
      const r = Math.round(n * f) / f;
      return allowNegative ? r : Math.max(0, r);
    },
    [decimals, allowNegative],
  );

  const tryEvaluateInline = React.useCallback(() => {
    if (!looksLikeExpression(value)) return;
    const r = evalExpression(value);
    if (r !== null) {
      const final = round(r);
      // Usa vírgula PT-BR sem zeros desnecessários
      const str = String(final).replace(".", ",");
      onValueChange(str);
    }
  }, [value, round, onValueChange]);

  // Resultado em tempo real do popover
  const calcResult = React.useMemo(() => evalExpression(calcExpr), [calcExpr]);

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      // Pré-popula com o valor atual se for número simples
      setCalcExpr(value || "");
    }
  };

  const apply = () => {
    if (calcResult === null) return;
    const final = round(calcResult);
    onValueChange(String(final).replace(".", ","));
    setOpen(false);
  };

  const append = (token: string) => setCalcExpr((c) => c + token);
  const backspace = () => setCalcExpr((c) => c.slice(0, -1));
  const clearAll = () => setCalcExpr("");

  const isExpr = looksLikeExpression(value);

  return (
    <div className={cn("relative inline-block", wrapperClassName)}>
      <Input
        {...inputProps}
        // Forçamos type=text para permitir expressões como "10*12+5"
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onBlur={(e) => {
          tryEvaluateInline();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            tryEvaluateInline();
          }
          onKeyDown?.(e);
        }}
        className={cn("pr-9", isExpr && "font-mono", className)}
      />
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Abrir calculadora"
            tabIndex={-1}
          >
            <Calculator className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          className="w-64 p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="space-y-2">
            <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <input
                autoFocus
                value={calcExpr}
                onChange={(e) => setCalcExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    apply();
                  }
                }}
                className="w-full bg-transparent text-right font-mono text-sm outline-none"
                placeholder="ex.: 10*12+5"
              />
              <div className="text-right text-lg font-semibold tabular-nums">
                {calcResult === null
                  ? "—"
                  : round(calcResult).toLocaleString("pt-BR", {
                      maximumFractionDigits: decimals,
                    })}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                ["7", "8", "9", "/"],
                ["4", "5", "6", "*"],
                ["1", "2", "3", "-"],
                ["0", ".", "(", "+"],
              ].map((row, i) => (
                <React.Fragment key={i}>
                  {row.map((k) => {
                    const isOp = "+-*/".includes(k);
                    return (
                      <Button
                        key={k}
                        type="button"
                        variant={isOp ? "secondary" : "outline"}
                        size="sm"
                        className="h-9"
                        onClick={() => append(k)}
                      >
                        {k}
                      </Button>
                    );
                  })}
                </React.Fragment>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => append(")")}
              >
                )
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={backspace}
              >
                ←
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={clearAll}
              >
                C
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-9"
                onClick={apply}
                disabled={calcResult === null}
              >
                =
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Dica: você também pode digitar a expressão direto no campo e
              pressionar Enter.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
