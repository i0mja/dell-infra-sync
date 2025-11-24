import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, ShieldOff } from "lucide-react";

const baselines = [
  { model: "R750", role: "Compute", baseline: "Gold 5.10", compliance: 92, drift: 3 },
  { model: "R740xd", role: "Storage", baseline: "Gold 4.8", compliance: 84, drift: 7 },
  { model: "MX7000", role: "Chassis", baseline: "Gold 4.8", compliance: 97, drift: 1 },
];

const rolloutStages = [
  { name: "Canary", progress: 100, notes: "Complete" },
  { name: "Cohort", progress: 64, notes: "In progress" },
  { name: "Fleet", progress: 12, notes: "Queued" },
];

const guardrails = [
  "Pre-checks: power, thermal, headroom",
  "Maintenance mode and image provenance validation",
  "Checksum enforcement and staged rollouts",
  "Smart sequencing to avoid impact zones",
  "Post-upgrade validation and sensor sanity",
  "Automatic pause on elevated failure rate",
];

export const CompliancePanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Firmware &amp; Driver Compliance</CardTitle>
        <CardDescription>
          Baselines, drift detection, staged rollouts, and automated remediation hooks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model / Role</TableHead>
              <TableHead>Baseline</TableHead>
              <TableHead>Compliance</TableHead>
              <TableHead className="text-right">Drift</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {baselines.map((item) => (
              <TableRow key={`${item.model}-${item.role}`}>
                <TableCell>
                  <div className="font-medium">{item.model}</div>
                  <div className="text-xs text-muted-foreground">{item.role}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{item.baseline}</Badge>
                </TableCell>
                <TableCell className="w-48">
                  <Progress value={item.compliance} />
                  <div className="text-xs text-muted-foreground mt-1">{item.compliance}% compliant</div>
                </TableCell>
                <TableCell className="text-right">
                  {item.drift === 0 ? (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-200">Aligned</Badge>
                  ) : (
                    <Badge variant="destructive">{item.drift} drift</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <CardTitle className="text-base">Staged Rollouts</CardTitle>
              </div>
              <CardDescription>Canary → Cohort → Fleet with pause on errors</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rolloutStages.map((stage) => (
                <div key={stage.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{stage.name}</span>
                    <span className="text-muted-foreground">{stage.notes}</span>
                  </div>
                  <Progress value={stage.progress} />
                </div>
              ))}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Image provenance checks</Badge>
                <Badge variant="outline">Checksum enforcement</Badge>
                <Badge variant="outline">Automatic pause</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldOff className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Remediation &amp; Validation</CardTitle>
              </div>
              <CardDescription>Pre-checks, smart sequencing, and rollback safety nets</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {guardrails.map((item) => (
                <div key={item} className="rounded border border-muted-foreground/20 p-2">
                  {item}
                </div>
              ))}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Firmware locker</Badge>
                <Badge variant="outline">Compliance scorecards</Badge>
                <Badge variant="outline">Post-upgrade validation</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
};

