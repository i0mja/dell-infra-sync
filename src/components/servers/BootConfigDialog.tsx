import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardDrive, Network, Disc, Power, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface BootConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname?: string | null;
    boot_mode?: string | null;
    boot_source_override_enabled?: string | null;
    boot_source_override_target?: string | null;
    boot_order?: string[] | null;
  };
}

export function BootConfigDialog({ open, onOpenChange, server }: BootConfigDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("one-time");
  const [oneTimeTarget, setOneTimeTarget] = useState<string>("None");
  const [bootMode, setBootMode] = useState<string>(server.boot_mode || "UEFI");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  
  const bootTargets = [
    { value: "None", label: "None", icon: Power },
    { value: "Pxe", label: "Network (PXE)", icon: Network },
    { value: "Hdd", label: "Hard Disk", icon: HardDrive },
    { value: "Cd", label: "CD/DVD", icon: Disc },
    { value: "Usb", label: "USB", icon: HardDrive },
    { value: "BiosSetup", label: "BIOS Setup", icon: Power },
  ];
  
  const handleFetchConfig = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { action: 'fetch_config' }
        });

      if (jobError) throw jobError;

      toast.success("Fetching boot configuration", {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error fetching boot config:', error);
      toast.error('Failed to fetch boot configuration', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetOneTimeBoot = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { 
            action: 'set_one_time_boot',
            boot_target: oneTimeTarget,
            boot_mode: bootMode
          }
        });

      if (jobError) throw jobError;

      toast.success(`One-time boot set to ${oneTimeTarget}`, {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error setting one-time boot:', error);
      toast.error('Failed to set one-time boot', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisableOverride = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { action: 'disable_override' }
        });

      if (jobError) throw jobError;

      toast.success("Boot override disabled", {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error disabling boot override:', error);
      toast.error('Failed to disable boot override', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
      setConfirmAction(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Boot Configuration
            </DialogTitle>
            <DialogDescription>
              Manage boot settings for {server.hostname || server.ip_address}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="one-time">One-Time Boot</TabsTrigger>
              <TabsTrigger value="current">Current Config</TabsTrigger>
            </TabsList>

            <TabsContent value="one-time" className="space-y-4">
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Boot Device</Label>
                  <Select value={oneTimeTarget} onValueChange={setOneTimeTarget}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select boot device" />
                    </SelectTrigger>
                    <SelectContent>
                      {bootTargets.map((target) => {
                        const Icon = target.icon;
                        return (
                          <SelectItem key={target.value} value={target.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {target.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Device to boot from on next restart only
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Boot Mode</Label>
                  <Select value={bootMode} onValueChange={setBootMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UEFI">UEFI</SelectItem>
                      <SelectItem value="Legacy">Legacy BIOS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Note:</strong> One-time boot will only affect the next system restart. 
                    After that, the server will revert to its configured boot order.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button onClick={handleSetOneTimeBoot} disabled={isSubmitting || oneTimeTarget === "None"}>
                  {isSubmitting ? "Applying..." : "Set One-Time Boot"}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="current" className="space-y-4">
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Boot Mode</Label>
                    <div className="font-mono text-sm">{server.boot_mode || 'Unknown'}</div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Override Status</Label>
                    <Badge variant={server.boot_source_override_enabled === 'Disabled' ? 'outline' : 'default'}>
                      {server.boot_source_override_enabled || 'Unknown'}
                    </Badge>
                  </div>
                </div>

                {server.boot_source_override_enabled && server.boot_source_override_enabled !== 'Disabled' && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Override Target</Label>
                    <div className="font-mono text-sm">{server.boot_source_override_target || 'None'}</div>
                  </div>
                )}

                {server.boot_order && server.boot_order.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Boot Order</Label>
                    <div className="space-y-1">
                      {server.boot_order.map((device, index) => (
                        <div key={device} className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{index + 1}.</span>
                          <code className="text-xs bg-muted px-2 py-1 rounded">{device}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="flex justify-between">
                <div className="flex gap-2">
                  {server.boot_source_override_enabled !== 'Disabled' && (
                    <Button
                      variant="outline"
                      onClick={() => setConfirmAction('disable_override')}
                      disabled={isSubmitting}
                    >
                      Disable Override
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                    Close
                  </Button>
                  <Button onClick={handleFetchConfig} disabled={isSubmitting}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAction !== null} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disable the boot override? The server will boot from its configured boot order on next restart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableOverride} disabled={isSubmitting}>
              {isSubmitting ? "Disabling..." : "Disable Override"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
