import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArchiveRestore, RotateCcw } from "lucide-react";

const backups = [
  { target: "iDRAC configs", schedule: "Daily 02:00", retention: "30 days", encryption: "Enabled" },
  { target: "vCenter creds", schedule: "Daily 03:00", retention: "60 days", encryption: "Enabled" },
  { target: "SCP profiles", schedule: "Weekly Sun", retention: "90 days", encryption: "Enabled" },
];

const recovery = [
  "Scheduled SCP/iDRAC config backups",
  "Versioned config history with diffs",
  "Policy-based retention and encryption",
  "One-click restore with pre-flight validation",
  "Cross-device config compare and drift alerts",
  "Integrity checks with checksum/manifest",
  "Dry-run mode for restores",
  "Post-restore validation checklist",
  "Break-glass recovery bundles",
];

export const BackupRecoveryPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Backup, Config Drift, and Recovery</CardTitle>
        <CardDescription>Scheduled backups, retention, and validated restores</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Target</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Retention</TableHead>
              <TableHead className="text-right">Encryption</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.map((item) => (
              <TableRow key={item.target}>
                <TableCell className="font-medium">{item.target}</TableCell>
                <TableCell>{item.schedule}</TableCell>
                <TableCell>{item.retention}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary">{item.encryption}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Card className="border-muted-foreground/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ArchiveRestore className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Recovery Controls</CardTitle>
            </div>
            <CardDescription>Diffs, integrity checks, and dry-run safety</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ScrollArea className="h-32 pr-2">
              <div className="space-y-2">
                {recovery.map((item) => (
                  <div key={item} className="rounded border border-muted-foreground/20 p-2">
                    {item}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3" /> Dry-run restore
              </Badge>
              <Badge variant="outline">Checksum enforcement</Badge>
              <Badge variant="outline">Break-glass bundles</Badge>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
};

