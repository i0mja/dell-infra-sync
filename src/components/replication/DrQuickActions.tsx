import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Shield, Plus, Rocket, Play, ChevronDown, Users } from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { AddVMSelector } from "./AddVMSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProtectionGroups, useProtectedVMs } from "@/hooks/useReplication";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateProtectionGroupWizard } from "./CreateProtectionGroupWizard";
import { OnboardZfsTargetWizard } from "./OnboardZfsTargetWizard";
import { PairedZfsDeployWizard } from "./PairedZfsDeployWizard";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface DrQuickActionsProps {
  onOpenOnboardWizard?: () => void;
}

export function DrQuickActions({ onOpenOnboardWizard }: DrQuickActionsProps) {
  const { vcenters, loading: vcentersLoading } = useVCenters();
  const { groups, refetch: refetchGroups } = useProtectionGroups();
  
  // State for dialogs/wizards
  const [showCreateGroupWizard, setShowCreateGroupWizard] = useState(false);
  const [showAddVMDialog, setShowAddVMDialog] = useState(false);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [showSingleTargetWizard, setShowSingleTargetWizard] = useState(false);
  const [showPairedTargetWizard, setShowPairedTargetWizard] = useState(false);
  
  // State for VM protection
  const [selectedVCenterForProtection, setSelectedVCenterForProtection] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  
  // State for run replication
  const [runningReplication, setRunningReplication] = useState(false);
  
  // Get protected VMs for the selected group
  const { vms: protectedVMs, addVM } = useProtectedVMs(selectedGroupId || undefined);

  const isLoading = vcentersLoading;
  const hasVCenters = vcenters.length > 0;
  const hasGroups = groups && groups.length > 0;
  const existingVMIds = protectedVMs?.map(vm => vm.vm_id).filter(Boolean) as string[] || [];

  const handleProtectVm = () => {
    if (!hasGroups) {
      toast.error("No protection groups", {
        description: "Create a protection group first before adding VMs"
      });
      return;
    }
    setShowGroupSelector(true);
  };

  const handleGroupSelectedForProtection = (groupId: string) => {
    setSelectedGroupId(groupId);
    setShowGroupSelector(false);
    
    // Find the group's vCenter
    const group = groups?.find(g => g.id === groupId);
    if (group?.source_vcenter_id) {
      setSelectedVCenterForProtection(group.source_vcenter_id);
    } else {
      // Fallback to primary or first vCenter
      const primaryVCenter = vcenters.find(vc => vc.is_primary);
      const targetVCenter = primaryVCenter || vcenters[0];
      if (targetVCenter) {
        setSelectedVCenterForProtection(targetVCenter.id);
      }
    }
    setShowAddVMDialog(true);
  };

  const handleRunReplication = async () => {
    if (!hasGroups) {
      toast.error("No protection groups", {
        description: "Create a protection group first"
      });
      return;
    }

    const enabledGroups = groups?.filter(g => g.is_enabled && g.status !== 'paused') || [];
    if (enabledGroups.length === 0) {
      toast.error("No active groups", {
        description: "All protection groups are paused or disabled"
      });
      return;
    }

    setRunningReplication(true);
    try {
      // Create replication jobs for all enabled groups
      const promises = enabledGroups.map(group => 
        supabase.from('replication_jobs').insert({
          protection_group_id: group.id,
          job_type: 'sync',
          status: 'pending',
          incremental: true,
        })
      );

      await Promise.all(promises);
      toast.success(`Started replication for ${enabledGroups.length} group(s)`);
    } catch (error) {
      toast.error("Failed to start replication", {
        description: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      setRunningReplication(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background">
        {/* Primary Action: Run Replication */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="sm"
                onClick={handleRunReplication}
                disabled={isLoading || !hasGroups || runningReplication}
              >
                <Play className="h-4 w-4 mr-2" />
                {runningReplication ? "Starting..." : "Run Replication"}
              </Button>
            </TooltipTrigger>
            {!hasGroups && !isLoading && (
              <TooltipContent>
                <p>Create a protection group first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Protect VM */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleProtectVm}
                disabled={isLoading || !hasVCenters || !hasGroups}
              >
                <Shield className="h-4 w-4 mr-2" />
                Protect VM
              </Button>
            </TooltipTrigger>
            {(!hasVCenters || !hasGroups) && !isLoading && (
              <TooltipContent>
                <p>{!hasVCenters ? "Configure a vCenter first" : "Create a protection group first"}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* New Group */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowCreateGroupWizard(true)}
                disabled={isLoading || !hasVCenters}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Group
              </Button>
            </TooltipTrigger>
            {!hasVCenters && !isLoading && (
              <TooltipContent>
                <p>Configure a vCenter first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Add ZFS Target Dropdown */}
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    disabled={isLoading || !hasVCenters}
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Add ZFS Target
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              {!hasVCenters && !isLoading && (
                <TooltipContent>
                  <p>Configure a vCenter first</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="start" className="bg-popover">
            <DropdownMenuItem onClick={() => setShowPairedTargetWizard(true)}>
              <Users className="h-4 w-4 mr-2" />
              <div>
                <div className="font-medium">Deploy Paired Targets</div>
                <div className="text-xs text-muted-foreground">Source + DR site together (recommended)</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowSingleTargetWizard(true)}>
              <Rocket className="h-4 w-4 mr-2" />
              <div>
                <div className="font-medium">Deploy Single Target</div>
                <div className="text-xs text-muted-foreground">One site only (advanced)</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Group Selector Dialog for Protect VM */}
      <Dialog open={showGroupSelector} onOpenChange={setShowGroupSelector}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Protection Group</DialogTitle>
            <DialogDescription>
              Choose which group to add the VM to
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select onValueChange={handleGroupSelectedForProtection}>
              <SelectTrigger>
                <SelectValue placeholder="Select a protection group" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {groups?.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <span>{group.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGroupSelector(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add VM to Protection Dialog */}
      <AddVMSelector
        open={showAddVMDialog}
        onOpenChange={setShowAddVMDialog}
        sourceVCenterId={selectedVCenterForProtection}
        existingVMIds={existingVMIds}
        onAddVM={addVM}
      />

      {/* Create Protection Group Wizard */}
      <CreateProtectionGroupWizard
        open={showCreateGroupWizard}
        onOpenChange={(open) => {
          setShowCreateGroupWizard(open);
          if (!open) refetchGroups();
        }}
      />

      {/* Single Target Wizard */}
      <OnboardZfsTargetWizard
        open={showSingleTargetWizard}
        onOpenChange={setShowSingleTargetWizard}
        onSuccess={() => {
          setShowSingleTargetWizard(false);
          toast.success("ZFS target deployment started");
        }}
      />

      {/* Paired Target Wizard */}
      <PairedZfsDeployWizard
        open={showPairedTargetWizard}
        onOpenChange={setShowPairedTargetWizard}
        onSuccess={() => {
          setShowPairedTargetWizard(false);
        }}
      />
    </>
  );
}
