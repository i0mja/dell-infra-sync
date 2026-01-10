import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, Trash2, Plug, AlertCircle } from 'lucide-react';
import { usePdus } from '@/hooks/usePdus';
import { useServerPduMappings } from '@/hooks/useServerPduMappings';
import { OutletStateIndicator } from './OutletStateIndicator';
import type { Server } from '@/hooks/useServers';

interface ServerPduMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server;
}

export function ServerPduMappingDialog({
  open,
  onOpenChange,
  server,
}: ServerPduMappingDialogProps) {
  const { pdus, isLoading: pdusLoading } = usePdus();
  const { mappings, isLoading: mappingsLoading, addMapping, removeMapping } = useServerPduMappings(server.id);
  
  const [selectedPduId, setSelectedPduId] = useState<string>('');
  const [outletNumber, setOutletNumber] = useState<number>(1);
  const [feedLabel, setFeedLabel] = useState<'A' | 'B'>('A');
  const [notes, setNotes] = useState<string>('');

  const isLoading = pdusLoading || mappingsLoading;

  const selectedPdu = pdus.find(p => p.id === selectedPduId);
  const maxOutlets = selectedPdu?.total_outlets || 24;

  // Check if feed label is already used
  const feedUsed = mappings.some(m => m.feed_label === feedLabel);

  const handleAddMapping = async () => {
    if (!selectedPduId || !outletNumber) return;

    await addMapping.mutateAsync({
      server_id: server.id,
      pdu_id: selectedPduId,
      outlet_number: outletNumber,
      feed_label: feedLabel,
      notes: notes || undefined,
    });

    // Reset form
    setSelectedPduId('');
    setOutletNumber(1);
    setNotes('');
    // Auto-select next feed
    if (feedLabel === 'A') {
      setFeedLabel('B');
    }
  };

  const handleRemoveMapping = async (mappingId: string) => {
    await removeMapping.mutateAsync(mappingId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            PDU Mappings
          </DialogTitle>
          <DialogDescription>
            Map {server.hostname || server.ip_address} to PDU outlets for power control
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current Mappings */}
            <div>
              <Label className="text-sm font-medium">Current Mappings</Label>
              {mappings.length === 0 ? (
                <div className="mt-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No PDU mappings configured
                </div>
              ) : (
                <ScrollArea className="mt-2 max-h-[200px]">
                  <div className="space-y-2">
                    {mappings.map((mapping) => (
                      <div
                        key={mapping.id}
                        className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant={mapping.feed_label === 'A' ? 'default' : 'secondary'}>
                            Feed {mapping.feed_label}
                          </Badge>
                          <div className="text-sm">
                            <span className="font-medium">{mapping.pdu?.name}</span>
                            <span className="text-muted-foreground"> • Outlet {mapping.outlet_number}</span>
                          </div>
                          {mapping.outlet && (
                            <OutletStateIndicator
                              state={mapping.outlet.outlet_state}
                              outletNumber={mapping.outlet_number}
                              outletName={mapping.outlet.outlet_name}
                              size="sm"
                            />
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleRemoveMapping(mapping.id)}
                          disabled={removeMapping.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <Separator />

            {/* Add New Mapping */}
            <div>
              <Label className="text-sm font-medium">Add Mapping</Label>
              
              {pdus.length === 0 ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>No PDUs configured. Add a PDU first in the PDU Management page.</span>
                </div>
              ) : (
                <div className="mt-2 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">PDU</Label>
                      <Select value={selectedPduId} onValueChange={setSelectedPduId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select PDU" />
                        </SelectTrigger>
                        <SelectContent>
                          {pdus.map((pdu) => (
                            <SelectItem key={pdu.id} value={pdu.id}>
                              <div className="flex items-center gap-2">
                                <span>{pdu.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {pdu.connection_status}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Outlet Number</Label>
                      <Input
                        type="number"
                        min={1}
                        max={maxOutlets}
                        value={outletNumber}
                        onChange={(e) => setOutletNumber(parseInt(e.target.value) || 1)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Feed Label</Label>
                      <Select value={feedLabel} onValueChange={(v) => setFeedLabel(v as 'A' | 'B')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">
                            Feed A {mappings.some(m => m.feed_label === 'A') && '(in use)'}
                          </SelectItem>
                          <SelectItem value="B">
                            Feed B {mappings.some(m => m.feed_label === 'B') && '(in use)'}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                      <Input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. PSU1"
                      />
                    </div>
                  </div>

                  {feedUsed && (
                    <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-400">
                      <AlertCircle className="h-3 w-3" />
                      <span>Feed {feedLabel} already has a mapping. Adding will replace it.</span>
                    </div>
                  )}

                  <Button
                    onClick={handleAddMapping}
                    disabled={!selectedPduId || addMapping.isPending}
                    className="w-full"
                  >
                    {addMapping.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add Mapping
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
