import { Clock, Loader2, FileText, Server, Zap, Activity } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { Database } from '@/integrations/supabase/types';
import type { JobProgress } from '@/hooks/useNotificationCenter';
import { cn } from '@/lib/utils';

type Job = Database['public']['Tables']['jobs']['Row'];

interface ActiveJobCardProps {
  job: Job;
  progress?: JobProgress;
  onClick: () => void;
}

const jobTypeIcons: Record<string, React.ElementType> = {
  firmware_update: Zap,
  discovery_scan: Activity,
  full_server_update: Server,
  power_action: Zap,
  health_check: Activity,
  fetch_event_logs: FileText,
  scp_export: FileText,
  scp_import: FileText,
};

const jobTypeLabels: Record<string, string> = {
  firmware_update: 'Firmware Update',
  discovery_scan: 'Discovery Scan',
  full_server_update: 'Full Server Update',
  power_action: 'Power Action',
  health_check: 'Health Check',
  fetch_event_logs: 'Event Logs',
  scp_export: 'SCP Export',
  scp_import: 'SCP Import',
  boot_configuration: 'Boot Config',
  virtual_media_mount: 'Virtual Media',
  bios_config_read: 'BIOS Read',
  bios_config_write: 'BIOS Write',
  idrac_network_read: 'iDRAC Network Read',
  idrac_network_write: 'iDRAC Network Write',
  rolling_cluster_update: 'Rolling Cluster Update',
  vcenter_sync: 'vCenter Sync',
  test_credentials: 'Credential Test',
  refresh_existing_servers: 'Server Refresh',
};

export function ActiveJobCard({ job, progress, onClick }: ActiveJobCardProps) {
  const Icon = jobTypeIcons[job.job_type] || FileText;
  const label = jobTypeLabels[job.job_type] || job.job_type.replace(/_/g, ' ');
  
  const targetScope = job.target_scope as any;
  const serverIds = targetScope?.server_ids || [];
  const serverCount = serverIds.length;
  
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isActive = job.status === 'running' || job.status === 'pending';
  
  const statusColor = isActive 
    ? 'bg-primary' 
    : isCompleted 
    ? 'bg-green-600' 
    : isFailed 
    ? 'bg-destructive' 
    : 'bg-muted';
  
  const borderColor = isActive 
    ? 'border-l-primary' 
    : isCompleted 
    ? 'border-l-green-600' 
    : isFailed 
    ? 'border-l-destructive' 
    : 'border-l-muted';
  
  const badgeVariant = isActive 
    ? 'default' 
    : isCompleted 
    ? 'outline' 
    : isFailed 
    ? 'destructive' 
    : 'secondary';
  
  return (
    <Card
      className={cn(
        "p-3 cursor-pointer transition-all hover:bg-accent/50 border-l-4",
        borderColor,
        !isActive && "opacity-80"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-2 rounded-lg", statusColor)}>
          <Icon className="h-4 w-4 text-primary-foreground" />
        </div>
        
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm truncate">{label}</p>
            <Badge variant={badgeVariant} className={cn("text-xs", isCompleted && "text-green-600 border-green-600")}>
              {isCompleted ? 'Just completed' : isFailed ? 'Failed' : job.status}
            </Badge>
          </div>
          
          {serverCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {serverCount === 1 ? '1 server' : `${serverCount} servers`}
            </p>
          )}
          
          {progress && isActive && (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {progress.completedTasks}/{progress.totalTasks} tasks
                  </span>
                  <span className="font-medium">
                    {Math.round(progress.progressPercent)}%
                  </span>
                </div>
                <Progress value={progress.progressPercent} className="h-1.5" />
              </div>
              
              <p className="text-xs text-muted-foreground truncate">
                {progress.currentStatus}
              </p>
            </>
          )}
          
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              {isCompleted || isFailed 
                ? `Finished ${progress?.elapsedTime || 'just now'}` 
                : progress?.elapsedTime || 'Starting...'}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
