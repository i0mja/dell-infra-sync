import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Target, 
  Plus, 
  Trash2, 
  CheckCircle2,
  XCircle,
  AlertCircle,
  HardDrive,
  Server,
  MoreHorizontal,
  HeartPulse,
  Pencil,
  Building2,
  Loader2,
  Link2,
  Unlink,
  ArrowRightLeft,
  Wand2,
  KeyRound,
  Database,
  RefreshCw,
  MonitorCheck,
  Eye,
  Key,
} from "lucide-react";
import { useReplicationTargets, ReplicationTarget, TargetDependencies } from "@/hooks/useReplication";
import { useSshKeys, SshKey } from "@/hooks/useSshKeys";
import { useVCenterVMs, VCenterVM } from "@/hooks/useVCenterVMs";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PrepareTemplateWizard } from "./PrepareTemplateWizard";
import { PairedZfsDeployWizard } from "./PairedZfsDeployWizard";
import { DecommissionTargetDialog, DecommissionOption } from "./DecommissionTargetDialog";
import { DatastoreManagementDialog } from "./DatastoreManagementDialog";
import { ZfsTargetHealthDialog } from "./ZfsTargetHealthDialog";
import { DeploySshKeyDialog } from "./DeploySshKeyDialog";
import { useDatastoreManagement } from "@/hooks/useDatastoreManagement";

interface ReplicationTargetsPanelProps {
  onAddTarget?: () => void;
}

export function ReplicationTargetsPanel({ onAddTarget }: ReplicationTargetsPanelProps) {
  const { 
    targets, 
    loading, 
    createTarget, 
    deleteTarget, 
    archiveTarget,
    decommissionTarget: runDecommission,
    checkTargetDependencies,
    setPartner, 
    refetch 
  } = useReplicationTargets();
  const { sshKeys } = useSshKeys();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [showPairedDeployWizard, setShowPairedDeployWizard] = useState(false);
  const [showPrepareTemplateWizard, setShowPrepareTemplateWizard] = useState(false);
  const [pairingTargetId, setPairingTargetId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [healthCheckingId, setHealthCheckingId] = useState<string | null>(null);
  const [scanningVmForId, setScanningVmForId] = useState<string | null>(null);
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  
  // Datastore management hook
  const { rescanDatastore } = useDatastoreManagement();
  
  // Fetch VMs for the editing target's vCenter (for VM selector)
  const { data: vcenterVms = [], isLoading: loadingVms } = useVCenterVMs(editingTarget?.dr_vcenter_id);
  
  // Decommission dialog state
  const [showDecommissionDialog, setShowDecommissionDialog] = useState(false);
  const [targetToDecommission, setTargetToDecommission] = useState<ReplicationTarget | null>(null);
  const [decommissionDeps, setDecommissionDeps] = useState<TargetDependencies | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  
  // Datastore management dialog state
  const [showDatastoreDialog, setShowDatastoreDialog] = useState(false);
  const [datastoreTarget, setDatastoreTarget] = useState<ReplicationTarget | null>(null);
  
  // SSH password dialog state
  const [sshPasswordDialog, setSshPasswordDialog] = useState<{
    open: boolean;
    target: ReplicationTarget | null;
  }>({ open: false, target: null });
  const [sshPassword, setSshPassword] = useState('');
  const [submittingSshExchange, setSubmittingSshExchange] = useState(false);
  
  // Health dialog state
  const [showHealthDialog, setShowHealthDialog] = useState(false);
  const [healthResults, setHealthResults] = useState<any>(null);
  const [healthTarget, setHealthTarget] = useState<ReplicationTarget | null>(null);
  
  // Deploy SSH Key dialog state
  const [showDeploySshKeyDialog, setShowDeploySshKeyDialog] = useState(false);
  const [deploySshKeyTarget, setDeploySshKeyTarget] = useState<ReplicationTarget | null>(null);
  
  // Form for creating paired targets (source + DR)
  const [formData, setFormData] = useState({
    // Source site (Point A)
    sourceName: "",
    sourceDescription: "",
    sourceHostname: "",
    sourcePort: "22",
    sourceZfsPool: "",
    sourceDatasetPrefix: "",
    sourceSshUsername: "",
    // DR site (Point B)
    drName: "",
    drDescription: "",
    drHostname: "",
    drPort: "22",
    drZfsPool: "",
    drDatasetPrefix: "",
    drSshUsername: "",
  });
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState(false);

  const resetForm = () => {
    setFormData({
      sourceName: "",
      sourceDescription: "",
      sourceHostname: "",
      sourcePort: "22",
      sourceZfsPool: "",
      sourceDatasetPrefix: "",
      sourceSshUsername: "",
      drName: "",
      drDescription: "",
      drHostname: "",
      drPort: "22",
      drZfsPool: "",
      drDatasetPrefix: "",
      drSshUsername: "",
    });
  };

  const handleCreate = async () => {
    // Require at least source target
    if (!formData.sourceName.trim() || !formData.sourceHostname.trim() || !formData.sourceZfsPool.trim()) return;
    
    setCreating(true);
    try {
      // Create source target first
      const sourceTarget = await createTarget({
        name: formData.sourceName,
        description: formData.sourceDescription || undefined,
        hostname: formData.sourceHostname,
        port: parseInt(formData.sourcePort) || 22,
        zfs_pool: formData.sourceZfsPool,
        zfs_dataset_prefix: formData.sourceDatasetPrefix || undefined,
        ssh_username: formData.sourceSshUsername || undefined,
        site_role: 'primary',
      });

      // If DR target info provided, create it and pair them
      if (formData.drName.trim() && formData.drHostname.trim() && formData.drZfsPool.trim() && sourceTarget) {
        const drTarget = await createTarget({
          name: formData.drName,
          description: formData.drDescription || undefined,
          hostname: formData.drHostname,
          port: parseInt(formData.drPort) || 22,
          zfs_pool: formData.drZfsPool,
          zfs_dataset_prefix: formData.drDatasetPrefix || undefined,
          ssh_username: formData.drSshUsername || undefined,
          site_role: 'dr',
        });

        // Pair them together
        if (drTarget) {
          await setPartner({ sourceId: sourceTarget.id, partnerId: drTarget.id });
        }
      }

      setShowCreateDialog(false);
      resetForm();
      toast({
        title: "ZFS targets created",
        description: formData.drName.trim() ? "Source and DR targets created and paired" : "Source target created",
      });
    } catch (err: any) {
      toast({
        title: "Error creating targets",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  // Open decommission dialog with dependency check
  const handleOpenDecommission = async (target: ReplicationTarget) => {
    setTargetToDecommission(target);
    setDecommissionDeps(null);
    setShowDecommissionDialog(true);
    setLoadingDeps(true);
    
    try {
      const deps = await checkTargetDependencies(target.id);
      setDecommissionDeps(deps);
    } catch (err) {
      console.error('Failed to check dependencies:', err);
      setDecommissionDeps({ dependentGroups: [], partnerTarget: null, hasDeployedVm: false });
    } finally {
      setLoadingDeps(false);
    }
  };

  // Handle decommission confirmation
  const handleDecommissionConfirm = async (option: DecommissionOption) => {
    if (!targetToDecommission) return;

    try {
      if (option === 'archive') {
        await archiveTarget(targetToDecommission.id);
      } else if (option === 'database') {
        await deleteTarget(targetToDecommission.id);
      } else if (option === 'full') {
        await runDecommission(targetToDecommission.id);
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleHealthCheck = async (target: any, showResultsAfter: boolean = false) => {
    setHealthCheckingId(target.id);
    try {
      // Get current user
      const { data: userData } = await supabase.auth.getUser();
      
      // Use hosting VM IP if available, otherwise fall back to hostname
      const sshHost = target.hosting_vm?.ip_address || target.hostname;
      
      // Create a check_zfs_target_health job that the Job Executor will process
      const { data: jobData, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'check_zfs_target_health' as any,
          status: 'pending',
          created_by: userData?.user?.id,
          details: { 
            target_id: target.id,
            target_hostname: sshHost,
            zfs_pool: target.zfs_pool,
            target_name: target.name,
            hosting_vm_name: target.hosting_vm?.name || null
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      toast({
        title: "Health check job created",
        description: `Checking ${target.name} via ${sshHost}... See Jobs page for results`
      });
      
      // If requested, poll for results and show dialog
      if (showResultsAfter && jobData) {
        setHealthTarget(target);
        pollForHealthResults(jobData.id, target);
      }
      
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setHealthCheckingId(null);
    }
  };

  const pollForHealthResults = async (jobId: string, target: ReplicationTarget) => {
    // Poll for job completion (max 60 seconds)
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const { data: job } = await supabase
        .from('jobs')
        .select('status, details')
        .eq('id', jobId)
        .single();
      
      const details = job?.details as Record<string, any> | null;
      
      if (job?.status === 'completed' && details?.results) {
        setHealthResults(details.results);
        setShowHealthDialog(true);
        return;
      }
      
      if (job?.status === 'failed') {
        toast({
          title: "Health check failed",
          description: details?.error || "Unknown error",
          variant: "destructive"
        });
        return;
      }
    }
    
    toast({
      title: "Health check timeout",
      description: "Check the Jobs page for results",
    });
  };

  const handleViewHealthResults = async (target: ReplicationTarget) => {
    // Find the most recent completed health check job for this target
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, status, details, completed_at')
      .eq('job_type', 'check_zfs_target_health' as any)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20);
    
    // Find one that matches this target
    const targetJob = jobs?.find(j => {
      const details = j.details as Record<string, any> | null;
      return details?.target_id === target.id;
    });
    
    const targetDetails = targetJob?.details as Record<string, any> | null;
    if (targetDetails?.results) {
      setHealthTarget(target);
      setHealthResults(targetDetails.results);
      setShowHealthDialog(true);
    } else {
      // No results, run a new check
      handleHealthCheck(target, true);
    }
  };

  const handleEdit = (target: any) => {
    setEditingTarget({
      ...target,
      hosting_vm_id: target.hosting_vm_id || target.hosting_vm?.id || null,
      ssh_key_id: target.ssh_key_id || null
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingTarget) return;
    
    try {
      const updateData: Record<string, any> = {
        name: editingTarget.name,
        description: editingTarget.description
      };
      
      // Include ssh_key_id if it was changed (can be null to unlink)
      if ('ssh_key_id' in editingTarget) {
        updateData.ssh_key_id = editingTarget.ssh_key_id || null;
      }
      
      // Include hosting_vm_id if changed
      if ('hosting_vm_id' in editingTarget) {
        updateData.hosting_vm_id = editingTarget.hosting_vm_id || null;
        
        // If VM selected, also update hostname to VM's IP
        if (editingTarget.hosting_vm_id) {
          const selectedVm = vcenterVms.find(vm => vm.id === editingTarget.hosting_vm_id);
          if (selectedVm?.ip_address) {
            updateData.hostname = selectedVm.ip_address;
          }
        }
      }
      
      const { error } = await supabase
        .from('replication_targets')
        .update(updateData)
        .eq('id', editingTarget.id);
      
      if (error) throw error;
      
      toast({ title: "Target updated" });
      setShowEditDialog(false);
      setEditingTarget(null);
      refetch();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  // Scan for hosting VM (trigger vcenter_sync for VMs only)
  const handleScanForVm = async (target: ReplicationTarget) => {
    if (!target.dr_vcenter_id) {
      toast({
        title: "No vCenter linked",
        description: "This target doesn't have a DR vCenter configured",
        variant: "destructive"
      });
      return;
    }
    
    setScanningVmForId(target.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'vcenter_sync' as any,
          status: 'pending',
          created_by: user?.id,
          details: {
            vcenter_id: target.dr_vcenter_id,
            sync_type: 'vms_only',
            reason: `Scan for hosting VM for ${target.name}`
          }
        });
      
      if (error) throw error;
      
      toast({
        title: "VM scan job created",
        description: "Scanning vCenter for VMs. Refresh after completion."
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setScanningVmForId(null);
    }
  };

  // Rescan datastore to refresh vCenter file listing
  const handleRescanDatastore = async (target: ReplicationTarget) => {
    if (!target.datastore_name) {
      toast({
        title: "No datastore configured",
        description: "This target doesn't have a datastore configured",
        variant: "destructive"
      });
      return;
    }
    
    setRescanningId(target.id);
    try {
      await rescanDatastore(target.id);
    } finally {
      setRescanningId(null);
    }
  };

  // Filter VMs for dropdown - show VREP-like VMs first
  const sortedVcenterVms = [...vcenterVms].sort((a, b) => {
    const aIsVrep = a.name?.toLowerCase().includes('vrep') || a.name?.toLowerCase().includes('zfs');
    const bIsVrep = b.name?.toLowerCase().includes('vrep') || b.name?.toLowerCase().includes('zfs');
    if (aIsVrep && !bIsVrep) return -1;
    if (!aIsVrep && bIsVrep) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Filter only active SSH keys for the dropdown
  const availableSshKeys = sshKeys?.filter(k => k.status === 'active' || k.status === 'pending') || [];

  const handleOpenPairDialog = (targetId: string) => {
    setPairingTargetId(targetId);
    setSelectedPartnerId("");
    setShowPairDialog(true);
  };

  const handlePairTargets = async () => {
    if (!pairingTargetId || !selectedPartnerId) return;
    
    setPairing(true);
    try {
      await setPartner({ sourceId: pairingTargetId, partnerId: selectedPartnerId });
      setShowPairDialog(false);
      setPairingTargetId(null);
      setSelectedPartnerId("");
    } finally {
      setPairing(false);
    }
  };

  const handleUnpairTarget = async (targetId: string) => {
    if (!confirm('Remove pairing between these ZFS targets?')) return;
    await setPartner({ sourceId: targetId, partnerId: null });
  };

  const handleSwapRoles = async (target: ReplicationTarget) => {
    if (!target.partner_target_id) return;
    if (!confirm('Swap primary and DR roles between these targets?')) return;
    
    try {
      // Swap the site_role values
      const newSourceRole = target.site_role === 'primary' ? 'dr' : 'primary';
      const newPartnerRole = newSourceRole === 'primary' ? 'dr' : 'primary';
      
      await supabase
        .from('replication_targets')
        .update({ site_role: newSourceRole })
        .eq('id', target.id);
        
      await supabase
        .from('replication_targets')
        .update({ site_role: newPartnerRole })
        .eq('id', target.partner_target_id);
      
      toast({ title: 'Roles swapped successfully' });
      refetch();
    } catch (err: any) {
      toast({
        title: 'Error swapping roles',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const handleReestablishSsh = (target: ReplicationTarget) => {
    if (!target.partner_target_id) return;
    setSshPasswordDialog({ open: true, target });
    setSshPassword('');
  };

  const submitSshKeyExchange = async () => {
    const target = sshPasswordDialog.target;
    if (!target || !target.partner_target_id) return;
    
    setSubmittingSshExchange(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // Encrypt password before storing in job details
      let encryptedPassword: string | undefined;
      if (sshPassword) {
        const { data: encryptData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            password: sshPassword,
            type: 'return_only'
          }
        });
        if (encryptError) throw encryptError;
        encryptedPassword = encryptData?.encrypted;
      }
      
      // Create SSH key exchange job with encrypted password
      const { error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'exchange_ssh_keys' as any,
          status: 'pending',
          created_by: user?.id,
          details: {
            source_target_id: target.id,
            destination_target_id: target.partner_target_id,
            admin_password_encrypted: encryptedPassword,
          },
        });
      
      if (error) throw error;
      
      toast({
        title: 'SSH key exchange job created',
        description: 'Check Jobs page for progress',
      });
      
      setSshPasswordDialog({ open: false, target: null });
      setSshPassword('');
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSubmittingSshExchange(false);
    }
  };

  // Get available targets for pairing (exclude self and already paired)
  const getAvailablePartners = (targetId: string) => {
    return targets.filter(t => 
      t.id !== targetId && 
      !t.partner_target_id
    );
  };

  const getHealthBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <Badge variant="outline" className="text-green-600 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Healthy
          </Badge>
        );
      case 'degraded':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30">
            <AlertCircle className="h-3 w-3 mr-1" />
            Degraded
          </Badge>
        );
      case 'offline':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Offline
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            Unknown
          </Badge>
        );
    }
  };

  const getSiteRoleBadge = (siteRole?: string) => {
    if (!siteRole) return null;
    
    return siteRole === 'primary' ? (
      <Badge variant="default" className="bg-primary/10 text-primary border-primary/20">
        <Building2 className="h-3 w-3 mr-1" />
        Primary Site
      </Badge>
    ) : (
      <Badge variant="secondary">
        <Building2 className="h-3 w-3 mr-1" />
        DR Site
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              ZFS Replication Targets
            </CardTitle>
            <CardDescription>
              Manage ZFS storage targets for VM replication
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowPrepareTemplateWizard(true)}>
              <Wand2 className="h-4 w-4 mr-1" />
              Prepare Template
            </Button>
            {onAddTarget && (
              <Button variant="outline" onClick={onAddTarget}>
                <Plus className="h-4 w-4 mr-1" />
                Add Single Target
              </Button>
            )}
            <Button onClick={() => setShowPairedDeployWizard(true)}>
              <ArrowRightLeft className="h-4 w-4 mr-1" />
              Deploy Paired Targets
            </Button>
            <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  Manual Pair Setup
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowRightLeft className="h-5 w-5" />
                    Create Paired ZFS Targets
                  </DialogTitle>
                  <DialogDescription>
                    Configure both source (Point A) and DR (Point B) ZFS appliances that will replicate data between sites
                  </DialogDescription>
                </DialogHeader>
                
                <div className="grid md:grid-cols-2 gap-6 py-4">
                  {/* Source Site (Point A) */}
                  <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Badge className="bg-primary">A</Badge>
                      <span className="font-semibold">Source Site (Primary)</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Name *</Label>
                        <Input
                          placeholder="e.g., zfs-prod-01"
                          value={formData.sourceName}
                          onChange={(e) => setFormData({ ...formData, sourceName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Hostname / IP *</Label>
                        <Input
                          placeholder="e.g., 10.207.105.106"
                          value={formData.sourceHostname}
                          onChange={(e) => setFormData({ ...formData, sourceHostname: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>ZFS Pool *</Label>
                          <Input
                            placeholder="e.g., tank"
                            value={formData.sourceZfsPool}
                            onChange={(e) => setFormData({ ...formData, sourceZfsPool: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>SSH Port</Label>
                          <Input
                            type="number"
                            value={formData.sourcePort}
                            onChange={(e) => setFormData({ ...formData, sourcePort: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>SSH Username</Label>
                          <Input
                            placeholder="e.g., zfsrepl"
                            value={formData.sourceSshUsername}
                            onChange={(e) => setFormData({ ...formData, sourceSshUsername: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Dataset Prefix</Label>
                          <Input
                            placeholder="e.g., nfs"
                            value={formData.sourceDatasetPrefix}
                            onChange={(e) => setFormData({ ...formData, sourceDatasetPrefix: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          placeholder="Optional..."
                          className="h-16"
                          value={formData.sourceDescription}
                          onChange={(e) => setFormData({ ...formData, sourceDescription: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* DR Site (Point B) */}
                  <div className="space-y-4 p-4 border rounded-lg bg-secondary/30">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Badge variant="secondary">B</Badge>
                      <span className="font-semibold">DR Site (Recovery)</span>
                      <span className="text-xs text-muted-foreground ml-auto">Optional</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          placeholder="e.g., zfs-dr-01"
                          value={formData.drName}
                          onChange={(e) => setFormData({ ...formData, drName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Hostname / IP</Label>
                        <Input
                          placeholder="e.g., 10.208.105.106"
                          value={formData.drHostname}
                          onChange={(e) => setFormData({ ...formData, drHostname: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>ZFS Pool</Label>
                          <Input
                            placeholder="e.g., tank"
                            value={formData.drZfsPool}
                            onChange={(e) => setFormData({ ...formData, drZfsPool: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>SSH Port</Label>
                          <Input
                            type="number"
                            value={formData.drPort}
                            onChange={(e) => setFormData({ ...formData, drPort: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>SSH Username</Label>
                          <Input
                            placeholder="e.g., zfsrepl"
                            value={formData.drSshUsername}
                            onChange={(e) => setFormData({ ...formData, drSshUsername: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Dataset Prefix</Label>
                          <Input
                            placeholder="e.g., dr"
                            value={formData.drDatasetPrefix}
                            onChange={(e) => setFormData({ ...formData, drDatasetPrefix: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          placeholder="Optional..."
                          className="h-16"
                          value={formData.drDescription}
                          onChange={(e) => setFormData({ ...formData, drDescription: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Replication Flow Visualization */}
                {formData.sourceName && formData.drName && (
                  <div className="flex items-center justify-center gap-4 py-3 px-4 bg-muted/50 rounded-lg">
                    <div className="text-center">
                      <div className="font-mono text-sm font-medium">{formData.sourceName}</div>
                      <div className="text-xs text-muted-foreground">{formData.sourceHostname || '...'}</div>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <ArrowRightLeft className="h-4 w-4" />
                      <span className="text-xs">ZFS Send/Recv</span>
                    </div>
                    <div className="text-center">
                      <div className="font-mono text-sm font-medium">{formData.drName}</div>
                      <div className="text-xs text-muted-foreground">{formData.drHostname || '...'}</div>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreate} 
                    disabled={creating || !formData.sourceName.trim() || !formData.sourceHostname.trim() || !formData.sourceZfsPool.trim()}
                  >
                    {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {creating ? 'Creating...' : formData.drName.trim() ? 'Create Paired Targets' : 'Create Source Target'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      
      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Target</DialogTitle>
            <DialogDescription>
              Update target settings, hosting VM, and SSH key assignment
            </DialogDescription>
          </DialogHeader>
          {editingTarget && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editingTarget.name}
                  onChange={(e) => setEditingTarget({ ...editingTarget, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editingTarget.description || ''}
                  onChange={(e) => setEditingTarget({ ...editingTarget, description: e.target.value })}
                />
              </div>
              
              {/* Hosting VM Selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MonitorCheck className="h-4 w-4" />
                  Hosting VM
                </Label>
                {editingTarget.dr_vcenter_id ? (
                  <>
                    <Select 
                      value={editingTarget.hosting_vm_id || 'none'} 
                      onValueChange={(value) => setEditingTarget({ 
                        ...editingTarget, 
                        hosting_vm_id: value === 'none' ? null : value 
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={loadingVms ? "Loading VMs..." : "Select hosting VM..."} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        <SelectItem value="none">
                          <span className="text-muted-foreground">No VM linked</span>
                        </SelectItem>
                        {sortedVcenterVms.map(vm => (
                          <SelectItem key={vm.id} value={vm.id}>
                            <div className="flex items-center gap-2">
                              <Server className="h-3 w-3" />
                              <span>{vm.name}</span>
                              {vm.ip_address && (
                                <span className="text-xs text-muted-foreground">({vm.ip_address})</span>
                              )}
                              {vm.power_state === 'poweredOn' && (
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Select the VM that hosts this ZFS appliance. This will be used for health checks.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No DR vCenter configured. Set a vCenter to select a hosting VM.
                  </p>
                )}
              </div>
              
              {/* SSH Key Selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  SSH Key
                </Label>
                <Select 
                  value={editingTarget.ssh_key_id || 'none'} 
                  onValueChange={(value) => setEditingTarget({ 
                    ...editingTarget, 
                    ssh_key_id: value === 'none' ? null : value 
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select SSH key..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">No SSH key assigned</span>
                    </SelectItem>
                    {availableSshKeys.map(key => (
                      <SelectItem key={key.id} value={key.id}>
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-3 w-3" />
                          {key.name}
                          <Badge variant="outline" className="ml-1 text-xs">
                            {key.status}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assign an SSH key for health checks and replication operations.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : targets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No ZFS targets configured</p>
            <p className="text-sm">Add a ZFS target to start replicating VMs</p>
            {onAddTarget && (
              <Button variant="outline" className="mt-4" onClick={onAddTarget}>
                <Plus className="h-4 w-4 mr-2" />
                Add ZFS Target
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VM / Target</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>NFS Datastore</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>ZFS Pool</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="font-medium">
                      {target.hosting_vm ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4 text-primary" />
                            <span className="font-medium">{target.hosting_vm.name}</span>
                            {target.hosting_vm.power_state === 'poweredOn' && (
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" title="Powered On" />
                            )}
                            {/* SSH key badge - show name if assigned, warning if not */}
                            {target.ssh_key_id ? (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-500/30" title={`SSH key: ${target.ssh_key?.name || 'assigned'}`}>
                                <KeyRound className="h-3 w-3 mr-1" />
                                {target.ssh_key?.name || 'SSH'}
                              </Badge>
                            ) : target.ssh_trust_established ? (
                              <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30" title="Legacy SSH trust (no managed key)">
                                <KeyRound className="h-3 w-3 mr-1" />
                                Legacy SSH
                              </Badge>
                            ) : target.health_status !== 'healthy' && (
                              <Badge variant="outline" className="text-xs text-red-600 border-red-500/30" title="No SSH configured - health checks may fail">
                                <KeyRound className="h-3 w-3 mr-1" />
                                No SSH
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {target.hosting_vm.ip_address || target.hostname}
                          </div>
                          <div className="text-xs text-muted-foreground/60">
                            {target.name}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-muted-foreground" />
                            <span className="italic text-muted-foreground">No VM linked</span>
                            {target.ssh_key_id ? (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-500/30" title={`SSH key: ${target.ssh_key?.name || 'assigned'}`}>
                                <KeyRound className="h-3 w-3 mr-1" />
                                {target.ssh_key?.name || 'SSH'}
                              </Badge>
                            ) : target.ssh_trust_established ? (
                              <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30" title="Legacy SSH trust">
                                <KeyRound className="h-3 w-3 mr-1" />
                                Legacy SSH
                              </Badge>
                            ) : target.health_status !== 'healthy' && (
                              <Badge variant="outline" className="text-xs text-red-600 border-red-500/30" title="No SSH configured">
                                <KeyRound className="h-3 w-3 mr-1" />
                                No SSH
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{target.hostname}:{target.port}</div>
                          <div className="text-xs text-muted-foreground/60">{target.name}</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {getSiteRoleBadge(target.site_role)}
                    </TableCell>
                    <TableCell>
                      {target.linked_datastore ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <Database className="h-3 w-3 text-blue-500" />
                            <span className="font-medium text-sm">{target.linked_datastore.name}</span>
                            {/* Warning if datastore is not accessible or has no hosts */}
                            {!target.linked_datastore.accessible && (
                              <Badge variant="destructive" className="text-xs px-1.5 py-0">
                                <AlertCircle className="h-3 w-3 mr-0.5" />
                                Not Accessible
                              </Badge>
                            )}
                            {target.linked_datastore.accessible && target.linked_datastore.host_count === 0 && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500 text-amber-600">
                                <AlertCircle className="h-3 w-3 mr-0.5" />
                                Unmounted
                              </Badge>
                            )}
                          </div>
                          {target.linked_datastore.capacity_bytes && target.linked_datastore.free_bytes && (
                            <div className="text-xs text-muted-foreground">
                              {Math.round((1 - target.linked_datastore.free_bytes / target.linked_datastore.capacity_bytes) * 100)}% used
                            </div>
                          )}
                          {/* Show host count */}
                          {target.linked_datastore.host_count !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              Mounted on {target.linked_datastore.host_count} hosts
                            </div>
                          )}
                        </div>
                      ) : target.datastore_name ? (
                        <div className="flex items-center gap-1.5">
                          <Database className="h-3 w-3 text-amber-500" />
                          <span className="text-sm text-amber-600">{target.datastore_name}</span>
                          <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500 text-amber-600">
                            <AlertCircle className="h-3 w-3 mr-0.5" />
                            Not Found
                          </Badge>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Database className="h-3 w-3" />
                          <span className="text-sm italic">No datastore</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {target.partner_target ? (
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">
                            {target.partner_target.name}
                          </span>
                          {target.partner_target.ssh_trust_established ? (
                            <Badge variant="outline" className="text-xs text-green-600 border-green-500/30">
                              <KeyRound className="h-3 w-3 mr-1" />
                              SSH
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30">
                              <KeyRound className="h-3 w-3 mr-1" />
                              No SSH
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-muted-foreground"
                          onClick={() => handleOpenPairDialog(target.id)}
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          Pair
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3 w-3 text-muted-foreground" />
                        {target.zfs_pool}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getHealthBadge(target.health_status)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            {healthCheckingId === target.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleViewHealthResults(target)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Health
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleHealthCheck(target)}>
                            <HeartPulse className="h-4 w-4 mr-2" />
                            Run Health Check
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(target)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            setDatastoreTarget(target);
                            setShowDatastoreDialog(true);
                          }}>
                            <Database className="h-4 w-4 mr-2" />
                            Manage Datastore
                          </DropdownMenuItem>
                          {/* Rescan datastore to refresh vCenter file listing */}
                          {target.datastore_name && (
                            <DropdownMenuItem 
                              onClick={() => handleRescanDatastore(target)}
                              disabled={rescanningId === target.id}
                            >
                              {rescanningId === target.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              Rescan Datastore
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => {
                            setDeploySshKeyTarget(target);
                            setShowDeploySshKeyDialog(true);
                          }}>
                            <Key className="h-4 w-4 mr-2" />
                            Deploy SSH Key
                          </DropdownMenuItem>
                          {/* Scan for VM option - useful when VM not linked */}
                          {!target.hosting_vm && target.dr_vcenter_id && (
                            <DropdownMenuItem 
                              onClick={() => handleScanForVm(target)}
                              disabled={scanningVmForId === target.id}
                            >
                              {scanningVmForId === target.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              Scan for Hosting VM
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {target.partner_target ? (
                            <>
                              <DropdownMenuItem onClick={() => handleSwapRoles(target)}>
                                <ArrowRightLeft className="h-4 w-4 mr-2" />
                                Swap Primary/DR Roles
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleReestablishSsh(target)}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                Re-establish SSH Trust
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleOpenPairDialog(target.id)}>
                                <Link2 className="h-4 w-4 mr-2" />
                                Change Partner
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUnpairTarget(target.id)}>
                                <Unlink className="h-4 w-4 mr-2" />
                                Remove Pairing
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem onClick={() => handleOpenPairDialog(target.id)}>
                              <Link2 className="h-4 w-4 mr-2" />
                              Pair with DR Target
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => handleOpenDecommission(target)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete / Decommission
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Pair Targets Dialog */}
      <Dialog open={showPairDialog} onOpenChange={setShowPairDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Pair ZFS Targets
            </DialogTitle>
            <DialogDescription>
              Connect a source ZFS target with a DR destination for replication
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium">Source Target</p>
              <p className="text-sm text-muted-foreground">
                {targets.find(t => t.id === pairingTargetId)?.name || 'Unknown'}
              </p>
            </div>
            <div className="flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label>DR Destination Target</Label>
              <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select DR target..." />
                </SelectTrigger>
                <SelectContent>
                  {pairingTargetId && getAvailablePartners(pairingTargetId).map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        {t.name}
                        <span className="text-muted-foreground text-xs">
                          ({t.hostname})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pairingTargetId && getAvailablePartners(pairingTargetId).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No available targets. Create another ZFS target first.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPairDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handlePairTargets} 
              disabled={pairing || !selectedPartnerId}
            >
              {pairing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Pairing...
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-2" />
                  Create Pair
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Prepare Template Wizard */}
      <PrepareTemplateWizard 
        open={showPrepareTemplateWizard} 
        onOpenChange={setShowPrepareTemplateWizard} 
      />
      
      {/* Paired ZFS Deploy Wizard */}
      <PairedZfsDeployWizard
        open={showPairedDeployWizard}
        onOpenChange={setShowPairedDeployWizard}
        onSuccess={() => {
          refetch();
          setShowPairedDeployWizard(false);
          toast({
            title: "Paired targets deployed",
            description: "Source and DR ZFS targets are now ready for replication",
          });
        }}
      />

      {/* Decommission Target Dialog */}
      <DecommissionTargetDialog
        open={showDecommissionDialog}
        onOpenChange={setShowDecommissionDialog}
        target={targetToDecommission}
        dependencies={decommissionDeps}
        loading={loadingDeps}
        onConfirm={handleDecommissionConfirm}
      />

      {/* Datastore Management Dialog */}
      <DatastoreManagementDialog
        open={showDatastoreDialog}
        onOpenChange={setShowDatastoreDialog}
        target={datastoreTarget ? {
          id: datastoreTarget.id,
          name: datastoreTarget.name,
          hostname: datastoreTarget.hostname,
          zfs_pool: datastoreTarget.zfs_pool,
          datastore_name: datastoreTarget.datastore_name,
          nfs_export_path: datastoreTarget.nfs_export_path,
          dr_vcenter_id: datastoreTarget.dr_vcenter_id,
        } : null}
      />

      {/* SSH Password Dialog for Key Exchange */}
      <Dialog 
        open={sshPasswordDialog.open} 
        onOpenChange={(open) => {
          if (!open) {
            setSshPasswordDialog({ open: false, target: null });
            setSshPassword('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              SSH Authentication Required
            </DialogTitle>
            <DialogDescription>
              Enter the root password for <strong>{sshPasswordDialog.target?.name}</strong> to establish SSH key trust between paired targets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ssh-password">Root Password</Label>
              <Input 
                id="ssh-password"
                type="password" 
                value={sshPassword} 
                onChange={(e) => setSshPassword(e.target.value)}
                placeholder="Enter root password"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                This password is used once to establish SSH key-based authentication between targets.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSshPasswordDialog({ open: false, target: null });
                setSshPassword('');
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={submitSshKeyExchange} 
              disabled={submittingSshExchange || !sshPassword.trim()}
            >
              {submittingSshExchange ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating Job...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Establish Trust
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Health Results Dialog */}
      <ZfsTargetHealthDialog
        open={showHealthDialog}
        onOpenChange={setShowHealthDialog}
        healthResults={healthResults}
        partnerName={healthTarget?.partner_target?.name}
        onRefresh={() => healthTarget && handleHealthCheck(healthTarget, true)}
        refreshing={healthCheckingId === healthTarget?.id}
      />

      {/* Deploy SSH Key Dialog */}
      <DeploySshKeyDialog
        open={showDeploySshKeyDialog}
        onOpenChange={setShowDeploySshKeyDialog}
        target={deploySshKeyTarget}
        onDeployComplete={() => refetch()}
      />
    </Card>
  );
}
