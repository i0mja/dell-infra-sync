import { useState } from 'react';
import { usePdus } from '@/hooks/usePdus';
import { testPduConnection, discoverPdu, syncPduStatus } from '@/services/pduService';
import { PduCard } from '@/components/pdu/PduCard';
import { AddPduDialog } from '@/components/pdu/AddPduDialog';
import { EditPduDialog } from '@/components/pdu/EditPduDialog';
import { PduOutletsDialog } from '@/components/pdu/PduOutletsDialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Zap, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Pdu, PduFormData, PduDiscoverResponse } from '@/types/pdu';

export default function Pdus() {
  const { pdus, isLoading, refetch, addPdu, updatePdu, deletePdu } = usePdus();
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPdu, setEditingPdu] = useState<Pdu | null>(null);
  const [deletingPdu, setDeletingPdu] = useState<Pdu | null>(null);
  const [viewingOutletsPdu, setViewingOutletsPdu] = useState<Pdu | null>(null);

  const handleAdd = async (data: PduFormData) => {
    const result = await addPdu.mutateAsync(data);
    
    // Auto-discover to get outlet count
    if (result?.id) {
      toast.info('Discovering PDU outlets...');
      try {
        const discovery = await discoverPdu(result.id);
        // Check if it's an instant API response (has discovered property)
        if (typeof discovery === 'object' && 'discovered' in discovery) {
          const discoverResult = discovery as PduDiscoverResponse;
          if (discoverResult.success && discoverResult.discovered?.total_outlets) {
            toast.success(`Discovered ${discoverResult.discovered.total_outlets} outlets`);
          } else if (discoverResult.error) {
            toast.warning(`Discovery: ${discoverResult.error}`);
          }
        } else {
          // Job queue fallback - just notify
          toast.info('Discovery job queued');
        }
        refetch();
      } catch (e) {
        console.log('Auto-discovery deferred:', e);
      }
    }
  };

  const handleEdit = async (id: string, data: Partial<PduFormData>) => {
    await updatePdu.mutateAsync({ id, data });
  };

  const handleDelete = async () => {
    if (!deletingPdu) return;
    await deletePdu.mutateAsync(deletingPdu.id);
    setDeletingPdu(null);
  };

  const handleTest = async (pdu: Pdu) => {
    try {
      const result = await testPduConnection(pdu.id);
      if (typeof result === 'object' && 'success' in result) {
        if (result.success) {
          toast.success(`${pdu.name}: ${result.message || 'Connection successful'}${result.protocol_used ? ` (${result.protocol_used.toUpperCase()})` : ''}`);
        } else {
          toast.error(`${pdu.name}: ${result.error || 'Connection failed'}`);
        }
      } else {
        toast.success(`Connection test job created for ${pdu.name}`);
      }
      setTimeout(() => refetch(), 1000);
    } catch (error) {
      toast.error(`Failed to test connection: ${error}`);
    }
  };

  const handleSync = async (pdu: Pdu) => {
    try {
      const result = await syncPduStatus(pdu.id);
      if (typeof result === 'object' && 'success' in result) {
        if (result.success) {
          toast.success(`${pdu.name}: Synced ${result.outlet_count || 0} outlets${result.protocol_used ? ` (${result.protocol_used.toUpperCase()})` : ''}`);
        } else {
          toast.error(`${pdu.name}: ${result.error || 'Sync failed'}`);
        }
      } else {
        toast.success(`Status sync job created for ${pdu.name}`);
      }
      setTimeout(() => refetch(), 1000);
    } catch (error) {
      toast.error(`Failed to sync status: ${error}`);
    }
  };

  const handleDiscoverAll = async () => {
    let successCount = 0;
    let failCount = 0;
    
    for (const pdu of pdus) {
      try {
        const result = await discoverPdu(pdu.id);
        if (typeof result === 'object' && 'success' in result) {
          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } else {
          successCount++; // Job queued counts as success
        }
      } catch {
        failCount++;
      }
    }
    
    if (successCount > 0) {
      toast.success(`Discovered ${successCount} PDU(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to discover ${failCount} PDU(s)`);
    }
    
    setTimeout(() => refetch(), 2000);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6" />
            PDU Management
          </h1>
          <p className="text-muted-foreground">
            Manage Schneider Electric / APC Power Distribution Units
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pdus.length > 0 && (
            <Button variant="outline" onClick={handleDiscoverAll}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Discover All
            </Button>
          )}
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add PDU
          </Button>
        </div>
      </div>

      {/* PDU Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[280px]" />
          ))}
        </div>
      ) : pdus.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pdus.map((pdu) => (
            <PduCard
              key={pdu.id}
              pdu={pdu}
              onEdit={setEditingPdu}
              onDelete={setDeletingPdu}
              onTest={handleTest}
              onSync={handleSync}
              onViewOutlets={setViewingOutletsPdu}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Zap className="h-12 w-12 mb-4" />
          <h3 className="text-lg font-medium mb-2">No PDUs Configured</h3>
          <p className="text-sm mb-4">
            Add your first PDU to start managing power outlets
          </p>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add PDU
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <AddPduDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAdd}
      />

      <EditPduDialog
        open={!!editingPdu}
        onOpenChange={(open) => !open && setEditingPdu(null)}
        pdu={editingPdu}
        onSubmit={handleEdit}
      />

      <PduOutletsDialog
        open={!!viewingOutletsPdu}
        onOpenChange={(open) => !open && setViewingOutletsPdu(null)}
        pdu={viewingOutletsPdu}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingPdu} onOpenChange={() => setDeletingPdu(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PDU</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingPdu?.name}"? This will also remove all
              outlet data and server mappings. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
