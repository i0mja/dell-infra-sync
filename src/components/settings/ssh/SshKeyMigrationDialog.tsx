import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle, CheckCircle2, Key, Server, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InlineKeyInfo {
  id: string;
  name: string;
  type: "replication_target" | "zfs_template";
  hasInlineKey: boolean;
  hasCentralizedKey: boolean;
  hostname?: string;
}

interface SshKeyMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function SshKeyMigrationDialog({
  open,
  onOpenChange,
  onComplete,
}: SshKeyMigrationDialogProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [scanResults, setScanResults] = useState<InlineKeyInfo[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [migrationProgress, setMigrationProgress] = useState(0);
  const [migrationResults, setMigrationResults] = useState<{ success: number; failed: number }>({ success: 0, failed: 0 });
  const [clearInlineKeys, setClearInlineKeys] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);

  useEffect(() => {
    if (open) {
      scanForInlineKeys();
    } else {
      // Reset state when closing
      setScanResults([]);
      setSelectedItems([]);
      setMigrationProgress(0);
      setMigrationResults({ success: 0, failed: 0 });
      setScanComplete(false);
    }
  }, [open]);

  const scanForInlineKeys = async () => {
    setIsScanning(true);
    const results: InlineKeyInfo[] = [];

    try {
      // Scan replication targets
      const { data: targets } = await supabase
        .from("replication_targets")
        .select("id, name, hostname, ssh_key_encrypted, ssh_key_id");

      (targets || []).forEach((t) => {
        if (t.ssh_key_encrypted) {
          results.push({
            id: t.id,
            name: t.name,
            type: "replication_target",
            hasInlineKey: true,
            hasCentralizedKey: !!t.ssh_key_id,
            hostname: t.hostname,
          });
        }
      });

      // Scan ZFS templates
      const { data: templates } = await supabase
        .from("zfs_target_templates")
        .select("id, name, ssh_key_encrypted, ssh_key_id");

      (templates || []).forEach((t) => {
        if (t.ssh_key_encrypted) {
          results.push({
            id: t.id,
            name: t.name,
            type: "zfs_template",
            hasInlineKey: true,
            hasCentralizedKey: !!t.ssh_key_id,
          });
        }
      });

      setScanResults(results);
      // Auto-select items that don't have centralized keys
      setSelectedItems(results.filter(r => !r.hasCentralizedKey).map(r => r.id));
      setScanComplete(true);
    } catch (error) {
      console.error("Error scanning for inline keys:", error);
      toast.error("Failed to scan for inline keys");
    } finally {
      setIsScanning(false);
    }
  };

  const handleMigrate = async () => {
    if (selectedItems.length === 0) {
      toast.error("No items selected for migration");
      return;
    }

    setIsMigrating(true);
    setMigrationProgress(0);
    const results = { success: 0, failed: 0 };

    const itemsToMigrate = scanResults.filter(r => selectedItems.includes(r.id));
    
    for (let i = 0; i < itemsToMigrate.length; i++) {
      const item = itemsToMigrate[i];
      
      try {
        // Get the inline key data
        let keyData: any;
        if (item.type === "replication_target") {
          const { data } = await supabase
            .from("replication_targets")
            .select("ssh_key_encrypted, ssh_username")
            .eq("id", item.id)
            .single();
          keyData = data;
        } else {
          const { data } = await supabase
            .from("zfs_target_templates")
            .select("ssh_key_encrypted, default_ssh_username")
            .eq("id", item.id)
            .single();
          keyData = data ? { ...data, ssh_username: data.default_ssh_username } : null;
        }

        if (!keyData?.ssh_key_encrypted) {
          results.failed++;
          continue;
        }

        // Create a new centralized SSH key entry
        const { data: newKey, error: insertError } = await supabase
          .from("ssh_keys")
          .insert({
            name: `Migrated - ${item.name}`,
            description: `Auto-migrated from ${item.type === "replication_target" ? "replication target" : "ZFS template"}: ${item.name}`,
            key_type: "ed25519", // Default, since we don't know the original type
            public_key: "MIGRATED_KEY", // Placeholder - inline keys don't have public key stored
            public_key_fingerprint: `migrated-${item.id.slice(0, 8)}`,
            private_key_encrypted: keyData.ssh_key_encrypted,
            status: "active",
            activated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // Update the source to reference the centralized key
        if (item.type === "replication_target") {
          await supabase
            .from("replication_targets")
            .update({ 
              ssh_key_id: newKey.id,
              ...(clearInlineKeys ? { ssh_key_encrypted: null } : {})
            })
            .eq("id", item.id);
        } else {
          await supabase
            .from("zfs_target_templates")
            .update({ 
              ssh_key_id: newKey.id,
              ...(clearInlineKeys ? { ssh_key_encrypted: null } : {})
            })
            .eq("id", item.id);
        }

        // Create deployment record
        await supabase
          .from("ssh_key_deployments")
          .insert({
            ssh_key_id: newKey.id,
            ...(item.type === "replication_target" 
              ? { replication_target_id: item.id }
              : { zfs_template_id: item.id }),
            status: "deployed",
            deployed_at: new Date().toISOString(),
          });

        results.success++;
      } catch (error) {
        console.error(`Failed to migrate ${item.name}:`, error);
        results.failed++;
      }

      setMigrationProgress(Math.round(((i + 1) / itemsToMigrate.length) * 100));
    }

    setMigrationResults(results);
    setIsMigrating(false);

    if (results.success > 0) {
      toast.success(`Successfully migrated ${results.success} SSH key(s)`);
      onComplete?.();
    }
    if (results.failed > 0) {
      toast.error(`Failed to migrate ${results.failed} item(s)`);
    }
  };

  const needsMigration = scanResults.filter(r => !r.hasCentralizedKey);
  const alreadyMigrated = scanResults.filter(r => r.hasCentralizedKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            SSH Key Migration
          </DialogTitle>
          <DialogDescription>
            Migrate inline SSH keys to centralized key management
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isScanning ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Scanning for inline SSH keys...</span>
            </div>
          ) : scanComplete && migrationResults.success === 0 && migrationResults.failed === 0 ? (
            <>
              {scanResults.length === 0 ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    No inline SSH keys found. All keys are already centralized.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {needsMigration.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        Needs Migration ({needsMigration.length})
                      </h4>
                      <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                        {needsMigration.map((item) => (
                          <div key={item.id} className="flex items-center gap-3 p-2">
                            <Checkbox
                              checked={selectedItems.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setSelectedItems(prev =>
                                  checked
                                    ? [...prev, item.id]
                                    : prev.filter(id => id !== item.id)
                                );
                              }}
                            />
                            {item.type === "replication_target" ? (
                              <Server className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Database className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.type === "replication_target" ? "Replication Target" : "ZFS Template"}
                                {item.hostname && ` • ${item.hostname}`}
                              </p>
                            </div>
                            <Badge variant="outline">Inline Key</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {alreadyMigrated.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Already Migrated ({alreadyMigrated.length})
                      </h4>
                      <div className="border rounded-md divide-y max-h-32 overflow-y-auto opacity-60">
                        {alreadyMigrated.map((item) => (
                          <div key={item.id} className="flex items-center gap-3 p-2">
                            {item.type === "replication_target" ? (
                              <Server className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Database className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{item.name}</p>
                            </div>
                            <Badge variant="secondary">Centralized</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {needsMigration.length > 0 && (
                    <div className="flex items-center gap-2 pt-2">
                      <Checkbox
                        id="clearInline"
                        checked={clearInlineKeys}
                        onCheckedChange={(checked) => setClearInlineKeys(!!checked)}
                      />
                      <label htmlFor="clearInline" className="text-sm text-muted-foreground">
                        Clear inline keys after migration (recommended)
                      </label>
                    </div>
                  )}
                </>
              )}
            </>
          ) : isMigrating ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>Migrating SSH keys...</span>
              </div>
              <Progress value={migrationProgress} />
              <p className="text-center text-sm text-muted-foreground">
                {migrationProgress}% complete
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Migration complete! {migrationResults.success} key(s) migrated successfully.
                  {migrationResults.failed > 0 && ` ${migrationResults.failed} failed.`}
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>

        <DialogFooter>
          {!isMigrating && migrationResults.success === 0 && migrationResults.failed === 0 && needsMigration.length > 0 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleMigrate}
                disabled={selectedItems.length === 0}
              >
                Migrate {selectedItems.length} Key(s)
              </Button>
            </>
          )}
          {(migrationResults.success > 0 || migrationResults.failed > 0 || needsMigration.length === 0) && !isMigrating && (
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}