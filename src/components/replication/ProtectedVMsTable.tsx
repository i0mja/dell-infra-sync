import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Plus, 
  Trash2, 
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  Server as ServerIcon,
  MoveRight,
  MoreVertical,
  Wand2,
} from "lucide-react";
import { ProtectedVM } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";
import { ProtectionDatastoreWizard } from "./ProtectionDatastoreWizard";
import { DrShellVmWizard } from "./DrShellVmWizard";

interface ProtectedVMsTableProps {
  vms: ProtectedVM[];
  loading: boolean;
  onAddVM: (vm: Partial<ProtectedVM>) => Promise<ProtectedVM | undefined>;
  onRemoveVM: (vmId: string) => Promise<void>;
  protectionDatastore?: string;
  onRefresh?: () => void;
}

export function ProtectedVMsTable({
  vms,
  loading,
  onAddVM,
  onRemoveVM,
  protectionDatastore,
  onRefresh,
}: ProtectedVMsTableProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newVMName, setNewVMName] = useState("");
  const [newVMDatastore, setNewVMDatastore] = useState("");
  const [adding, setAdding] = useState(false);
  
  // Wizard state
  const [datastoreWizardOpen, setDatastoreWizardOpen] = useState(false);
  const [drShellWizardOpen, setDrShellWizardOpen] = useState(false);
  const [selectedVM, setSelectedVM] = useState<ProtectedVM | null>(null);
  
  const openDatastoreWizard = (vm: ProtectedVM) => {
    setSelectedVM(vm);
    setDatastoreWizardOpen(true);
  };
  
  const openDrShellWizard = (vm: ProtectedVM) => {
    setSelectedVM(vm);
    setDrShellWizardOpen(true);
  };
  
  const handleWizardComplete = () => {
    onRefresh?.();
  };

  const handleAdd = async () => {
    if (!newVMName.trim()) return;
    
    setAdding(true);
    try {
      await onAddVM({
        vm_name: newVMName,
        current_datastore: newVMDatastore || undefined,
      });
      setShowAddDialog(false);
      setNewVMName("");
      setNewVMDatastore("");
    } finally {
      setAdding(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge variant="outline" className="text-green-600 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add VM Button */}
      <div className="flex justify-end">
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add VM
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add VM to Protection</DialogTitle>
              <DialogDescription>
                Add a VM to this protection group for DR replication
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">VM Name</label>
                <Input
                  placeholder="e.g., db-primary"
                  value={newVMName}
                  onChange={(e) => setNewVMName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Datastore</label>
                <Input
                  placeholder="e.g., Production-DS"
                  value={newVMDatastore}
                  onChange={(e) => setNewVMDatastore(e.target.value)}
                />
                {protectionDatastore && newVMDatastore && newVMDatastore !== protectionDatastore && (
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <AlertTriangle className="h-3 w-3" />
                    Storage vMotion required: {newVMDatastore} → {protectionDatastore}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={adding || !newVMName.trim()}>
                {adding ? 'Adding...' : 'Add VM'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* VMs Table */}
      {vms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <ServerIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No VMs in this protection group</p>
          <p className="text-sm">Add VMs to start protecting them</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VM Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Datastore</TableHead>
                <TableHead>DR Shell</TableHead>
                <TableHead>Last Replication</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vms.map((vm) => (
                <TableRow key={vm.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ServerIcon className="h-4 w-4 text-muted-foreground" />
                      {vm.vm_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(vm.replication_status)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <HardDrive className="h-3 w-3 text-muted-foreground" />
                      {vm.current_datastore || '-'}
                      {vm.needs_storage_vmotion && (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                          <MoveRight className="h-3 w-3 mr-1" />
                          vMotion needed
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {vm.dr_shell_vm_created ? (
                      <Badge variant="outline" className="text-green-600 border-green-500/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {vm.dr_shell_vm_name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">Not created</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {vm.last_replication_at 
                      ? formatDistanceToNow(new Date(vm.last_replication_at), { addSuffix: true })
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover z-50">
                        <DropdownMenuItem onClick={() => openDatastoreWizard(vm)}>
                          <Wand2 className="h-4 w-4 mr-2" />
                          Protection Datastore Wizard
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDrShellWizard(vm)}>
                          <ServerIcon className="h-4 w-4 mr-2" />
                          DR Shell VM Wizard
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => onRemoveVM(vm.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove from Protection
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
      
      {/* Wizards */}
      <ProtectionDatastoreWizard
        open={datastoreWizardOpen}
        onOpenChange={setDatastoreWizardOpen}
        vm={selectedVM}
        protectionDatastore={protectionDatastore}
        onComplete={handleWizardComplete}
      />
      
      <DrShellVmWizard
        open={drShellWizardOpen}
        onOpenChange={setDrShellWizardOpen}
        vm={selectedVM}
        onComplete={handleWizardComplete}
      />
    </div>
  );
}
