import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Loader2 } from "lucide-react";
import { useVCenters, type VCenterFormData, type VCenter } from "@/hooks/useVCenters";
import { VCenterConnectionCard } from "./VCenterConnectionCard";
import { VCenterForm } from "./VCenterForm";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface VCenterManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVCenterAdded?: () => void;
}

export function VCenterManagementDialog({
  open,
  onOpenChange,
  onVCenterAdded,
}: VCenterManagementDialogProps) {
  const { toast } = useToast();
  const { vcenters, loading, addVCenter, updateVCenter, deleteVCenter } = useVCenters();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [pendingSyncVCenter, setPendingSyncVCenter] = useState<{id: string, name: string} | null>(null);

  const editingVCenter = vcenters.find((vc) => vc.id === editingId);

  const handleAdd = async (data: VCenterFormData) => {
    const result = await addVCenter(data);
    if (result.success) {
      setIsAdding(false);
      onVCenterAdded?.();
      
      // Show confirmation dialog if sync is enabled
      if (result.id && data.sync_enabled) {
        setPendingSyncVCenter({ id: result.id, name: data.name });
      }
    }
    return result.success;
  };

  const handleEdit = async (data: VCenterFormData) => {
    if (!editingId) return false;
    const success = await updateVCenter(editingId, data);
    if (success) {
      setEditingId(null);
    }
    return success;
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const success = await deleteVCenter(deletingId);
    if (success) {
      setDeletingId(null);
    }
  };

  const handleTest = async (vcenter: VCenter) => {
    setTestingId(vcenter.id);
    try {
      toast({
        title: "Testing connection...",
        description: `Testing connection to ${vcenter.name}`,
      });

      // Create test job
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "vcenter_connectivity_test",
          target_scope: {},
          details: { vcenter_id: vcenter.id },
        },
      });

      if (error) throw error;

      toast({
        title: "Test initiated",
        description: "Connection test job created. Check the Jobs panel for results.",
      });
    } catch (error: any) {
      console.error("Error testing vCenter:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to test vCenter connection",
        variant: "destructive",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleSync = async (vcenter: VCenter) => {
    setSyncingId(vcenter.id);
    try {
      toast({
        title: "Starting sync...",
        description: `Syncing ${vcenter.name}`,
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: jobData, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "vcenter_sync",
          target_scope: { vcenter_ids: [vcenter.id] },
          details: { 
            vcenter_id: vcenter.id,
            vcenter_name: vcenter.name,
          },
        },
      });

      if (error) throw error;

      toast({
        title: "Sync initiated",
        description: "vCenter sync job created. Check the Jobs panel for progress.",
      });
    } catch (error: any) {
      console.error("Error syncing vCenter:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to sync vCenter",
        variant: "destructive",
      });
    } finally {
      setSyncingId(null);
    }
  };

  const handleInitialSync = async () => {
    if (!pendingSyncVCenter) return;
    
    toast({
      title: "Starting initial sync...",
      description: `Syncing ${pendingSyncVCenter.name}`,
    });

    const { error } = await supabase.functions.invoke("create-job", {
      body: {
        job_type: "vcenter_sync",
        target_scope: { vcenter_ids: [pendingSyncVCenter.id] },
        details: { 
          vcenter_id: pendingSyncVCenter.id,
          vcenter_name: pendingSyncVCenter.name,
          is_initial_sync: true,
        },
      },
    });

    if (error) {
      toast({
        title: "Error",
        description: error.message || "Failed to start initial sync",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Sync initiated",
        description: "Initial sync job created. Check the Jobs panel for progress.",
      });
    }
    
    setPendingSyncVCenter(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage vCenter Connections</DialogTitle>
            <DialogDescription>
              Add and manage multiple VMware vCenter Server connections
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Add/Edit Form */}
              {(isAdding || editingId) && (
                <div className="border rounded-lg p-4 bg-muted/50">
                  <h3 className="font-semibold mb-4">
                    {isAdding ? "Add New vCenter" : "Edit vCenter"}
                  </h3>
                  <VCenterForm
                    initialData={editingVCenter}
                    onSubmit={isAdding ? handleAdd : handleEdit}
                    onCancel={() => {
                      setIsAdding(false);
                      setEditingId(null);
                    }}
                    submitLabel={isAdding ? "Add vCenter" : "Save Changes"}
                  />
                </div>
              )}

              {/* List of vCenters */}
              {vcenters.length > 0 && (
                <div className="space-y-3">
                  {vcenters.map((vcenter) => (
                    <VCenterConnectionCard
                      key={vcenter.id}
                      vcenter={vcenter}
                      onEdit={() => setEditingId(vcenter.id)}
                      onDelete={() => setDeletingId(vcenter.id)}
                      onTest={() => handleTest(vcenter)}
                      onSync={() => handleSync(vcenter)}
                    />
                  ))}
                </div>
              )}

              {vcenters.length === 0 && !isAdding && (
                <div className="text-center py-8 text-muted-foreground">
                  No vCenter connections configured. Click "Add vCenter" to get started.
                </div>
              )}

              {/* Add Button */}
              {!isAdding && !editingId && (
                <Button onClick={() => setIsAdding(true)} className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Add vCenter Connection
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vCenter Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this vCenter connection? This will also remove all
              associated hosts, VMs, clusters, and datastores data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Initial Sync Confirmation Dialog */}
      <AlertDialog open={!!pendingSyncVCenter} onOpenChange={(open) => !open && setPendingSyncVCenter(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Initial Sync?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to sync {pendingSyncVCenter?.name} now? This will import clusters, 
              datastores, VMs, alarms, and ESXi hosts from vCenter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Skip for Now</AlertDialogCancel>
            <AlertDialogAction onClick={handleInitialSync}>
              Yes, Sync Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
