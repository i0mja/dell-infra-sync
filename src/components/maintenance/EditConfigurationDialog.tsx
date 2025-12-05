import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { FirmwareSourceSelector } from "@/components/common/FirmwareSourceSelector";
import { useFirmwarePackages } from "@/hooks/useFirmwarePackages";

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
  const { firmwarePackages } = useFirmwarePackages();

  // Firmware settings
  const [firmwareSource, setFirmwareSource] = useState<'local_repository' | 'dell_online_catalog' | 'skip' | 'manual'>(
    details.firmware_source || 'local_repository'
  );
  const [componentFilter, setComponentFilter] = useState<string[]>(
    details.component_filter || ['all']
  );
  const [autoSelectLatest, setAutoSelectLatest] = useState(details.auto_select_latest ?? true);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>(
    details.firmware_package_ids || []
  );

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
        firmware_package_ids: selectedPackageIds,
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
                
                <FirmwareSourceSelector
                  value={firmwareSource}
                  onChange={setFirmwareSource}
                  componentFilter={componentFilter}
                  onComponentFilterChange={setComponentFilter}
                  autoSelectLatest={autoSelectLatest}
                  onAutoSelectLatestChange={setAutoSelectLatest}
                  showManualOption={false}
                  showSkipOption={false}
                />

                {firmwareSource === 'local_repository' && (
                  <div className="space-y-2">
                    <Label>Select Firmware Packages</Label>
                    <div className="border rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
                      {firmwarePackages
                        .filter(pkg => pkg.upload_status === 'completed' || pkg.upload_status === 'available')
                        .map(pkg => (
                          <div key={pkg.id} className="flex items-center space-x-2">
                            <Checkbox
                              checked={selectedPackageIds.includes(pkg.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedPackageIds(prev => [...prev, pkg.id]);
                                } else {
                                  setSelectedPackageIds(prev => prev.filter(id => id !== pkg.id));
                                }
                              }}
                            />
                            <span className="flex-1 text-sm truncate">{pkg.filename}</span>
                            <Badge variant="outline">{pkg.component_type}</Badge>
                            <span className="text-xs text-muted-foreground">{pkg.dell_version}</span>
                          </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedPackageIds.length} package(s) selected
                    </p>
                  </div>
                )}
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
