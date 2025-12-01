import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { FirmwareSourceSelector } from "@/components/common/FirmwareSourceSelector";
import { 
  Info, 
  Plus, 
  X, 
  Loader2, 
  CheckCircle, 
  AlertTriangle,
  Server,
  Clock,
  Shield
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WorkflowExecutionViewer } from "./WorkflowExecutionViewer";

interface ServerUpdateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preSelectedTarget?: {
    type: 'cluster' | 'group' | 'servers';
    id?: string;
    ids?: string[];
  };
}

interface FirmwareUpdate {
  component: string;
  version: string;
  image_uri: string;
  reboot_required: boolean;
}

interface TargetInfo {
  name: string;
  total: number;
  linked: number;
  connected: number;
}

interface ServerMembership {
  serverId: string;
  serverName: string;
  vcenterCluster?: string;
  serverGroup?: { id: string; name: string };
}

interface ClusterConflict {
  detected: boolean;
  clusterName: string;
  selectedServers: string[];
  allClusterHostIds: string[];
  acknowledged: boolean;
}

const STEPS = [
  { id: 1, name: 'Target Selection', icon: Server },
  { id: 2, name: 'Firmware Selection', icon: Shield },
  { id: 3, name: 'Configuration', icon: Clock },
  { id: 4, name: 'Review & Confirm', icon: CheckCircle },
  { id: 5, name: 'Execution', icon: Loader2 },
];

export const ServerUpdateWizard = ({
  open,
  onOpenChange,
  preSelectedTarget
}: ServerUpdateWizardProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  // Step 1: Target Selection
  const [targetType, setTargetType] = useState<'cluster' | 'group' | 'servers'>(
    preSelectedTarget?.type || 'cluster'
  );
  const [clusters, setClusters] = useState<string[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<string>(preSelectedTarget?.type === 'cluster' && preSelectedTarget?.id ? preSelectedTarget.id : '');
  const [selectedGroup, setSelectedGroup] = useState<string>(preSelectedTarget?.type === 'group' && preSelectedTarget?.id ? preSelectedTarget.id : '');
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>(preSelectedTarget?.type === 'servers' && preSelectedTarget?.ids ? preSelectedTarget.ids : []);
  const [targetInfo, setTargetInfo] = useState<TargetInfo | null>(null);
  const [safetyCheckLoading, setSafetyCheckLoading] = useState(false);
  const [safetyCheckPassed, setSafetyCheckPassed] = useState(false);
  const [serverMemberships, setServerMemberships] = useState<ServerMembership[]>([]);
  const [clusterConflict, setClusterConflict] = useState<ClusterConflict | null>(null);
  
  // Step 2: Firmware Selection
  const [firmwareSource, setFirmwareSource] = useState<'local_repository' | 'dell_online_catalog' | 'manual'>('local_repository');
  const [componentFilter, setComponentFilter] = useState<string[]>(['all']);
  const [autoSelectLatest, setAutoSelectLatest] = useState(true);
  const [firmwareUpdates, setFirmwareUpdates] = useState<FirmwareUpdate[]>([{
    component: '',
    version: '',
    image_uri: '',
    reboot_required: true
  }]);
  
  // Step 3: Configuration
  const [backupScp, setBackupScp] = useState(true);
  const [preflightMode, setPreflightMode] = useState<'strict' | 'relaxed'>('strict');
  const [verifyAfterEach, setVerifyAfterEach] = useState(true);
  const [continueOnFailure, setContinueOnFailure] = useState(false);
  
  // Step 4: Review
  const [confirmed, setConfirmed] = useState(false);
  
  // Step 5: Execution
  const [jobId, setJobId] = useState<string | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchTargets();
    }
  }, [open, targetType]);

  useEffect(() => {
    if (targetType === 'cluster' && selectedCluster) {
      fetchClusterInfo();
    } else if (targetType === 'group' && selectedGroup) {
      fetchGroupInfo();
    } else if (targetType === 'servers' && selectedServerIds.length > 0) {
      fetchServersInfo();
      checkClusterMembership();
    }
  }, [targetType, selectedCluster, selectedGroup, selectedServerIds]);

  const fetchTargets = async () => {
    if (targetType === 'cluster') {
      const { data } = await supabase
        .from("vcenter_hosts")
        .select("cluster")
        .not("cluster", "is", null);
      
      if (data) {
        const uniqueClusters = [...new Set(data.map(h => h.cluster).filter(Boolean))];
        setClusters(uniqueClusters as string[]);
      }
    } else if (targetType === 'group') {
      const { data } = await supabase
        .from("server_groups")
        .select("*");
      
      if (data) setGroups(data);
    } else if (targetType === 'servers') {
      const { data } = await supabase
        .from("servers")
        .select("id, ip_address, hostname, model, connection_status");
      
      if (data) setServers(data);
    }
  };

  const fetchClusterInfo = async () => {
    const { data: hosts } = await supabase
      .from("vcenter_hosts")
      .select("id, server_id, status")
      .eq("cluster", selectedCluster);
    
    if (hosts) {
      setTargetInfo({
        name: selectedCluster,
        total: hosts.length,
        linked: hosts.filter(h => h.server_id).length,
        connected: hosts.filter(h => h.status === 'connected').length
      });
    }
  };

  const fetchGroupInfo = async () => {
    const { data: members } = await supabase
      .from("server_group_members")
      .select("server_id, servers(connection_status)")
      .eq("server_group_id", selectedGroup);
    
    if (members) {
      const group = groups.find(g => g.id === selectedGroup);
      setTargetInfo({
        name: group?.name || 'Unknown',
        total: members.length,
        linked: members.length,
        connected: members.filter((m: any) => m.servers?.connection_status === 'online').length
      });
    }
  };

  const fetchServersInfo = async () => {
    const { data: serversList } = await supabase
      .from("servers")
      .select("*")
      .in("id", selectedServerIds);
    
    if (serversList) {
      setTargetInfo({
        name: `${serversList.length} Server${serversList.length > 1 ? 's' : ''}`,
        total: serversList.length,
        linked: serversList.length,
        connected: serversList.filter(s => s.connection_status === 'online').length
      });
    }
  };

  const checkClusterMembership = async () => {
    if (selectedServerIds.length === 0) {
      setClusterConflict(null);
      return;
    }

    // Check if any selected server belongs to a cluster
    const { data: linkedHosts } = await supabase
      .from("vcenter_hosts")
      .select("id, server_id, cluster, name")
      .in("server_id", selectedServerIds)
      .not("cluster", "is", null);
    
    if (linkedHosts && linkedHosts.length > 0) {
      const clusterName = linkedHosts[0].cluster;
      
      // Get ALL hosts in this cluster
      const { data: allClusterHosts } = await supabase
        .from("vcenter_hosts")
        .select("server_id, name")
        .eq("cluster", clusterName)
        .not("server_id", "is", null);
      
      const allClusterServerIds = allClusterHosts?.map(h => h.server_id).filter(Boolean) || [];
      
      // Check if user selected all hosts (no conflict) or partial (conflict)
      const selectedAllHosts = allClusterServerIds.length > 0 && 
        allClusterServerIds.every(id => selectedServerIds.includes(id));
      
      if (!selectedAllHosts && allClusterServerIds.length > selectedServerIds.length) {
        setClusterConflict({
          detected: true,
          clusterName,
          selectedServers: selectedServerIds,
          allClusterHostIds: allClusterServerIds as string[],
          acknowledged: false
        });
      } else {
        setClusterConflict(null);
      }
    } else {
      setClusterConflict(null);
    }
  };

  const handleAcknowledgeClusterExpansion = async () => {
    if (!clusterConflict) return;
    
    // Fetch clusters FIRST before switching tabs
    const { data } = await supabase
      .from("vcenter_hosts")
      .select("cluster")
      .not("cluster", "is", null);
    
    if (data) {
      const uniqueClusters = [...new Set(data.map(h => h.cluster).filter(Boolean))];
      setClusters(uniqueClusters as string[]);
    }
    
    // Now switch to cluster mode and preselect
    setTargetType('cluster');
    setSelectedCluster(clusterConflict.clusterName);
    setSelectedServerIds([]);
    setClusterConflict(null);
    setSafetyCheckPassed(false);
    
    toast({
      title: "Target Updated",
      description: `Now targeting all hosts in "${clusterConflict.clusterName}" cluster.`,
    });
  };

  const runSafetyCheck = async () => {
    setSafetyCheckLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (targetType === 'servers') {
        // For individual servers, just check connectivity
        if (targetInfo && targetInfo.connected === targetInfo.total) {
          setSafetyCheckPassed(true);
          toast({
            title: "Safety check passed",
            description: `All ${targetInfo.total} selected server(s) are connected.`,
          });
        } else {
          throw new Error(`${targetInfo?.total - (targetInfo?.connected || 0)} server(s) not connected`);
        }
      } else {
        // For clusters/groups, check health with preflight mode
        if (!targetInfo) throw new Error('No target information available');
        
        const degradedCount = targetInfo.total - targetInfo.connected;
        
        if (targetInfo.total < 2) {
          throw new Error('Single-host target - no redundancy. Consider using individual server update.');
        }
        
        if (preflightMode === 'strict' && degradedCount > 0) {
          throw new Error(`${degradedCount} host(s) already degraded. All hosts must be healthy in strict mode.`);
        }
        
        if (preflightMode === 'relaxed' && degradedCount > 1) {
          throw new Error(`${degradedCount} hosts already degraded. Maximum 1 allowed in relaxed mode.`);
        }
        
        setSafetyCheckPassed(true);
        toast({
          title: "Safety check passed",
          description: `Target has ${targetInfo.connected} healthy hosts (${degradedCount} degraded).`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Safety check failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSafetyCheckLoading(false);
    }
  };

  const addFirmwareUpdate = () => {
    setFirmwareUpdates([...firmwareUpdates, {
      component: '',
      version: '',
      image_uri: '',
      reboot_required: true
    }]);
  };

  const removeFirmwareUpdate = (index: number) => {
    setFirmwareUpdates(firmwareUpdates.filter((_, i) => i !== index));
  };

  const updateFirmware = (index: number, field: keyof FirmwareUpdate, value: any) => {
    const updated = [...firmwareUpdates];
    (updated[index] as any)[field] = value;
    setFirmwareUpdates(updated);
  };

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        const hasTarget = (targetType === 'cluster' && selectedCluster) ||
                         (targetType === 'group' && selectedGroup) ||
                         (targetType === 'servers' && selectedServerIds.length > 0);
        // Block if cluster conflict exists and not acknowledged
        const noConflict = !clusterConflict || clusterConflict.acknowledged;
        return hasTarget && targetInfo && safetyCheckPassed && noConflict;
      case 2:
        if (firmwareSource === 'manual') {
          return firmwareUpdates.length > 0 && 
                 firmwareUpdates.every(f => f.component && f.version && f.image_uri);
        }
        return componentFilter.length > 0;
      case 3:
        return true;
      case 4:
        return confirmed;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    try {
      const target_scope = targetType === 'cluster' 
        ? { cluster_id: selectedCluster }
        : targetType === 'group'
          ? { server_group_id: selectedGroup }
          : { server_ids: selectedServerIds };

      const { data, error } = await supabase
        .from("jobs")
        .insert({
          job_type: 'rolling_cluster_update' as any,
          created_by: user?.id!,
          target_scope: target_scope as any,
            details: {
              ...(targetType === 'cluster' && { cluster_id: selectedCluster }),
              ...(targetType === 'group' && { server_group_id: selectedGroup }),
              ...(targetType === 'servers' && { server_ids: selectedServerIds }),
              firmware_source: firmwareSource,
              component_filter: componentFilter,
              auto_select_latest: autoSelectLatest,
              ...(firmwareSource === 'manual' && { firmware_updates: firmwareUpdates }),
              backup_scp: backupScp,
              ...(targetType !== 'servers' && { preflight_mode: preflightMode }),
              max_parallel: 1, // Always sequential for safety
              verify_after_each: verifyAfterEach,
              continue_on_failure: continueOnFailure
            } as any,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      setJobId(data.id);
      setCurrentStep(5);
      
      toast({
        title: "Rolling update started",
        description: "The update workflow has been initiated.",
      });
    } catch (error: any) {
      toast({
        title: "Error starting update",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const estimatedTime = () => {
    if (!targetInfo) return 0;
    // Updates are sequential (one at a time), so total time = hosts * time per host
    const timePerHost = firmwareSource === 'manual' 
      ? firmwareUpdates.length * 15 
      : componentFilter.length * 15;
    return targetInfo.linked * timePerHost;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <Tabs value={targetType} onValueChange={(v: any) => setTargetType(v)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="cluster">vCenter Cluster</TabsTrigger>
                <TabsTrigger value="group">Server Group</TabsTrigger>
                <TabsTrigger value="servers">Individual Servers</TabsTrigger>
              </TabsList>

              <TabsContent value="cluster" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Select Cluster</Label>
                  <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a cluster" />
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
              </TabsContent>

              <TabsContent value="group" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Select Server Group</Label>
                  <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a group" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((group: any) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="servers" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Select Servers</Label>
                  <div className="max-h-64 overflow-y-auto border rounded-lg p-3 space-y-2">
                    {servers.map((server: any) => (
                      <div key={server.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`server-${server.id}`}
                          checked={selectedServerIds.includes(server.id)}
                          onCheckedChange={(checked) => {
                            setSelectedServerIds(
                              checked
                                ? [...selectedServerIds, server.id]
                                : selectedServerIds.filter(id => id !== server.id)
                            );
                            setSafetyCheckPassed(false);
                          }}
                        />
                        <label htmlFor={`server-${server.id}`} className="text-sm cursor-pointer flex-1">
                          {server.hostname || server.ip_address} ({server.model})
                        </label>
                        <Badge variant={server.connection_status === 'connected' ? 'default' : 'secondary'}>
                          {server.connection_status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                {clusterConflict && clusterConflict.detected && !clusterConflict.acknowledged && (
                  <Alert variant="destructive" className="border-2">
                    <AlertTriangle className="h-5 w-5" />
                    <AlertTitle className="text-lg">Cannot Update Cluster Hosts Individually</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>
                        <strong>{clusterConflict.selectedServers.length} selected server(s)</strong> belong to 
                        vCenter cluster <strong>"{clusterConflict.clusterName}"</strong>.
                      </p>
                      
                      <div className="bg-destructive/10 p-3 rounded-md text-sm space-y-1">
                        <p className="font-medium">Why is this dangerous?</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          <li>Cluster HA/DRS may fail to migrate VMs if hosts have different firmware versions</li>
                          <li>vCenter may flag hosts as incompatible with each other</li>
                          <li>EVC mode violations can cause VM migration failures</li>
                          <li>Partial updates leave your cluster in an inconsistent state</li>
                        </ul>
                      </div>
                      
                      <p className="text-sm">
                        The update plan will be adjusted to include <strong>all {clusterConflict.allClusterHostIds.length} hosts</strong> 
                        in cluster "{clusterConflict.clusterName}".
                      </p>
                      
                      <Button 
                        onClick={handleAcknowledgeClusterExpansion}
                        className="w-full"
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        OK - Update Entire Cluster Instead
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>
            </Tabs>

            {targetInfo && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Target Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Hosts:</span>
                    <Badge>{targetInfo.total}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Linked Servers:</span>
                    <Badge>{targetInfo.linked}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Connected:</span>
                    <Badge variant={targetInfo.connected === targetInfo.total ? "default" : "destructive"}>
                      {targetInfo.connected}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <Button 
                    onClick={runSafetyCheck} 
                    disabled={safetyCheckLoading || safetyCheckPassed || (clusterConflict?.detected && !clusterConflict.acknowledged)}
                    className="w-full"
                  >
                    {safetyCheckLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {safetyCheckPassed ? (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Safety Check Passed
                      </>
                    ) : (
                      'Run Safety Check'
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <FirmwareSourceSelector
              value={firmwareSource}
              onChange={(value) => setFirmwareSource(value as any)}
              componentFilter={componentFilter}
              onComponentFilterChange={setComponentFilter}
              autoSelectLatest={autoSelectLatest}
              onAutoSelectLatestChange={setAutoSelectLatest}
              showManualOption={true}
              showSkipOption={false}
            />

            {firmwareSource === 'manual' && (
              <div className="space-y-4 mt-6">
                <div className="flex items-center justify-between">
                  <Label>Manual Firmware Entries</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addFirmwareUpdate}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Firmware
                  </Button>
                </div>

                {firmwareUpdates.map((firmware, index) => (
                  <Card key={index}>
                    <CardContent className="pt-6 space-y-3">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <Input
                          placeholder="Component (e.g., BIOS, iDRAC)"
                          value={firmware.component}
                          onChange={(e) => updateFirmware(index, 'component', e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFirmwareUpdate(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input
                        placeholder="Version"
                        value={firmware.version}
                        onChange={(e) => updateFirmware(index, 'version', e.target.value)}
                      />
                      <Input
                        placeholder="Firmware Image URI (HTTP/HTTPS)"
                        value={firmware.image_uri}
                        onChange={(e) => updateFirmware(index, 'image_uri', e.target.value)}
                      />
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`reboot-${index}`}
                          checked={firmware.reboot_required}
                          onCheckedChange={(checked) => updateFirmware(index, 'reboot_required', checked)}
                        />
                        <Label htmlFor={`reboot-${index}`} className="font-normal">
                          Reboot required
                        </Label>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="backup"
                checked={backupScp}
                onCheckedChange={(checked) => setBackupScp(checked as boolean)}
              />
              <Label htmlFor="backup">Create SCP backup for each host before update</Label>
            </div>

            {targetType !== 'servers' && (
              <div className="space-y-3">
                <Label>Pre-flight Requirements</Label>
                <RadioGroup value={preflightMode} onValueChange={(v) => setPreflightMode(v as 'strict' | 'relaxed')}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="strict" id="strict" />
                    <Label htmlFor="strict" className="font-normal">
                      All hosts must be healthy to start (recommended)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="relaxed" id="relaxed" />
                    <Label htmlFor="relaxed" className="font-normal">
                      Allow starting with 1 host already degraded
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Rolling Update Process</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                  <li>Hosts are updated <strong>one at a time</strong></li>
                  <li>Each host must return to healthy state before proceeding</li>
                  <li>Update pauses automatically if a host fails to recover</li>
                </ul>
              </AlertDescription>
            </Alert>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="verify"
                checked={verifyAfterEach}
                onCheckedChange={(checked) => setVerifyAfterEach(checked as boolean)}
              />
              <Label htmlFor="verify">Verify host health after update completes</Label>
            </div>

            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Advanced Option</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex items-center space-x-2">
                  <Checkbox
                    id="continueOnFail"
                    checked={continueOnFailure}
                    onCheckedChange={(checked) => setContinueOnFailure(checked as boolean)}
                  />
                  <Label htmlFor="continueOnFail" className="font-normal">
                    Continue to next host even if previous fails
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Not recommended - may cascade failures across the {targetType === 'cluster' ? 'cluster' : 'group'}
                </p>
              </AlertDescription>
            </Alert>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Target</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium capitalize">{targetType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium">{targetInfo?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hosts to update:</span>
                    <span className="font-medium">{targetInfo?.linked}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Firmware</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Source:</span>
                  <Badge variant="outline">{firmwareSource === 'local_repository' ? 'Local Repository' : firmwareSource === 'dell_online_catalog' ? 'Dell Catalog' : 'Manual'}</Badge>
                </div>
                {firmwareSource !== 'manual' && (
                  <div className="flex justify-between text-sm">
                    <span>Components:</span>
                    <Badge variant="outline">{componentFilter.includes('all') ? 'All' : componentFilter.join(', ')}</Badge>
                  </div>
                )}
                {firmwareSource === 'manual' && firmwareUpdates.map((fw, index) => (
                  <div key={index} className="text-sm flex justify-between">
                    <span>{fw.component}</span>
                    <Badge variant="outline">{fw.version}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>SCP Backups:</span>
                  <span>{backupScp ? 'Yes' : 'No'}</span>
                </div>
                {targetType !== 'servers' && (
                  <div className="flex justify-between">
                    <span>Pre-flight Mode:</span>
                    <Badge variant="outline">{preflightMode === 'strict' ? 'Strict (all healthy)' : 'Relaxed (1 degraded)'}</Badge>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Update Strategy:</span>
                  <span>Sequential (1 host at a time)</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated Time:</span>
                  <Badge>{estimatedTime()} minutes</Badge>
                </div>
              </CardContent>
            </Card>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex items-center space-x-2">
                  <Checkbox
                    id="confirm"
                    checked={confirmed}
                    onCheckedChange={(checked) => setConfirmed(checked as boolean)}
                  />
                  <Label htmlFor="confirm" className="font-normal">
                    I understand this will cause host reboots and potential VM downtime
                  </Label>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            {jobId && (
              <WorkflowExecutionViewer 
                jobId={jobId} 
                workflowType="rolling_cluster_update" 
              />
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Server Update Wizard</DialogTitle>
          <DialogDescription>
            Guided workflow for orchestrating server firmware updates
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                currentStep >= step.id 
                  ? 'border-primary bg-primary text-primary-foreground' 
                  : 'border-muted bg-background'
              }`}>
                {currentStep > step.id ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <step.icon className="h-5 w-5" />
                )}
              </div>
              {index < STEPS.length - 1 && (
                <div className={`w-16 h-0.5 mx-2 ${
                  currentStep > step.id ? 'bg-primary' : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
        </div>

        <div className="py-4">
          <h3 className="text-lg font-semibold mb-4">
            Step {currentStep}: {STEPS[currentStep - 1].name}
          </h3>
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || currentStep === 5}
          >
            Back
          </Button>

          <div className="flex gap-2">
            {currentStep < 4 && (
              <Button
                onClick={handleNext}
                disabled={!canProceedToNextStep()}
              >
                Next
              </Button>
            )}
            {currentStep === 4 && (
              <Button
                onClick={handleExecute}
                disabled={!canProceedToNextStep() || loading}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start Update
              </Button>
            )}
            {currentStep === 5 && (
              <Button onClick={() => onOpenChange(false)}>
                Close
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
