import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { PreFlightCheckDialog } from "./PreFlightCheckDialog";

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  preSelectedServerId?: string;
  quickScanIp?: string;
}

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
}

interface CredentialSet {
  id: string;
  name: string;
  description: string | null;
  priority: number;
}

export const CreateJobDialog = ({ open, onOpenChange, onSuccess, preSelectedServerId, quickScanIp }: CreateJobDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState<'firmware_update' | 'discovery_scan' | 'full_server_update' | 'boot_configuration' | ''>("");
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [scanRange, setScanRange] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [notes, setNotes] = useState("");
  const [firmwareUri, setFirmwareUri] = useState("");
  const [component, setComponent] = useState("BIOS");
  const [firmwareSource, setFirmwareSource] = useState<'manual' | 'dell_online' | 'dell_direct'>('manual');
  const [dellCatalogUrl, setDellCatalogUrl] = useState('https://downloads.dell.com/catalog/Catalog.xml');
  const [autoSelectLatest, setAutoSelectLatest] = useState(true);
  const [credentialSets, setCredentialSets] = useState<CredentialSet[]>([]);
  const [selectedCredentialSets, setSelectedCredentialSets] = useState<string[]>([]);
  const [preFlightOpen, setPreFlightOpen] = useState(false);
  const [preFlightServerId, setPreFlightServerId] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchServers();
      fetchCredentialSets();
      // Pre-select server if provided
      if (preSelectedServerId) {
        setSelectedServers([preSelectedServerId]);
        setJobType('firmware_update');
      }
      // Quick scan mode for discovery
      if (quickScanIp) {
        setJobType('discovery_scan');
        setScanRange(quickScanIp);
      }
    }
  }, [open, preSelectedServerId, quickScanIp]);

  const fetchServers = async () => {
    const { data } = await supabase
      .from("servers")
      .select("id, ip_address, hostname, model")
      .order("ip_address");
    
    setServers(data || []);
  };

  const fetchCredentialSets = async () => {
    const { data } = await supabase
      .from("credential_sets")
      .select("id, name, description, priority")
      .order("priority");
    
    setCredentialSets(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if any selected server has vCenter link for firmware updates
    if (jobType === 'firmware_update' || jobType === 'full_server_update') {
      const { data: serversData } = await supabase
        .from('servers')
        .select('id, vcenter_host_id')
        .in('id', selectedServers);
      
      const vcenterLinkedServers = serversData?.filter(s => s.vcenter_host_id) || [];
      
      if (vcenterLinkedServers.length > 0) {
        // Open pre-flight check for first vCenter-linked server
        setPreFlightServerId(vcenterLinkedServers[0].id);
        setPreFlightOpen(true);
        return; // Don't proceed with job creation yet
      }
    }
    
    // Continue with job creation
    await createJob();
  };

  const createJob = async () => {
    setLoading(true);

    try {
      let target_scope: any = {};
      let details: any = { notes };

      if (jobType === 'firmware_update' || jobType === 'full_server_update' || jobType === 'boot_configuration') {
        if (selectedServers.length === 0) {
          throw new Error('Please select at least one server');
        }
        target_scope = { server_ids: selectedServers };
        details.firmware_uri = firmwareUri || undefined;
        
        // Only set component for single firmware updates
        if (jobType === 'firmware_update') {
          details.component = component;
          details.version = "latest";
          details.apply_time = "OnReset";
        }
        // Add firmware source information
        if (jobType === 'firmware_update') {
          details.firmware_source = firmwareSource === 'dell_online' ? 'dell_online_catalog' : 
                                     firmwareSource === 'dell_direct' ? 'dell_direct_url' : 
                                     'manual_repository';
          if (firmwareSource === 'dell_online') {
            details.dell_catalog_url = dellCatalogUrl;
            details.auto_select_latest = autoSelectLatest;
          }
        }
      } else if (jobType === 'discovery_scan') {
        if (!scanRange) {
          throw new Error('Please enter an IP range to scan');
        }
        target_scope = { ip_range: scanRange };
        details.scan_type = 'redfish';
        details.credential_set_ids = selectedCredentialSets;
      }

      const { data: result, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: jobType as "firmware_update" | "discovery_scan" | "vcenter_sync" | "full_server_update",
          created_by: user?.id,
          target_scope,
          details,
          schedule_at: scheduleAt || null,
          credential_set_ids: jobType === 'discovery_scan' ? selectedCredentialSets : undefined,
        }
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed to create job');

      toast({
        title: "Job Created",
        description: `Job has been created and will be picked up by the job executor`,
      });

      // Reset form
      setJobType('');
      setSelectedServers([]);
      setScanRange("");
      setScheduleAt("");
      setNotes("");
      setFirmwareUri("");
      setComponent("BIOS");
      setSelectedCredentialSets([]);
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error creating job",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleServer = (serverId: string) => {
    setSelectedServers(prev =>
      prev.includes(serverId)
        ? prev.filter(id => id !== serverId)
        : [...prev, serverId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>
            Configure and schedule a new job for firmware updates, server discovery, or vCenter synchronization.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job_type">Job Type *</Label>
            <Select value={jobType} onValueChange={(value) => setJobType(value as any)} required>
              <SelectTrigger>
                <SelectValue placeholder="Select job type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="firmware_update">Firmware Update (Single Component)</SelectItem>
                <SelectItem value="full_server_update">Full Server Update (All Components)</SelectItem>
                <SelectItem value="discovery_scan">IP Discovery Scan</SelectItem>
                <SelectItem value="boot_configuration">Boot Configuration</SelectItem>
              <SelectItem value="virtual_media_mount">Virtual Media - Mount</SelectItem>
              <SelectItem value="virtual_media_unmount">Virtual Media - Unmount</SelectItem>
              <SelectItem value="scp_export">SCP Export (Backup)</SelectItem>
              <SelectItem value="scp_import">SCP Import (Restore)</SelectItem>
              <SelectItem value="bios_config_read">BIOS Config - Read/Snapshot</SelectItem>
              <SelectItem value="bios_config_write">BIOS Config - Write/Apply</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(jobType === 'firmware_update' || jobType === 'full_server_update') && (
            <>
              <div className="space-y-2">
                <Label>Target Servers * ({selectedServers.length} selected)</Label>
                <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                  {servers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No servers available</p>
                  ) : (
                    servers.map((server) => (
                      <div key={server.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={server.id}
                          checked={selectedServers.includes(server.id)}
                          onCheckedChange={() => toggleServer(server.id)}
                        />
                        <label
                          htmlFor={server.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {server.hostname || server.ip_address} ({server.model || 'Unknown model'})
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {jobType === 'firmware_update' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="component">Component *</Label>
                    <Select value={component} onValueChange={setComponent} required>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BIOS">BIOS</SelectItem>
                        <SelectItem value="iDRAC">iDRAC</SelectItem>
                        <SelectItem value="NIC">Network Card</SelectItem>
                        <SelectItem value="RAID">RAID Controller</SelectItem>
                        <SelectItem value="PSU">Power Supply</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Firmware Source *</Label>
                    <Select value={firmwareSource} onValueChange={(value) => setFirmwareSource(value as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">
                          <div className="space-y-0.5">
                            <div className="font-medium">Manual Repository</div>
                            <div className="text-xs text-muted-foreground">Local HTTP server (offline)</div>
                          </div>
                        </SelectItem>
                        <SelectItem value="dell_online">
                          <div className="space-y-0.5">
                            <div className="font-medium">Dell Online Catalog</div>
                            <div className="text-xs text-muted-foreground">downloads.dell.com (internet required)</div>
                          </div>
                        </SelectItem>
                        <SelectItem value="dell_direct">
                          <div className="space-y-0.5">
                            <div className="font-medium">Dell Direct URL</div>
                            <div className="text-xs text-muted-foreground">Specific Dell download link</div>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {firmwareSource === 'manual' && (
                    <div className="space-y-2">
                      <Label htmlFor="firmware_uri">Firmware URI *</Label>
                      <Input
                        id="firmware_uri"
                        placeholder="http://firmware.example.com/dell/BIOS_R740_2.9.0.exe"
                        value={firmwareUri}
                        onChange={(e) => setFirmwareUri(e.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Full URL to firmware package (.exe)
                      </p>
                    </div>
                  )}

                  {firmwareSource === 'dell_online' && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="dell_catalog_url">Dell Catalog URL</Label>
                        <Input
                          id="dell_catalog_url"
                          value={dellCatalogUrl}
                          onChange={(e) => setDellCatalogUrl(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Default works for most scenarios
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="auto_latest"
                          checked={autoSelectLatest}
                          onCheckedChange={(checked) => setAutoSelectLatest(checked as boolean)}
                        />
                        <label htmlFor="auto_latest" className="text-sm cursor-pointer">
                          Automatically install latest available firmware
                        </label>
                      </div>
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          iDRAC will query Dell's catalog and download the latest firmware. Server must have internet connectivity.
                        </AlertDescription>
                      </Alert>
                    </>
                  )}

                  {firmwareSource === 'dell_direct' && (
                    <div className="space-y-2">
                      <Label htmlFor="firmware_uri">Dell Download URL *</Label>
                      <Input
                        id="firmware_uri"
                        placeholder="https://downloads.dell.com/FOLDER09876543M/1/BIOS_ABC12.exe"
                        value={firmwareUri}
                        onChange={(e) => setFirmwareUri(e.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Direct URL from Dell support downloads
                      </p>
                    </div>
                  )}
                </>
              )}

              {jobType === 'full_server_update' && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Full server update will update all components (BIOS, iDRAC, NIC, RAID) to their latest versions.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {jobType === 'discovery_scan' && (
            <>
              {quickScanIp && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    This will fetch complete server details from iDRAC and update the server record you just created.
                    The Job Executor must be running on your host machine.
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="scan-range">
                  {quickScanIp ? "Server IP Address *" : "IP Range to Scan *"}
                </Label>
                <Input
                  id="scan-range"
                  value={scanRange}
                  onChange={(e) => setScanRange(e.target.value)}
                  placeholder={quickScanIp ? "192.168.1.100" : "e.g., 192.168.1.1-192.168.1.254 or 10.0.0.0/24"}
                  required
                />
                {!quickScanIp && (
                  <p className="text-sm text-muted-foreground">
                    Enter a range (192.168.1.1-192.168.1.254) or CIDR notation (10.0.0.0/24)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Credential Sets to Try *</Label>
                <div className="border rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
                  {credentialSets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No credential sets available</p>
                  ) : (
                    credentialSets.map((set) => (
                      <div key={set.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={set.id}
                          checked={selectedCredentialSets.includes(set.id)}
                          onCheckedChange={(checked) => {
                            setSelectedCredentialSets(prev =>
                              checked
                                ? [...prev, set.id]
                                : prev.filter(id => id !== set.id)
                            );
                          }}
                        />
                        <label
                          htmlFor={set.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {set.name} {set.description && `(${set.description})`}
                        </label>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  The job executor will try each credential set in priority order
                </p>
              </div>
            </>
          )}

          {jobType && (
            <>
              <div className="space-y-2">
                <Label htmlFor="schedule_at">Schedule At (Optional)</Label>
                <Input
                  id="schedule_at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to start immediately
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes about this job..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !jobType}>
              {loading ? "Creating..." : "Create Job"}
            </Button>
          </div>
        </form>
      </DialogContent>
      
      <PreFlightCheckDialog
        open={preFlightOpen}
        onOpenChange={setPreFlightOpen}
        onProceed={createJob}
        serverId={preFlightServerId || ''}
        jobType={jobType as 'firmware_update' | 'full_server_update'}
      />
    </Dialog>
  );
};
