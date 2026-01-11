import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link2, Unlink, Server, Loader2, Search } from 'lucide-react';
import type { OutletAssignment } from '@/hooks/usePduOutletAssignments';

interface OutletServerAssignmentPopoverProps {
  pduId: string;
  outletNumber: number;
  currentAssignment?: OutletAssignment;
  onAssign: (data: {
    pdu_id: string;
    outlet_number: number;
    server_id: string;
    feed_label: 'A' | 'B';
    notes?: string;
  }) => void;
  onUnassign: (mappingId: string) => void;
  isAssigning?: boolean;
}

export function OutletServerAssignmentPopover({
  pduId,
  outletNumber,
  currentAssignment,
  onAssign,
  onUnassign,
  isAssigning,
}: OutletServerAssignmentPopoverProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [feedLabel, setFeedLabel] = useState<'A' | 'B'>('A');

  const { data: servers = [], isLoading: loadingServers } = useQuery({
    queryKey: ['servers-for-pdu-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servers')
        .select('id, hostname, ip_address, service_tag')
        .order('hostname');
      
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const filteredServers = servers.filter((server) => {
    const search = searchTerm.toLowerCase();
    return (
      server.hostname?.toLowerCase().includes(search) ||
      server.ip_address?.toLowerCase().includes(search) ||
      server.service_tag?.toLowerCase().includes(search)
    );
  });

  const handleAssign = () => {
    if (!selectedServerId) return;
    
    onAssign({
      pdu_id: pduId,
      outlet_number: outletNumber,
      server_id: selectedServerId,
      feed_label: feedLabel,
    });
    
    setOpen(false);
    setSelectedServerId(null);
    setSearchTerm('');
  };

  const handleUnassign = () => {
    if (!currentAssignment) return;
    onUnassign(currentAssignment.mapping_id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={(e) => e.stopPropagation()}
        >
          {currentAssignment ? (
            <Link2 className="h-4 w-4 text-primary" />
          ) : (
            <Link2 className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80" 
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">
              Outlet {outletNumber} - Server Assignment
            </h4>
            
            {currentAssignment ? (
              <div className="p-3 rounded-md bg-muted/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">
                      {currentAssignment.server_hostname}
                    </span>
                  </div>
                  <Badge variant="outline">Feed {currentAssignment.feed_label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {currentAssignment.server_ip}
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleUnassign}
                  disabled={isAssigning}
                >
                  <Unlink className="mr-2 h-4 w-4" />
                  Unassign Server
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search servers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                  />
                </div>

                <ScrollArea className="h-[150px] border rounded-md">
                  {loadingServers ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredServers.length > 0 ? (
                    <div className="p-1">
                      {filteredServers.map((server) => (
                        <div
                          key={server.id}
                          onClick={() => setSelectedServerId(server.id)}
                          className={`
                            flex items-center gap-2 p-2 rounded cursor-pointer
                            transition-colors hover:bg-accent
                            ${selectedServerId === server.id ? 'bg-accent' : ''}
                          `}
                        >
                          <Server className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {server.hostname || 'Unknown'}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {server.ip_address}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      No servers found
                    </div>
                  )}
                </ScrollArea>

                <div className="space-y-2">
                  <Label className="text-xs">Power Feed</Label>
                  <Select value={feedLabel} onValueChange={(v) => setFeedLabel(v as 'A' | 'B')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Feed A (Primary)</SelectItem>
                      <SelectItem value="B">Feed B (Secondary)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  onClick={handleAssign}
                  disabled={!selectedServerId || isAssigning}
                >
                  {isAssigning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Assign Server
                </Button>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
