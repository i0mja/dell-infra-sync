import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Activity, ChevronDown, ChevronRight, Search, RefreshCw, Filter } from "lucide-react";
import { toast } from "sonner";
import { CommandDetailDialog } from "@/components/activity/CommandDetailDialog";
import { format } from "date-fns";

interface IdracCommand {
  id: string;
  timestamp: string;
  server_id: string | null;
  job_id: string | null;
  task_id: string | null;
  command_type: string;
  endpoint: string;
  full_url: string;
  request_headers: any;
  request_body: any;
  status_code: number | null;
  response_time_ms: number;
  response_body: any;
  success: boolean;
  error_message: string | null;
  initiated_by: string | null;
  source: string;
  servers?: { hostname: string | null; ip_address: string };
}

export default function ActivityMonitor() {
  const [commands, setCommands] = useState<IdracCommand[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<IdracCommand | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  
  // Filters
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [commandTypeFilter, setCommandTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("24h");
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch servers for filter dropdown
  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servers')
        .select('id, hostname, ip_address')
        .order('hostname');
      if (error) throw error;
      return data;
    },
  });

  // Calculate time range
  const getTimeRangeDate = () => {
    const now = new Date();
    switch (timeRangeFilter) {
      case '1h': return new Date(now.getTime() - 60 * 60 * 1000);
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      default: return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  };

  // Fetch commands
  const { data: commandsData, refetch } = useQuery({
    queryKey: ['idrac-commands', serverFilter, commandTypeFilter, statusFilter, timeRangeFilter],
    queryFn: async () => {
      let query = supabase
        .from('idrac_commands')
        .select('*, servers(hostname, ip_address)')
        .gte('timestamp', getTimeRangeDate().toISOString())
        .order('timestamp', { ascending: false })
        .limit(500);

      if (serverFilter !== 'all') {
        query = query.eq('server_id', serverFilter);
      }
      if (commandTypeFilter !== 'all') {
        query = query.eq('command_type', commandTypeFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('success', statusFilter === 'success');
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as IdracCommand[];
    },
  });

  useEffect(() => {
    if (commandsData) {
      setCommands(commandsData);
    }
  }, [commandsData]);

  // Set up realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('idrac-commands-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'idrac_commands'
        },
        async (payload) => {
          // Fetch the full record with server info
          const { data } = await supabase
            .from('idrac_commands')
            .select('*, servers(hostname, ip_address)')
            .eq('id', payload.new.id)
            .single();

          if (data) {
            setCommands(prev => [data as IdracCommand, ...prev].slice(0, 500));
            
            if (!data.success) {
              toast.error(`iDRAC Command Failed: ${data.error_message}`);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredCommands = commands.filter(cmd => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      cmd.endpoint.toLowerCase().includes(searchLower) ||
      cmd.full_url.toLowerCase().includes(searchLower) ||
      cmd.error_message?.toLowerCase().includes(searchLower) ||
      cmd.servers?.hostname?.toLowerCase().includes(searchLower) ||
      cmd.servers?.ip_address.toLowerCase().includes(searchLower)
    );
  });

  const getStatusBadge = (success: boolean, statusCode: number | null) => {
    if (success) {
      return <Badge variant="default" className="bg-green-600">{statusCode || 'OK'}</Badge>;
    }
    return <Badge variant="destructive">{statusCode || 'FAIL'}</Badge>;
  };

  const getCommandTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-600',
      POST: 'bg-green-600',
      PATCH: 'bg-yellow-600',
      DELETE: 'bg-red-600',
      network_validation_server: 'bg-purple-600',
      network_validation_vcenter: 'bg-purple-600',
      network_validation_dns: 'bg-purple-600',
    };
    
    const labels: Record<string, string> = {
      network_validation_server: 'NET:SERVER',
      network_validation_vcenter: 'NET:VCENTER',
      network_validation_dns: 'NET:DNS',
    };
    
    return <Badge className={colors[type] || 'bg-gray-600'}>{labels[type] || type}</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Activity Monitor</h1>
            <p className="text-muted-foreground">Live iDRAC command viewer</p>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Filters</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search endpoint, error..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select value={serverFilter} onValueChange={setServerFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Servers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Servers</SelectItem>
              {servers?.map(server => (
                <SelectItem key={server.id} value={server.id}>
                  {server.hostname || server.ip_address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={commandTypeFilter} onValueChange={setCommandTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Command Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
              <SelectItem value="network_validation_server">Network: Server Test</SelectItem>
              <SelectItem value="network_validation_vcenter">Network: vCenter Test</SelectItem>
              <SelectItem value="network_validation_dns">Network: DNS Test</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeRangeFilter} onValueChange={setTimeRangeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last Hour</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Commands Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Command</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Response Time</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCommands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No commands found. Commands will appear here in real-time.
                </TableCell>
              </TableRow>
            ) : (
              filteredCommands.map((cmd) => (
                <>
                  <TableRow 
                    key={cmd.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedRow(expandedRow === cmd.id ? null : cmd.id)}
                  >
                    <TableCell>
                      {expandedRow === cmd.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {format(new Date(cmd.timestamp), 'MMM dd, HH:mm:ss')}
                    </TableCell>
                    <TableCell className="text-sm">
                      {cmd.servers?.hostname || cmd.servers?.ip_address || '-'}
                    </TableCell>
                    <TableCell>{getCommandTypeBadge(cmd.command_type)}</TableCell>
                    <TableCell className="font-mono text-xs max-w-xs truncate">
                      {cmd.endpoint}
                    </TableCell>
                    <TableCell>{getStatusBadge(cmd.success, cmd.status_code)}</TableCell>
                    <TableCell className="text-sm">{cmd.response_time_ms}ms</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {cmd.source}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {expandedRow === cmd.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30 p-4">
                        <div className="space-y-2">
                          <div>
                            <strong className="text-sm">Full URL:</strong>
                            <p className="font-mono text-xs bg-background p-2 rounded mt-1 break-all">
                              {cmd.full_url}
                            </p>
                          </div>
                          {cmd.error_message && (
                            <div>
                              <strong className="text-sm text-destructive">Error:</strong>
                              <p className="text-sm text-destructive mt-1">{cmd.error_message}</p>
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCommand(cmd);
                              setDetailDialogOpen(true);
                            }}
                          >
                            View Full Details
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <CommandDetailDialog
        command={selectedCommand}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );
}
