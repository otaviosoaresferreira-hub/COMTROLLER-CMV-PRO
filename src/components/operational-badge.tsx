import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface OperationalBadgeProps {
  className?: string;
  /** Tamanho do ícone em px. Default 14 */
  size?: number;
}

/**
 * Selo visual exibido ao lado do nome de Insumos Operacionais
 * (custo zero / estoque infinito) com tooltip explicativo.
 */
export function OperationalBadge({ className, size = 14 }: OperationalBadgeProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-muted-foreground hover:text-foreground",
              className,
            )}
            aria-label="Insumo operacional"
            onClick={(e) => e.stopPropagation()}
          >
            <Info style={{ width: size, height: size }} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          Este é um insumo operacional. Ele possui custo zero e estoque
          infinito, sendo utilizado apenas para compor o peso e o rendimento
          real das porções.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
