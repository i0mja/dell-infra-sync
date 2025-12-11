/**
 * RefreshButton
 * 
 * Small refresh button for manual sync next to dropdowns
 */

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface RefreshButtonProps {
  onClick: () => void;
  isRefreshing: boolean;
  tooltip?: string;
  className?: string;
  size?: "sm" | "icon";
}

export function RefreshButton({ 
  onClick, 
  isRefreshing, 
  tooltip = "Refresh",
  className,
  size = "icon"
}: RefreshButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={onClick}
          disabled={isRefreshing}
          className={cn("h-8 w-8 shrink-0", className)}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{isRefreshing ? "Syncing..." : tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
