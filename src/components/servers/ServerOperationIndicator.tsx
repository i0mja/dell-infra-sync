import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useServerOperations, operationLabels, OperationType } from "@/contexts/ServerOperationsContext";

interface ServerOperationIndicatorProps {
  serverId: string;
  refreshing?: boolean;
  testing?: boolean;
  hasActiveHealthCheck?: boolean;
  className?: string;
}

export function ServerOperationIndicator({ 
  serverId, 
  refreshing,
  testing,
  hasActiveHealthCheck,
  className 
}: ServerOperationIndicatorProps) {
  const { getActiveOperations } = useServerOperations();
  
  // Combine context operations with prop-based loading states
  const contextOps = getActiveOperations(serverId);
  const activeOps: string[] = [...contextOps];
  
  // Add prop-based states (legacy support during transition)
  if (refreshing && !activeOps.includes("refresh")) {
    activeOps.push("refresh");
  }
  if (testing && !activeOps.includes("test")) {
    activeOps.push("test");
  }
  if (hasActiveHealthCheck && !activeOps.includes("health")) {
    activeOps.push("health");
  }
  
  if (activeOps.length === 0) return null;
  
  // Show first operation with spinner
  const primaryOp = activeOps[0] as OperationType;
  const label = operationLabels[primaryOp] || primaryOp;
  
  return (
    <Badge 
      variant="outline" 
      className={`gap-1 text-xs animate-pulse bg-primary/5 ${className || ""}`}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      {label}
      {activeOps.length > 1 && (
        <span className="text-muted-foreground">+{activeOps.length - 1}</span>
      )}
    </Badge>
  );
}
