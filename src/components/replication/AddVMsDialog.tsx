import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Server,
  Monitor,
  Power,
  PowerOff,
  X,
  ArrowUpDown,
  FileStack,
  CheckSquare,
  MoveRight,
} from "lucide-react";
import { ProtectedVM } from "@/hooks/useReplication";
import { useVCenterVMs, VCenterVM } from "@/hooks/useVCenterVMs";
import { cn } from "@/lib/utils";

type SortField = "name" | "power_state" | "cluster_name";
type SortDirection = "asc" | "desc";

interface AddVMsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceVCenterId: string;
  protectionDatastore?: string;
  existingVMIds: string[];
  onAddVMs: (vms: Partial<ProtectedVM>[], autoMigrate?: boolean) => Promise<unknown>;
}

export function AddVMsDialog({
  open,
  onOpenChange,
  sourceVCenterId,
  protectionDatastore,
  existingVMIds,
  onAddVMs,
}: AddVMsDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [powerFilter, setPowerFilter] = useState<string>("all");
  const [hideTemplates, setHideTemplates] = useState(true);
  const [selectedVMIds, setSelectedVMIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [autoMigrate, setAutoMigrate] = useState(false);

  // Use paginated hook for all VMs
  const { data: vms = [], isLoading, clusters } = useVCenterVMs(open ? sourceVCenterId : undefined);

  // Filter VMs
  const filteredVMs = useMemo(() => {
    let result = vms.filter(vm => {
      // Exclude already protected VMs
      if (existingVMIds.includes(vm.id)) return false;

      // Hide templates if enabled
      if (hideTemplates && vm.is_template) return false;

      // Search filter - extended to IP and OS
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const nameMatch = vm.name.toLowerCase().includes(search);
        const ipMatch = vm.ip_address?.toLowerCase().includes(search);
        const osMatch = vm.guest_os?.toLowerCase().includes(search);
        if (!nameMatch && !ipMatch && !osMatch) return false;
      }

      // Cluster filter
      if (clusterFilter !== "all" && vm.cluster_name !== clusterFilter) {
        return false;
      }

      // Power state filter
      if (powerFilter !== "all" && vm.power_state?.toLowerCase() !== powerFilter.toLowerCase()) {
        return false;
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let aVal: string | undefined;
      let bVal: string | undefined;
      
      switch (sortField) {
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case "power_state":
          aVal = a.power_state?.toLowerCase() || "";
          bVal = b.power_state?.toLowerCase() || "";
          break;
        case "cluster_name":
          aVal = a.cluster_name?.toLowerCase() || "";
          bVal = b.cluster_name?.toLowerCase() || "";
          break;
      }

      if (sortDirection === "asc") {
        return (aVal || "").localeCompare(bVal || "");
      }
      return (bVal || "").localeCompare(aVal || "");
    });

    return result;
  }, [vms, searchTerm, clusterFilter, powerFilter, hideTemplates, existingVMIds, sortField, sortDirection]);

  // Selection stats
  const selectedVMs = useMemo(() => 
    vms.filter(vm => selectedVMIds.has(vm.id)),
    [vms, selectedVMIds]
  );
  
  const poweredOnSelected = selectedVMs.filter(vm => vm.power_state?.toLowerCase() === "poweredon").length;
  const poweredOffSelected = selectedVMs.length - poweredOnSelected;

  const handleSelectAll = () => {
    const filteredIds = new Set(filteredVMs.map(vm => vm.id));
    const allSelected = filteredVMs.every(vm => selectedVMIds.has(vm.id));
    
    if (allSelected) {
      // Deselect all filtered
      setSelectedVMIds(prev => {
        const next = new Set(prev);
        filteredIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all filtered
      setSelectedVMIds(prev => new Set([...prev, ...filteredIds]));
    }
  };

  const handleToggleVM = (vmId: string) => {
    setSelectedVMIds(prev => {
      const next = new Set(prev);
      if (next.has(vmId)) {
        next.delete(vmId);
      } else {
        next.add(vmId);
      }
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleAdd = async () => {
    if (selectedVMIds.size === 0) return;

    setAdding(true);
    try {
      const vmsToAdd: Partial<ProtectedVM>[] = selectedVMs.map(vm => ({
        vm_id: vm.id,
        vm_name: vm.name,
        vm_vcenter_id: vm.vcenter_id || undefined,
        current_datastore: vm.primary_datastore || undefined,
        needs_storage_vmotion: true,
      }));

      await onAddVMs(vmsToAdd, autoMigrate);
      handleClose();
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedVMIds(new Set());
    setSearchTerm("");
    setClusterFilter("all");
    setPowerFilter("all");
    setHideTemplates(true);
    setAutoMigrate(false);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setClusterFilter("all");
    setPowerFilter("all");
    setHideTemplates(true);
  };

  const getPowerIcon = (state: string | null) => {
    if (state?.toLowerCase() === "poweredon") {
      return <Power className="h-3 w-3 text-green-500" />;
    }
    return <PowerOff className="h-3 w-3 text-muted-foreground" />;
  };

  const allFilteredSelected = filteredVMs.length > 0 && filteredVMs.every(vm => selectedVMIds.has(vm.id));
  const someFilteredSelected = filteredVMs.some(vm => selectedVMIds.has(vm.id));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add VMs to Protection</DialogTitle>
          <DialogDescription>
            Select VMs from your synced vCenter inventory ({vms.length.toLocaleString()} total, {existingVMIds.length} already protected)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4">
          {/* Search and Filters */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search VMs, IPs, or OS..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={clusterFilter} onValueChange={setClusterFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="All Clusters" />
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
              <Select value={powerFilter} onValueChange={setPowerFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  <SelectItem value="poweredOn">Powered On</SelectItem>
                  <SelectItem value="poweredOff">Powered Off</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Quick filters:</span>
              <Button
                variant={powerFilter === "poweredOn" ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPowerFilter(powerFilter === "poweredOn" ? "all" : "poweredOn")}
              >
                <Power className="h-3 w-3 mr-1 text-green-500" />
                Powered On
              </Button>
              <Button
                variant={powerFilter === "poweredOff" ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPowerFilter(powerFilter === "poweredOff" ? "all" : "poweredOff")}
              >
                <PowerOff className="h-3 w-3 mr-1" />
                Powered Off
              </Button>
              <Button
                variant={hideTemplates ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setHideTemplates(!hideTemplates)}
              >
                <FileStack className="h-3 w-3 mr-1" />
                Hide Templates
              </Button>
              {(searchTerm || clusterFilter !== "all" || powerFilter !== "all" || !hideTemplates) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={clearFilters}
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          {/* Select All Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allFilteredSelected}
                onCheckedChange={handleSelectAll}
                className={cn(someFilteredSelected && !allFilteredSelected && "data-[state=checked]:bg-primary/50")}
              />
              <span className="text-sm font-medium">
                Select All ({filteredVMs.length.toLocaleString()})
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{selectedVMIds.size.toLocaleString()} selected</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => handleSort("name")}
                >
                  <ArrowUpDown className="h-3 w-3 mr-1" />
                  Name
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => handleSort("cluster_name")}
                >
                  <ArrowUpDown className="h-3 w-3 mr-1" />
                  Cluster
                </Button>
              </div>
            </div>
          </div>

          {/* VM List */}
          <ScrollArea className="h-[350px] border rounded-lg">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filteredVMs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
                <Server className="h-12 w-12 mb-2 opacity-50" />
                <p>{vms.length === 0 ? "No VMs found in vCenter" : "No matching VMs"}</p>
                {(searchTerm || clusterFilter !== "all" || powerFilter !== "all") && (
                  <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredVMs.map((vm) => {
                  const isSelected = selectedVMIds.has(vm.id);
                  return (
                    <div
                      key={vm.id}
                      className={cn(
                        "p-3 rounded-lg cursor-pointer transition-colors border",
                        isSelected
                          ? "bg-primary/10 border-primary"
                          : "hover:bg-muted/50 border-transparent"
                      )}
                      onClick={() => handleToggleVM(vm.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleVM(vm.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span className="font-medium">{vm.name}</span>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {vm.ip_address && <span>{vm.ip_address}</span>}
                              {vm.guest_os && <span className="truncate max-w-[200px]">{vm.guest_os}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getPowerIcon(vm.power_state)}
                          <Badge variant="outline" className="text-xs">
                            {vm.cluster_name || "No Cluster"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Selection Summary */}
          {selectedVMIds.size > 0 && (
            <div className="flex flex-col gap-2 px-3 py-2 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-4 text-sm">
                <CheckSquare className="h-4 w-4 text-primary" />
                <span className="font-medium">{selectedVMIds.size} VMs selected</span>
                <span className="text-muted-foreground">
                  • {poweredOnSelected} powered on • {poweredOffSelected} powered off
                </span>
              </div>
              {protectionDatastore && (
                <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                  <Checkbox
                    id="auto-migrate"
                    checked={autoMigrate}
                    onCheckedChange={(checked) => setAutoMigrate(!!checked)}
                  />
                  <label 
                    htmlFor="auto-migrate" 
                    className="text-sm cursor-pointer flex items-center gap-1"
                  >
                    <MoveRight className="h-3 w-3" />
                    Automatically migrate to protection datastore
                    <span className="text-muted-foreground">({protectionDatastore})</span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={adding || selectedVMIds.size === 0}>
            {adding ? "Adding..." : `Add ${selectedVMIds.size} VM${selectedVMIds.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
