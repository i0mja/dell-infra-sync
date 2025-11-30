import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink } from "lucide-react";

interface BackendStatusHelperProps {
  show: boolean;
}

export const BackendStatusHelper = ({ show }: BackendStatusHelperProps) => {
  if (!show) return null;

  return (
    <Alert className="border-amber-500/50 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertDescription className="space-y-3">
        <div className="text-sm">
          <strong className="text-foreground">Backend Service Not Responding</strong>
          <p className="text-muted-foreground mt-1">
            The backend service is not responding. This may indicate:
          </p>
          <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
            <li>Job Executor service is not running</li>
            <li>Network connectivity issues</li>
            <li>Service configuration problems</li>
          </ul>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open('/activity', '_blank')}
            className="gap-2"
          >
            <ExternalLink className="h-3 w-3" />
            View Activity Monitor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open('/maintenance-planner?tab=jobs', '_blank')}
            className="gap-2"
          >
            <ExternalLink className="h-3 w-3" />
            View Jobs
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          💡 Check system services and network connectivity in Settings → System & Monitoring
        </p>
      </AlertDescription>
    </Alert>
  );
};
