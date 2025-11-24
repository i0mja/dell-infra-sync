import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, FileJson, FileSpreadsheet, Flame, Network, Power, ShieldCheck, ThermometerSun } from "lucide-react";

const siteHealth = [
  {
    name: "Austin-DC",
    status: "Healthy",
    uptime: "99.98%",
    anomalies: ["None"],
    openIncidents: 1,
    slaMinutesRemaining: 42,
  },
  {
    name: "Frankfurt-Cluster",
    status: "Degraded",
    uptime: "99.4%",
    anomalies: ["Power transient", "2 thermal alerts"],
    openIncidents: 3,
    slaMinutesRemaining: 18,
  },
  {
    name: "Singapore-Edge",
    status: "Watch",
    uptime: "99.1%",
    anomalies: ["Firmware drift", "Needs reboot"],
    openIncidents: 2,
    slaMinutesRemaining: 55,
  },
];

const heatmap = [
  { severity: "Critical", count: 6, color: "bg-destructive/20 text-destructive" },
  { severity: "Major", count: 14, color: "bg-orange-500/20 text-orange-700" },
  { severity: "Minor", count: 27, color: "bg-yellow-500/20 text-yellow-700" },
  { severity: "Info", count: 45, color: "bg-sky-500/20 text-sky-700" },
];

const blastRadius = [
  {
    incident: "Rack PDU overload",
    impact: "Rack R12 → 12 hosts → 134 VMs",
    remediation: "Throttle non-essential jobs, rebalance workload",
  },
  {
    incident: "Fabric switch certificate expiry",
    impact: "Cluster C4 → 2 racks → 38 hosts",
    remediation: "Rotate certs, suppress noisy alerts during maintenance window",
  },
];

const quickFilters = [
  { label: "Needs reboot", count: 8 },
  { label: "Degraded RAID", count: 5 },
  { label: "Noisy alerts suppressed", count: 12 },
  { label: "Config drift", count: 9 },
];

const cohorts = [
  { name: "R750 gold baseline", firmware: "v5.10.2", drift: 2 },
  { name: "MX7000 chassis", firmware: "v4.8.1", drift: 0 },
  { name: "Legacy R640", firmware: "v3.2.0", drift: 7 },
];

export const FleetHealthOverview = () => {
  return (
    <Card className="col-span-6">
      <CardHeader className="pb-2">
        <CardTitle>Unified Fleet Overview &amp; Health</CardTitle>
        <CardDescription>
          Real-time status tiles per site with incident SLAs, heatmaps, blast radius, and cohort-aware drift detection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {siteHealth.map((site) => (
            <Card key={site.name} className="border-muted-foreground/20">
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{site.name}</CardTitle>
                  <Badge variant="outline">{site.status}</Badge>
                </div>
                <CardDescription>Uptime {site.uptime}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Open incidents</span>
                  <Badge variant="secondary">{site.openIncidents}</Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">SLA timer</span>
                    <span className="font-medium">{site.slaMinutesRemaining} min</span>
                  </div>
                  <Progress value={Math.min((site.slaMinutesRemaining / 60) * 100, 100)} />
                </div>
                <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                  {site.anomalies.map((note) => (
                    <Badge key={note} variant="secondary" className="bg-muted text-foreground">
                      {note}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500" />
                <CardTitle className="text-base">Alert Heatmap</CardTitle>
              </div>
              <CardDescription>Hardware alerts by severity with suppression tracking</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {heatmap.map((item) => (
                  <div
                    key={item.severity}
                    className={`rounded border p-3 text-sm ${item.color} border-muted-foreground/20`}
                  >
                    <div className="font-medium">{item.severity}</div>
                    <div className="text-2xl font-semibold">{item.count}</div>
                    <div className="text-xs">Active alerts</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Suppression rules enabled</Badge>
                <Badge variant="outline">Noise reduction</Badge>
                <Badge variant="outline">Auto-severity tuning</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Blast Radius</CardTitle>
              </div>
              <CardDescription>Outage impact and affected objects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScrollArea className="h-52 pr-2">
                <div className="space-y-3">
                  {blastRadius.map((item) => (
                    <div key={item.incident} className="rounded border border-muted-foreground/20 p-3">
                      <div className="font-medium">{item.incident}</div>
                      <div className="text-sm text-muted-foreground">{item.impact}</div>
                      <div className="text-xs text-muted-foreground mt-1">{item.remediation}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-emerald-500" />
                <CardTitle className="text-base">Drift &amp; Cohorts</CardTitle>
              </div>
              <CardDescription>Auto-grouping by model/firmware and drift vs gold</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohorts.map((cohort) => (
                    <TableRow key={cohort.name}>
                      <TableCell className="font-medium">{cohort.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{cohort.firmware}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {cohort.drift === 0 ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-200">
                            In baseline
                          </Badge>
                        ) : (
                          <Badge variant="destructive">{cohort.drift} drift</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <ThermometerSun className="h-4 w-4" /> Power/thermal anomaly flags
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Config drift badges
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1">
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Export CSV
                </Button>
                <Button size="sm" variant="secondary" className="flex-1">
                  <FileJson className="mr-2 h-4 w-4" /> Export JSON
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Needs reboot filter</Badge>
                <Badge variant="outline">Degraded RAID filter</Badge>
                <Badge variant="outline">Real-time tiles</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-muted-foreground/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <CardTitle className="text-base">Fleet Filters &amp; Flags</CardTitle>
            </div>
            <CardDescription>Quick filters with suppression and anomaly tracking</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              {quickFilters.map((filter) => (
                <div key={filter.label} className="rounded border border-muted-foreground/20 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{filter.label}</span>
                    <Badge variant="secondary">{filter.count}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Tap to pivot dashboards instantly</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
};

