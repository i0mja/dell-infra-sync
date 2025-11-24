import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarClock, ClipboardCheck, Recycle, RefreshCw, Shield, Trash2 } from "lucide-react";

const lifecycle = [
  { stage: "Provision", actions: ["Zero-touch checklist", "Asset tagging", "CMDB sync"] },
  { stage: "Operate", actions: ["Warranty pulls", "Standard BIOS/iDRAC profile", "Lease calendar"] },
  { stage: "Retire", actions: ["Secure wipe", "Return-to-inventory", "RMA tracking"] },
];

const renewals = [
  { asset: "R750-12", lease: "2026-02-01", warranty: "2026-08-15", owner: "Edge Ops" },
  { asset: "MX7000-03", lease: "2025-11-20", warranty: "2027-01-01", owner: "Core" },
  { asset: "R640-18", lease: "2025-06-30", warranty: "2026-01-05", owner: "DBA" },
];

export const LifecycleAutomationPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Lifecycle Automation</CardTitle>
        <CardDescription>
          Provision-to-retirement flows with governance, warranty pulls, and custody tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {lifecycle.map((item) => (
            <Card key={item.stage} className="border-muted-foreground/20">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  {item.stage === "Provision" && <ClipboardCheck className="h-4 w-4 text-primary" />}
                  {item.stage === "Operate" && <RefreshCw className="h-4 w-4 text-emerald-500" />}
                  {item.stage === "Retire" && <Trash2 className="h-4 w-4 text-rose-500" />}
                  <CardTitle className="text-base">{item.stage}</CardTitle>
                </div>
                <CardDescription>Automated controls</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {item.actions.map((action) => (
                  <div key={action} className="rounded border border-muted-foreground/20 p-2">
                    {action}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Lease &amp; Warranty</CardTitle>
              </div>
              <CardDescription>Calendar reminders with inline ownership</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Lease</TableHead>
                    <TableHead>Warranty</TableHead>
                    <TableHead className="text-right">Owner</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renewals.map((row) => (
                    <TableRow key={row.asset}>
                      <TableCell className="font-medium">{row.asset}</TableCell>
                      <TableCell>{row.lease}</TableCell>
                      <TableCell>{row.warranty}</TableCell>
                      <TableCell className="text-right">{row.owner}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Automated warranty pulls</Badge>
                <Badge variant="outline">Golden image enforcement</Badge>
                <Badge variant="outline">Return-to-inventory workflow</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Recycle className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Custody &amp; Compliance</CardTitle>
              </div>
              <CardDescription>Transfer-of-custody audits and secure wipes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <ScrollArea className="h-32 pr-2">
                <div className="space-y-2">
                  <div className="rounded border border-muted-foreground/20 p-2">Transfer-of-custody audit trails</div>
                  <div className="rounded border border-muted-foreground/20 p-2">Secure wipe &amp; verification</div>
                  <div className="rounded border border-muted-foreground/20 p-2">RMA tracking with shipment status</div>
                  <div className="rounded border border-muted-foreground/20 p-2">Golden image enforcement</div>
                </div>
              </ScrollArea>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Asset tagging</Badge>
                <Badge variant="outline">Ownership enforcement</Badge>
                <Badge variant="outline">Return validation</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
};

