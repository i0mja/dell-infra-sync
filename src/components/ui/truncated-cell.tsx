import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TruncatedCellProps {
  value: string | null | undefined;
  maxWidth?: string;
  className?: string;
}

export function TruncatedCell({ value, maxWidth = "180px", className }: TruncatedCellProps) {
  if (!value) return <span className={cn("text-muted-foreground", className)}>-</span>;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span
            className={cn("truncate block cursor-help", className)}
            style={{ maxWidth }}
          >
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[400px] break-words">
          <p>{value}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
