import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, ArrowRight, Clock, PlayCircle } from "lucide-react";
import { Link } from "react-router-dom";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_at: string;
  started_at: string | null;
}

interface ActiveOperationsPanelProps {
  jobs: Job[];
  onJobClick: (job: Job) => void;
}

export function ActiveOperationsPanel({ jobs, onJobClick }: ActiveOperationsPanelProps) {
  if (jobs.length === 0) {
    return null;
  }

  const getJobTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      firmware_update: "Firmware Update",
      discovery_scan: "Discovery Scan",
      vcenter_sync: "vCenter Sync",
      full_server_update: "Full Server Update",
      cluster_safety_check: "Safety Check",
    };
    return labels[type] || type;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Active Operations
            </CardTitle>
            <CardDescription>
              Jobs currently running or pending execution
            </CardDescription>
          </div>
          <Button variant="outline" asChild>
            <Link to="/maintenance-planner?view=all-jobs">
              View All
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.slice(0, 5).map((job) => (
          <div
            key={job.id}
            onClick={() => onJobClick(job)}
            className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              {job.status === 'running' ? (
                <PlayCircle className="h-5 w-5 text-primary animate-pulse" />
              ) : (
                <Clock className="h-5 w-5 text-warning" />
              )}
              <div>
                <p className="font-medium">{getJobTypeLabel(job.job_type)}</p>
                <p className="text-sm text-muted-foreground">
                  Started {new Date(job.started_at || job.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <Badge variant={job.status === 'running' ? 'default' : 'outline'}>
              {job.status}
            </Badge>
          </div>
        ))}
        
        {jobs.length > 5 && (
          <p className="text-sm text-muted-foreground text-center pt-2">
            +{jobs.length - 5} more active jobs
          </p>
        )}
      </CardContent>
    </Card>
  );
}
