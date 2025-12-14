import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, 
  Camera, 
  Send, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Server,
  HardDrive
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow, format } from "date-fns";

interface TimelineEvent {
  id: string;
  type: 'snapshot' | 'send_start' | 'send_complete' | 'sync_complete' | 'error';
  vm_name?: string;
  group_name?: string;
  bytes_transferred?: number;
  transfer_rate?: number;
  timestamp: string;
  message: string;
  success: boolean;
}

export function ReplicationActivityTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecentEvents = async () => {
    try {
      // Fetch recent completed replication jobs
      const { data: jobs, error } = await supabase
        .from('replication_jobs')
        .select('*')
        .in('status', ['completed', 'failed'])
        .order('completed_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const timelineEvents: TimelineEvent[] = [];

      for (const job of jobs || []) {
        const vmSyncDetails = (job.details as any)?.vm_sync_details || [];
        
        // Add per-VM sync events
        for (const vm of vmSyncDetails) {
          timelineEvents.push({
            id: `${job.id}-${vm.vm_name}`,
            type: vm.success ? 'send_complete' : 'error',
            vm_name: vm.vm_name,
            bytes_transferred: vm.bytes_transferred,
            transfer_rate: vm.transfer_rate_mbps,
            timestamp: job.completed_at || job.updated_at,
            message: vm.success 
              ? `Synced ${formatBytes(vm.bytes_transferred)}` 
              : 'Sync failed',
            success: vm.success
          });
        }

        // Add overall job completion event
        if (job.status === 'completed') {
          timelineEvents.push({
            id: job.id,
            type: 'sync_complete',
            group_name: (job.details as any)?.protection_group_name,
            bytes_transferred: job.bytes_transferred || 0,
            timestamp: job.completed_at || job.updated_at,
            message: `Sync complete - ${formatBytes(job.bytes_transferred || 0)} transferred`,
            success: true
          });
        } else if (job.status === 'failed') {
          timelineEvents.push({
            id: job.id,
            type: 'error',
            group_name: (job.details as any)?.protection_group_name,
            timestamp: job.completed_at || job.updated_at,
            message: job.error_message || 'Sync failed',
            success: false
          });
        }
      }

      // Sort by timestamp desc and take top 15
      timelineEvents.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      setEvents(timelineEvents.slice(0, 15));
    } catch (error) {
      console.error('Error fetching timeline events:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecentEvents();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('replication-timeline')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'replication_jobs' },
        () => {
          fetchRecentEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getEventIcon = (event: TimelineEvent) => {
    switch (event.type) {
      case 'snapshot':
        return <Camera className="h-4 w-4 text-blue-500" />;
      case 'send_start':
        return <Send className="h-4 w-4 text-amber-500" />;
      case 'send_complete':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'sync_complete':
        return <HardDrive className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Replication Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Clock className="h-5 w-5 animate-pulse text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Replication Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No recent replication activity
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Replication Activity
          <Badge variant="secondary" className="ml-auto">{events.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="p-4 space-y-3">
            {events.map((event, idx) => (
              <div 
                key={event.id} 
                className="flex items-start gap-3 relative"
              >
                {/* Timeline line */}
                {idx < events.length - 1 && (
                  <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border h-[calc(100%+12px)]" />
                )}
                
                {/* Icon */}
                <div className="relative z-10 p-1 bg-background rounded-full border">
                  {getEventIcon(event)}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {event.vm_name && (
                      <span className="text-sm font-medium flex items-center gap-1">
                        <Server className="h-3 w-3" />
                        {event.vm_name}
                      </span>
                    )}
                    {event.group_name && !event.vm_name && (
                      <Badge variant="outline" className="text-xs">
                        {event.group_name}
                      </Badge>
                    )}
                  </div>
                  <p className={`text-sm ${event.success ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {event.message}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </span>
                    {event.transfer_rate && event.transfer_rate > 0 && (
                      <span className="text-xs text-green-600">
                        @ {event.transfer_rate.toFixed(1)} MB/s
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}