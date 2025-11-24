import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Globe2, Network, WifiOff } from "lucide-react";

const connectivity = [
  { target: "iDRAC 10.1.1.12", latency: "4 ms", jitter: "1 ms", reliability: "99.9%", tls: "2025-08-01" },
  { target: "vCenter 10.1.2.30", latency: "6 ms", jitter: "2 ms", reliability: "99.7%", tls: "2025-04-12" },
  { target: "Host 10.1.3.54", latency: "9 ms", jitter: "3 ms", reliability: "98.9%", tls: "2024-12-01" },
];

const probes = [
  "Reachability matrix for iDRAC/host/vCenter endpoints",
  "Latency/jitter history to each management IP",
  "TLS/certificate expiry monitoring",
  "Port/feature availability checks (Redfish/WS-Man/SSH)",
  "Credential validity probes with scoped tests",
  "Routing path hints (gateway/VLAN info)",
  "DNS and NTP sanity dashboards",
  "Packet loss and retransmit counters",
  "Per-device connectivity reliability score",
  "Suggested remediation playbooks",
];

export const NetworkDiagnosticsPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Network &amp; Connectivity Diagnostics</CardTitle>
        <CardDescription>Reachability, TLS monitoring, and remediation hints</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Target</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Jitter</TableHead>
              <TableHead>Reliability</TableHead>
              <TableHead className="text-right">TLS Expiry</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connectivity.map((row) => (
              <TableRow key={row.target}>
                <TableCell className="font-medium">{row.target}</TableCell>
                <TableCell>{row.latency}</TableCell>
                <TableCell>{row.jitter}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{row.reliability}</Badge>
                </TableCell>
                <TableCell className="text-right">{row.tls}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Card className="border-muted-foreground/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Connectivity Probes</CardTitle>
            </div>
            <CardDescription>Port checks, credentials, and path hints</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ScrollArea className="h-32 pr-2">
              <div className="space-y-2">
                {probes.map((item) => (
                  <div key={item} className="rounded border border-muted-foreground/20 p-2">
                    {item}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="flex items-center gap-1">
                <Globe2 className="h-3 w-3" /> DNS &amp; NTP
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1">
                <WifiOff className="h-3 w-3" /> Packet loss alerts
              </Badge>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
};

