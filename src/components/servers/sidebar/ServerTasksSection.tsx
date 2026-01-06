import { CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface ServerTasksSectionProps {
  serverId: string;
}

export function ServerTasksSection({ serverId }: ServerTasksSectionProps) {
  const navigate = useNavigate();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["server-tasks", serverId],
    queryFn: async () => {
      // Get recent job tasks for this server with parent job status
      const { data } = await supabase
        .from("job_tasks")
        .select(`
          id,
          status,
          completed_at,
          started_at,
          created_at,
          job:jobs(id, job_type, status)
        `)
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(4);

      return data || [];
    },
    staleTime: 30000,
  });

  type TaskWithJob = {
    id: string;
    status: string;
    completed_at: string | null;
    started_at: string | null;
    created_at: string;
    job: { id: string; job_type: string; status: string } | null;
  };

  const getStatusIcon = (task: TaskWithJob) => {
    // Check if task is "running" but parent job is in a terminal state
    const terminalJobStates = ["completed", "cancelled", "failed"];
    const isStaleRunning = 
      task.status === "running" && 
      task.job?.status && 
      terminalJobStates.includes(task.job.status);
    
    if (isStaleRunning) {
      // Show as stale/pending since parent job is done
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }

    switch (task.status) {
      case "completed":
        return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
      case "failed":
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "running":
        return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const formatJobType = (type: string) => {
    return type
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const handleViewAll = () => {
    navigate(`/activity?server=${serverId}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Tasks
        </h4>
        <div className="flex items-center gap-2 py-2 px-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Loading tasks...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Tasks
        </h4>
        {tasks && tasks.length > 0 && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={handleViewAll}
          >
            View All
          </Button>
        )}
      </div>

      {!tasks || tasks.length === 0 ? (
        <div className="flex items-center gap-2 py-2 px-2 rounded-md bg-muted/30 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>No recent tasks</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
            >
              {getStatusIcon(task as TaskWithJob)}
              <span className="flex-1 truncate text-foreground">
                {task.job?.job_type ? formatJobType(task.job.job_type) : "Task"}
              </span>
              <span className="text-muted-foreground flex-shrink-0">
                {formatDistanceToNow(new Date(task.completed_at || task.created_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
