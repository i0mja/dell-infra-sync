import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { JobSummary } from "@/hooks/useScpBackups";

interface CreateBackupTabProps {
  serverId: string;
  serverName: string;
  recentJobs: JobSummary[];
  onJobsRefresh: () => void;
}

export function CreateBackupTab({ serverId, serverName, recentJobs, onJobsRefresh }: CreateBackupTabProps) {
  const [loading, setLoading] = useState(false);
  const [backupName, setBackupName] = useState("");
  const [description, setDescription] = useState("");
  const [includeBios, setIncludeBios] = useState(true);
  const [includeIdrac, setIncludeIdrac] = useState(true);
  const [includeNic, setIncludeNic] = useState(true);
  const [includeRaid, setIncludeRaid] = useState(true);

  useEffect(() => {
    const defaultName = `${serverName} - ${format(new Date(), "yyyy-MM-dd HH:mm")}`;
    setBackupName(defaultName);
  }, [serverName]);

  const handleExport = async () => {
    if (!backupName.trim()) {
      toast.error("Please enter a backup name");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "scp_export",
          target_scope: {
            server_ids: [serverId],
          },
          details: {
            backup_name: backupName,
            description: description || null,
            include_bios: includeBios,
            include_idrac: includeIdrac,
            include_nic: includeNic,
            include_raid: includeRaid,
          },
        },
      });

      if (error) throw error;

      if (data && "success" in data && !data.success) {
        throw new Error((data as any).error || "Failed to create export job");
      }

      toast.success("SCP Export Job Created", {
        description: "Configuration backup has been initiated",
      });

      onJobsRefresh();

      // Reset form
      setBackupName(`${serverName} - ${format(new Date(), "yyyy-MM-dd HH:mm")}`);
      setDescription("");
    } catch (error: any) {
      console.error("Error creating export job:", error);
      toast.error("Failed to create export job", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "running":
        return "default" as const;
      case "pending":
        return "secondary" as const;
      case "completed":
        return "default" as const;
      case "failed":
      case "cancelled":
        return "destructive" as const;
      default:
        return "secondary" as const;
    }
  };

  const activeJobs = recentJobs.filter((job) => job.status === "pending" || job.status === "running");

  return (
    <div className="space-y-6">
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Export creates a backup of the server's configuration profile (SCP) including BIOS, iDRAC, NIC, and RAID settings.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        <div>
          <Label htmlFor="backup-name">Backup Name *</Label>
          <Input
            id="backup-name"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
            placeholder="e.g., Pre-upgrade backup"
          />
        </div>

        <div>
          <Label htmlFor="description">Description (Optional)</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes about this backup..."
            rows={2}
          />
        </div>

        <div className="space-y-3">
          <Label>Components to Export</Label>
          <div className="grid grid-cols-2 gap-3">
            <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setIncludeBios(!includeBios)}>
              <CardContent className="p-4 flex items-start gap-3">
                <Checkbox
                  id="include-bios"
                  checked={includeBios}
                  onCheckedChange={(checked) => setIncludeBios(checked as boolean)}
                />
                <div className="space-y-0.5">
                  <label htmlFor="include-bios" className="text-sm font-medium cursor-pointer">
                    BIOS
                  </label>
                  <p className="text-xs text-muted-foreground">System settings</p>
                </div>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setIncludeIdrac(!includeIdrac)}>
              <CardContent className="p-4 flex items-start gap-3">
                <Checkbox
                  id="include-idrac"
                  checked={includeIdrac}
                  onCheckedChange={(checked) => setIncludeIdrac(checked as boolean)}
                />
                <div className="space-y-0.5">
                  <label htmlFor="include-idrac" className="text-sm font-medium cursor-pointer">
                    iDRAC
                  </label>
                  <p className="text-xs text-muted-foreground">Management</p>
                </div>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setIncludeNic(!includeNic)}>
              <CardContent className="p-4 flex items-start gap-3">
                <Checkbox
                  id="include-nic"
                  checked={includeNic}
                  onCheckedChange={(checked) => setIncludeNic(checked as boolean)}
                />
                <div className="space-y-0.5">
                  <label htmlFor="include-nic" className="text-sm font-medium cursor-pointer">
                    NIC
                  </label>
                  <p className="text-xs text-muted-foreground">Network</p>
                </div>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setIncludeRaid(!includeRaid)}>
              <CardContent className="p-4 flex items-start gap-3">
                <Checkbox
                  id="include-raid"
                  checked={includeRaid}
                  onCheckedChange={(checked) => setIncludeRaid(checked as boolean)}
                />
                <div className="space-y-0.5">
                  <label htmlFor="include-raid" className="text-sm font-medium cursor-pointer">
                    RAID
                  </label>
                  <p className="text-xs text-muted-foreground">Storage</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Button onClick={handleExport} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating Backup...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Create Backup
            </>
          )}
        </Button>
      </div>

      {activeJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Active Export Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeJobs.map((job) => (
              <div key={job.id} className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Job {job.id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.created_at ? format(new Date(job.created_at), "PPp") : "N/A"}
                  </p>
                </div>
                <Badge variant={getStatusBadgeVariant(job.status)} className="uppercase text-xs">
                  {job.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
