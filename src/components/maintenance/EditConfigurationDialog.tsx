import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface EditConfigurationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  window: any;
}

export function EditConfigurationDialog({ open, onOpenChange, window }: EditConfigurationDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const details = window.details || {};

  // Firmware settings
  const [firmwareSource, setFirmwareSource] = useState(details.firmware_source || 'dell_catalog');
  const [componentFilter, setComponentFilter] = useState(details.component_filter || '');
  const [autoSelectLatest, setAutoSelectLatest] = useState(details.auto_select_latest ?? true);

  // Execution options
  const [maxParallel, setMaxParallel] = useState(details.max_parallel || 1);
  const [minHealthyHosts, setMinHealthyHosts] = useState(details.min_healthy_hosts || 2);
  const [verifyAfterEach, setVerifyAfterEach] = useState(details.verify_after_each ?? true);
  const [continueOnFailure, setContinueOnFailure] = useState(details.continue_on_failure ?? false);
  const [rebootServers, setRebootServers] = useState(details.reboot_servers ?? true);

  // Backup settings
  const [backupScp, setBackupScp] = useState(details.backup_scp ?? true);
  const [backupComponents, setBackupComponents] = useState<string[]>(
    details.backup_components || ['bios', 'idrac', 'nic', 'raid']
  );

  const handleSave = async () => {
    setLoading(true);
    try {
      const updatedDetails = {
        ...details,
        firmware_source: firmwareSource,
        component_filter: componentFilter,
        auto_select_latest: autoSelectLatest,
        max_parallel: maxParallel,
        min_healthy_hosts: minHealthyHosts,
        verify_after_each: verifyAfterEach,
        continue_on_failure: continueOnFailure,
        reboot_servers: rebootServers,
        backup_scp: backupScp,
        backup_components: backupComponents,
      };

      const { error } = await supabase
        .from('maintenance_windows')
        .update({ details: updatedDetails })
        .eq('id', window.id);

      if (error) throw error;

      toast({
        title: "Configuration updated",
        description: "Maintenance window configuration has been updated successfully."
      });

      queryClient.invalidateQueries({ queryKey: ['maintenance-windows'] });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error updating configuration",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleBackupComponent = (component: string) => {
    setBackupComponents(prev =>
      prev.includes(component)
        ? prev.filter(c => c !== component)
        : [...prev, component]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Configuration</DialogTitle>
          <DialogDescription>
            Update firmware settings, execution options, and backup configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {window.maintenance_type !== 'esxi_only' && (
            <>
              <div className="space-y-4">
                <h3 className="font-medium">Firmware Settings</h3>
                
                <div className="space-y-2">
                  <Label htmlFor="firmware-source">Firmware Source</Label>
                  <Select value={firmwareSource} onValueChange={setFirmwareSource}>
                    <SelectTrigger id="firmware-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dell_catalog">Dell Online Catalog</SelectItem>
                      <SelectItem value="manual_packages">Manual Packages</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="component-filter">Component Filter (optional)</Label>
                  <Input
                    id="component-filter"
                    placeholder="e.g., BIOS,iDRAC"
                    value={componentFilter}
                    onChange={(e) => setComponentFilter(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-latest">Auto-select Latest Versions</Label>
                    <div className="text-sm text-muted-foreground">
                      Automatically use the latest firmware versions
                    </div>
                  </div>
                  <Switch
                    id="auto-latest"
                    checked={autoSelectLatest}
                    onCheckedChange={setAutoSelectLatest}
                  />
                </div>
              </div>

              <Separator />
            </>
          )}

          <div className="space-y-4">
            <h3 className="font-medium">Execution Options</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max-parallel">Max Parallel Updates</Label>
                <Input
                  id="max-parallel"
                  type="number"
                  min="1"
                  value={maxParallel}
                  onChange={(e) => setMaxParallel(parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="min-healthy">Min Healthy Hosts</Label>
                <Input
                  id="min-healthy"
                  type="number"
                  min="1"
                  value={minHealthyHosts}
                  onChange={(e) => setMinHealthyHosts(parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="verify">Verify After Each Update</Label>
              <Switch
                id="verify"
                checked={verifyAfterEach}
                onCheckedChange={setVerifyAfterEach}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="continue">Continue on Failure</Label>
              <Switch
                id="continue"
                checked={continueOnFailure}
                onCheckedChange={setContinueOnFailure}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="reboot">Reboot Servers After Update</Label>
              <Switch
                id="reboot"
                checked={rebootServers}
                onCheckedChange={setRebootServers}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-medium">Backup Settings</h3>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="backup-scp">SCP Backup Before Update</Label>
                <div className="text-sm text-muted-foreground">
                  Create configuration backup before applying changes
                </div>
              </div>
              <Switch
                id="backup-scp"
                checked={backupScp}
                onCheckedChange={setBackupScp}
              />
            </div>

            {backupScp && (
              <div className="space-y-2">
                <Label>Backup Components</Label>
                <div className="grid grid-cols-2 gap-4">
                  {['bios', 'idrac', 'nic', 'raid'].map(component => (
                    <div key={component} className="flex items-center space-x-2">
                      <Checkbox
                        id={`backup-${component}`}
                        checked={backupComponents.includes(component)}
                        onCheckedChange={() => toggleBackupComponent(component)}
                      />
                      <Label
                        htmlFor={`backup-${component}`}
                        className="text-sm font-normal cursor-pointer uppercase"
                      >
                        {component}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
