import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useEsxiProfiles } from "@/hooks/useEsxiProfiles";
import { useQuery } from "@tanstack/react-query";
import { 
  Info, 
  Plus, 
  X, 
  Loader2, 
  CheckCircle, 
  AlertTriangle,
  Server,
  Clock,
  Shield,
  Settings,
  Calendar,
  Minimize2
} from "lucide-react";
import { WorkflowExecutionViewer } from "./WorkflowExecutionViewer";
import { FirmwareSourceSelector } from "@/components/common/FirmwareSourceSelector";
import { useMinimizedJobs } from "@/contexts/MinimizedJobsContext";
import { RecurrenceConfig, getNextExecutionsFromConfig, getHumanReadableSchedule } from "@/lib/cron-utils";
import { addHours, addDays, format } from "date-fns";

interface ClusterUpdateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preSelectedCluster?: string;
  preSelectedTarget?: {
    type: 'cluster' | 'group' | 'servers';
    id?: string;
    ids?: string[];
  };
  onClusterExpansionRequest?: (clusterName: string) => void;
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

interface ClusterConflict {
  detected: boolean;
  clusterName: string;
  selectedServers: string[];
  allClusterHostIds: string[];
  acknowledged: boolean;
}

const STEPS = [
  { id: 1, name: 'Target Selection', icon: Server },
  { id: 2, name: 'Update Type & Details', icon: Shield },
  { id: 3, name: 'Configuration', icon: Settings },
  { id: 4, name: 'Timing', icon: Clock },
  { id: 5, name: 'Review & Confirm', icon: CheckCircle },
  { id: 6, name: 'Execution', icon: Loader2 },
];

export const ClusterUpdateWizard = ({
  open,
  onOpenChange,
  preSelectedCluster,
  preSelectedTarget,
  onClusterExpansionRequest
}: ClusterUpdateWizardProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const { minimizeJob, isMinimized } = useMinimizedJobs();
  
  // Step 1: Target Selection
  const [targetType, setTargetType] = useState<'cluster' | 'group' | 'servers'>(
    preSelectedTarget?.type || (preSelectedCluster ? 'cluster' : 'cluster')
  );
  const [clusters, setClusters] = useState<string[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<string>(
    preSelectedCluster || (preSelectedTarget?.type === 'cluster' && preSelectedTarget?.id ? preSelectedTarget.id : '')
  );
  const [selectedGroup, setSelectedGroup] = useState<string>(
    preSelectedTarget?.type === 'group' && preSelectedTarget?.id ? preSelectedTarget.id : ''
  );
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>(
    preSelectedTarget?.type === 'servers' && preSelectedTarget?.ids ? preSelectedTarget.ids : []
  );
  const [targetInfo, setTargetInfo] = useState<TargetInfo | null>(null);
  const [targetInfoLoading, setTargetInfoLoading] = useState(false);
  const [safetyCheckLoading, setSafetyCheckLoading] = useState(false);
  const [safetyCheckPassed, setSafetyCheckPassed] = useState(false);
  const [clusterConflict, setClusterConflict] = useState<ClusterConflict | null>(null);
  
  // Step 2: Update Type and Selection
  const [updateType, setUpdateType] = useState<'firmware_only' | 'esxi_only' | 'esxi_then_firmware' | 'firmware_then_esxi'>('firmware_only');
  const [firmwareSource, setFirmwareSource] = useState<'local_repository' | 'dell_online_catalog' | 'skip' | 'manual'>('dell_online_catalog');
  const [componentFilter, setComponentFilter] = useState<string[]>(['all']);
  const [autoSelectLatest, setAutoSelectLatest] = useState(true);
  const [firmwareUpdates, setFirmwareUpdates] = useState<FirmwareUpdate[]>([{
    component: '',
    version: '',
    image_uri: '',
    reboot_required: true
  }]);
  const [selectedEsxiProfileId, setSelectedEsxiProfileId] = useState<string | null>(null);
  const [esxiCredentialMode, setEsxiCredentialMode] = useState<'stored' | 'manual'>('stored');
  const [esxiCredentialSetId, setEsxiCredentialSetId] = useState<string | null>(null);
  const [esxiSshPassword, setEsxiSshPassword] = useState('');
  
  // Fetch ESXi credential sets
  const { data: esxiCredentials } = useQuery({
    queryKey: ['credential_sets', 'esxi'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credential_sets')
        .select('*')
        .eq('credential_type', 'esxi')
        .order('priority', { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });
  
  // Step 3: Configuration
  const [backupScp, setBackupScp] = useState(true);
  const [minHealthyHosts, setMinHealthyHosts] = useState(2);
  const [maxParallel, setMaxParallel] = useState(1);
  const [verifyAfterEach, setVerifyAfterEach] = useState(true);
  const [continueOnFailure, setContinueOnFailure] = useState(false);
  
  // Step 4: Timing
  const [executionMode, setExecutionMode] = useState<'immediate' | 'scheduled' | 'recurring'>('immediate');
  const [scheduledStart, setScheduledStart] = useState<Date>(addDays(new Date(), 1));
  const [scheduledEnd, setScheduledEnd] = useState<Date>(addHours(addDays(new Date(), 1), 4));
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig>({
    enabled: false,
    interval: 1,
    unit: 'months',
    hour: 2,
    minute: 0,
    dayOfWeek: 0,
    dayOfMonth: 1,
  });
  
  // Step 5: Review
  const [confirmed, setConfirmed] = useState(false);
  
  // Step 6: Execution
  const [jobId, setJobId] = useState<string | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();
  const { profiles: esxiProfiles, isLoading: esxiProfilesLoading } = useEsxiProfiles();

  useEffect(() => {
    if (open) {
      fetchTargets();
    }
  }, [open, targetType]);

  useEffect(() => {
    if (targetType === 'cluster' && selectedCluster) {
      fetchTargetInfo();
    } else if (targetType === 'group' && selectedGroup) {
      fetchTargetInfo();
    } else if (targetType === 'servers' && selectedServerIds.length > 0) {
      fetchTargetInfo();
      checkClusterMembership();
    }
  }, [targetType, selectedCluster, selectedGroup, selectedServerIds]);

  // Reset safety check and target info when target selection changes
  useEffect(() => {
    setSafetyCheckPassed(false);
    setTargetInfo(null);
    // Clear cluster conflict when switching to cluster/group mode
    if (targetType !== 'servers') {
      setClusterConflict(null);
    }
  }, [targetType, selectedCluster, selectedGroup, selectedServerIds]);

  // Sync preSelectedTarget to state when dialog opens
  useEffect(() => {
    if (open && preSelectedTarget) {
      // Only update if values are actually different
      if (preSelectedTarget.type !== targetType) {
        setTargetType(preSelectedTarget.type);
      }
      
      if (preSelectedTarget.type === 'cluster' && preSelectedTarget.id) {
        if (preSelectedTarget.id !== selectedCluster) {
          setSelectedCluster(preSelectedTarget.id);
        }
        if (selectedGroup !== '') {
          setSelectedGroup('');
        }
        if (selectedServerIds.length > 0) {
          setSelectedServerIds([]);
        }
      } else if (preSelectedTarget.type === 'group' && preSelectedTarget.id) {
        if (preSelectedTarget.id !== selectedGroup) {
          setSelectedGroup(preSelectedTarget.id);
        }
        if (selectedCluster !== '') {
          setSelectedCluster('');
        }
        if (selectedServerIds.length > 0) {
          setSelectedServerIds([]);
        }
      } else if (preSelectedTarget.type === 'servers' && preSelectedTarget.ids) {
        const idsChanged = JSON.stringify(preSelectedTarget.ids) !== JSON.stringify(selectedServerIds);
        if (idsChanged) {
          setSelectedServerIds(preSelectedTarget.ids);
        }
        if (selectedCluster !== '') {
          setSelectedCluster('');
        }
        if (selectedGroup !== '') {
          setSelectedGroup('');
        }
      }
    }
  }, [open, preSelectedTarget, targetType, selectedCluster, selectedGroup, selectedServerIds]);

  // Reset wizard when closed
  useEffect(() => {
    if (!open) {
      setCurrentStep(1);
      setSafetyCheckPassed(false);
      setTargetInfo(null);
      setConfirmed(false);
      setJobId(null);
      setClusterConflict(null);
    }
  }, [open]);

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
        .select("*")
        .order("name");
      
      if (data) {
        setGroups(data);
      }
    } else if (targetType === 'servers') {
      const { data } = await supabase
        .from("servers")
        .select("id, hostname, ip_address, connection_status")
        .order("hostname");
      
      if (data) {
        setServers(data);
      }
    }
  };

  const fetchTargetInfo = async () => {
    setTargetInfoLoading(true);
    try {
      if (targetType === 'cluster' && selectedCluster) {
        const { data: hosts, error } = await supabase
          .from("vcenter_hosts")
          .select("id, name, status")
          .eq("cluster", selectedCluster);

        if (error) throw error;

        if (hosts) {
          const connected = hosts.filter((h: any) => h.status === 'connected' || h.status === 'online').length;
          setTargetInfo({
            name: selectedCluster,
            total: hosts.length,
            linked: connected,
            connected
          });
        }
      } else if (targetType === 'group' && selectedGroup) {
        const { data: members, error } = await supabase
          .from("server_group_members")
          .select("server_id, servers(id, hostname, connection_status)")
          .eq("server_group_id", selectedGroup);

        if (error) throw error;

        if (members) {
          const total = members.length;
          const connected = members.filter((m: any) => m.servers?.connection_status === 'online').length;
          const groupName = groups.find(g => g.id === selectedGroup)?.name || selectedGroup;
          setTargetInfo({
            name: groupName,
            total,
            linked: connected,
            connected
          });
        }
      } else if (targetType === 'servers' && selectedServerIds.length > 0) {
        const { data: serverData, error } = await supabase
          .from("servers")
          .select("id, hostname, connection_status")
          .in("id", selectedServerIds);

        if (error) throw error;

        if (serverData) {
          const connected = serverData.filter((s: any) => s.connection_status === 'online').length;
          setTargetInfo({
            name: `${serverData.length} selected server(s)`,
            total: serverData.length,
            linked: connected,
            connected
          });
        }
      }
    } catch (error: any) {
      console.error("Error fetching target info:", error);
      toast({
        title: "Error fetching target info",
        description: error.message || "Could not load target information",
        variant: "destructive"
      });
    } finally {
      setTargetInfoLoading(false);
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

  const handleAcknowledgeClusterExpansion = () => {
    if (!clusterConflict) return;
    
    const clusterName = clusterConflict.clusterName;
    
    // If parent provides callback, use it (close and re-open wizard)
    if (onClusterExpansionRequest) {
      onClusterExpansionRequest(clusterName);
    } else {
      // Fallback: close wizard with toast
      onOpenChange(false);
      toast({
        title: "Cluster Detected",
        description: `Please select the "${clusterName}" cluster from the Update Wizard.`,
      });
    }
  };

  const runSafetyCheck = async () => {
    if (!targetInfo) return;

    setSafetyCheckLoading(true);
    try {
      // Simulate safety check - in real implementation this would call an edge function
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (targetInfo.connected >= minHealthyHosts) {
        setSafetyCheckPassed(true);
        toast({
          title: "Safety check passed",
          description: `Target has ${targetInfo.connected} healthy hosts.`,
        });
      } else {
        throw new Error(`Insufficient healthy hosts. Found ${targetInfo.connected}, need ${minHealthyHosts}`);
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

  const updateFirmware = (index: number, field: keyof FirmwareUpdate, value: string | boolean) => {
    const updated = [...firmwareUpdates];
    (updated[index][field] as any) = value;
    setFirmwareUpdates(updated);
  };

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        if (targetType === 'cluster') {
          return selectedCluster && safetyCheckPassed;
        } else if (targetType === 'group') {
          return selectedGroup && safetyCheckPassed;
        } else if (targetType === 'servers') {
          const noConflict = !clusterConflict || clusterConflict.acknowledged;
          return selectedServerIds.length > 0 && safetyCheckPassed && noConflict;
        }
        return false;
      case 2:
        if (updateType === 'firmware_only') {
          // Check based on firmware source
          if (firmwareSource === 'dell_online_catalog' || firmwareSource === 'local_repository') {
            return componentFilter.length > 0;
          } else if (firmwareSource === 'manual') {
            return firmwareUpdates.length > 0 && 
                   firmwareUpdates.every(f => f.component && f.version && f.image_uri);
          }
          return false;
        }
        if (updateType === 'esxi_only') {
          const hasCredentials = esxiCredentialMode === 'stored' 
            ? esxiCredentialSetId 
            : esxiSshPassword;
          return selectedEsxiProfileId && hasCredentials;
        }
        // For combined workflows, need both
        const hasCredentials = esxiCredentialMode === 'stored' 
          ? esxiCredentialSetId 
          : esxiSshPassword;
        const hasFirmware = firmwareSource === 'dell_online_catalog' || firmwareSource === 'local_repository'
          ? componentFilter.length > 0
          : (firmwareUpdates.length > 0 && firmwareUpdates.every(f => f.component && f.version && f.image_uri));
        return selectedEsxiProfileId && hasCredentials && hasFirmware;
      case 3:
        return true;
      case 4:
        return true; // Timing step always allows proceeding
      case 5:
        return confirmed;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleExecute = async () => {
    if (!user) return;
    if (targetType === 'cluster' && !selectedCluster) return;
    if (targetType === 'group' && !selectedGroup) return;
    if (targetType === 'servers' && selectedServerIds.length === 0) return;

    setLoading(true);
    try {
      if (executionMode === 'immediate') {
        // Map update type to job type
        const jobTypeMap = {
          'firmware_only': 'rolling_cluster_update',
          'esxi_only': 'esxi_upgrade',
          'esxi_then_firmware': 'esxi_then_firmware',
          'firmware_then_esxi': 'firmware_then_esxi'
        };

        let targetScope: any = {};
        if (targetType === 'cluster') {
          targetScope = {
            type: 'cluster',
            cluster_name: selectedCluster,
          };
        } else if (targetType === 'group') {
          targetScope = {
            type: 'group',
            group_id: selectedGroup,
            group_name: groups.find(g => g.id === selectedGroup)?.name
          };
        } else if (targetType === 'servers') {
          targetScope = {
            type: 'servers',
            server_ids: selectedServerIds
          };
        }

        const jobDetails: any = {
          backup_scp: backupScp,
          min_healthy_hosts: minHealthyHosts,
          max_parallel: maxParallel,
          verify_after_each: verifyAfterEach,
          continue_on_failure: continueOnFailure
        };

        // Add firmware updates if applicable
        if (updateType !== 'esxi_only') {
          jobDetails.firmware_source = firmwareSource;
          
          if (firmwareSource === 'dell_online_catalog') {
            jobDetails.dell_catalog_url = 'https://downloads.dell.com/catalog/Catalog.xml';
            jobDetails.component_filter = componentFilter;
            jobDetails.auto_select_latest = autoSelectLatest;
          } else if (firmwareSource === 'local_repository') {
            jobDetails.component_filter = componentFilter;
            jobDetails.auto_select_latest = autoSelectLatest;
          } else if (firmwareSource === 'manual') {
            jobDetails.firmware_updates = firmwareUpdates;
          }
        }

        // Add ESXi details if applicable
        if (updateType !== 'firmware_only') {
          jobDetails.esxi_profile_id = selectedEsxiProfileId;
          if (esxiCredentialMode === 'stored') {
            jobDetails.esxi_credential_set_id = esxiCredentialSetId;
          } else {
            jobDetails.esxi_ssh_password = esxiSshPassword;
          }
        }

        const { data, error } = await supabase
          .from("jobs")
          .insert({
            job_type: jobTypeMap[updateType] as "rolling_cluster_update" | "esxi_upgrade" | "esxi_then_firmware" | "firmware_then_esxi",
            created_by: user.id,
            target_scope: targetScope,
            details: jobDetails,
            status: 'pending'
          })
          .select()
          .single();

        if (error) throw error;

        setJobId(data.id);
        setCurrentStep(6);
        
        toast({
          title: "Update workflow started",
          description: "The update has been initiated.",
        });
      } else {
        // Create maintenance window instead of job
        const maintenanceDetails: any = {
          // Target info
          target_type: targetType,
          cluster_name: selectedCluster,
          group_id: selectedGroup,
          server_ids: selectedServerIds,
          
          // Configuration
          backup_scp: backupScp,
          min_healthy_hosts: minHealthyHosts,
          max_parallel: maxParallel,
          verify_after_each: verifyAfterEach,
          continue_on_failure: continueOnFailure,
        };

        // Add firmware settings if applicable
        if (updateType !== 'esxi_only') {
          maintenanceDetails.firmware_source = firmwareSource;
          maintenanceDetails.component_filter = componentFilter;
          maintenanceDetails.auto_select_latest = autoSelectLatest;
          if (firmwareSource === 'manual') {
            maintenanceDetails.firmware_updates = firmwareUpdates;
          }
        }

        // Add ESXi settings if applicable
        if (updateType !== 'firmware_only') {
          maintenanceDetails.esxi_profile_id = selectedEsxiProfileId;
          maintenanceDetails.esxi_credential_set_id = esxiCredentialSetId;
          maintenanceDetails.esxi_credential_mode = esxiCredentialMode;
          if (esxiCredentialMode === 'manual') {
            maintenanceDetails.esxi_ssh_password = esxiSshPassword;
          }
        }

        // Add recurrence config if recurring
        if (executionMode === 'recurring') {
          maintenanceDetails.recurrence_config = { ...recurrenceConfig, enabled: true };
        }

        const { data, error } = await supabase
          .from("maintenance_windows")
          .insert({
            title: `${updateType === 'firmware_only' ? 'Firmware' : updateType === 'esxi_only' ? 'ESXi' : 'Combined'} Update - ${targetInfo?.name || 'Selected Servers'}`,
            description: `Scheduled update via Update Wizard`,
            maintenance_type: updateType,
            planned_start: scheduledStart.toISOString(),
            planned_end: scheduledEnd.toISOString(),
            recurrence_enabled: executionMode === 'recurring',
            auto_execute: true,
            details: maintenanceDetails,
            cluster_ids: targetType === 'cluster' ? [selectedCluster] : null,
            server_group_ids: targetType === 'group' ? [selectedGroup] : null,
            server_ids: targetType === 'servers' ? selectedServerIds : null,
            created_by: user.id,
            status: 'planned'
          })
          .select()
          .single();

        if (error) throw error;

        toast({
          title: executionMode === 'scheduled' ? "Update scheduled" : "Recurring update scheduled",
          description: executionMode === 'scheduled' 
            ? `Update scheduled for ${format(scheduledStart, 'PPp')}`
            : `Update will run ${getHumanReadableSchedule({ ...recurrenceConfig, enabled: true })}`,
        });

        onOpenChange(false);
      }
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
    const hostsToUpdate = Math.ceil(targetInfo.linked / maxParallel);
    const timePerHost = firmwareUpdates.length * 15; // 15 min per firmware update
    return hostsToUpdate * timePerHost;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            {/* Target Type Selection */}
            <div>
              <Label className="mb-2 block">Target Type</Label>
              <Tabs value={targetType} onValueChange={(v) => setTargetType(v as any)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="cluster">vCenter Cluster</TabsTrigger>
                  <TabsTrigger value="group">Server Group</TabsTrigger>
                  <TabsTrigger value="servers">Individual Servers</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Cluster Selection */}
            {targetType === 'cluster' && (
              <div>
                <Label>Select vCenter Cluster</Label>
                <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters.map((cluster) => (
                      <SelectItem key={cluster} value={cluster}>
                        {cluster}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Group Selection */}
            {targetType === 'group' && (
              <div>
                <Label>Select Server Group</Label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a server group" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Server Selection */}
            {targetType === 'servers' && (
              <div>
                <Label className="mb-2 block">Select Servers</Label>
                <div className="border rounded-md p-4 max-h-64 overflow-y-auto space-y-2">
                  {servers.map((server) => (
                    <div key={server.id} className="flex items-center space-x-2">
                      <Checkbox
                        checked={selectedServerIds.includes(server.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedServerIds([...selectedServerIds, server.id]);
                          } else {
                            setSelectedServerIds(selectedServerIds.filter(id => id !== server.id));
                          }
                          setSafetyCheckPassed(false);
                        }}
                      />
                      <Label className="flex-1 cursor-pointer">
                        {server.hostname || server.ip_address}
                        <Badge variant={server.connection_status === 'online' ? 'default' : 'secondary'} className="ml-2">
                          {server.connection_status}
                        </Badge>
                      </Label>
                    </div>
                  ))}
                </div>

                {clusterConflict && clusterConflict.detected && !clusterConflict.acknowledged && (
                  <Alert variant="destructive" className="border-2 mt-4">
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
              </div>
            )}

            {targetInfoLoading && (
              <Card>
                <CardContent className="py-8 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading target information...</span>
                </CardContent>
              </Card>
            )}

            {!targetInfoLoading && targetInfo && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Target Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Name:</span>
                    <span className="font-medium">{targetInfo.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Total:</span>
                    <Badge>{targetInfo.total}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Connected:</span>
                    <Badge variant={targetInfo.connected >= minHealthyHosts ? "default" : "destructive"}>
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
          <div className="space-y-6">
            {/* Update Type Selection */}
            <div className="space-y-3">
              <Label>Update Type</Label>
              <RadioGroup value={updateType} onValueChange={(value: any) => setUpdateType(value)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="firmware_only" id="firmware_only" />
                  <Label htmlFor="firmware_only" className="font-normal cursor-pointer">
                    Dell Firmware Only - Update firmware components on Dell servers
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="esxi_only" id="esxi_only" />
                  <Label htmlFor="esxi_only" className="font-normal cursor-pointer">
                    ESXi Upgrade Only - Upgrade ESXi hypervisor version
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="esxi_then_firmware" id="esxi_then_firmware" />
                  <Label htmlFor="esxi_then_firmware" className="font-normal cursor-pointer">
                    ESXi → Firmware - Upgrade ESXi first, then update firmware
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="firmware_then_esxi" id="firmware_then_esxi" />
                  <Label htmlFor="firmware_then_esxi" className="font-normal cursor-pointer">
                    Firmware → ESXi - Update firmware first, then upgrade ESXi
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* ESXi Profile Selection - Show for ESXi-related updates */}
            {updateType !== 'firmware_only' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>ESXi Upgrade Profile</Label>
                  <Select value={selectedEsxiProfileId || ''} onValueChange={setSelectedEsxiProfileId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select ESXi profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {esxiProfiles.filter(p => p.is_active).map(profile => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name} (ESXi {profile.target_version})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {esxiProfiles.filter(p => p.is_active).length === 0 && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        No active ESXi profiles found. Create one in Settings → ESXi Profiles.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>ESXi SSH Credentials</Label>
                    <RadioGroup value={esxiCredentialMode} onValueChange={(v: any) => setEsxiCredentialMode(v)}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="stored" id="stored" />
                        <Label htmlFor="stored" className="font-normal cursor-pointer">
                          Use stored credentials
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="manual" id="manual" />
                        <Label htmlFor="manual" className="font-normal cursor-pointer">
                          Enter password manually
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {esxiCredentialMode === 'stored' ? (
                    <div className="space-y-2">
                      <Label htmlFor="esxi-credential">Select Credential Set</Label>
                      <Select value={esxiCredentialSetId || ''} onValueChange={setEsxiCredentialSetId}>
                        <SelectTrigger id="esxi-credential">
                          <SelectValue placeholder="Choose ESXi credentials" />
                        </SelectTrigger>
                        <SelectContent>
                          {esxiCredentials?.map(cred => (
                            <SelectItem key={cred.id} value={cred.id}>
                              {cred.name} ({cred.username})
                            </SelectItem>
                          ))}
                          {(!esxiCredentials || esxiCredentials.length === 0) && (
                            <SelectItem value="_none" disabled>
                              No ESXi credentials configured
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Configure ESXi credentials in Settings → Credentials
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="ssh-password">ESXi Root Password</Label>
                      <Input
                        id="ssh-password"
                        type="password"
                        value={esxiSshPassword}
                        onChange={(e) => setEsxiSshPassword(e.target.value)}
                        placeholder="Enter root password for SSH access"
                      />
                      <p className="text-xs text-muted-foreground">
                        Required for SSH connection to apply ESXi upgrade
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Firmware Selection - Show for firmware-related updates */}
            {updateType !== 'esxi_only' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <FirmwareSourceSelector
                    value={firmwareSource}
                    onChange={setFirmwareSource}
                    componentFilter={componentFilter}
                    onComponentFilterChange={setComponentFilter}
                    autoSelectLatest={autoSelectLatest}
                    onAutoSelectLatestChange={setAutoSelectLatest}
                    showManualOption={true}
                    showSkipOption={false}
                  />

                  {/* Manual firmware entry - only show when manual mode selected */}
                  {firmwareSource === 'manual' && (
                    <div className="space-y-4 pt-4">
                      <div className="flex items-center justify-between">
                        <Label>Firmware Updates</Label>
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

                      {firmwareUpdates.length === 0 && (
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription>
                            Add at least one firmware update to proceed.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </div>
              </>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minHealthy">Minimum Healthy Hosts</Label>
                <Input
                  id="minHealthy"
                  type="number"
                  min={1}
                  value={minHealthyHosts}
                  onChange={(e) => setMinHealthyHosts(parseInt(e.target.value) || 1)}
                />
                <p className="text-xs text-muted-foreground">
                  Updates will pause if cluster drops below this threshold
                </p>
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
                <p className="text-xs text-muted-foreground">
                  How many hosts to update simultaneously
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="verify"
                checked={verifyAfterEach}
                onCheckedChange={(checked) => setVerifyAfterEach(checked as boolean)}
              />
              <Label htmlFor="verify">Verify each host after update</Label>
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
                    Continue updating other hosts even if one fails
                  </Label>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        );

      case 4:
        const presets = [
          { label: 'Daily', interval: 1, unit: 'days' as const },
          { label: 'Weekly', interval: 1, unit: 'weeks' as const },
          { label: 'Monthly', interval: 1, unit: 'months' as const },
          { label: 'Quarterly', interval: 3, unit: 'months' as const },
          { label: 'Yearly', interval: 1, unit: 'years' as const },
          { label: 'Every 2 Years', interval: 2, unit: 'years' as const },
          { label: 'Every 5 Years', interval: 5, unit: 'years' as const },
        ];
        
        return (
          <div className="space-y-6">
            <div>
              <Label className="mb-3 block">When should this update run?</Label>
              <RadioGroup value={executionMode} onValueChange={(v: any) => setExecutionMode(v)}>
                <Card className={executionMode === 'immediate' ? 'border-primary' : ''}>
                  <CardContent className="pt-6">
                    <div className="flex items-start space-x-2">
                      <RadioGroupItem value="immediate" id="immediate" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="immediate" className="cursor-pointer font-semibold">
                          Run Immediately
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Start the update as soon as you confirm
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card className={executionMode === 'scheduled' ? 'border-primary' : ''}>
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex items-start space-x-2">
                      <RadioGroupItem value="scheduled" id="scheduled" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="scheduled" className="cursor-pointer font-semibold">
                          Schedule for Later
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Pick a specific date and time
                        </p>
                      </div>
                    </div>
                    
                    {executionMode === 'scheduled' && (
                      <div className="ml-6 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="start-date">Start Date & Time</Label>
                            <Input
                              id="start-date"
                              type="datetime-local"
                              value={format(scheduledStart, "yyyy-MM-dd'T'HH:mm")}
                              onChange={(e) => setScheduledStart(new Date(e.target.value))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="end-date">End Date & Time</Label>
                            <Input
                              id="end-date"
                              type="datetime-local"
                              value={format(scheduledEnd, "yyyy-MM-dd'T'HH:mm")}
                              onChange={(e) => setScheduledEnd(new Date(e.target.value))}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                <Card className={executionMode === 'recurring' ? 'border-primary' : ''}>
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex items-start space-x-2">
                      <RadioGroupItem value="recurring" id="recurring" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="recurring" className="cursor-pointer font-semibold">
                          Recurring Schedule
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Run on a regular schedule (daily, weekly, monthly, yearly, etc.)
                        </p>
                      </div>
                    </div>
                    
                    {executionMode === 'recurring' && (
                      <div className="ml-6 space-y-4">
                        <div>
                          <Label className="mb-2 block text-sm">Quick Presets</Label>
                          <div className="flex flex-wrap gap-2">
                            {presets.map((preset) => (
                              <Button
                                key={preset.label}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setRecurrenceConfig({ 
                                  ...recurrenceConfig, 
                                  interval: preset.interval, 
                                  unit: preset.unit 
                                })}
                              >
                                {preset.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="interval">Interval</Label>
                            <Input
                              id="interval"
                              type="number"
                              min={1}
                              max={recurrenceConfig.unit === 'years' ? 10 : recurrenceConfig.unit === 'months' ? 60 : 365}
                              value={recurrenceConfig.interval}
                              onChange={(e) => setRecurrenceConfig({ 
                                ...recurrenceConfig, 
                                interval: parseInt(e.target.value) || 1 
                              })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="unit">Unit</Label>
                            <Select 
                              value={recurrenceConfig.unit} 
                              onValueChange={(v: any) => setRecurrenceConfig({ ...recurrenceConfig, unit: v })}
                            >
                              <SelectTrigger id="unit">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="hours">Hours</SelectItem>
                                <SelectItem value="days">Days</SelectItem>
                                <SelectItem value="weeks">Weeks</SelectItem>
                                <SelectItem value="months">Months</SelectItem>
                                <SelectItem value="years">Years</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="hour">Hour (0-23)</Label>
                            <Input
                              id="hour"
                              type="number"
                              min={0}
                              max={23}
                              value={recurrenceConfig.hour}
                              onChange={(e) => setRecurrenceConfig({ 
                                ...recurrenceConfig, 
                                hour: parseInt(e.target.value) || 0 
                              })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="minute">Minute (0-59)</Label>
                            <Input
                              id="minute"
                              type="number"
                              min={0}
                              max={59}
                              value={recurrenceConfig.minute}
                              onChange={(e) => setRecurrenceConfig({ 
                                ...recurrenceConfig, 
                                minute: parseInt(e.target.value) || 0 
                              })}
                            />
                          </div>
                        </div>
                        
                        {(recurrenceConfig.unit === 'weeks' || recurrenceConfig.unit === 'months' || recurrenceConfig.unit === 'years') && (
                          <div className="space-y-2">
                            <Label htmlFor="dayOfMonth">Day of Month (1-31)</Label>
                            <Input
                              id="dayOfMonth"
                              type="number"
                              min={1}
                              max={31}
                              value={recurrenceConfig.dayOfMonth}
                              onChange={(e) => setRecurrenceConfig({ 
                                ...recurrenceConfig, 
                                dayOfMonth: parseInt(e.target.value) || 1 
                              })}
                            />
                          </div>
                        )}
                        
                        <Card className="bg-muted/50">
                          <CardHeader>
                            <CardTitle className="text-sm">Schedule Preview</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <p className="text-sm font-medium">
                              {getHumanReadableSchedule({ ...recurrenceConfig, enabled: true })}
                            </p>
                            <div className="text-xs space-y-1 text-muted-foreground">
                              <p className="font-semibold">Next 5 scheduled runs:</p>
                              {getNextExecutionsFromConfig({ ...recurrenceConfig, enabled: true }, new Date(), 5).map((date, i) => (
                                <p key={i}>• {format(date, 'PPp')}</p>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </RadioGroup>
            </div>
          </div>
        );

      case 5:
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
                    <span className="font-medium">{targetType}</span>
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

            {updateType !== 'esxi_only' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Firmware Updates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Source:</span>
                      <Badge variant="outline">
                        {firmwareSource === 'dell_online_catalog' ? 'Dell Online Catalog' : 
                         firmwareSource === 'local_repository' ? 'Local Repository' : 
                         firmwareSource === 'manual' ? 'Manual Entry' : 'Skip'}
                      </Badge>
                    </div>
                    {(firmwareSource === 'dell_online_catalog' || firmwareSource === 'local_repository') && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Components:</span>
                          <span className="font-medium">
                            {componentFilter.includes('all') ? 'All' : componentFilter.join(', ')}
                          </span>
                        </div>
                        {firmwareSource === 'dell_online_catalog' && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Auto-select Latest:</span>
                            <span className="font-medium">{autoSelectLatest ? 'Yes' : 'No'}</span>
                          </div>
                        )}
                      </>
                    )}
                    {firmwareSource === 'manual' && firmwareUpdates.map((fw, index) => (
                      <div key={index} className="text-sm flex justify-between pt-2">
                        <span>{fw.component}</span>
                        <Badge variant="outline">{fw.version}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>SCP Backups:</span>
                  <span>{backupScp ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Min Healthy Hosts:</span>
                  <span>{minHealthyHosts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Max Parallel:</span>
                  <span>{maxParallel}</span>
                </div>
                <div className="flex justify-between">
                  <span>Verify After Each:</span>
                  <span>{verifyAfterEach ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated Time:</span>
                  <Badge>{estimatedTime()} minutes</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Timing
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {executionMode === 'immediate' && (
                  <p className="text-muted-foreground">This update will start as soon as you confirm</p>
                )}
                {executionMode === 'scheduled' && (
                  <>
                    <div className="flex justify-between">
                      <span>Start Time:</span>
                      <Badge variant="outline">{format(scheduledStart, 'PPp')}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>End Time:</span>
                      <Badge variant="outline">{format(scheduledEnd, 'PPp')}</Badge>
                    </div>
                  </>
                )}
                {executionMode === 'recurring' && (
                  <>
                    <div className="flex justify-between items-start">
                      <span>Schedule:</span>
                      <span className="text-right font-medium max-w-[60%]">
                        {getHumanReadableSchedule({ ...recurrenceConfig, enabled: true })}
                      </span>
                    </div>
                    <div className="pt-2">
                      <span className="text-muted-foreground text-xs">Next runs:</span>
                      <div className="mt-1 space-y-1">
                        {getNextExecutionsFromConfig({ ...recurrenceConfig, enabled: true }, new Date(), 3).map((date, i) => (
                          <div key={i} className="text-xs text-muted-foreground">
                            • {format(date, 'PPp')}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
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

      case 6:
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

  const jobIsMinimized = jobId ? isMinimized(jobId) : false;

  return (
    <>
      <Dialog open={open && !jobIsMinimized} onOpenChange={(newOpen) => {
        if (!newOpen && currentStep === 6 && jobId) {
          // Don't close if on step 6 with active job, minimize instead
          minimizeJob(jobId, 'rolling_cluster_update');
          onOpenChange(false);
        } else {
          onOpenChange(newOpen);
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Update Wizard</DialogTitle>
                <DialogDescription>
                  Guided workflow for firmware and ESXi updates across clusters, groups, or servers
                </DialogDescription>
              </div>
              {currentStep === 6 && jobId && (
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => {
                    minimizeJob(jobId, 'rolling_cluster_update');
                    onOpenChange(false);
                  }}
                  className="ml-2"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                currentStep >= step.id 
                  ? 'border-primary bg-primary text-primary-foreground' 
                  : 'border-muted bg-muted text-muted-foreground'
              }`}>
                <step.icon className="h-5 w-5" />
              </div>
              {index < STEPS.length - 1 && (
                <div className={`h-0.5 w-12 mx-2 ${
                  currentStep > step.id ? 'bg-primary' : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="min-h-[400px]">
          {renderStepContent()}
        </div>

        {/* Footer Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || currentStep === 6}
          >
            Back
          </Button>
          {currentStep < 5 ? (
            <Button 
              onClick={handleNext}
              disabled={!canProceedToNextStep()}
            >
              Next
            </Button>
          ) : currentStep === 5 ? (
            <Button
              onClick={handleExecute}
              disabled={!canProceedToNextStep() || loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {executionMode === 'immediate' ? 'Start Update' : 'Schedule Update'}
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  </>
  );
};
