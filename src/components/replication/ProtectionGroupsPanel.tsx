import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFailoverEventSubscription } from "@/hooks/useFailoverEventSubscription";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Shield, 
  Plus, 
  Play, 
  Trash2, 
  Clock,
  Server,
  ChevronRight,
  CheckCircle2,
  Pencil,
  Pause,
  PlayCircle,
  AlertTriangle,
  XCircle,
  AlertCircle,
  RefreshCw,
  KeyRound,
  Link2,
  Zap,
  ChevronDown,
  ClipboardCheck,
  FlaskConical,
  Loader2,
} from "lucide-react";
import { useProtectionGroups, useProtectedVMs, ProtectionGroup, useReplicationTargets, ReplicationTarget } from "@/hooks/useReplication";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { ProtectedVMsTable } from "./ProtectedVMsTable";
import { EditProtectionGroupDialog } from "./EditProtectionGroupDialog";
import { CreateProtectionGroupWizard } from "./CreateProtectionGroupWizard";
import { FailoverPreflightDialog } from "./FailoverPreflightDialog";
import { GroupFailoverWizard } from "./GroupFailoverWizard";
import { ActiveTestIndicator } from "./ActiveTestIndicator";
import { supabase } from "@/integrations/supabase/client";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "N/A";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(1)} TB`;
  }
  return `${gb.toFixed(1)} GB`;
}

function StatusBadge({ group }: { group: ProtectionGroup }) {
  const status = group.status || (group.is_enabled ? 'meeting_sla' : 'paused');
  
  switch (status) {
    case 'meeting_sla':
      return (
        <Badge variant="outline" className="text-green-600 border-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Meeting SLA
        </Badge>
      );
    case 'not_meeting_sla':
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Not Meeting SLA
        </Badge>
      );
    case 'paused':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Pause className="h-3 w-3 mr-1" />
          Paused
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="outline" className="text-red-600 border-red-500/30">
          <XCircle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
    case 'syncing':
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-500/30">
          <Play className="h-3 w-3 mr-1 animate-pulse" />
          Syncing
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {group.is_enabled ? 'Active' : 'Paused'}
        </Badge>
      );
  }
}

function PriorityBadge({ priority }: { priority?: string }) {
  switch (priority) {
    case 'critical':
      return <Badge className="bg-red-500 hover:bg-red-600">Critical</Badge>;
    case 'high':
      return <Badge className="bg-amber-500 hover:bg-amber-600">High</Badge>;
    case 'medium':
      return <Badge className="bg-blue-500 hover:bg-blue-600">Medium</Badge>;
    case 'low':
      return <Badge variant="secondary">Low</Badge>;
    default:
      return null;
  }
}

export function ProtectionGroupsPanel() {
  const { groups, loading, updateGroup, deleteGroup, pauseGroup, runReplicationNow, exchangeSshKeys, refetch } = useProtectionGroups();
  const { targets } = useReplicationTargets();
  const { toast } = useToast();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPreflightDialog, setShowPreflightDialog] = useState(false);
  const [showFailoverWizard, setShowFailoverWizard] = useState(false);
  const [failoverType, setFailoverType] = useState<'test' | 'live'>('test');
  const [runningReplication, setRunningReplication] = useState<string | null>(null);
  const [pausingGroup, setPausingGroup] = useState<string | null>(null);
  const [exchangingKeys, setExchangingKeys] = useState(false);
  
  // SSH password dialog state
  const [sshPasswordDialog, setSshPasswordDialog] = useState<{
    open: boolean;
    sourceTarget: ReplicationTarget | null;
    destTarget: ReplicationTarget | null;
  }>({ open: false, sourceTarget: null, destTarget: null });
  const [sshPassword, setSshPassword] = useState('');

  const { vms, loading: vmsLoading, refetch: refetchVMs, addVMs, removeVM, batchMigrate } = useProtectedVMs(
    selectedGroupId || undefined
  );

  const selectedGroup = groups.find(g => g.id === selectedGroupId);
  
  // Subscribe to realtime failover event changes for immediate UI updates
  useFailoverEventSubscription(selectedGroupId);
  
  // Get target info for selected group
  const selectedTarget = selectedGroup?.target_id 
    ? targets.find(t => t.id === selectedGroup.target_id) 
    : null;
  const partnerTarget = selectedTarget?.partner_target;

  // Query for active sync jobs
  const { data: activeSyncJobs = [] } = useQuery({
    queryKey: ['active-sync-jobs', selectedGroupId],
    queryFn: async () => {
      if (!selectedGroupId) return [];
      const { data } = await supabase
        .from('jobs')
        .select('id, status, created_at, started_at')
        .eq('job_type', 'run_replication_sync')
        .contains('details', { protection_group_id: selectedGroupId })
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1);
      return data || [];
    },
    enabled: !!selectedGroupId,
    refetchInterval: 3000,
  });

  const isSyncing = activeSyncJobs.length > 0;

  // Query for active test failover
  const { data: activeTestEvent } = useQuery({
    queryKey: ['active-test-failover', selectedGroupId],
    queryFn: async () => {
      if (!selectedGroupId) return null;
      const { data } = await supabase
        .from('failover_events')
        .select('id, failover_type, status, started_at, test_duration_minutes, cleanup_scheduled_at')
        .eq('protection_group_id', selectedGroupId)
        .eq('failover_type', 'test')
        .in('status', ['pending', 'in_progress', 'awaiting_commit', 'completed'])
        .is('rolled_back_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedGroupId,
    refetchInterval: 30000, // Reduced from 5s - realtime handles immediate updates
  });

  // Check if test is overdue (also returns true if never tested and reminder is set)
  const isTestOverdue = (group: ProtectionGroup): boolean => {
    if (!group.test_reminder_days) return false;
    
    // If never tested, check against group creation date
    if (!group.last_test_at) {
      const daysSinceCreation = differenceInDays(new Date(), new Date(group.created_at));
      return daysSinceCreation > group.test_reminder_days;
    }
    
    const daysSinceTest = differenceInDays(new Date(), new Date(group.last_test_at));
    return daysSinceTest > group.test_reminder_days;
  };
  
  // Check if group has never been tested
  const isNeverTested = (group: ProtectionGroup): boolean => {
    return !group.last_test_at && !!group.test_reminder_days;
  };

  // Check if group has target configured
  const hasTargetConfigured = (group: ProtectionGroup): boolean => {
    return !!group.target_id;
  };

  const handleRunNow = async (groupId: string) => {
    setRunningReplication(groupId);
    try {
      await runReplicationNow(groupId);
      await refetchVMs();
    } finally {
      setRunningReplication(null);
    }
  };

  const handleExchangeSshKeys = () => {
    if (!selectedTarget?.id || !partnerTarget?.id) return;
    setSshPasswordDialog({ 
      open: true, 
      sourceTarget: selectedTarget as ReplicationTarget, 
      destTarget: partnerTarget as unknown as ReplicationTarget 
    });
    setSshPassword('');
  };

  const submitSshKeyExchange = async () => {
    const { sourceTarget, destTarget } = sshPasswordDialog;
    if (!sourceTarget || !destTarget) return;
    
    setExchangingKeys(true);
    try {
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
      
      await exchangeSshKeys({
        sourceTargetId: sourceTarget.id,
        destTargetId: destTarget.id,
        adminPasswordEncrypted: encryptedPassword,
      });
      
      setSshPasswordDialog({ open: false, sourceTarget: null, destTarget: null });
      setSshPassword('');
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setExchangingKeys(false);
    }
  };

  const handlePauseToggle = async (group: ProtectionGroup) => {
    setPausingGroup(group.id);
    try {
      const isPaused = !!group.paused_at;
      await pauseGroup({ id: group.id, paused: !isPaused });
    } finally {
      setPausingGroup(null);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!confirm('Delete this protection group? All protected VMs will be removed.')) return;
    await deleteGroup(groupId);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
    }
  };

  const handleSaveEdit = async (id: string, updates: Partial<ProtectionGroup>, originalGroup?: ProtectionGroup) => {
    await updateGroup({ id, updates, originalGroup });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Protection Groups List */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Protection Groups
              </CardTitle>
              <CardDescription>
                Groups of VMs replicated together
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowCreateWizard(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No protection groups</p>
              <p className="text-sm">Create your first group to start protecting VMs</p>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedGroupId === group.id 
                      ? 'border-primary bg-primary/5' 
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      <span className="font-medium">{group.name}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary">
                      <Server className="h-3 w-3 mr-1" />
                      {group.vm_count || 0} VMs
                    </Badge>
                    <StatusBadge group={group} />
                    <PriorityBadge priority={group.priority} />
                    {group.status === 'failed_over' && (
                      <Badge variant="outline" className="text-blue-600 border-blue-500/30">
                        <FlaskConical className="h-3 w-3 mr-1" />
                        Test Active
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      RPO: {group.rpo_minutes}m
                      {group.current_rpo_seconds && (
                        <span className="ml-1">
                          (actual: {Math.round(group.current_rpo_seconds / 60)}m)
                        </span>
                      )}
                    </span>
                    {group.last_replication_at && (
                      <span>
                        {formatDistanceToNow(new Date(group.last_replication_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  {isTestOverdue(group) && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                      <AlertCircle className="h-3 w-3" />
                      Test overdue ({differenceInDays(new Date(), new Date(group.last_test_at!))} days)
                    </div>
                  )}
                  {!hasTargetConfigured(group) && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                      <Link2 className="h-3 w-3" />
                      Not linked to ZFS target
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Protected VMs Detail */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                {selectedGroup ? selectedGroup.name : 'Protected VMs'}
              </CardTitle>
              <CardDescription>
                {selectedGroup 
                  ? `${vms.length} VMs in this protection group`
                  : 'Select a protection group to view its VMs'}
              </CardDescription>
            </div>
            {selectedGroup && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowEditDialog(true)}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handlePauseToggle(selectedGroup)}
                  disabled={pausingGroup === selectedGroup.id}
                >
                  {selectedGroup.paused_at ? (
                    <>
                      <PlayCircle className="h-4 w-4 mr-1" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-1" />
                      Pause
                    </>
                  )}
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant={isSyncing ? "secondary" : "outline"}
                        onClick={() => handleRunNow(selectedGroup.id)}
                        disabled={runningReplication === selectedGroup.id || isSyncing || vms.length === 0 || !!selectedGroup.paused_at || !hasTargetConfigured(selectedGroup)}
                      >
                        {isSyncing ? (
                          <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Play className={`h-4 w-4 mr-1 ${runningReplication === selectedGroup.id ? 'animate-pulse' : ''}`} />
                        )}
                        {isSyncing ? 'Syncing...' : runningReplication === selectedGroup.id ? 'Starting...' : 'Sync Now'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {!hasTargetConfigured(selectedGroup) 
                        ? 'Configure a ZFS target in Edit first'
                        : vms.length === 0 
                        ? 'Add VMs to this group first'
                        : selectedGroup.paused_at
                        ? 'Resume the group first'
                        : 'Trigger immediate ZFS replication sync'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      disabled={!hasTargetConfigured(selectedGroup) || vms.length === 0}
                    >
                      <Zap className="h-4 w-4 mr-1" />
                      Failover
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setShowPreflightDialog(true)}>
                      <ClipboardCheck className="h-4 w-4 mr-2" />
                      Pre-Flight Check
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setFailoverType('test'); setShowFailoverWizard(true); }}>
                      <FlaskConical className="h-4 w-4 mr-2" />
                      Test Failover
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => { setFailoverType('live'); setShowFailoverWizard(true); }}
                      className="text-red-600 focus:text-red-600"
                    >
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      Live Failover
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => handleDelete(selectedGroup.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Target Link Status */}
          {selectedGroup && (
            <div className="mt-4 p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {selectedTarget ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">{selectedTarget.name}</span>
                        <Badge variant={selectedTarget.health_status === 'healthy' ? 'default' : 'secondary'} className="text-xs">
                          {selectedTarget.health_status}
                        </Badge>
                      </div>
                      {partnerTarget && (
                        <>
                          <span className="text-muted-foreground">→</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{partnerTarget.name}</span>
                            <Badge variant={partnerTarget.health_status === 'healthy' ? 'default' : 'secondary'} className="text-xs">
                              {partnerTarget.health_status}
                            </Badge>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm">No ZFS target configured</span>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => setShowEditDialog(true)}
                        className="ml-2"
                      >
                        <Link2 className="h-3 w-3 mr-1" />
                        Link Now
                      </Button>
                    </div>
                  )}
                </div>
                {selectedTarget && partnerTarget && (
                  <div className="flex items-center gap-2">
                    {(selectedTarget as any).ssh_trust_established || (partnerTarget as any).ssh_trust_established ? (
                      <Badge variant="outline" className="text-green-600 border-green-500/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        SSH Ready
                      </Badge>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleExchangeSshKeys}
                              disabled={exchangingKeys}
                              className="text-amber-600 border-amber-500/30"
                            >
                              <KeyRound className={`h-4 w-4 mr-1 ${exchangingKeys ? 'animate-spin' : ''}`} />
                              {exchangingKeys ? 'Exchanging...' : 'Exchange SSH Keys'}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Set up passwordless SSH between source and DR targets for ZFS replication
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!selectedGroup ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Select a protection group to manage its VMs</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active Test Indicator */}
              {activeTestEvent && activeTestEvent.status !== 'rolled_back' && (
                <ActiveTestIndicator
                  groupId={selectedGroup.id}
                  eventId={activeTestEvent.id}
                  cleanupScheduledAt={activeTestEvent.cleanup_scheduled_at}
                  testDurationMinutes={activeTestEvent.test_duration_minutes}
                  startedAt={activeTestEvent.started_at}
                />
              )}
              
              <ProtectedVMsTable
                vms={vms}
                loading={vmsLoading}
                onAddVMs={addVMs}
                onRemoveVM={removeVM}
                onBatchMigrate={batchMigrate}
                protectionDatastore={selectedGroup.protection_datastore}
                sourceVCenterId={selectedGroup.source_vcenter_id || undefined}
                protectionGroupId={selectedGroup.id}
                rpoMinutes={selectedGroup.rpo_minutes}
                onRefresh={refetchVMs}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <EditProtectionGroupDialog
        group={selectedGroup || null}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSave={handleSaveEdit}
      />

      {/* Create Protection Group Wizard */}
      <CreateProtectionGroupWizard
        open={showCreateWizard}
        onOpenChange={setShowCreateWizard}
      />

      {/* Pre-Flight Check Dialog */}
      {selectedGroup && (
        <FailoverPreflightDialog
          open={showPreflightDialog}
          onOpenChange={setShowPreflightDialog}
          groupId={selectedGroup.id}
          groupName={selectedGroup.name}
          onProceedToFailover={(force) => {
            setShowPreflightDialog(false);
            setShowFailoverWizard(true);
          }}
        />
      )}

      {/* Failover Wizard */}
      {selectedGroup && (
        <GroupFailoverWizard
          open={showFailoverWizard}
          onOpenChange={setShowFailoverWizard}
          group={selectedGroup}
          vms={vms}
          initialFailoverType={failoverType}
        />
      )}

      {/* SSH Password Dialog for Key Exchange */}
      <Dialog 
        open={sshPasswordDialog.open} 
        onOpenChange={(open) => {
          if (!open) {
            setSshPasswordDialog({ open: false, sourceTarget: null, destTarget: null });
            setSshPassword('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              SSH Key Exchange
            </DialogTitle>
            <DialogDescription>
              Enter the root password for <strong>{sshPasswordDialog.sourceTarget?.name}</strong> to establish SSH key trust with <strong>{sshPasswordDialog.destTarget?.name}</strong>.
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
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSshPasswordDialog({ open: false, sourceTarget: null, destTarget: null });
                setSshPassword('');
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={submitSshKeyExchange} 
              disabled={exchangingKeys || !sshPassword.trim()}
            >
              {exchangingKeys ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Establishing Trust...
                </>
              ) : (
                'Establish Trust'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
