import { AlertTriangle, XCircle, Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Job } from "./JobsTable";
import { useNavigate } from "react-router-dom";

interface StaleJobWarningProps {
  staleJobs: Job[];
  onCancelJobs: (jobIds: string[]) => Promise<void>;
  onDismiss: () => void;
}

export function StaleJobWarning({ staleJobs, onCancelJobs, onDismiss }: StaleJobWarningProps) {
  const navigate = useNavigate();

  if (staleJobs.length === 0) return null;

  const jobTypes = [...new Set(staleJobs.map(j => j.job_type))];

  return (
    <Alert variant="destructive" className="mb-4 border-amber-500 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertTitle className="text-amber-500">Job Executor Not Responding</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        <p className="mb-2">
          {staleJobs.length} job{staleJobs.length > 1 ? "s" : ""} pending for over 60 seconds: {jobTypes.join(", ")}
        </p>
        <p className="text-xs mb-3">
          The Job Executor may not be running. Ensure <code className="bg-muted px-1 rounded">python job-executor.py</code> is running on your host.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500 text-amber-500 hover:bg-amber-500/20"
            onClick={() => onCancelJobs(staleJobs.map(j => j.id))}
          >
            <XCircle className="h-3 w-3 mr-1" />
            Cancel Stale Jobs
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate("/settings/system")}
          >
            <Settings className="h-3 w-3 mr-1" />
            System Health
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
