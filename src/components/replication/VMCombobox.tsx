/**
 * VMCombobox - Searchable VM picker for handling 1600+ VMs efficiently
 * 
 * Features:
 * - Fuzzy search input using cmdk Command
 * - Cluster filter dropdown
 * - Power state filter (All / On / Off / Template)
 * - Result count display
 * - Compact VM cards with power icon, name, IP, cluster badge
 * - Limits rendered results to first 100 for performance
 */

import { useState, useMemo } from 'react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, Server, Power, PowerOff, FileBox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VCenterVM } from '@/hooks/useVCenterVMs';

interface VMComboboxProps {
  vms: VCenterVM[];
  clusters: string[];
  selectedVmId: string | null;
  onSelectVm: (vm: VCenterVM) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
}

const MAX_DISPLAYED_RESULTS = 100;

export function VMCombobox({
  vms,
  clusters,
  selectedVmId,
  onSelectVm,
  disabled = false,
  isLoading = false,
  placeholder = "Select VM or Template",
}: VMComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [powerFilter, setPowerFilter] = useState<string>('all');

  // Filter VMs based on search and filters
  const filteredVMs = useMemo(() => {
    return vms.filter(vm => {
      // Search by name or IP
      const searchLower = search.toLowerCase();
      const matchesSearch = 
        vm.name.toLowerCase().includes(searchLower) ||
        (vm.ip_address && vm.ip_address.includes(search));
      
      // Cluster filter
      const matchesCluster = clusterFilter === 'all' || vm.cluster_name === clusterFilter;
      
      // Power state filter
      let matchesPower = true;
      if (powerFilter === 'on') {
        matchesPower = vm.power_state === 'poweredOn';
      } else if (powerFilter === 'off') {
        matchesPower = vm.power_state === 'poweredOff';
      } else if (powerFilter === 'template') {
        matchesPower = vm.is_template === true;
      }
      
      return matchesSearch && matchesCluster && matchesPower;
    });
  }, [vms, search, clusterFilter, powerFilter]);

  // Limit displayed results for performance
  const displayedVMs = filteredVMs.slice(0, MAX_DISPLAYED_RESULTS);
  const hasMore = filteredVMs.length > MAX_DISPLAYED_RESULTS;

  // Get selected VM details
  const selectedVM = vms.find(vm => vm.id === selectedVmId);

  // Get power state icon
  const getPowerIcon = (vm: VCenterVM) => {
    if (vm.is_template) {
      return <FileBox className="h-4 w-4 text-purple-500" />;
    }
    if (vm.power_state === 'poweredOn') {
      return <Power className="h-4 w-4 text-green-500" />;
    }
    return <PowerOff className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-2">
      {/* Filter row */}
      <div className="flex gap-2">
        <Select value={clusterFilter} onValueChange={setClusterFilter} disabled={disabled}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Clusters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clusters</SelectItem>
            {clusters.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={powerFilter} onValueChange={setPowerFilter} disabled={disabled}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All States" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="on">
              <div className="flex items-center gap-2">
                <Power className="h-3 w-3 text-green-500" />
                Powered On
              </div>
            </SelectItem>
            <SelectItem value="off">
              <div className="flex items-center gap-2">
                <PowerOff className="h-3 w-3 text-muted-foreground" />
                Powered Off
              </div>
            </SelectItem>
            <SelectItem value="template">
              <div className="flex items-center gap-2">
                <FileBox className="h-3 w-3 text-purple-500" />
                Template
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Result count */}
        <div className="flex items-center text-sm text-muted-foreground ml-auto">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span>
              {filteredVMs.length === vms.length
                ? `${vms.length} VMs`
                : `${filteredVMs.length} of ${vms.length}`}
            </span>
          )}
        </div>
      </div>

      {/* VM Selector Popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled || isLoading}
          >
            {selectedVM ? (
              <div className="flex items-center gap-2 truncate">
                {getPowerIcon(selectedVM)}
                <span className="truncate">{selectedVM.name}</span>
                {selectedVM.ip_address && (
                  <span className="text-muted-foreground text-xs">
                    ({selectedVM.ip_address})
                  </span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">
                {isLoading ? "Loading VMs..." : placeholder}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[500px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search VMs by name or IP..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>
                {search ? `No VMs matching "${search}"` : "No VMs available"}
              </CommandEmpty>
              <CommandGroup>
                {displayedVMs.map((vm) => (
                  <CommandItem
                    key={vm.id}
                    value={vm.id}
                    onSelect={() => {
                      onSelectVm(vm);
                      setOpen(false);
                    }}
                    className="flex items-center gap-3 py-2"
                  >
                    {/* Check icon */}
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        selectedVmId === vm.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    
                    {/* Power state icon */}
                    {getPowerIcon(vm)}
                    
                    {/* VM info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{vm.name}</span>
                        {vm.is_template && (
                          <Badge variant="secondary" className="text-xs">Template</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {vm.ip_address && <span>{vm.ip_address}</span>}
                        {vm.guest_os && (
                          <>
                            {vm.ip_address && <span>•</span>}
                            <span className="truncate">{vm.guest_os}</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Cluster badge */}
                    {vm.cluster_name && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        {vm.cluster_name}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
                
                {/* Show more indicator */}
                {hasMore && (
                  <div className="py-2 px-3 text-xs text-center text-muted-foreground border-t">
                    Showing {MAX_DISPLAYED_RESULTS} of {filteredVMs.length} results.
                    Use search to narrow down.
                  </div>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
