/**
 * Multi-select VM list with search and filters
 * Used for selecting multiple VMs for protection groups
 */

import React, { useState, useMemo } from 'react';
import { Search, Power, PowerOff, FileBox, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface VCenterVM {
  id: string;
  name: string;
  power_state?: string;
  guest_os?: string;
  cpu_count?: number;
  memory_mb?: number;
  disk_gb?: number;
  ip_address?: string;
  cluster_name?: string;
  is_template?: boolean;
}

interface VMMultiSelectListProps {
  vms: VCenterVM[];
  clusters: string[];
  selectedVmIds: string[];
  onSelectionChange: (vmIds: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  maxHeight?: string;
}

const MAX_DISPLAYED = 100;

export function VMMultiSelectList({
  vms,
  clusters,
  selectedVmIds,
  onSelectionChange,
  disabled = false,
  isLoading = false,
  maxHeight = 'h-64',
}: VMMultiSelectListProps) {
  const [search, setSearch] = useState('');
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [powerFilter, setPowerFilter] = useState<string>('all');

  // Filter VMs based on search and filters
  const filteredVMs = useMemo(() => {
    return vms.filter((vm) => {
      // Search filter
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        vm.name.toLowerCase().includes(searchLower) ||
        (vm.ip_address && vm.ip_address.toLowerCase().includes(searchLower));

      // Cluster filter
      const matchesCluster =
        clusterFilter === 'all' || vm.cluster_name === clusterFilter;

      // Power state filter
      let matchesPower = true;
      if (powerFilter === 'on') {
        matchesPower = vm.power_state === 'poweredOn';
      } else if (powerFilter === 'off') {
        matchesPower = vm.power_state !== 'poweredOn' && !vm.is_template;
      } else if (powerFilter === 'template') {
        matchesPower = vm.is_template === true;
      }

      return matchesSearch && matchesCluster && matchesPower;
    });
  }, [vms, search, clusterFilter, powerFilter]);

  const displayedVMs = filteredVMs.slice(0, MAX_DISPLAYED);
  const hasMore = filteredVMs.length > MAX_DISPLAYED;

  // Check if all filtered VMs are selected
  const allFilteredSelected =
    filteredVMs.length > 0 &&
    filteredVMs.every((vm) => selectedVmIds.includes(vm.id));

  const handleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      // Deselect all filtered VMs
      const filteredIds = new Set(filteredVMs.map((vm) => vm.id));
      onSelectionChange(selectedVmIds.filter((id) => !filteredIds.has(id)));
    } else {
      // Select all filtered VMs (add to existing selection)
      const newIds = new Set([
        ...selectedVmIds,
        ...filteredVMs.map((vm) => vm.id),
      ]);
      onSelectionChange(Array.from(newIds));
    }
  };

  const handleToggleVM = (vmId: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedVmIds, vmId]);
    } else {
      onSelectionChange(selectedVmIds.filter((id) => id !== vmId));
    }
  };

  const getPowerIcon = (vm: VCenterVM) => {
    if (vm.is_template) {
      return <FileBox className="h-3 w-3 text-purple-500" />;
    }
    if (vm.power_state === 'poweredOn') {
      return <Power className="h-3 w-3 text-green-500" />;
    }
    return <PowerOff className="h-3 w-3 text-muted-foreground" />;
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-4 rounded-lg border bg-card">
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-muted rounded" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 rounded-lg border bg-card">
      {/* Search and Filters Row */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search VMs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
            disabled={disabled}
          />
        </div>
        
        <Select value={clusterFilter} onValueChange={setClusterFilter} disabled={disabled}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Cluster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clusters</SelectItem>
            {clusters.map((cluster) => (
              <SelectItem key={cluster} value={cluster}>
                {cluster}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={powerFilter} onValueChange={setPowerFilter} disabled={disabled}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="on">Powered On</SelectItem>
            <SelectItem value="off">Powered Off</SelectItem>
            <SelectItem value="template">Templates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Selection Header */}
      <div className="flex items-center justify-between text-xs">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={handleSelectAllFiltered}
          disabled={disabled || filteredVMs.length === 0}
        >
          <Checkbox
            checked={allFilteredSelected && filteredVMs.length > 0}
            className="mr-1.5 h-3 w-3"
            disabled
          />
          {allFilteredSelected ? 'Deselect' : 'Select'} all ({filteredVMs.length})
        </Button>
        <Badge variant="secondary" className="text-xs">
          {selectedVmIds.length} selected of {vms.length} VMs
        </Badge>
      </div>

      {/* VM List */}
      <ScrollArea className={`${maxHeight} rounded border`}>
        <div className="p-2 space-y-1">
          {displayedVMs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {search || clusterFilter !== 'all' || powerFilter !== 'all'
                ? 'No VMs match your filters'
                : 'No VMs available'}
            </p>
          ) : (
            displayedVMs.map((vm) => (
              <div
                key={vm.id}
                className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  id={`vm-multi-${vm.id}`}
                  checked={selectedVmIds.includes(vm.id)}
                  onCheckedChange={(checked) =>
                    handleToggleVM(vm.id, checked === true)
                  }
                  disabled={disabled}
                />
                <Label
                  htmlFor={`vm-multi-${vm.id}`}
                  className="flex-1 flex items-center gap-2 text-xs cursor-pointer"
                >
                  {getPowerIcon(vm)}
                  <span className="font-medium truncate max-w-[160px]">
                    {vm.name}
                  </span>
                  {vm.ip_address && (
                    <span className="text-muted-foreground hidden sm:inline">
                      {vm.ip_address}
                    </span>
                  )}
                  {vm.cluster_name && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 hidden md:inline-flex">
                      {vm.cluster_name}
                    </Badge>
                  )}
                </Label>
              </div>
            ))
          )}
          
          {hasMore && (
            <p className="text-xs text-muted-foreground text-center pt-2 border-t mt-2">
              Showing {MAX_DISPLAYED} of {filteredVMs.length} filtered. Use search to narrow results.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
