import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronUp, XCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { VCenterAlarm } from "@/hooks/useVCenterData";

interface AlarmsPanelProps {
  alarms: VCenterAlarm[];
}

export function AlarmsPanel({ alarms }: AlarmsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Count alarms by status
  const redAlarms = alarms.filter((a) => a.alarm_status?.toLowerCase() === "red").length;
  const yellowAlarms = alarms.filter((a) => a.alarm_status?.toLowerCase() === "yellow").length;
  const totalAlarms = alarms.length;

  // Filter alarms
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

  if (totalAlarms === 0) {
    return (
      <div className="border-b bg-success/10 border-success/20">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-success">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">All systems nominal - No active alarms</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="border-b bg-warning/10 border-warning/20">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-warning/20 transition-colors">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <span className="font-medium">
                {totalAlarms} Active Alarm{totalAlarms !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="text-xs">
                  {redAlarms} Critical
                </Badge>
                <Badge variant="outline" className="text-warning text-xs">
                  {yellowAlarms} Warning
                </Badge>
              </div>
            </div>
            <Button variant="ghost" size="sm">
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-2" />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-2" />
                  View All
                </>
              )}
            </Button>
          </div>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="border-b bg-card">
          {/* Filter buttons */}
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/50">
            <span className="text-xs text-muted-foreground mr-2">Filter:</span>
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

          {/* Alarms table */}
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-muted z-10">
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead className="w-[250px]">Alarm</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[150px]">Entity</TableHead>
                  <TableHead className="w-[200px]">Entity Name</TableHead>
                  <TableHead className="w-[140px]">Triggered</TableHead>
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
                      <TableCell className="font-medium">
                        {alarm.alarm_name || "Unnamed Alarm"}
                      </TableCell>
                      <TableCell>{getStatusBadge(alarm.alarm_status)}</TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline" className="text-xs">
                          {alarm.entity_type || "Unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
