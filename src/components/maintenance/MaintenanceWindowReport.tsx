import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Server, 
  Power, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Activity,
  Calendar,
  User,
  FileText
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface MaintenanceWindowReportProps {
  maintenanceWindowId: string;
}

interface BlockerResolution {
  id: string;
  host_id: string;
  host_name: string;
  vm_id: string;
  vm_name: string;
  blocker_reason: string;
  resolution_type: string;
  resolved_at: string;
  executed_at: string | null;
  execution_result: string | null;
  powered_on_at: string | null;
  resolved_by: string | null;
}

interface MaintenanceWindow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  maintenance_type: string;
  planned_start: string;
  planned_end: string;
  started_at: string | null;
  completed_at: string | null;
  details: any;
  profiles?: { full_name: string | null; email: string } | null;
}

export function MaintenanceWindowReport({ maintenanceWindowId }: MaintenanceWindowReportProps) {
  const [loading, setLoading] = useState(true);
  const [maintenanceWindow, setMaintenanceWindow] = useState<MaintenanceWindow | null>(null);
  const [resolutions, setResolutions] = useState<BlockerResolution[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReportData();
  }, [maintenanceWindowId]);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      // Fetch maintenance window
      const { data: mw, error: mwError } = await supabase
        .from('maintenance_windows')
        .select('*')
        .eq('id', maintenanceWindowId)
        .single();

      if (mwError) throw mwError;
      setMaintenanceWindow(mw);

      // Fetch blocker resolutions
      const { data: res, error: resError } = await supabase
        .from('maintenance_blocker_resolutions')
        .select('*')
        .eq('maintenance_window_id', maintenanceWindowId)
        .order('host_name', { ascending: true });

      if (resError) throw resError;
      setResolutions(res || []);
    } catch (err: any) {
      console.error('Error fetching report data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-500">In Progress</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'planned':
        return <Badge variant="secondary">Planned</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getReasonBadge = (reason: string) => {
    const colors: Record<string, string> = {
      passthrough: 'bg-purple-500',
      local_storage: 'bg-orange-500',
      vcsa: 'bg-blue-500',
      fault_tolerance: 'bg-red-500',
      vgpu: 'bg-pink-500',
      affinity: 'bg-yellow-500',
      critical_infra: 'bg-indigo-500',
    };
    return (
      <Badge className={colors[reason] || 'bg-secondary'}>
        {reason.replace('_', ' ')}
      </Badge>
    );
  };

  const getResolutionIcon = (type: string, result: string | null) => {
    if (result === 'success') {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    } else if (result === 'failed') {
      return <XCircle className="h-4 w-4 text-destructive" />;
    } else if (type === 'power_off') {
      return <Power className="h-4 w-4 text-yellow-500" />;
    } else if (type === 'acknowledged') {
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return format(new Date(dateStr), 'MMM d, yyyy HH:mm');
    } catch {
      return dateStr;
    }
  };

  // Group resolutions by host
  const resolutionsByHost = resolutions.reduce((acc, res) => {
    if (!acc[res.host_name]) {
      acc[res.host_name] = [];
    }
    acc[res.host_name].push(res);
    return acc;
  }, {} as Record<string, BlockerResolution[]>);

  // Calculate summary stats
  const powerOffCount = resolutions.filter(r => r.resolution_type === 'power_off').length;
  const acknowledgedCount = resolutions.filter(r => r.resolution_type === 'acknowledged').length;
  const executedCount = resolutions.filter(r => r.executed_at).length;
  const poweredOnCount = resolutions.filter(r => r.powered_on_at).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Activity className="h-8 w-8 animate-pulse mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">Loading report...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!maintenanceWindow) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Maintenance window not found</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {maintenanceWindow.title}
              </CardTitle>
              <CardDescription>{maintenanceWindow.description}</CardDescription>
            </div>
            {getStatusBadge(maintenanceWindow.status)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Planned Start</div>
                <div className="text-sm font-medium">{formatDateTime(maintenanceWindow.planned_start)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Planned End</div>
                <div className="text-sm font-medium">{formatDateTime(maintenanceWindow.planned_end)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Actual Start</div>
                <div className="text-sm font-medium">{formatDateTime(maintenanceWindow.started_at)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-sm font-medium">{formatDateTime(maintenanceWindow.completed_at)}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* VM Power-Off Summary */}
      {resolutions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="h-5 w-5" />
              VM Power-Off Actions
            </CardTitle>
            <CardDescription>
              Summary of VMs that were managed during this maintenance window
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{powerOffCount}</div>
                <div className="text-xs text-muted-foreground">VMs Powered Off</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">{acknowledgedCount}</div>
                <div className="text-xs text-muted-foreground">Acknowledged</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold text-green-500">{executedCount}</div>
                <div className="text-xs text-muted-foreground">Actions Executed</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold text-green-500">{poweredOnCount}</div>
                <div className="text-xs text-muted-foreground">Powered Back On</div>
              </div>
            </div>

            <Separator className="my-4" />

            {/* Detailed Table */}
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VM Name</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Blocker</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Powered Off</TableHead>
                    <TableHead>Powered On</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resolutions.map((res) => (
                    <TableRow key={res.id}>
                      <TableCell className="font-medium">{res.vm_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Server className="h-3 w-3 text-muted-foreground" />
                          {res.host_name}
                        </div>
                      </TableCell>
                      <TableCell>{getReasonBadge(res.blocker_reason)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {res.resolution_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateTime(res.executed_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateTime(res.powered_on_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {getResolutionIcon(res.resolution_type, res.execution_result)}
                          <span className="text-sm capitalize">
                            {res.execution_result || 'pending'}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* No resolutions message */}
      {resolutions.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium">No VM Power-Off Actions</p>
            <p className="text-sm text-muted-foreground">
              All VMs were migrated successfully without requiring power-off
            </p>
          </CardContent>
        </Card>
      )}

      {/* Host Update Order (if available in details) */}
      {maintenanceWindow.details?.host_update_order && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Host Update Order
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(maintenanceWindow.details.host_update_order as string[]).map((hostId: string, idx: number) => (
                <Badge key={hostId} variant="outline" className="text-sm">
                  {idx + 1}. {hostId}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
