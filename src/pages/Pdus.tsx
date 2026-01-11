import { useState, useMemo, useEffect } from 'react';
import { usePdus, usePduOutlets } from '@/hooks/usePdus';
import { testPduConnection, discoverPdu, syncPduStatus } from '@/services/pduService';
import { PduStatsBar } from '@/components/pdu/PduStatsBar';
import { PdusTable } from '@/components/pdu/PdusTable';
import { PduDetailsSidebar } from '@/components/pdu/PduDetailsSidebar';
import { AddPduDialog } from '@/components/pdu/AddPduDialog';
import { EditPduDialog } from '@/components/pdu/EditPduDialog';
import { PduOutletsDialog } from '@/components/pdu/PduOutletsDialog';
import { PduDiagnosticsDialog } from '@/components/pdu/PduDiagnosticsDialog';
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
import { Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { Pdu, PduFormData, PduDiscoverResponse, PduOutlet } from '@/types/pdu';

export default function Pdus() {
  const { pdus, isLoading, refetch, addPdu, updatePdu, deletePdu } = usePdus();
  
  const [selectedPdu, setSelectedPdu] = useState<Pdu | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPdu, setEditingPdu] = useState<Pdu | null>(null);
  const [deletingPdu, setDeletingPdu] = useState<Pdu | null>(null);
  const [viewingOutletsPdu, setViewingOutletsPdu] = useState<Pdu | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [testingPdu, setTestingPdu] = useState<string | null>(null);
  const [syncingPdu, setSyncingPdu] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Fetch outlets for selected PDU
  const { outlets: selectedPduOutlets } = usePduOutlets(selectedPdu?.id || null);

  // Build outlets map for all PDUs (for table preview)
  const [outletsMap, setOutletsMap] = useState<Map<string, PduOutlet[]>>(new Map());

  // Update outlets map when PDUs change
  useEffect(() => {
    // For efficiency, we only fetch outlets for the selected PDU
    // The table uses a simpler preview based on total_outlets count
    if (selectedPdu && selectedPduOutlets) {
      setOutletsMap(prev => {
        const newMap = new Map(prev);
        newMap.set(selectedPdu.id, selectedPduOutlets);
        return newMap;
      });
    }
  }, [selectedPdu, selectedPduOutlets]);

  // Compute stats
  const stats = useMemo(() => {
    const online = pdus.filter(p => p.connection_status === 'online').length;
    const offline = pdus.filter(p => p.connection_status === 'offline').length;
    const error = pdus.filter(p => p.connection_status === 'error').length;
    const unknown = pdus.filter(p => !p.connection_status || p.connection_status === 'unknown').length;
    const totalOutlets = pdus.reduce((sum, p) => sum + (p.total_outlets || 0), 0);
    
    return { online, offline, error, unknown, totalOutlets };
  }, [pdus]);

  // Default to Cloud mode for badge display
  const useJobExecutor = false;

  const handleAdd = async (data: PduFormData) => {
    const result = await addPdu.mutateAsync(data);
    
    // Auto-discover to get outlet count
    if (result?.id) {
      toast.info('Discovering PDU outlets...');
      try {
        const discovery = await discoverPdu(result.id);
        if (typeof discovery === 'object' && 'discovered' in discovery) {
          const discoverResult = discovery as PduDiscoverResponse;
          if (discoverResult.success && discoverResult.discovered?.total_outlets) {
            toast.success(`Discovered ${discoverResult.discovered.total_outlets} outlets`);
          } else if (discoverResult.error) {
            toast.warning(`Discovery: ${discoverResult.error}`);
          }
        } else {
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
    if (selectedPdu?.id === deletingPdu.id) {
      setSelectedPdu(null);
    }
  };

  const handleTest = async (pdu: Pdu) => {
    setTestingPdu(pdu.id);
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
    } finally {
      setTestingPdu(null);
    }
  };

  const handleSync = async (pdu: Pdu) => {
    setSyncingPdu(pdu.id);
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
    } finally {
      setSyncingPdu(null);
    }
  };

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    let successCount = 0;
    let failCount = 0;
    
    for (const pdu of pdus) {
      try {
        const result = await syncPduStatus(pdu.id);
        if (typeof result === 'object' && 'success' in result) {
          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } else {
          successCount++;
        }
      } catch {
        failCount++;
      }
    }
    
    if (successCount > 0) {
      toast.success(`Synced ${successCount} PDU(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to sync ${failCount} PDU(s)`);
    }
    
    setTimeout(() => refetch(), 2000);
    setIsSyncingAll(false);
  };

  const handleDiscoverAll = async () => {
    setIsSyncingAll(true);
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
          successCount++;
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
    setIsSyncingAll(false);
  };

  const handlePduClick = (pdu: Pdu) => {
    setSelectedPdu(pdu);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="border-b bg-card px-4 py-3">
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex-1 flex">
          <div className="flex-1 p-4 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="w-[440px] border-l p-4">
            <Skeleton className="h-full" />
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (pdus.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PduStatsBar
          totalPdus={0}
          onlineCount={0}
          offlineCount={0}
          unknownCount={0}
          errorCount={0}
          totalOutlets={0}
          useJobExecutor={useJobExecutor}
          onAddPdu={() => setShowAddDialog(true)}
          onRefreshAll={refetch}
          onSyncAll={handleSyncAll}
          onDiscoverAll={handleDiscoverAll}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Zap className="h-12 w-12 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No PDUs Configured</h3>
            <p className="text-sm mb-4">
              Add your first PDU to start managing power outlets
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add PDU
            </Button>
          </div>
        </div>

        <AddPduDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onSubmit={handleAdd}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats Bar */}
      <PduStatsBar
        totalPdus={pdus.length}
        onlineCount={stats.online}
        offlineCount={stats.offline}
        unknownCount={stats.unknown}
        errorCount={stats.error}
        totalOutlets={stats.totalOutlets}
        useJobExecutor={useJobExecutor}
        onAddPdu={() => setShowAddDialog(true)}
        onRefreshAll={refetch}
        onSyncAll={handleSyncAll}
        onDiscoverAll={handleDiscoverAll}
        isSyncing={isSyncingAll}
      />

      {/* Main Content: Table + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-hidden min-w-0">
          <PdusTable
            pdus={pdus}
            outlets={outletsMap}
            selectedPduId={selectedPdu?.id || null}
            onPduClick={handlePduClick}
            onTest={handleTest}
            onSync={handleSync}
            onEdit={setEditingPdu}
            onDelete={setDeletingPdu}
            onViewOutlets={setViewingOutletsPdu}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />
        </div>

        {/* Sidebar */}
        <PduDetailsSidebar
          selectedPdu={selectedPdu}
          outlets={selectedPduOutlets || []}
          onClose={() => setSelectedPdu(null)}
          onEdit={() => selectedPdu && setEditingPdu(selectedPdu)}
          onDelete={() => selectedPdu && setDeletingPdu(selectedPdu)}
          onTest={() => selectedPdu && handleTest(selectedPdu)}
          onSync={() => selectedPdu && handleSync(selectedPdu)}
          onViewOutlets={() => selectedPdu && setViewingOutletsPdu(selectedPdu)}
          onViewDiagnostics={() => setShowDiagnostics(true)}
          isTesting={testingPdu === selectedPdu?.id}
          isSyncing={syncingPdu === selectedPdu?.id}
        />
      </div>

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

      {selectedPdu && (
        <PduDiagnosticsDialog
          pdu={selectedPdu}
          open={showDiagnostics}
          onOpenChange={setShowDiagnostics}
          onRefresh={() => selectedPdu && handleSync(selectedPdu)}
        />
      )}

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
