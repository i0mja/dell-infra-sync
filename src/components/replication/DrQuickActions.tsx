import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Shield, Plus, Rocket, RefreshCw, TestTube } from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useZfsTemplates } from "@/hooks/useZfsTemplates";
import { DeployZfsTargetWizard } from "./DeployZfsTargetWizard";
import { AddVMSelector } from "./AddVMSelector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HardDrive } from "lucide-react";
import { useProtectionGroups, useProtectedVMs } from "@/hooks/useReplication";
import { useAccessibleDatastores } from "@/hooks/useAccessibleDatastores";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "N/A";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(1)} TB`;
  }
  return `${gb.toFixed(1)} GB`;
}

export function DrQuickActions() {
  const { vcenters, loading: vcentersLoading } = useVCenters();
  const { templates, loading: templatesLoading } = useZfsTemplates();
  const { groups, createGroup } = useProtectionGroups();
  const { vms: protectedVMs, addVM } = useProtectedVMs(groups?.[0]?.id);
  
  const [showDeployWizard, setShowDeployWizard] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [showAddVMDialog, setShowAddVMDialog] = useState(false);
  const [selectedVCenterForProtection, setSelectedVCenterForProtection] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupDatastore, setNewGroupDatastore] = useState("");
  const [selectedVCenterId, setSelectedVCenterId] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: datastores = [], isLoading: loadingDatastores } = useAccessibleDatastores(
    selectedVCenterId || undefined
  );

  const isLoading = vcentersLoading || templatesLoading;
  const hasTemplates = templates.length > 0;
  const hasVCenters = vcenters.length > 0;
  const existingVMIds = protectedVMs?.map(vm => vm.vm_id).filter(Boolean) as string[] || [];

  const handleProtectVm = () => {
    if (vcenters.length === 1) {
      setSelectedVCenterForProtection(vcenters[0].id);
    } else if (vcenters.length > 0) {
      setSelectedVCenterForProtection(vcenters[0].id);
    }
    setShowAddVMDialog(true);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !selectedVCenterId || !newGroupDatastore) return;
    
    setCreating(true);
    try {
      await createGroup({
        name: newGroupName,
        description: newGroupDescription,
        protection_datastore: newGroupDatastore,
        source_vcenter_id: selectedVCenterId,
      });
      setShowCreateGroupDialog(false);
      resetForm();
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setNewGroupName("");
    setNewGroupDescription("");
    setNewGroupDatastore("");
    setSelectedVCenterId("");
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleProtectVm}
                disabled={isLoading || !hasVCenters}
              >
                <Shield className="h-4 w-4 mr-2" />
                Protect VM
              </Button>
            </TooltipTrigger>
            {!hasVCenters && !isLoading && (
              <TooltipContent>
                <p>Configure a vCenter first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowCreateGroupDialog(true)}
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

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowDeployWizard(true)}
                disabled={isLoading || !hasTemplates || !hasVCenters}
              >
                <Rocket className="h-4 w-4 mr-2" />
                Deploy ZFS Target
              </Button>
            </TooltipTrigger>
            {(!hasTemplates || !hasVCenters) && !isLoading && (
              <TooltipContent>
                <p>
                  {!hasVCenters 
                    ? "Configure a vCenter first" 
                    : "Create a ZFS template first in Settings → Infrastructure"}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                disabled
              >
                <TestTube className="h-4 w-4 mr-2" />
                Failover Test
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Coming soon: Test DR failover without affecting production</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex-1" />

        <Button variant="ghost" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Sync vCenter
        </Button>
      </div>

      {/* Deploy ZFS Target Wizard */}
      <DeployZfsTargetWizard
        open={showDeployWizard}
        onOpenChange={setShowDeployWizard}
      />

      {/* Add VM to Protection Dialog */}
      <AddVMSelector
        open={showAddVMDialog}
        onOpenChange={setShowAddVMDialog}
        sourceVCenterId={selectedVCenterForProtection}
        existingVMIds={existingVMIds}
        onAddVM={addVM}
      />

      {/* Create Protection Group Dialog */}
      <Dialog open={showCreateGroupDialog} onOpenChange={(open) => {
        setShowCreateGroupDialog(open);
        if (!open) resetForm();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Protection Group</DialogTitle>
            <DialogDescription>
              Create a new group to protect related VMs together
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                placeholder="e.g., Production Databases"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                placeholder="Optional description..."
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vcenter">Source vCenter</Label>
              <Select 
                value={selectedVCenterId} 
                onValueChange={(val) => {
                  setSelectedVCenterId(val);
                  setNewGroupDatastore("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vCenter" />
                </SelectTrigger>
                <SelectContent>
                  {vcenters.map((vc) => (
                    <SelectItem key={vc.id} value={vc.id}>
                      {vc.name} ({vc.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="datastore">Protection Datastore</Label>
              <Select
                value={newGroupDatastore}
                onValueChange={setNewGroupDatastore}
                disabled={!selectedVCenterId || loadingDatastores}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    !selectedVCenterId 
                      ? "Select vCenter first" 
                      : loadingDatastores 
                        ? "Loading datastores..." 
                        : "Select datastore"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {datastores.map((ds) => (
                    <SelectItem key={ds.id} value={ds.name}>
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <span>{ds.name}</span>
                        <span className="text-muted-foreground text-xs">
                          ({formatBytes(ds.free_bytes)} free)
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                VMs will be moved here before replication (via Storage vMotion)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateGroupDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateGroup} 
              disabled={creating || !newGroupName.trim() || !selectedVCenterId || !newGroupDatastore}
            >
              {creating ? 'Creating...' : 'Create Group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
