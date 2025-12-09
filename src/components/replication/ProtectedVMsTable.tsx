import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Loader2,
} from "lucide-react";
import { ProtectedVM } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";
import { ProtectionDatastoreWizard } from "./ProtectionDatastoreWizard";
import { DrShellVmWizard } from "./DrShellVmWizard";
import { AddVMsDialog } from "./AddVMsDialog";

interface ProtectedVMsTableProps {
  vms: ProtectedVM[];
  loading: boolean;
  onAddVMs: (vms: Partial<ProtectedVM>[], autoMigrate?: boolean) => Promise<unknown>;
  onRemoveVM: (vmId: string) => Promise<void>;
  onBatchMigrate?: (vmIds: string[]) => Promise<unknown>;
  protectionDatastore?: string;
  sourceVCenterId?: string;
  onRefresh?: () => void;
}

export function ProtectedVMsTable({
  vms,
  loading,
  onAddVMs,
  onRemoveVM,
  onBatchMigrate,
  protectionDatastore,
  sourceVCenterId,
  onRefresh,
}: ProtectedVMsTableProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [migratingAll, setMigratingAll] = useState(false);
  
  // Wizard state
  const [datastoreWizardOpen, setDatastoreWizardOpen] = useState(false);
  const [drShellWizardOpen, setDrShellWizardOpen] = useState(false);
  const [selectedVM, setSelectedVM] = useState<ProtectedVM | null>(null);
  
  // Get existing VM IDs to exclude from selector
  const existingVMIds = vms.map(vm => vm.vm_id).filter(Boolean) as string[];
  
  // Count VMs pending migration
  const pendingMigrationVMs = vms.filter(vm => vm.needs_storage_vmotion);
  const pendingMigrationCount = pendingMigrationVMs.length;
  
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

  const handleBatchMigrate = async () => {
    if (!onBatchMigrate || pendingMigrationCount === 0) return;
    
    setMigratingAll(true);
    try {
      const vmIds = pendingMigrationVMs.map(vm => vm.id);
      await onBatchMigrate(vmIds);
    } finally {
      setMigratingAll(false);
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
      {/* Pending Migrations Alert */}
      {pendingMigrationCount > 0 && onBatchMigrate && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-amber-600">
              {pendingMigrationCount} VM{pendingMigrationCount !== 1 ? 's' : ''} need{pendingMigrationCount === 1 ? 's' : ''} migration to protection datastore
              {protectionDatastore && <span className="text-muted-foreground"> ({protectionDatastore})</span>}
            </span>
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleBatchMigrate}
              disabled={migratingAll}
              className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
            >
              {migratingAll ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Migrating...
                </>
              ) : (
                <>
                  <MoveRight className="h-4 w-4 mr-1" />
                  Migrate All
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Add VMs Button */}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAddDialog(true)} disabled={!sourceVCenterId}>
          <Plus className="h-4 w-4 mr-1" />
          Add VMs
        </Button>
      </div>

      {/* Add VMs Dialog */}
      {sourceVCenterId && (
        <AddVMsDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          sourceVCenterId={sourceVCenterId}
          protectionDatastore={protectionDatastore}
          existingVMIds={existingVMIds}
          onAddVMs={onAddVMs}
        />
      )}

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
