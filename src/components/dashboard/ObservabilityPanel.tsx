import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActivitySquare, BellRing, Brain } from "lucide-react";

const events = [
  { source: "iDRAC", detail: "Predictive failure: Drive 3", time: "2m ago", severity: "Major" },
  { source: "vCenter", detail: "Host maintenance mode", time: "12m ago", severity: "Info" },
  { source: "Syslog", detail: "Power supply redundancy lost", time: "22m ago", severity: "Critical" },
];

const insights = [
  "Unified event timeline across sources (iDRAC, vCenter, syslog)",
  "Correlated incident views (power + thermal + firmware)",
  "Noise reduction with deduplication rules",
  "Predictive failure warnings (drive SMART/sensors)",
  "Suggested runbooks based on similar incidents",
  "Custom KPIs and SLO tracking dashboards",
  "Cost/impact estimation for actions (reboot, evacuation)",
  "Webhooks for SIEM/ITSM integration",
  "Saved views and subscriptions for recurring checks",
  "Anomaly detection on sensor trends",
];

export const ObservabilityPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Observability &amp; Intelligence</CardTitle>
        <CardDescription>Events, correlations, runbooks, and anomaly detection</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.detail}>
                <TableCell className="font-medium">{event.source}</TableCell>
                <TableCell>{event.detail}</TableCell>
                <TableCell>{event.time}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={event.severity === "Critical" ? "destructive" : "secondary"}>{event.severity}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Card className="border-muted-foreground/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Correlated Intelligence</CardTitle>
            </div>
            <CardDescription>Noise reduction, runbooks, and anomaly detection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ScrollArea className="h-32 pr-2">
              <div className="space-y-2">
                {insights.map((item) => (
                  <div key={item} className="rounded border border-muted-foreground/20 p-2">
                    {item}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="flex items-center gap-1">
                <ActivitySquare className="h-3 w-3" /> Unified timeline
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1">
                <BellRing className="h-3 w-3" /> Deduped alerts
              </Badge>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
};

