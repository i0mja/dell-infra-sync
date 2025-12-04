import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, RefreshCw, Search, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { logActivityDirect } from "@/hooks/useActivityLog";

interface EventLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname?: string;
  };
}

interface EventLog {
  id: string;
  event_id?: string;
  timestamp: string;
  severity?: string;
  message?: string;
  category?: string;
  sensor_type?: string;
}

export function EventLogDialog({ open, onOpenChange, server }: EventLogDialogProps) {
  const [events, setEvents] = useState<EventLog[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EventLog[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  useEffect(() => {
    if (open) {
      fetchEventLogs();
    }
  }, [open, server.id]);

  useEffect(() => {
    filterEvents();
  }, [events, searchQuery, severityFilter]);

  const fetchEventLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('server_event_logs')
        .select('*')
        .eq('server_id', server.id)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) throw error;
      setEvents(data || []);
    } catch (error: any) {
      console.error('Error fetching event logs:', error);
      toast.error('Failed to fetch event logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'fetch_event_logs',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { limit: 100 }
        });

      if (jobError) throw jobError;

      toast.success('Event log fetch initiated', {
        description: 'New events will be available shortly'
      });

      // Log activity
      logActivityDirect('event_log_fetch', 'server', server.hostname || server.ip_address, {}, { targetId: server.id, success: true });
    } catch (error: any) {
      console.error('Error initiating event log fetch:', error);
      toast.error('Failed to initiate event log fetch', {
        description: error.message
      });

      // Log failed activity
      logActivityDirect('event_log_fetch', 'server', server.hostname || server.ip_address, {}, { targetId: server.id, success: false, error: error.message });
    } finally {
      setIsRefreshing(false);
    }
  };

  const filterEvents = () => {
    let filtered = events;

    if (severityFilter !== "all") {
      filtered = filtered.filter(e => e.severity === severityFilter);
    }

    if (searchQuery) {
      filtered = filtered.filter(e =>
        e.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.category?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredEvents(filtered);
  };

  const getSeverityIcon = (severity?: string) => {
    switch (severity) {
      case 'Critical':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'Warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSeverityBadge = (severity?: string) => {
    const variant = severity === 'Critical' ? 'destructive' : severity === 'Warning' ? 'outline' : 'secondary';
    return <Badge variant={variant}>{severity || 'Info'}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            System Event Log
          </DialogTitle>
          <DialogDescription>
            {server.hostname || server.ip_address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Filters and Refresh */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>

            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="Critical">Critical</SelectItem>
                <SelectItem value="Warning">Warning</SelectItem>
                <SelectItem value="OK">OK</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              size="icon"
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Event Log Table */}
          <div className="flex-1 overflow-auto border rounded-lg">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading event logs...
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-4">No event logs found</p>
                {events.length === 0 && (
                  <Button onClick={handleRefresh} disabled={isRefreshing}>
                    Fetch Event Logs
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead className="w-[100px]">Severity</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-[150px]">Category</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{getSeverityIcon(event.severity)}</TableCell>
                      <TableCell className="text-xs">
                        {format(new Date(event.timestamp), 'MMM dd, HH:mm:ss')}
                      </TableCell>
                      <TableCell>{getSeverityBadge(event.severity)}</TableCell>
                      <TableCell className="text-sm">{event.message}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {event.category}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Footer Info */}
          <div className="text-xs text-muted-foreground text-center">
            Showing {filteredEvents.length} of {events.length} events
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}