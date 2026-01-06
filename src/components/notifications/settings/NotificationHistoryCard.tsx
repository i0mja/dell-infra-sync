import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { History, RefreshCw, ChevronDown, Mail, MessageSquare, Bell, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

import type { Json } from '@/integrations/supabase/types';

interface NotificationLog {
  id: string;
  notification_type: string;
  status: string;
  created_at: string;
  job_id: string | null;
  error_message: string | null;
  severity: string | null;
  is_test: boolean;
  delivery_details: Json | null;
}

export function NotificationHistoryCard() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('notification_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (channelFilter !== 'all') {
        query = query.eq('notification_type', channelFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error('Failed to load notification logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [channelFilter, statusFilter]);

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'email':
        return <Mail className="h-4 w-4 text-blue-500" />;
      case 'teams':
        return <MessageSquare className="h-4 w-4 text-purple-500" />;
      case 'cluster_safety_alert':
        return <Bell className="h-4 w-4 text-orange-500" />;
      case 'sla_violation_alert':
        return <Clock className="h-4 w-4 text-red-500" />;
      case 'maintenance_reminder':
        return <Bell className="h-4 w-4 text-blue-400" />;
      case 'job_notification':
        return <Bell className="h-4 w-4 text-green-500" />;
      default:
        return <Bell className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
      case 'sent':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Delivered
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            {status}
          </Badge>
        );
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <History className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Notification History</CardTitle>
              <CardDescription>
                Recent notification delivery attempts
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex gap-3">
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="teams">Teams</SelectItem>
              <SelectItem value="cluster_safety_alert">Cluster Safety</SelectItem>
              <SelectItem value="sla_violation_alert">SLA Violation</SelectItem>
              <SelectItem value="maintenance_reminder">Maintenance</SelectItem>
              <SelectItem value="job_notification">Job Notification</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Log List */}
        <ScrollArea className="h-[400px] rounded-lg border">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <History className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No notifications found</p>
              <p className="text-xs">Notifications will appear here once sent</p>
            </div>
          ) : (
            <div className="divide-y">
              {logs.map((log) => (
                <Collapsible
                  key={log.id}
                  open={expandedId === log.id}
                  onOpenChange={(open) => setExpandedId(open ? log.id : null)}
                >
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-muted">
                          {getChannelIcon(log.notification_type)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium capitalize">
                              {log.notification_type}
                            </span>
                            {log.is_test && (
                              <Badge variant="secondary" className="text-xs">
                                Test
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(log.status)}
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === log.id ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 pt-0">
                      <div className="p-3 rounded-lg bg-muted/50 space-y-2 text-xs">
                        {log.job_id && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Job ID:</span>
                            <span className="font-mono">{log.job_id.slice(0, 8)}...</span>
                          </div>
                        )}
                        {log.severity && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Severity:</span>
                            <span className="capitalize">{log.severity}</span>
                          </div>
                        )}
                        {log.error_message && (
                          <div className="pt-2 border-t">
                            <span className="text-muted-foreground">Error:</span>
                            <p className="mt-1 text-destructive">{log.error_message}</p>
                          </div>
                        )}
                        {log.delivery_details && (
                          <div className="pt-2 border-t">
                            <span className="text-muted-foreground">Details:</span>
                            <pre className="mt-1 p-2 rounded bg-background overflow-x-auto">
                              {JSON.stringify(log.delivery_details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
