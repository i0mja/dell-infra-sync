import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { Calendar, Clock, User, CheckCircle, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNextExecutionsFromConfig } from "@/lib/cron-utils";

interface OverviewTabProps {
  window: any;
  onUpdate?: () => void;
}

export function OverviewTab({ window, onUpdate }: OverviewTabProps) {
  const { data: creator } = useQuery({
    queryKey: ['profile', window.created_by],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', window.created_by)
        .single();
      return data;
    }
  });

  const { data: approver } = useQuery({
    queryKey: ['profile', window.approved_by],
    queryFn: async () => {
      if (!window.approved_by) return null;
      const { data } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', window.approved_by)
        .single();
      return data;
    },
    enabled: !!window.approved_by
  });

  const getNextRun = () => {
    if (window.status === 'completed' || window.status === 'failed') {
      return null;
    }

    if (window.recurrence_enabled && window.recurrence_pattern) {
      try {
        const recurrenceConfig = JSON.parse(window.recurrence_pattern);
        const nextRuns = getNextExecutionsFromConfig(recurrenceConfig, new Date(window.planned_start), 1);
        return nextRuns[0];
      } catch (error) {
        console.error('Error parsing recurrence pattern:', error);
      }
    }

    return new Date(window.planned_start);
  };

  const nextRun = getNextRun();
  const isUpcoming = nextRun && nextRun > new Date();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1">Type</div>
            <Badge variant="outline" className="capitalize">
              {window.maintenance_type.replace('_', ' ')}
            </Badge>
          </div>

          {window.description && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Description</div>
              <p className="text-sm">{window.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                <User className="w-3 h-3" />
                Created By
              </div>
              <p className="text-sm">
                {creator?.full_name || creator?.email || 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(window.created_at), 'PPp')}
              </p>
            </div>

            {window.requires_approval && window.approved_by && (
              <div>
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Approved By
                </div>
                <p className="text-sm">
                  {approver?.full_name || approver?.email || 'Unknown'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(window.approved_at), 'PPp')}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {window.auto_execute && (
              <Badge variant="outline" className="gap-1">
                <CheckCircle className="w-3 h-3" />
                Auto-Execute
              </Badge>
            )}
            {window.requires_approval && !window.approved_by && (
              <Badge variant="outline" className="gap-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                <AlertCircle className="w-3 h-3" />
                Requires Approval
              </Badge>
            )}
            {window.notification_sent && (
              <Badge variant="outline">
                Notification Sent
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {isUpcoming && nextRun && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <div className="font-medium mb-1">Next Scheduled Run</div>
                <div className="text-2xl font-semibold mb-1">
                  {format(nextRun, 'PPp')}
                </div>
                <div className="text-sm text-muted-foreground">
                  Starts {formatDistanceToNow(nextRun, { addSuffix: true })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {window.last_executed_at && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last Execution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">
                {format(new Date(window.last_executed_at), 'PPp')}
              </span>
              <span className="text-sm text-muted-foreground">
                ({formatDistanceToNow(new Date(window.last_executed_at), { addSuffix: true })})
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {window.safety_check_snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Safety Check Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Total Hosts:</span>{' '}
              {window.safety_check_snapshot.total_hosts}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Healthy Hosts:</span>{' '}
              {window.safety_check_snapshot.healthy_hosts}
            </div>
            {window.safety_check_snapshot.drs_enabled !== undefined && (
              <div className="text-sm">
                <span className="text-muted-foreground">DRS:</span>{' '}
                {window.safety_check_snapshot.drs_enabled ? 'Enabled' : 'Disabled'}
              </div>
            )}
            {window.safety_check_snapshot.ha_enabled !== undefined && (
              <div className="text-sm">
                <span className="text-muted-foreground">HA:</span>{' '}
                {window.safety_check_snapshot.ha_enabled ? 'Enabled' : 'Disabled'}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
