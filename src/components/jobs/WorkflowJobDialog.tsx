import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Info, Plus, X, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

interface WorkflowJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultJobType?: 'prepare_host_for_update' | 'verify_host_after_update' | 'rolling_cluster_update';
  preSelectedServerId?: string;
  preSelectedCluster?: string;
}

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  vcenter_host_id: string | null;
}

interface VCenterHost {
  id: string;
  name: string;
  cluster: string | null;
  server_id: string | null;
}

interface FirmwareVersion {
  component: string;
  version: string;
}

export const WorkflowJobDialog = ({
  open,
  onOpenChange,
  onSuccess,
  defaultJobType,
  preSelectedServerId,
  preSelectedCluster
}: WorkflowJobDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState<string>(defaultJobType || '');
  const [servers, setServers] = useState<Server[]>([]);
  const [vcenterHosts, setVCenterHosts] = useState<VCenterHost[]>([]);
  const [clusters, setClusters] = useState<string[]>([]);
  
  // Prepare workflow fields
  const [selectedServerId, setSelectedServerId] = useState(preSelectedServerId || '');
  const [selectedVCenterHostId, setSelectedVCenterHostId] = useState('');
  const [backupScp, setBackupScp] = useState(true);
  const [maintenanceTimeout, setMaintenanceTimeout] = useState([600]);
  
  // Verify workflow fields
  const [expectedVersions, setExpectedVersions] = useState<FirmwareVersion[]>([]);
  
  // Rolling update workflow fields
  const [selectedCluster, setSelectedCluster] = useState(preSelectedCluster || '');
  const [minHealthyHosts, setMinHealthyHosts] = useState(2);
  const [maxParallel, setMaxParallel] = useState(1);
  const [verifyAfterEach, setVerifyAfterEach] = useState(true);
  const [continueOnFailure, setContinueOnFailure] = useState(false);
  
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchServers();
      fetchVCenterHosts();
      if (preSelectedServerId) {
        setSelectedServerId(preSelectedServerId);
        // Auto-detect vCenter host
        const server = servers.find(s => s.id === preSelectedServerId);
        if (server?.vcenter_host_id) {
          setSelectedVCenterHostId(server.vcenter_host_id);
        }
      }
    }
  }, [open, preSelectedServerId]);

  const fetchServers = async () => {
    const { data } = await supabase
      .from("servers")
      .select("id, ip_address, hostname, vcenter_host_id")
      .order("ip_address");
    
    setServers(data || []);
  };

  const fetchVCenterHosts = async () => {
    const { data } = await supabase
      .from("vcenter_hosts")
      .select("id, name, cluster, server_id")
      .order("cluster, name");
    
    if (data) {
      setVCenterHosts(data);
      // Extract unique clusters
      const uniqueClusters = [...new Set(data.map(h => h.cluster).filter(Boolean))];
      setClusters(uniqueClusters as string[]);
    }
  };

  const addExpectedVersion = () => {
    setExpectedVersions([...expectedVersions, { component: '', version: '' }]);
  };

  const removeExpectedVersion = (index: number) => {
    setExpectedVersions(expectedVersions.filter((_, i) => i !== index));
  };

  const updateExpectedVersion = (index: number, field: 'component' | 'version', value: string) => {
    const updated = [...expectedVersions];
    updated[index][field] = value;
    setExpectedVersions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let details: any = { notes };
      let target_scope: any = {};

      if (jobType === 'prepare_host_for_update') {
        if (!selectedServerId) {
          throw new Error('Please select a server');
        }
        details.server_id = selectedServerId;
        details.vcenter_host_id = selectedVCenterHostId || null;
        details.backup_scp = backupScp;
        details.maintenance_timeout = maintenanceTimeout[0];
        target_scope = { server_ids: [selectedServerId] };
      } else if (jobType === 'verify_host_after_update') {
        if (!selectedServerId) {
          throw new Error('Please select a server');
        }
        details.server_id = selectedServerId;
        details.vcenter_host_id = selectedVCenterHostId || null;
        if (expectedVersions.length > 0) {
          details.expected_firmware_versions = expectedVersions.reduce((acc, ev) => {
            if (ev.component && ev.version) {
              acc[ev.component] = ev.version;
            }
            return acc;
          }, {} as Record<string, string>);
        }
        target_scope = { server_ids: [selectedServerId] };
      } else if (jobType === 'rolling_cluster_update') {
        if (!selectedCluster) {
          throw new Error('Please select a cluster');
        }
        details.cluster_id = selectedCluster;
        details.firmware_updates = []; // Would be filled by ClusterUpdateWizard
        details.backup_scp = backupScp;
        details.min_healthy_hosts = minHealthyHosts;
        details.max_parallel = maxParallel;
        details.verify_after_each = verifyAfterEach;
        details.continue_on_failure = continueOnFailure;
        target_scope = { cluster_id: selectedCluster };
      }

      const { error } = await supabase
        .from("jobs")
        .insert([{
          job_type: jobType as any,
          created_by: user?.id!,
          target_scope,
          details,
          status: 'pending'
        }]);

      if (error) throw error;

      toast({
        title: "Workflow job created",
        description: `${jobType.replace(/_/g, ' ')} workflow has been queued.`,
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      toast({
        title: "Error creating workflow job",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setJobType(defaultJobType || '');
    setSelectedServerId('');
    setSelectedVCenterHostId('');
    setBackupScp(true);
    setMaintenanceTimeout([600]);
    setExpectedVersions([]);
    setSelectedCluster('');
    setMinHealthyHosts(2);
    setMaxParallel(1);
    setVerifyAfterEach(true);
    setContinueOnFailure(false);
    setNotes('');
  };

  const getDialogTitle = () => {
    if (jobType === 'prepare_host_for_update') return 'Prepare Host for Update';
    if (jobType === 'verify_host_after_update') return 'Verify Host After Update';
    if (jobType === 'rolling_cluster_update') return 'Rolling Cluster Update';
    return 'Create Workflow Job';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{getDialogTitle()}</DialogTitle>
          <DialogDescription>
            Create an automated workflow job for server maintenance operations
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!defaultJobType && (
            <div className="space-y-2">
              <Label htmlFor="jobType">Workflow Type</Label>
              <Select value={jobType} onValueChange={setJobType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select workflow type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepare_host_for_update">Prepare Host for Update</SelectItem>
                  <SelectItem value="verify_host_after_update">Verify Host After Update</SelectItem>
                  <SelectItem value="rolling_cluster_update">Rolling Cluster Update</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {jobType === 'prepare_host_for_update' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="server">Server</Label>
                <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select server" />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.map(server => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.hostname || server.ip_address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vcenterHost">vCenter Host (Optional)</Label>
                <Select value={selectedVCenterHostId} onValueChange={setSelectedVCenterHostId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select vCenter host or leave empty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {vcenterHosts.map(host => (
                      <SelectItem key={host.id} value={host.id}>
                        {host.name} {host.cluster && `(${host.cluster})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="backupScp" 
                  checked={backupScp} 
                  onCheckedChange={(checked) => setBackupScp(checked as boolean)}
                />
                <Label htmlFor="backupScp" className="font-normal">
                  Create SCP backup before maintenance
                </Label>
              </div>

              <div className="space-y-2">
                <Label>Maintenance Mode Timeout: {maintenanceTimeout[0]}s</Label>
                <Slider
                  value={maintenanceTimeout}
                  onValueChange={setMaintenanceTimeout}
                  min={300}
                  max={1800}
                  step={60}
                />
                <p className="text-sm text-muted-foreground">
                  Maximum time to wait for VMs to evacuate
                </p>
              </div>
            </>
          )}

          {jobType === 'verify_host_after_update' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="server">Server</Label>
                <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select server" />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.map(server => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.hostname || server.ip_address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vcenterHost">vCenter Host (Optional)</Label>
                <Select value={selectedVCenterHostId} onValueChange={setSelectedVCenterHostId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select vCenter host or leave empty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {vcenterHosts.map(host => (
                      <SelectItem key={host.id} value={host.id}>
                        {host.name} {host.cluster && `(${host.cluster})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Expected Firmware Versions (Optional)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addExpectedVersion}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Version
                  </Button>
                </div>
                {expectedVersions.map((version, index) => (
                  <Card key={index} className="p-3">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        placeholder="Component (e.g., BIOS)"
                        value={version.component}
                        onChange={(e) => updateExpectedVersion(index, 'component', e.target.value)}
                      />
                      <Input
                        placeholder="Version (e.g., 2.15.0)"
                        value={version.version}
                        onChange={(e) => updateExpectedVersion(index, 'version', e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeExpectedVersion(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {jobType === 'rolling_cluster_update' && (
            <>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Use the Cluster Update Wizard for a guided experience with firmware selection and safety checks.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="cluster">Cluster</Label>
                <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters.map(cluster => (
                      <SelectItem key={cluster} value={cluster}>
                        {cluster}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="backupScpCluster" 
                  checked={backupScp} 
                  onCheckedChange={(checked) => setBackupScp(checked as boolean)}
                />
                <Label htmlFor="backupScpCluster" className="font-normal">
                  Create SCP backups for each host
                </Label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minHealthy">Min Healthy Hosts</Label>
                  <Input
                    id="minHealthy"
                    type="number"
                    min={1}
                    value={minHealthyHosts}
                    onChange={(e) => setMinHealthyHosts(parseInt(e.target.value) || 1)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxParallel">Max Parallel Updates</Label>
                  <Input
                    id="maxParallel"
                    type="number"
                    min={1}
                    max={5}
                    value={maxParallel}
                    onChange={(e) => setMaxParallel(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="verifyEach" 
                  checked={verifyAfterEach} 
                  onCheckedChange={(checked) => setVerifyAfterEach(checked as boolean)}
                />
                <Label htmlFor="verifyEach" className="font-normal">
                  Verify each host after update
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="continueOnFail" 
                  checked={continueOnFailure} 
                  onCheckedChange={(checked) => setContinueOnFailure(checked as boolean)}
                />
                <Label htmlFor="continueOnFail" className="font-normal text-destructive">
                  Continue on failure (not recommended)
                </Label>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add notes about this workflow..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !jobType}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
