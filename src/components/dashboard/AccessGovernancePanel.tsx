import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, ShieldCheck, ShieldQuestion, TimerReset } from "lucide-react";

const controls = [
  "Role-based views and action policies",
  "Just-in-time elevation with time-bound tokens",
  "Strong audit trails for every action/command",
  "Change windows and peer approval flows",
  "Policy-as-code checks before execution",
  "Per-object ACLs for sensitive hosts",
  "Secret rotation reminders and automations",
  "Tamper-evident log storage with integrity checks",
  "Session recording/replay for critical ops",
  "Anomaly alerts on unusual command patterns",
];

export const AccessGovernancePanel = () => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Access, Audit, and Governance</CardTitle>
        <CardDescription>RBAC, approvals, and tamper-evident audit trails</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <ScrollArea className="h-60 pr-2">
          <div className="space-y-2">
            {controls.map((item) => (
              <div key={item} className="rounded border border-muted-foreground/20 p-2">
                {item}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="flex items-center gap-1">
            <Shield className="h-3 w-3" /> Policy-as-code
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Peer approvals
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <TimerReset className="h-3 w-3" /> Time-bound elevation
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <ShieldQuestion className="h-3 w-3" /> Tamper-evident logs
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
};

