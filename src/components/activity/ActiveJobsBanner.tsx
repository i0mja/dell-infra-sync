import { useState } from "react";
import { X, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface Job {
  id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  created_at: string;
}

interface ActiveJobsBannerProps {
  jobs: Job[];
}

export const ActiveJobsBanner = ({ jobs }: ActiveJobsBannerProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const navigate = useNavigate();

  if (isDismissed || jobs.length === 0) {
    return null;
  }

  const runningJobs = jobs.filter(j => j.status === 'running').length;
  const pendingJobs = jobs.filter(j => j.status === 'pending').length;

  const getJobTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      firmware_update: "Firmware Update",
      discovery_scan: "Discovery Scan",
      vcenter_sync: "vCenter Sync",
      full_server_update: "Full Server Update",
      test_credentials: "Test Credentials",
      power_action: "Power Action",
      health_check: "Health Check",
      fetch_event_logs: "Fetch Event Logs",
      boot_configuration: "Boot Config",
      virtual_media_mount: "Virtual Media Mount",
      virtual_media_unmount: "Virtual Media Unmount",
      bios_config_read: "BIOS Config Read",
      bios_config_write: "BIOS Config Write",
      scp_export: "SCP Export",
      scp_import: "SCP Import",
      openmanage_sync: "OpenManage Sync",
      cluster_safety_check: "Cluster Safety Check",
      prepare_host_for_update: "Prepare Host",
      verify_host_after_update: "Verify Host",
      rolling_cluster_update: "Rolling Cluster Update",
      server_group_safety_check: "Server Group Safety Check"
    };
    return labels[type] || type;
  };

  const formatDuration = (startedAt: string | null, createdAt: string) => {
    const start = startedAt ? new Date(startedAt) : new Date(createdAt);
    const now = new Date();
    const diff = Math.floor((now.getTime() - start.getTime()) / 1000);
    
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="font-semibold text-sm">
              ACTIVE JOBS ({jobs.length})
            </span>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>Running: {runningJobs}</span>
            <span>•</span>
            <span>Pending: {pendingJobs}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate('/maintenance-planner')}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View All
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsDismissed(true)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="px-4 pb-3 space-y-2">
          {jobs.slice(0, 3).map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-3 text-sm bg-background/50 rounded px-3 py-2"
            >
              <Badge 
                variant="outline"
                className={job.status === 'running' 
                  ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                  : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                }
              >
                {job.status}
              </Badge>
              <span className="flex-1">{getJobTypeLabel(job.job_type)}</span>
              {job.status === 'running' && (
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDuration(job.started_at, job.created_at)}
                </span>
              )}
            </div>
          ))}
          {jobs.length > 3 && (
            <div className="text-xs text-muted-foreground text-center pt-1">
              +{jobs.length - 3} more jobs
            </div>
          )}
        </div>
      )}
    </div>
  );
};
