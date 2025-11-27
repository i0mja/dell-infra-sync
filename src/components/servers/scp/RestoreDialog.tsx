import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { format } from "date-fns";

interface RestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backupId: string | null;
  serverId: string;
  onRestoreComplete: () => void;
}

export function RestoreDialog({ open, onOpenChange, backupId, serverId, onRestoreComplete }: RestoreDialogProps) {
  const [loading, setLoading] = useState(false);
  const [backup, setBackup] = useState<any>(null);
  const [shutdownType, setShutdownType] = useState<"Graceful" | "Forced" | "NoReboot">("Graceful");
  const [hostPowerState, setHostPowerState] = useState<"On" | "Off">("On");
  const [restoreBios, setRestoreBios] = useState(true);
  const [restoreIdrac, setRestoreIdrac] = useState(true);
  const [restoreNic, setRestoreNic] = useState(true);
  const [restoreRaid, setRestoreRaid] = useState(true);

  useEffect(() => {
    if (open && backupId) {
      fetchBackupDetails();
    }
  }, [open, backupId]);

  const fetchBackupDetails = async () => {
    if (!backupId) return;

    try {
      const { data, error } = await supabase
        .from("scp_backups")
        .select("*")
        .eq("id", backupId)
        .single();

      if (error) throw error;
      setBackup(data);

      // Set default component selections based on what's in the backup
      setRestoreBios(!!data.include_bios);
      setRestoreIdrac(!!data.include_idrac);
      setRestoreNic(!!data.include_nic);
      setRestoreRaid(!!data.include_raid);
    } catch (error: any) {
      console.error("Error fetching backup details:", error);
      toast.error("Failed to load backup details");
    }
  };

  const handleRestore = async () => {
    if (!backupId) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "scp_import",
          target_scope: {
            server_ids: [serverId],
          },
          details: {
            backup_id: backupId,
            shutdown_type: shutdownType,
            host_power_state: hostPowerState,
            restore_bios: restoreBios,
            restore_idrac: restoreIdrac,
            restore_nic: restoreNic,
            restore_raid: restoreRaid,
          },
        },
      });

      if (error) throw error;

      toast.success("Configuration Restore Initiated", {
        description: "Server may reboot during this operation",
      });

      onRestoreComplete();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating restore job:", error);
      toast.error("Failed to start restore", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const getComponents = () => {
    if (!backup) return [];
    const components = [];
    if (backup.include_bios && restoreBios) components.push("BIOS");
    if (backup.include_idrac && restoreIdrac) components.push("iDRAC");
    if (backup.include_nic && restoreNic) components.push("NIC");
    if (backup.include_raid && restoreRaid) components.push("RAID");
    return components;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Restore Configuration
          </DialogTitle>
        </DialogHeader>

        {backup && (
          <div className="space-y-4">
            <Alert variant="default" className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                This will apply configuration from:{" "}
                <strong className="block mt-1">{backup.backup_name}</strong>
                {backup.exported_at && (
                  <span className="text-xs block mt-1">
                    ({format(new Date(backup.exported_at), "MMM d, yyyy 'at' h:mm a")})
                  </span>
                )}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Components to Restore</Label>
              <div className="grid grid-cols-2 gap-2">
                {backup.include_bios && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="restore-bios"
                      checked={restoreBios}
                      onCheckedChange={(checked) => setRestoreBios(checked as boolean)}
                    />
                    <label htmlFor="restore-bios" className="text-sm cursor-pointer">
                      BIOS
                    </label>
                  </div>
                )}
                {backup.include_idrac && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="restore-idrac"
                      checked={restoreIdrac}
                      onCheckedChange={(checked) => setRestoreIdrac(checked as boolean)}
                    />
                    <label htmlFor="restore-idrac" className="text-sm cursor-pointer">
                      iDRAC
                    </label>
                  </div>
                )}
                {backup.include_nic && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="restore-nic"
                      checked={restoreNic}
                      onCheckedChange={(checked) => setRestoreNic(checked as boolean)}
                    />
                    <label htmlFor="restore-nic" className="text-sm cursor-pointer">
                      NIC
                    </label>
                  </div>
                )}
                {backup.include_raid && (
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="restore-raid"
                      checked={restoreRaid}
                      onCheckedChange={(checked) => setRestoreRaid(checked as boolean)}
                    />
                    <label htmlFor="restore-raid" className="text-sm cursor-pointer">
                      RAID
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="shutdown-type">Shutdown Type</Label>
                <Select value={shutdownType} onValueChange={(v: any) => setShutdownType(v)}>
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

              <div className="space-y-2">
                <Label htmlFor="power-state">After Import</Label>
                <Select value={hostPowerState} onValueChange={(v: any) => setHostPowerState(v)}>
                  <SelectTrigger id="power-state">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="On">Power On</SelectItem>
                    <SelectItem value="Off">Power Off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Server may reboot during this operation. Ensure no critical workloads are running.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleRestore} disabled={loading || getComponents().length === 0}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Restore Configuration
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
