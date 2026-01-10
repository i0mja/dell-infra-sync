import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { Loader2, Power, PowerOff, RotateCcw, RefreshCw, Settings, Zap, AlertTriangle } from 'lucide-react';
import { useServerPduMappings } from '@/hooks/useServerPduMappings';
import { controlPduOutlet, controlServerPduPower, syncPduStatus } from '@/services/pduService';
import { OutletStateIndicator } from './OutletStateIndicator';
import { toast } from 'sonner';
import type { ServerPduMapping, OutletAction } from '@/types/pdu';

interface ServerPduPowerSectionProps {
  serverId: string;
  serverName: string;
  onManageMappings?: () => void;
  compact?: boolean;
}

interface ConfirmationState {
  open: boolean;
  action: OutletAction;
  feedLabel?: 'A' | 'B';
  mapping?: ServerPduMapping;
  isAllFeeds?: boolean;
}

export function ServerPduPowerSection({
  serverId,
  serverName,
  onManageMappings,
  compact = false,
}: ServerPduPowerSectionProps) {
  const { mappings, isLoading, refetch } = useServerPduMappings(serverId);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>({
    open: false,
    action: 'off',
  });

  const handleOutletAction = async (mapping: ServerPduMapping, action: OutletAction) => {
    // Power off and reboot require confirmation
    if (action === 'off' || action === 'reboot') {
      setConfirmation({
        open: true,
        action,
        feedLabel: mapping.feed_label,
        mapping,
      });
      return;
    }

    await executeAction(mapping, action);
  };

  const handleAllFeedsAction = async (action: OutletAction) => {
    if (action === 'off' || action === 'reboot') {
      setConfirmation({
        open: true,
        action,
        isAllFeeds: true,
      });
      return;
    }

    await executeAllFeedsAction(action);
  };

  const executeAction = async (mapping: ServerPduMapping, action: OutletAction) => {
    const actionKey = `${mapping.id}-${action}`;
    setPendingAction(actionKey);

    try {
      await controlPduOutlet(mapping.pdu_id, [mapping.outlet_number], action);
      toast.success(`PDU ${action} command sent for Feed ${mapping.feed_label}`);
      // Refetch mappings to update outlet status
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      toast.error(`Failed to ${action} outlet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setPendingAction(null);
    }
  };

  const executeAllFeedsAction = async (action: OutletAction) => {
    setPendingAction(`all-${action}`);

    try {
      await controlServerPduPower(serverId, action);
      toast.success(`PDU ${action} command sent for all feeds`);
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      toast.error(`Failed to ${action} all feeds: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirm = async () => {
    if (confirmation.isAllFeeds) {
      await executeAllFeedsAction(confirmation.action);
    } else if (confirmation.mapping) {
      await executeAction(confirmation.mapping, confirmation.action);
    }
    setConfirmation({ open: false, action: 'off' });
  };

  const handleSyncStatus = async () => {
    setPendingAction('sync');
    
    try {
      // Sync status for all mapped PDUs
      const pduIds = [...new Set(mappings.map(m => m.pdu_id))];
      await Promise.all(pduIds.map(pduId => syncPduStatus(pduId)));
      toast.success('PDU status sync initiated');
      setTimeout(() => refetch(), 3000);
    } catch (error) {
      toast.error('Failed to sync PDU status');
    } finally {
      setPendingAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (mappings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <Zap className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">No PDU mappings configured</p>
        {onManageMappings && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onManageMappings}>
            <Settings className="mr-2 h-4 w-4" />
            Configure Mappings
          </Button>
        )}
      </div>
    );
  }

  const feedA = mappings.find(m => m.feed_label === 'A');
  const feedB = mappings.find(m => m.feed_label === 'B');

  const getActionLabel = (action: OutletAction): string => {
    switch (action) {
      case 'on': return 'Power On';
      case 'off': return 'Power Off';
      case 'reboot': return 'Reboot';
      default: return action;
    }
  };

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
        <div className="text-yellow-400">
          <p className="font-medium">PDU Power Control</p>
          <p className="text-xs opacity-80">
            Use only when iDRAC is unresponsive. This cuts power immediately without graceful shutdown.
          </p>
        </div>
      </div>

      {/* Feed mappings */}
      <div className="space-y-3">
        {[feedA, feedB].filter(Boolean).map((mapping) => (
          <div
            key={mapping!.id}
            className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
          >
            <div className="flex items-center gap-3">
              <Badge variant={mapping!.feed_label === 'A' ? 'default' : 'secondary'} className="min-w-[60px] justify-center">
                Feed {mapping!.feed_label}
              </Badge>
              <div className="text-sm">
                <span className="font-medium">{mapping!.pdu?.name}</span>
                <span className="text-muted-foreground"> • Outlet {mapping!.outlet_number}</span>
              </div>
              {mapping!.outlet && (
                <OutletStateIndicator
                  state={mapping!.outlet.outlet_state}
                  outletNumber={mapping!.outlet_number}
                  outletName={mapping!.outlet.outlet_name}
                  size="sm"
                />
              )}
            </div>
            
            {!compact && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-green-400 hover:bg-green-500/10 hover:text-green-400"
                  onClick={() => handleOutletAction(mapping!, 'on')}
                  disabled={pendingAction !== null}
                >
                  {pendingAction === `${mapping!.id}-on` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleOutletAction(mapping!, 'off')}
                  disabled={pendingAction !== null}
                >
                  {pendingAction === `${mapping!.id}-off` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PowerOff className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-yellow-400 hover:bg-yellow-500/10 hover:text-yellow-400"
                  onClick={() => handleOutletAction(mapping!, 'reboot')}
                  disabled={pendingAction !== null}
                >
                  {pendingAction === `${mapping!.id}-reboot` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* All feeds actions */}
      {mappings.length > 1 && !compact && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">All Feeds</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-green-400 border-green-500/30 hover:bg-green-500/10"
                onClick={() => handleAllFeedsAction('on')}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'all-on' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Power className="mr-2 h-4 w-4" />
                )}
                Power On
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => handleAllFeedsAction('off')}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'all-off' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PowerOff className="mr-2 h-4 w-4" />
                )}
                Power Off
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                onClick={() => handleAllFeedsAction('reboot')}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'all-reboot' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Reboot
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSyncStatus}
          disabled={pendingAction !== null}
        >
          {pendingAction === 'sync' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh Status
        </Button>
        {onManageMappings && (
          <Button variant="ghost" size="sm" onClick={onManageMappings}>
            <Settings className="mr-2 h-4 w-4" />
            Manage Mappings
          </Button>
        )}
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmation.open} onOpenChange={(open) => !open && setConfirmation({ open: false, action: 'off' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm PDU {getActionLabel(confirmation.action)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation.isAllFeeds ? (
                <>
                  This will immediately {confirmation.action === 'off' ? 'cut power to' : 'reboot'} <strong>{serverName}</strong> via all PDU feeds.
                </>
              ) : (
                <>
                  This will immediately {confirmation.action === 'off' ? 'cut power to' : 'reboot'} <strong>{serverName}</strong> via {confirmation.mapping?.pdu?.name} Outlet {confirmation.mapping?.outlet_number} (Feed {confirmation.feedLabel}).
                </>
              )}
              <br /><br />
              <span className="text-destructive">This may cause data loss or corruption if the operating system is running.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmation.action === 'off' ? 'Power Off' : 'Reboot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
