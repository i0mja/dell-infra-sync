import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { usePduOutlets } from '@/hooks/usePdus';
import { controlPduOutlet, syncPduStatus } from '@/services/pduService';
import { toast } from 'sonner';
import {
  Power,
  PowerOff,
  RotateCcw,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import type { Pdu, OutletAction } from '@/types/pdu';

interface PduOutletsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdu: Pdu | null;
}

export function PduOutletsDialog({ open, onOpenChange, pdu }: PduOutletsDialogProps) {
  const [selectedOutlets, setSelectedOutlets] = useState<number[]>([]);
  const [isActioning, setIsActioning] = useState(false);
  const [confirmAction, setConfirmAction] = useState<OutletAction | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const { outlets, isLoading, refetch } = usePduOutlets(pdu?.id || null);

  const toggleOutlet = (outletNumber: number) => {
    setSelectedOutlets((prev) =>
      prev.includes(outletNumber)
        ? prev.filter((n) => n !== outletNumber)
        : [...prev, outletNumber]
    );
  };

  const selectAll = () => {
    if (selectedOutlets.length === outlets.length) {
      setSelectedOutlets([]);
    } else {
      setSelectedOutlets(outlets.map((o) => o.outlet_number));
    }
  };

  const handleAction = async (action: OutletAction) => {
    if (!pdu || selectedOutlets.length === 0) return;
    
    setIsActioning(true);
    try {
      await controlPduOutlet(pdu.id, selectedOutlets, action);
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} command sent to ${selectedOutlets.length} outlet(s)`);
      setSelectedOutlets([]);
      // Refetch after a delay to get updated status
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      toast.error(`Failed to ${action} outlets: ${error}`);
    } finally {
      setIsActioning(false);
      setConfirmAction(null);
    }
  };

  const handleSync = async () => {
    if (!pdu) return;
    
    setIsSyncing(true);
    try {
      await syncPduStatus(pdu.id);
      toast.success('Status sync job created');
      setTimeout(() => refetch(), 3000);
    } catch (error) {
      toast.error(`Failed to sync: ${error}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'on':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'off':
        return <XCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return <RefreshCw className="h-4 w-4 text-yellow-400" />;
    }
  };

  const getStateBadge = (state: string) => {
    switch (state) {
      case 'on':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">On</Badge>;
      case 'off':
        return <Badge variant="secondary">Off</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  if (!pdu) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5" />
              {pdu.name} - Outlet Control
            </DialogTitle>
            <DialogDescription>
              {pdu.ip_address} • {pdu.total_outlets} outlets
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Action bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAll}
                >
                  {selectedOutlets.length === outlets.length ? 'Deselect All' : 'Select All'}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedOutlets.length} selected
                </span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sync Status
              </Button>
            </div>

            {/* Outlets grid */}
            <ScrollArea className="h-[300px] rounded-md border p-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : outlets.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {outlets.map((outlet) => (
                    <div
                      key={outlet.id}
                      onClick={() => toggleOutlet(outlet.outlet_number)}
                      className={`
                        flex items-center justify-between p-3 rounded-lg border cursor-pointer
                        transition-colors hover:bg-accent
                        ${selectedOutlets.includes(outlet.outlet_number) 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        {getStateIcon(outlet.outlet_state)}
                        <div>
                          <div className="font-medium text-sm">
                            {outlet.outlet_name || `Outlet ${outlet.outlet_number}`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Outlet {outlet.outlet_number}
                          </div>
                        </div>
                      </div>
                      {getStateBadge(outlet.outlet_state)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Power className="h-8 w-8 mb-2" />
                  <p>No outlet data. Click "Sync Status" to fetch.</p>
                </div>
              )}
            </ScrollArea>

            {/* Control buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="default"
                className="flex-1 bg-green-600 hover:bg-green-700"
                disabled={selectedOutlets.length === 0 || isActioning}
                onClick={() => setConfirmAction('on')}
              >
                <Power className="mr-2 h-4 w-4" />
                Power On
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={selectedOutlets.length === 0 || isActioning}
                onClick={() => setConfirmAction('off')}
              >
                <PowerOff className="mr-2 h-4 w-4" />
                Power Off
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={selectedOutlets.length === 0 || isActioning}
                onClick={() => setConfirmAction('reboot')}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reboot
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmAction} action</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {confirmAction} {selectedOutlets.length} outlet(s)?
              {confirmAction === 'off' && (
                <span className="block mt-2 text-destructive">
                  Warning: This will immediately cut power to connected devices.
                </span>
              )}
              {confirmAction === 'reboot' && (
                <span className="block mt-2 text-yellow-500">
                  This will power cycle the outlet(s). Connected devices will restart.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && handleAction(confirmAction)}
              className={confirmAction === 'off' ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              {isActioning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm {confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
