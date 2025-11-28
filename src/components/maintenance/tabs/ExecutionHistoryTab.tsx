import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExecutionHistoryTabProps {
  window: any;
}

export function ExecutionHistoryTab({ window }: ExecutionHistoryTabProps) {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ['maintenance-window-jobs', window.id],
    queryFn: async () => {
      // Get jobs linked to this maintenance window via job_ids array
      if (!window.job_ids || window.job_ids.length === 0) {
        return [];
      }

      const { data } = await supabase
        .from('jobs')
        .select('*')
        .in('id', window.job_ids)
        .order('created_at', { ascending: false });
      
      return data || [];
    }
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running':
        return <Clock className="w-4 h-4 text-blue-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      'pending': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      'running': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      'completed': 'bg-green-500/10 text-green-500 border-green-500/20',
      'failed': 'bg-red-500/10 text-red-500 border-red-500/20',
      'cancelled': 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    };

    return (
      <Badge className={colors[status] || ''}>
        {status}
      </Badge>
    );
  };

  const calculateDuration = (startedAt: string | null, completedAt: string | null) => {
    if (!startedAt || !completedAt) return '-';

    const duration = intervalToDuration({
      start: new Date(startedAt),
      end: new Date(completedAt)
    });

    return formatDuration(duration, {
      format: ['hours', 'minutes', 'seconds']
    });
  };

  const successfulRuns = jobs?.filter(j => j.status === 'completed').length || 0;
  const totalRuns = jobs?.length || 0;
  const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading execution history...
        </CardContent>
      </Card>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No execution history yet. This maintenance window has not been run.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Total Executions</div>
              <div className="text-2xl font-bold">{totalRuns}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Successful</div>
              <div className="text-2xl font-bold text-green-500">{successfulRuns}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Success Rate</div>
              <div className="text-2xl font-bold">
                {successRate}%
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    {format(new Date(job.created_at), 'PPp')}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {job.job_type.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {calculateDuration(job.started_at, job.completed_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      {getStatusBadge(job.status)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => {
                        // This would open the JobDetailDialog
                        // We'll need to pass this up or use a global state
                        console.log('View job details:', job.id);
                      }}
                    >
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
