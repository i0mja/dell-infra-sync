import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings, Activity, RefreshCw, RefreshCcw, Loader2, Database, Link as LinkIcon, HardDrive, AlertTriangle, ChevronDown, XCircle, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import type { VCenterAlarm } from "@/hooks/useVCenterData";

interface VCenterStatsBarProps {
  totalHosts: number;
  linkedHosts: number;
  unlinkedHosts: number;
  totalVms?: number;
  totalDatastores?: number;
  alarms: VCenterAlarm[];
  lastSync: string | null;
  mode: 'job-executor' | 'cloud';
  syncing: boolean;
  testing: boolean;
  onSettings: () => void;
  onTest: () => void;
  onSync: () => void;
  onRefresh: () => void;
  onClusterUpdate: () => void;
  hasActiveClusters: boolean;
}

export function VCenterStatsBar({
  totalHosts,
  linkedHosts,
  unlinkedHosts,
  totalVms = 0,
  totalDatastores = 0,
  alarms,
  lastSync,
  mode,
  syncing,
  testing,
  onSettings,
  onTest,
  onSync,
  onRefresh,
  onClusterUpdate,
  hasActiveClusters,
}: VCenterStatsBarProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const redAlarms = alarms.filter((a) => a.alarm_status?.toLowerCase() === "red").length;
  const yellowAlarms = alarms.filter((a) => a.alarm_status?.toLowerCase() === "yellow").length;
  const totalAlarms = alarms.length;
  
  const filteredAlarms = alarms.filter((alarm) => {
    if (statusFilter === "all") return true;
    return alarm.alarm_status?.toLowerCase() === statusFilter;
  });
  
  const getStatusIcon = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case "red":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "yellow":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };
  
  const getStatusBadge = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case "red":
        return <Badge variant="destructive" className="text-xs">Critical</Badge>;
      case "yellow":
        return <Badge variant="outline" className="text-warning text-xs">Warning</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status || "Unknown"}</Badge>;
    }
  };
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Hosts:</span>
            <span className="font-semibold">{totalHosts}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <LinkIcon className="h-4 w-4 text-success" />
            <span className="text-muted-foreground">Linked:</span>
            <span className="font-semibold text-success">{linkedHosts}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <LinkIcon className="h-4 w-4 text-warning" />
            <span className="text-muted-foreground">Unlinked:</span>
            <span className="font-semibold text-warning">{unlinkedHosts}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">VMs:</span>
            <span className="font-semibold">{totalVms}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Datastores:</span>
            <span className="font-semibold">{totalDatastores}</span>
          </div>

          {totalAlarms > 0 && (
            <>
              <div className="hidden h-4 w-px bg-border sm:block" />
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent gap-2 text-sm whitespace-nowrap">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <span className="text-muted-foreground">Alarms:</span>
                    <span className="font-semibold text-warning">{totalAlarms}</span>
                    {redAlarms > 0 && (
                      <Badge variant="destructive" className="text-xs h-5">
                        {redAlarms}
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[700px] p-0" align="end">
                  <div className="border-b bg-muted/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                        <span className="font-semibold">Active Alarms</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-xs">
                          {redAlarms} Critical
                        </Badge>
                        <Badge variant="outline" className="text-warning text-xs">
                          {yellowAlarms} Warning
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Filter:</span>
                      <Button
                        variant={statusFilter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("all")}
                        className="h-7 text-xs"
                      >
                        All ({totalAlarms})
                      </Button>
                      <Button
                        variant={statusFilter === "red" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("red")}
                        className="h-7 text-xs"
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Critical ({redAlarms})
                      </Button>
                      <Button
                        variant={statusFilter === "yellow" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter("yellow")}
                        className="h-7 text-xs"
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Warning ({yellowAlarms})
                      </Button>
                    </div>
                  </div>
                  
                  <div className="max-h-[400px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted z-10">
                        <TableRow>
                          <TableHead className="w-[40px]"></TableHead>
                          <TableHead className="w-[200px]">Alarm</TableHead>
                          <TableHead className="w-[100px]">Status</TableHead>
                          <TableHead className="w-[120px]">Entity</TableHead>
                          <TableHead className="w-[150px]">Entity Name</TableHead>
                          <TableHead className="w-[120px]">Triggered</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAlarms.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                              No alarms match the selected filter
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredAlarms.map((alarm) => (
                            <TableRow key={alarm.id} className="hover:bg-accent/50">
                              <TableCell>{getStatusIcon(alarm.alarm_status)}</TableCell>
                              <TableCell className="font-medium text-sm">
                                {alarm.alarm_name || "Unnamed Alarm"}
                              </TableCell>
                              <TableCell>{getStatusBadge(alarm.alarm_status)}</TableCell>
                              <TableCell className="text-sm">
                                <Badge variant="outline" className="text-xs">
                                  {alarm.entity_type || "Unknown"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm truncate max-w-[150px]">
                                {alarm.entity_name || "N/A"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {alarm.triggered_at
                                  ? formatDistanceToNow(new Date(alarm.triggered_at), { addSuffix: true })
                                  : "Unknown"}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Last Sync:</span>
            <span className="font-semibold truncate max-w-[200px]">
              {lastSync ? formatDistanceToNow(new Date(lastSync), { addSuffix: true }) : 'Never'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onSettings}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="mr-2 h-4 w-4" />
                Test
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onClusterUpdate}
            disabled={!hasActiveClusters}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Cluster Update
          </Button>

          <Button size="sm" onClick={onSync} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Sync Now
              </>
            )}
          </Button>

          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span className={`h-2 w-2 rounded-full ${mode === 'job-executor' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
            <span className="text-xs font-medium tracking-wide">
              {mode === 'job-executor' ? 'Job Executor' : 'Cloud Mode'}
            </span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
