import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Server, Clock, CheckCircle, XCircle, Loader2, Download, AlertCircle } from "lucide-react";

interface IdracJob {
  id: string;
  name: string;
  job_state: string;
  percent_complete: number;
  message?: string;
  job_type?: string;
  start_time?: string;
  end_time?: string;
}

interface IdracJobQueuePanelProps {
  jobs: IdracJob[];
  updatedAt?: string;
  serverIp?: string;
}

export const IdracJobQueuePanel = ({ jobs, updatedAt, serverIp }: IdracJobQueuePanelProps) => {
  const getStatusIcon = (state: string) => {
    switch (state?.toLowerCase()) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'scheduled':
      case 'new':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'downloaded':
        return <Download className="h-4 w-4 text-purple-500" />;
      case 'waiting':
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (state: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (state?.toLowerCase()) {
      case 'completed':
        return 'default';
      case 'running':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  if (!jobs || jobs.length === 0) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="pt-6 text-center text-muted-foreground text-sm">
          No active jobs in iDRAC queue
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            iDRAC Job Queue
            {serverIp && (
              <span className="font-mono text-xs text-muted-foreground">
                ({serverIp})
              </span>
            )}
          </CardTitle>
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(updatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="p-3 rounded-lg bg-background/80 border border-border/50 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {getStatusIcon(job.job_state)}
                <span className="font-mono text-xs text-muted-foreground">
                  {job.id}
                </span>
              </div>
              <Badge variant={getStatusBadgeVariant(job.job_state)} className="shrink-0">
                {job.job_state} ({job.percent_complete}%)
              </Badge>
            </div>
            <div className="text-sm font-medium truncate">{job.name}</div>
            {job.message && job.message !== job.name && (
              <div className="text-xs text-muted-foreground truncate">
                {job.message}
              </div>
            )}
            {job.job_state?.toLowerCase() === 'running' && (
              <Progress value={job.percent_complete} className="h-1.5" />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
