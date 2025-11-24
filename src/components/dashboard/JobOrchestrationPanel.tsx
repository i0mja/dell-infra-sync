import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, CheckCircle2, Clock, PauseOctagon, Play, Repeat, ShieldAlert } from "lucide-react";

const queue = [
  {
    id: "Job-4821",
    name: "Patch firmware",
    status: "Running",
    progress: 62,
    timeline: "Scheduled → Executing → Validation",
    slaMinutes: 25,
    tenant: "Finance",
  },
  {
    id: "Job-4822",
    name: "Rolling reboots",
    status: "Pending",
    progress: 0,
    timeline: "Waiting → Window",
    slaMinutes: 90,
    tenant: "Global",
  },
  {
    id: "Job-4815",
    name: "vCenter inventory refresh",
    status: "Completed",
    progress: 100,
    timeline: "Queued → Running → Done",
    slaMinutes: 0,
    tenant: "Ops",
  },
];

const dependencies = [
  {
    chain: "Patch firmware → Reboot → Validation",
    policy: "Retry x3 with exponential backoff",
    approvals: "Security + Platform",
    risk: "Approval gate required",
  },
  {
    chain: "Back up SCP → Apply config → Verify sensors",
    policy: "Retry x1 with reason code",
    approvals: "Ops only",
    risk: "Low impact",
  },
];

const templates = [
  {
    name: "Firmware roll",
    guardrails: ["Pre-check sensors", "Maintenance mode", "Blackout aware"],
  },
  {
    name: "Driver compliance",
    guardrails: ["Checksum verification", "Power headroom", "Rollback hooks"],
  },
  {
    name: "Lifecycle re-provision",
    guardrails: ["Zero-touch", "Secure wipe", "Audit logging"],
  },
];

export const JobOrchestrationPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Job Orchestration &amp; Tracking</CardTitle>
        <CardDescription>
          Central queue with timelines, dependency chains, approvals, and SLA monitors
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="text-right">SLA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">{job.id}</TableCell>
                <TableCell>
                  <div className="font-medium">{job.name}</div>
                  <div className="text-xs text-muted-foreground">{job.timeline}</div>
                  <div className="text-xs text-muted-foreground">Tenant: {job.tenant}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{job.status}</Badge>
                </TableCell>
                <TableCell className="w-52">
                  <Progress value={job.progress} />
                </TableCell>
                <TableCell className="text-right text-sm">{job.slaMinutes} min</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Dependency Chains</CardTitle>
              </div>
              <CardDescription>Sequencing with retry/backoff and approvals</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dependencies.map((item) => (
                <div key={item.chain} className="rounded border border-muted-foreground/20 p-3 text-sm">
                  <div className="font-medium">{item.chain}</div>
                  <div className="text-xs text-muted-foreground">{item.policy}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                    <span>{item.approvals}</span>
                    <Badge variant="outline">{item.risk}</Badge>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Approval gates</Badge>
                <Badge variant="outline">Rollback hooks</Badge>
                <Badge variant="outline">Blackout windows</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Scheduling &amp; SLA</CardTitle>
              </div>
              <CardDescription>Windows, blackout periods, and SLA timers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Scheduled window</span>
                <Badge variant="secondary">Sat 02:00 - 04:00</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Blackout period</span>
                <Badge variant="destructive">Sun 09:00 - 12:00</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>SLA monitor</span>
                <Badge variant="outline">Job duration alerts</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Live logs</span>
                <Badge variant="outline">Streaming</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Visibility</span>
                <Badge variant="secondary">Per tenant/role</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-500" />
                <CardTitle className="text-base">Job Templates</CardTitle>
              </div>
              <CardDescription>Guardrails and reusable workflows</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScrollArea className="h-40 pr-2">
                <div className="space-y-2">
                  {templates.map((template) => (
                    <div key={template.name} className="rounded border border-muted-foreground/20 p-3 text-sm">
                      <div className="font-medium">{template.name}</div>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground mt-1">
                        {template.guardrails.map((item) => (
                          <Badge key={item} variant="outline">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Play className="h-4 w-4" /> Retry/backoff policies
                </div>
                <div className="flex items-center gap-1">
                  <PauseOctagon className="h-4 w-4" /> Auto-pause on failures
                </div>
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> Reason codes captured
                </div>
                <div className="flex items-center gap-1">
                  <ArrowRight className="h-4 w-4" /> Dependency-aware queues
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
};

