import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Server, Clock, User, CheckCircle, XCircle, AlertTriangle, 
  HardDrive, RefreshCw, Database, Layers, PlayCircle, Circle
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface UpdateDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  update: any | null;
}

export function UpdateDetailDialog({ open, onOpenChange, update }: UpdateDetailDialogProps) {
  if (!update) return null;

  const components = update.components || [];
  const workflows = update.workflows || [];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <PlayCircle className="h-4 w-4 text-primary animate-pulse" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatDuration = (ms: number) => {
    if (!ms) return "-";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {update.server || "Update Details"}
            <Badge variant={update.status === "completed" ? "default" : update.status === "failed" ? "destructive" : "secondary"}>
              {update.status === "completed" ? "Success" : update.status === "failed" ? "Failed" : update.status}
            </Badge>
          </DialogTitle>
          <VisuallyHidden.Root>
            <DialogDescription>Detailed information about this firmware update</DialogDescription>
          </VisuallyHidden.Root>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="components">Components ({components.length})</TabsTrigger>
            <TabsTrigger value="timeline">Timeline ({workflows.length})</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-0 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Server className="h-4 w-4" />
                      Server Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hostname</span>
                      <span className="font-medium">{update.server || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IP Address</span>
                      <span className="font-mono">{update.server_ip || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cluster</span>
                      <span>{update.cluster_name || "-"}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Timing
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Started</span>
                      <span>{update.started_at ? format(new Date(update.started_at), "PPp") : "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completed</span>
                      <span>{update.completed_at ? format(new Date(update.completed_at), "PPp") : "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">{update.duration_formatted || "-"}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      Update Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Update Type</span>
                      <span>{update.job_type_label || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Components Updated</span>
                      <span className="font-medium">{update.components_updated || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Criticality</span>
                      <Badge variant={
                        update.highest_criticality === "Critical" ? "destructive" : 
                        update.highest_criticality === "Recommended" ? "secondary" : "outline"
                      }>
                        {update.highest_criticality || "Unknown"}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reboot Required</span>
                      <span>{update.reboot_required ? "Yes" : "No"}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Backup & Recovery
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SCP Backup</span>
                      <span className={cn(
                        "flex items-center gap-1",
                        update.scp_backup ? "text-success" : "text-muted-foreground"
                      )}>
                        {update.scp_backup ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {update.scp_backup ? "Available" : "Not Available"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Initiated By</span>
                      <span>{update.initiated_by || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Job ID</span>
                      <span className="font-mono text-xs">{update.job_id?.slice(0, 8) || "-"}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Components Tab */}
            <TabsContent value="components" className="mt-0">
              {components.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Current Version</TableHead>
                      <TableHead>New Version</TableHead>
                      <TableHead>Criticality</TableHead>
                      <TableHead>Reboot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {components.map((comp: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{comp.name || comp.component || "-"}</TableCell>
                        <TableCell>{comp.type || comp.component_type || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">{comp.current_version || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">{comp.available_version || comp.target_version || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={
                            comp.criticality === "Critical" ? "destructive" : 
                            comp.criticality === "Recommended" ? "secondary" : "outline"
                          }>
                            {comp.criticality || "Unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {comp.reboot_required === "HOST" || comp.reboot_required === true ? (
                            <RefreshCw className="h-4 w-4 text-warning" />
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <HardDrive className="h-12 w-12 mb-4 opacity-50" />
                  <p>No component details available</p>
                  <p className="text-sm">Component information was not captured for this update</p>
                </div>
              )}
            </TabsContent>

            {/* Timeline Tab */}
            <TabsContent value="timeline" className="mt-0">
              {workflows.length > 0 ? (
                <div className="space-y-4">
                  {workflows.map((step: any, index: number) => (
                    <div 
                      key={index}
                      className={cn(
                        "relative pl-8 pb-4",
                        index !== workflows.length - 1 && "border-l-2 border-border ml-2"
                      )}
                    >
                      <div className="absolute left-0 top-0 -ml-2.5">
                        {getStatusIcon(step.step_status)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{step.step_name}</p>
                            {step.step_started_at && (
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(step.step_started_at), "PPp")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {step.step_started_at && step.step_completed_at && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {formatDuration(new Date(step.step_completed_at).getTime() - new Date(step.step_started_at).getTime())}
                              </span>
                            )}
                            <Badge 
                              variant={
                                step.step_status === 'completed' ? 'secondary' :
                                step.step_status === 'failed' ? 'destructive' :
                                step.step_status === 'running' ? 'default' : 'outline'
                              }
                              className="text-xs"
                            >
                              {step.step_status}
                            </Badge>
                          </div>
                        </div>
                        {step.step_error && (
                          <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                            {step.step_error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Clock className="h-12 w-12 mb-4 opacity-50" />
                  <p>No workflow timeline available</p>
                  <p className="text-sm">Timeline information was not captured for this update</p>
                </div>
              )}
            </TabsContent>

            {/* Logs Tab */}
            <TabsContent value="logs" className="mt-0">
              {update.logs ? (
                <div className="bg-muted rounded-lg p-4 font-mono text-sm whitespace-pre-wrap max-h-[400px] overflow-auto">
                  {update.logs}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <AlertTriangle className="h-12 w-12 mb-4 opacity-50" />
                  <p>No logs available</p>
                  <p className="text-sm">Console output was not captured for this update</p>
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
