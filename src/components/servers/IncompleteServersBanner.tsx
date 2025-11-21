import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, X } from "lucide-react";

interface IncompleteServersBannerProps {
  count: number;
  onRefreshAll: () => void;
  onDismiss: () => void;
  refreshing: boolean;
}

export function IncompleteServersBanner({
  count,
  onRefreshAll,
  onDismiss,
  refreshing,
}: IncompleteServersBannerProps) {
  return (
    <Alert variant="default" className="border-orange-500/50 bg-orange-500/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-orange-500" />
          <AlertDescription>
            <span className="font-semibold">{count}</span> server{count !== 1 ? 's' : ''} missing hardware details
          </AlertDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshAll}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh All
          </Button>
          <Button variant="ghost" size="icon" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Alert>
  );
}
