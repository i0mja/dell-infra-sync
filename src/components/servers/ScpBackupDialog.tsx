import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Upload, FileJson, AlertCircle, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Database } from "@/integrations/supabase/types";

interface ScpBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    hostname: string | null;
    ip_address: string;
  };
}

interface ScpBackup {
  id: string;
  backup_name: string;
  description: string | null;
  scp_file_size_bytes: number | null;
  include_bios: boolean | null;
  include_idrac: boolean | null;
  include_nic: boolean | null;
  include_raid: boolean | null;
  checksum: string | null;
  exported_at: string | null;
  last_imported_at: string | null;
  is_valid: boolean | null;
  created_by: string | null;
}

type JobStatus = Database["public"]["Enums"]["job_status"];

interface JobSummary {
  id: string;
  status: JobStatus;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  details: any;
}

export function ScpBackupDialog({ open, onOpenChange, server }: ScpBackupDialogProps) {
  const [activeTab, setActiveTab] = useState<"export" | "restore">("export");
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<ScpBackup[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // Export form state
  const [backupName, setBackupName] = useState("");
  const [description, setDescription] = useState("");
  const [includeBios, setIncludeBios] = useState(true);
  const [includeIdrac, setIncludeIdrac] = useState(true);
  const [includeNic, setIncludeNic] = useState(true);
  const [includeRaid, setIncludeRaid] = useState(true);

  // Restore form state
  const [selectedBackupId, setSelectedBackupId] = useState<string>("");
  const [shutdownType, setShutdownType] = useState<"Graceful" | "Forced" | "NoReboot">("Graceful");
  const [hostPowerState, setHostPowerState] = useState<"On" | "Off">("On");

  useEffect(() => {
    if (open) {
      fetchBackups();
      fetchRecentJobs();

      // Set default backup name
      const defaultName = `${server.hostname || server.ip_address} - ${format(new Date(), "yyyy-MM-dd HH:mm")}`;
      setBackupName(defaultName);

      const interval = setInterval(() => {
        fetchRecentJobs(true);
        fetchBackups();
      }, 5000);

      // Clear polling when dialog closes
      return () => clearInterval(interval);
    }
  }, [open, server]);

  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const { data, error } = await supabase
        .from("scp_backups")
        .select(
          "id, backup_name, description, scp_file_size_bytes, include_bios, include_idrac, include_nic, include_raid, checksum, exported_at, last_imported_at, is_valid, created_by"
        )
        .eq("server_id", server.id)
        .order("exported_at", { ascending: false });

      if (error) throw error;
      setBackups(data || []);
    } catch (error: any) {
      console.error("Error fetching backups:", error);
      toast.error("Failed to load backups");
    } finally {
      setLoadingBackups(false);
    }
  };

  const fetchRecentJobs = async (silent = false) => {
    if (!silent) setLoadingJobs(true);
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, status, created_at, started_at, completed_at, details")
        .eq("job_type", "scp_export")
        .contains("target_scope", { server_ids: [server.id] })
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentJobs(data || []);
    } catch (error: any) {
      console.error("Error fetching jobs:", error);
      if (!silent) toast.error("Failed to load job status");
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  };

  const getStatusBadgeVariant = (status: JobStatus) => {
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

  const handleExport = async () => {
    if (!backupName.trim()) {
      toast.error("Please enter a backup name");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create SCP export job
      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "scp_export",
          target_scope: {
            server_ids: [server.id],
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

      fetchRecentJobs(true);

      // Refresh backups list after a delay
      setTimeout(() => {
        fetchBackups();
        fetchRecentJobs(true);
      }, 2000);

      // Reset form
      setBackupName(`${server.hostname || server.ip_address} - ${format(new Date(), "yyyy-MM-dd HH:mm")}`);
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

  const handleRestore = async () => {
    if (!selectedBackupId) {
      toast.error("Please select a backup to restore");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create SCP import job
      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "scp_import",
          target_scope: {
            server_ids: [server.id],
          },
          details: {
            backup_id: selectedBackupId,
            shutdown_type: shutdownType,
            host_power_state: hostPowerState,
          },
        },
      });

      if (error) throw error;

      toast.success("SCP Import Job Created", {
        description: "Configuration restore has been initiated. Server may reboot.",
      });

      // Refresh backups list
      setTimeout(fetchBackups, 2000);
    } catch (error: any) {
      console.error("Error creating import job:", error);
      toast.error("Failed to create import job", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (backupId: string, backupName: string) => {
    setDownloadingId(backupId);
    try {
      const { data, error } = await supabase
        .from("scp_backups")
        .select("scp_content")
        .eq("id", backupId)
        .single();

      if (error) throw error;

      if (!data?.scp_content) {
        toast.error("Run a new SCP export to generate a downloadable backup.");
        return;
      }

      const jsonString =
        typeof data.scp_content === "string"
          ? data.scp_content
          : JSON.stringify(data.scp_content, null, 2);

      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fallbackName = `${server.hostname || server.ip_address}-scp-backup-${format(
        new Date(),
        "yyyyMMdd-HHmmss"
      )}`;
      link.href = url;
      link.download = `${backupName || fallbackName}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success("SCP backup downloaded");
    } catch (error: any) {
      console.error("Error downloading backup:", error);
      toast.error("Failed to download backup", {
        description: error.message,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    if (!confirm("Are you sure you want to delete this backup?")) return;

    try {
      const { error } = await supabase
        .from("scp_backups")
        .delete()
        .eq("id", backupId);

      if (error) throw error;

      toast.success("Backup deleted");
      fetchBackups();
    } catch (error: any) {
      console.error("Error deleting backup:", error);
      toast.error("Failed to delete backup");
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getComponentsBadges = (backup: ScpBackup) => {
    const components = [];
    if (backup.include_bios) components.push("BIOS");
    if (backup.include_idrac) components.push("iDRAC");
    if (backup.include_nic) components.push("NIC");
    if (backup.include_raid) components.push("RAID");
    return components;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            SCP Backup & Restore - {server.hostname || server.ip_address}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "export" | "restore")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export">
              <Download className="h-4 w-4 mr-2" />
              Export (Backup)
            </TabsTrigger>
            <TabsTrigger value="restore">
              <Upload className="h-4 w-4 mr-2" />
              Import (Restore)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Export creates a backup of the server's configuration profile (SCP) including BIOS, iDRAC, NIC, and RAID settings.
              </AlertDescription>
            </Alert>

            <Alert variant="default" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-sm">
                <strong>Export Method:</strong> The system automatically detects your iDRAC firmware version.
                <br />
                • <strong>Newer iDRAC (9 v4.x+, 8 v2.70+):</strong> Uses "Local" export (faster)
                <br />
                • <strong>Older iDRAC:</strong> Automatically falls back to HTTP Push export
                <br />
                • <strong>Air-gapped environments:</strong> Configure SMB/NFS share in Settings → Activity Monitor for maximum compatibility
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

              <div className="space-y-2">
                <Label>Components to Include</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-bios"
                      checked={includeBios}
                      onCheckedChange={(checked) => setIncludeBios(checked as boolean)}
                    />
                    <label htmlFor="include-bios" className="text-sm cursor-pointer">
                      BIOS Settings
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-idrac"
                      checked={includeIdrac}
                      onCheckedChange={(checked) => setIncludeIdrac(checked as boolean)}
                    />
                    <label htmlFor="include-idrac" className="text-sm cursor-pointer">
                      iDRAC Settings
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-nic"
                      checked={includeNic}
                      onCheckedChange={(checked) => setIncludeNic(checked as boolean)}
                    />
                    <label htmlFor="include-nic" className="text-sm cursor-pointer">
                      NIC Settings
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-raid"
                      checked={includeRaid}
                      onCheckedChange={(checked) => setIncludeRaid(checked as boolean)}
                    />
                    <label htmlFor="include-raid" className="text-sm cursor-pointer">
                      RAID Settings
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Recent SCP export jobs</Label>
                  <Button size="sm" variant="ghost" onClick={() => fetchRecentJobs()} disabled={loadingJobs}>
                    Refresh
                  </Button>
                </div>
                <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                  {loadingJobs ? (
                    <div className="text-sm text-muted-foreground">Checking job status...</div>
                  ) : recentJobs.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No recent SCP export jobs for this server. Start a new export to see status.
                    </div>
                  ) : (
                    recentJobs.map((job) => (
                      <div key={job.id} className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">Job {job.id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">
                            Status: {job.status} • Created {job.created_at ? format(new Date(job.created_at), "PPp") : "N/A"}
                          </div>
                          {job.started_at && (
                            <div className="text-xs text-muted-foreground">
                              Started {format(new Date(job.started_at), "PPp")}
                              {job.completed_at ? ` • Completed ${format(new Date(job.completed_at), "PPp")}` : ""}
                            </div>
                          )}
                          {job.details?.error && (
                            <div className="text-xs text-destructive">{job.details.error}</div>
                          )}
                        </div>
                        <Badge variant={getStatusBadgeVariant(job.status)} className="uppercase">
                          {job.status}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Completed jobs will add a backup entry below once the executor uploads the SCP content.
                </p>
              </div>

              <Button
                onClick={handleExport}
                disabled={loading || !backupName.trim()}
                className="w-full"
              >
                {loading ? (
                  "Creating Backup..."
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export Configuration
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="restore" className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Import restores a server configuration from a backup. This operation may require a server reboot.
              </AlertDescription>
            </Alert>

            {loadingBackups ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading backups...
              </div>
            ) : backups.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No backups available. Create a backup first using the Export tab.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label>Select Backup to Restore</Label>
                  <div className="space-y-2 mt-2 max-h-64 overflow-y-auto border rounded-md p-2">
                    {backups.map((backup) => (
                      <div
                        key={backup.id}
                        className={`p-3 border rounded-md cursor-pointer transition-colors ${
                          selectedBackupId === backup.id
                            ? "border-primary bg-primary/5"
                            : "hover:border-muted-foreground/50"
                        }`}
                        onClick={() => setSelectedBackupId(backup.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium">{backup.backup_name}</div>
                            {backup.description && (
                              <div className="text-sm text-muted-foreground mt-1">
                                {backup.description}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {getComponentsBadges(backup).map((component) => (
                                <Badge key={component} variant="secondary" className="text-xs">
                                  {component}
                                </Badge>
                              ))}
                            </div>
                            <div className="text-xs text-muted-foreground mt-2">
                              Exported: {backup.exported_at ? format(new Date(backup.exported_at), "PPp") : "N/A"}
                              {" • "}
                              Size: {formatFileSize(backup.scp_file_size_bytes)}
                            </div>
                            {backup.last_imported_at && (
                              <div className="text-xs text-muted-foreground">
                                Last restored: {format(new Date(backup.last_imported_at), "PPp")}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(backup.id, backup.backup_name);
                              }}
                              disabled={downloadingId === backup.id}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteBackup(backup.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedBackupId && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="shutdown-type">Shutdown Type</Label>
                        <Select value={shutdownType} onValueChange={(v) => setShutdownType(v as any)}>
                          <SelectTrigger id="shutdown-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Graceful">Graceful</SelectItem>
                            <SelectItem value="Forced">Forced</SelectItem>
                            <SelectItem value="NoReboot">No Reboot</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="power-state">Host Power State</Label>
                        <Select value={hostPowerState} onValueChange={(v) => setHostPowerState(v as any)}>
                          <SelectTrigger id="power-state">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="On">On</SelectItem>
                            <SelectItem value="Off">Off</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      onClick={handleRestore}
                      disabled={loading}
                      className="w-full"
                      variant="destructive"
                    >
                      {loading ? (
                        "Restoring Configuration..."
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Restore Configuration
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
