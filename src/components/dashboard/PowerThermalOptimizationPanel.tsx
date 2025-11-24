import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BatteryCharging, Leaf, PlugZap, ThermometerSun, Timer, Zap } from "lucide-react";

const powerBudget = [
  { rack: "R12", cap: "8.5 kW", used: 72 },
  { rack: "R21", cap: "10 kW", used: 54 },
  { rack: "C7", cap: "6 kW", used: 88 },
];

const thermalHotspots = [
  { rack: "R12", inlet: 27, outlet: 38, status: "Hot" },
  { rack: "R9", inlet: 24, outlet: 31, status: "Watch" },
  { rack: "C7", inlet: 29, outlet: 40, status: "Critical" },
];

const policies = [
  "Scheduled power policies (weekend/overnight)",
  "Carbon-aware job scheduling",
  "Idle host detection with consolidation planner",
  "Fan/power profile tuning suggestions",
  "Capacity headroom forecasting",
  "Alerting on abnormal power transients",
];

export const PowerThermalOptimizationPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Power, Thermal, and Capacity Optimization</CardTitle>
        <CardDescription>
          Live power feeds, budgeting, hotspots, carbon-aware scheduling, and resiliency checks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rack</TableHead>
              <TableHead>Cap</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead className="text-right">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {powerBudget.map((item) => (
              <TableRow key={item.rack}>
                <TableCell className="font-medium">{item.rack}</TableCell>
                <TableCell>{item.cap}</TableCell>
                <TableCell className="w-48">
                  <Progress value={item.used} />
                  <div className="text-xs text-muted-foreground mt-1">{item.used}% of budget</div>
                </TableCell>
                <TableCell className="text-right">
                  {item.used > 80 ? (
                    <Badge variant="destructive">Cap alert</Badge>
                  ) : (
                    <Badge variant="outline">Balanced</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ThermometerSun className="h-4 w-4 text-orange-500" />
                <CardTitle className="text-base">Thermal Hotspots</CardTitle>
              </div>
              <CardDescription>Inlet/outlet differentials and flags</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {thermalHotspots.map((item) => (
                <div key={item.rack} className="flex items-center justify-between rounded border border-muted-foreground/20 p-2">
                  <div>
                    <div className="font-medium text-foreground">{item.rack}</div>
                    <div className="text-xs">{item.inlet}°C → {item.outlet}°C</div>
                  </div>
                  <Badge variant={item.status === "Critical" ? "destructive" : "secondary"}>{item.status}</Badge>
                </div>
              ))}
              <div className="text-xs text-muted-foreground">Power/thermal anomaly flags auto-raised</div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Leaf className="h-4 w-4 text-emerald-500" />
                <CardTitle className="text-base">Efficiency</CardTitle>
              </div>
              <CardDescription>Carbon-aware and consolidation-aware scheduling</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Carbon-aware scheduling</span>
                <Badge variant="secondary">Enabled</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Idle host consolidation</span>
                <Badge variant="outline">Planner active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Power budgeting</span>
                <Badge variant="secondary">Rack caps enforced</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Capacity headroom</span>
                <Badge variant="outline">Forecast: 12% spare</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <PlugZap className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Resiliency</CardTitle>
              </div>
              <CardDescription>PDU/UPS feeds, battery health, and transients</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Live PDU/UPS feeds</span>
                <Badge variant="secondary">Streaming</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Battery health</span>
                <Badge variant="outline">RAID controllers + UPS</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Power transients</span>
                <Badge variant="destructive">Alerting</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Power policies</span>
                <Badge variant="outline">Weekend/overnight</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Sequencing</span>
                <Badge variant="secondary">Avoid impact overlap</Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Smart sequencing
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1">
                  <BatteryCharging className="h-3 w-3" /> Blackout-aware
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1">
                  <Timer className="h-3 w-3" /> Scheduled windows
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
};

