import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
  HardDrive,
  AlertTriangle,
  Power,
  PowerOff,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { ProtectedVM } from "@/hooks/useReplication";

interface VCenterVM {
  id: string;
  name: string;
  vcenter_id: string | null;
  cluster_name: string | null;
  power_state: string | null;
  guest_os: string | null;
  disk_gb: number | null;
  memory_mb: number | null;
  cpu_count: number | null;
  tools_status: string | null;
  ip_address: string | null;
}

interface AddVMSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceVCenterId: string;
  protectionDatastore?: string;
  existingVMIds: string[];
  onAddVM: (vm: Partial<ProtectedVM>) => Promise<ProtectedVM | undefined>;
}

export function AddVMSelector({
  open,
  onOpenChange,
  sourceVCenterId,
  protectionDatastore,
  existingVMIds,
  onAddVM,
}: AddVMSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [powerFilter, setPowerFilter] = useState<string>("all");
  const [selectedVM, setSelectedVM] = useState<VCenterVM | null>(null);
  const [adding, setAdding] = useState(false);

  // Fetch VMs from vcenter_vms for the given vCenter
  const { data: vms = [], isLoading } = useQuery({
    queryKey: ["vcenter-vms-for-protection", sourceVCenterId],
    queryFn: async () => {
      if (!sourceVCenterId) return [];
      
      const { data, error } = await supabase
        .from("vcenter_vms")
        .select("id, name, vcenter_id, cluster_name, power_state, guest_os, disk_gb, memory_mb, cpu_count, tools_status, ip_address")
        .eq("source_vcenter_id", sourceVCenterId)
        .order("name");

      if (error) throw error;
      return data as VCenterVM[];
    },
    enabled: open && !!sourceVCenterId,
  });

  // Get unique clusters for filter
  const clusters = useMemo(() => {
    const clusterSet = new Set(vms.map(vm => vm.cluster_name).filter(Boolean));
    return Array.from(clusterSet).sort();
  }, [vms]);

  // Filter VMs
  const filteredVMs = useMemo(() => {
    return vms.filter(vm => {
      // Exclude already protected VMs
      if (existingVMIds.includes(vm.id)) return false;

      // Search filter
      if (searchTerm && !vm.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
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
  }, [vms, searchTerm, clusterFilter, powerFilter, existingVMIds]);

  const handleAdd = async () => {
    if (!selectedVM) return;

    setAdding(true);
    try {
      await onAddVM({
        vm_id: selectedVM.id,
        vm_name: selectedVM.name,
        vm_vcenter_id: selectedVM.vcenter_id || undefined,
        current_datastore: undefined, // Will need to be populated from VM details if available
        needs_storage_vmotion: true, // Default to true since we don't know the datastore
      });
      onOpenChange(false);
      setSelectedVM(null);
      setSearchTerm("");
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedVM(null);
    setSearchTerm("");
    setClusterFilter("all");
    setPowerFilter("all");
  };

  const getPowerIcon = (state: string | null) => {
    if (state?.toLowerCase() === "poweredon") {
      return <Power className="h-3 w-3 text-green-500" />;
    }
    return <PowerOff className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add VM to Protection</DialogTitle>
          <DialogDescription>
            Select a VM from your synced vCenter inventory
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search VMs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={clusterFilter} onValueChange={setClusterFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Clusters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clusters</SelectItem>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster} value={cluster!}>
                    {cluster}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={powerFilter} onValueChange={setPowerFilter}>
              <SelectTrigger className="w-[140px]">
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

          {/* VM List */}
          <ScrollArea className="h-[300px] border rounded-lg">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredVMs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
                <Server className="h-12 w-12 mb-2 opacity-50" />
                <p>{vms.length === 0 ? "No VMs found in vCenter" : "No matching VMs"}</p>
                {existingVMIds.length > 0 && vms.length > 0 && (
                  <p className="text-sm">{existingVMIds.length} VMs already protected</p>
                )}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredVMs.map((vm) => (
                  <div
                    key={vm.id}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedVM?.id === vm.id
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted/50 border border-transparent"
                    }`}
                    onClick={() => setSelectedVM(vm)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          selectedVM?.id === vm.id ? "border-primary" : "border-muted-foreground/30"
                        }`}>
                          {selectedVM?.id === vm.id && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{vm.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getPowerIcon(vm.power_state)}
                        <Badge variant="outline" className="text-xs">
                          {vm.cluster_name || "No Cluster"}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-1 ml-10 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{vm.guest_os || "Unknown OS"}</span>
                      {vm.cpu_count && <span>{vm.cpu_count} vCPU</span>}
                      {vm.memory_mb && <span>{Math.round(vm.memory_mb / 1024)} GB RAM</span>}
                      {vm.disk_gb && <span>{vm.disk_gb} GB disk</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Selection Summary */}
          {selectedVM && (
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-medium">Selected: {selectedVM.name}</span>
              </div>
              {protectionDatastore && (
                <div className="flex items-center gap-2 mt-2 text-sm text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Storage vMotion may be required to move to {protectionDatastore}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={adding || !selectedVM}>
            {adding ? "Adding..." : "Add VM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
