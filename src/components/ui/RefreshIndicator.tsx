/**
 * RefreshIndicator
 * 
 * Subtle badge showing background sync in progress
 */

import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RefreshIndicatorProps {
  isRefreshing: boolean;
  className?: string;
  label?: string;
}

export function RefreshIndicator({ 
  isRefreshing, 
  className,
  label = "Syncing inventory..."
}: RefreshIndicatorProps) {
  if (!isRefreshing) return null;
  
  return (
    <Badge 
      variant="secondary" 
      className={cn(
        "animate-pulse gap-1.5 text-xs font-normal",
        className
      )}
    >
      <RefreshCw className="h-3 w-3 animate-spin" />
      {label}
    </Badge>
  );
}
