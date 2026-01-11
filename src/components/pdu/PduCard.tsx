import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PduStatusBadge } from './PduStatusBadge';
import { OutletStateIndicator } from './OutletStateIndicator';
import { PduDiagnosticsDialog } from './PduDiagnosticsDialog';
import { usePduOutlets } from '@/hooks/usePdus';
import {
  MoreVertical,
  RefreshCw,
  Settings,
  Trash2,
  Zap,
  Loader2,
  Network,
  AlertCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Pdu } from '@/types/pdu';

interface PduCardProps {
  pdu: Pdu;
  onEdit: (pdu: Pdu) => void;
  onDelete: (pdu: Pdu) => void;
  onTest: (pdu: Pdu) => void;
  onSync: (pdu: Pdu) => void;
  onViewOutlets: (pdu: Pdu) => void;
}

export function PduCard({
  pdu,
  onEdit,
  onDelete,
  onTest,
  onSync,
  onViewOutlets,
}: PduCardProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const { outlets } = usePduOutlets(pdu.id);
  
  // Check if there are error diagnostics
  const hasErrorDiagnostics = pdu.last_sync_diagnostics?.entries?.some(
    e => e.level === 'ERROR' || e.level === 'WARN'
  );
  const handleTest = async () => {
    setIsTesting(true);
    try {
      await onTest(pdu);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await onSync(pdu);
    } finally {
      setIsSyncing(false);
    }
  };

  // Group outlets into rows of 8
  const outletRows: typeof outlets[] = [];
  for (let i = 0; i < outlets.length; i += 8) {
    outletRows.push(outlets.slice(i, i + 8));
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {pdu.name}
            </CardTitle>
            <CardDescription className="mt-1">
              {pdu.ip_address}
              {pdu.model && ` • ${pdu.model}`}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <PduStatusBadge status={pdu.connection_status} />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(pdu)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Edit Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onViewOutlets(pdu)}>
                  <Network className="mr-2 h-4 w-4" />
                  Manage Outlets
                </DropdownMenuItem>
                {pdu.last_sync_diagnostics && (
                  <DropdownMenuItem onClick={() => setShowDiagnostics(true)}>
                    <AlertCircle className="mr-2 h-4 w-4" />
                    View Diagnostics
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => onDelete(pdu)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error diagnostic warning */}
        {hasErrorDiagnostics && pdu.connection_status === 'error' && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive border-destructive/50 hover:bg-destructive/10"
            onClick={() => setShowDiagnostics(true)}
          >
            <AlertCircle className="mr-2 h-4 w-4" />
            View Sync Diagnostics
          </Button>
        )}
        
        {/* Outlet Grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {pdu.total_outlets} Outlets
            </span>
            {pdu.last_sync && (
              <span className="text-xs text-muted-foreground">
                Synced {formatDistanceToNow(new Date(pdu.last_sync), { addSuffix: true })}
              </span>
            )}
          </div>
          
          {outlets.length > 0 ? (
            <div className="space-y-1">
              {outletRows.map((row, rowIndex) => (
                <div key={rowIndex} className="flex gap-1">
                  {row.map((outlet) => (
                    <OutletStateIndicator
                      key={outlet.id}
                      state={outlet.outlet_state}
                      outletNumber={outlet.outlet_number}
                      outletName={outlet.outlet_name || undefined}
                      size="sm"
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {Array.from({ length: pdu.total_outlets }).map((_, i) => (
                <OutletStateIndicator
                  key={i}
                  state="unknown"
                  outletNumber={i + 1}
                  size="sm"
                />
              ))}
            </div>
          )}
        </div>

        {/* Info row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            {pdu.datacenter && <span>DC: {pdu.datacenter}</span>}
            {pdu.rack_id && <span>Rack: {pdu.rack_id}</span>}
          </div>
          <div>
            Protocol: {pdu.protocol.toUpperCase()}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting}
            className="flex-1"
          >
            {isTesting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Network className="mr-2 h-4 w-4" />
            )}
            Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="flex-1"
          >
            {isSyncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => onViewOutlets(pdu)}
            className="flex-1"
          >
            <Zap className="mr-2 h-4 w-4" />
            Control
          </Button>
        </div>
      </CardContent>
      
      {/* Diagnostics Dialog */}
      <PduDiagnosticsDialog
        pdu={pdu}
        open={showDiagnostics}
        onOpenChange={setShowDiagnostics}
        onRefresh={handleSync}
      />
    </Card>
  );
}
