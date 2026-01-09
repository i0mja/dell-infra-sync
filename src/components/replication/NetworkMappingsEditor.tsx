import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Trash2, ArrowRight, AlertTriangle, Network, Info } from "lucide-react";
import { useNetworkMappings, CreateNetworkMapping } from "@/hooks/useNetworkMappings";
import { supabase } from "@/integrations/supabase/client";

interface NetworkMappingsEditorProps {
  protectionGroupId: string;
  sourceVCenterId?: string;
  drVCenterId?: string;
}

interface VCenterNetwork {
  id: string;
  name: string;
  vlan_id: number | null;
  vcenter_id: string;
}

export function NetworkMappingsEditor({
  protectionGroupId,
  sourceVCenterId,
  drVCenterId,
}: NetworkMappingsEditorProps) {
  const { mappings, isLoading, addMapping, updateMapping, removeMapping } = useNetworkMappings(protectionGroupId);
  
  const [newSourceNetwork, setNewSourceNetwork] = useState("");
  const [newTargetNetwork, setNewTargetNetwork] = useState("");
  const [newIsTestNetwork, setNewIsTestNetwork] = useState(false);

  // Fetch networks from source vCenter
  const { data: sourceNetworks = [], isLoading: sourceNetworksLoading } = useQuery({
    queryKey: ["vcenter-networks", sourceVCenterId],
    queryFn: async () => {
      if (!sourceVCenterId) return [];
      const { data, error } = await supabase
        .from("vcenter_networks")
        .select("id, name, vlan_id, vcenter_id")
        .eq("vcenter_id", sourceVCenterId)
        .order("name");
      if (error) throw error;
      return data as VCenterNetwork[];
    },
    enabled: !!sourceVCenterId,
  });

  // Fetch networks from DR vCenter
  const { data: drNetworks = [], isLoading: drNetworksLoading } = useQuery({
    queryKey: ["vcenter-networks", drVCenterId],
    queryFn: async () => {
      if (!drVCenterId) return [];
      const { data, error } = await supabase
        .from("vcenter_networks")
        .select("id, name, vlan_id, vcenter_id")
        .eq("vcenter_id", drVCenterId)
        .order("name");
      if (error) throw error;
      return data as VCenterNetwork[];
    },
    enabled: !!drVCenterId,
  });

  // Get networks used by VMs in this protection group
  const { data: vmNetworks = [] } = useQuery({
    queryKey: ["protection-group-vm-networks", protectionGroupId],
    queryFn: async () => {
      // First get the VMs in this protection group
      const { data: protectedVms, error: vmError } = await supabase
        .from("protected_vms")
        .select("vm_id")
        .eq("protection_group_id", protectionGroupId)
        .not("vm_id", "is", null);

      if (vmError) throw vmError;
      if (!protectedVms?.length) return [];

      const vmIds = protectedVms.map(v => v.vm_id).filter(Boolean) as string[];
      
      // Get networks used by these VMs
      const { data: networkVms, error: netError } = await supabase
        .from("vcenter_network_vms")
        .select(`
          vcenter_networks!inner(id, name, vlan_id)
        `)
        .in("vm_id", vmIds);

      if (netError) throw netError;

      // Deduplicate networks
      const uniqueNetworks = new Map<string, { name: string; vlan_id: number | null }>();
      networkVms?.forEach(row => {
        const network = row.vcenter_networks as any;
        if (network && !uniqueNetworks.has(network.name)) {
          uniqueNetworks.set(network.name, { name: network.name, vlan_id: network.vlan_id });
        }
      });

      return Array.from(uniqueNetworks.values());
    },
    enabled: !!protectionGroupId,
  });

  // Check which VM networks are unmapped
  const unmappedVmNetworks = useMemo(() => {
    const mappedSources = new Set(mappings.map(m => m.source_network));
    return vmNetworks.filter(n => !mappedSources.has(n.name));
  }, [vmNetworks, mappings]);

  // Suggest matching networks by VLAN ID
  const suggestTargetNetwork = (sourceNetworkName: string) => {
    const sourceNetwork = sourceNetworks.find(n => n.name === sourceNetworkName);
    if (!sourceNetwork?.vlan_id) return null;
    
    const match = drNetworks.find(n => n.vlan_id === sourceNetwork.vlan_id);
    return match?.name || null;
  };

  const handleAddMapping = () => {
    if (!newSourceNetwork || !newTargetNetwork) return;

    addMapping.mutate({
      protection_group_id: protectionGroupId,
      source_network: newSourceNetwork,
      target_network: newTargetNetwork,
      is_test_network: newIsTestNetwork,
    });

    setNewSourceNetwork("");
    setNewTargetNetwork("");
    setNewIsTestNetwork(false);
  };

  const handleSelectSource = (value: string) => {
    setNewSourceNetwork(value);
    // Auto-suggest target if VLAN matches
    const suggested = suggestTargetNetwork(value);
    if (suggested && !newTargetNetwork) {
      setNewTargetNetwork(suggested);
    }
  };

  const isAddDisabled = !newSourceNetwork || !newTargetNetwork || addMapping.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const noVCentersConfigured = !sourceVCenterId && !drVCenterId;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4" />
          Network Mappings
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          Configure how source networks map to DR site networks during failover
        </p>
      </div>

      {noVCentersConfigured ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Configure source and DR vCenters in the Sites tab to enable network mapping.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Existing mappings table */}
          {mappings.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Network</TableHead>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Target Network</TableHead>
                    <TableHead className="w-24 text-center">Test Only</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="font-mono text-sm">
                        {mapping.source_network}
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {mapping.target_network}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={mapping.is_test_network}
                          onCheckedChange={(checked) => 
                            updateMapping.mutate({ 
                              id: mapping.id, 
                              updates: { is_test_network: checked } 
                            })
                          }
                          disabled={updateMapping.isPending}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMapping.mutate(mapping.id)}
                          disabled={removeMapping.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Add new mapping form */}
          <div className="grid grid-cols-[1fr_auto_1fr_auto_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Source Network</Label>
              <Select value={newSourceNetwork} onValueChange={handleSelectSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent>
                  {sourceNetworksLoading ? (
                    <div className="flex items-center justify-center p-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : sourceNetworks.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">No networks found</div>
                  ) : (
                    sourceNetworks.map((network) => (
                      <SelectItem key={network.id} value={network.name}>
                        <span className="flex items-center gap-2">
                          {network.name}
                          {network.vlan_id && (
                            <Badge variant="outline" className="text-xs">
                              VLAN {network.vlan_id}
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <ArrowRight className="h-4 w-4 text-muted-foreground mb-2" />

            <div className="space-y-1">
              <Label className="text-xs">Target Network (DR)</Label>
              <Select value={newTargetNetwork} onValueChange={setNewTargetNetwork}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target..." />
                </SelectTrigger>
                <SelectContent>
                  {drNetworksLoading ? (
                    <div className="flex items-center justify-center p-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : drNetworks.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">No networks found</div>
                  ) : (
                    drNetworks.map((network) => (
                      <SelectItem key={network.id} value={network.name}>
                        <span className="flex items-center gap-2">
                          {network.name}
                          {network.vlan_id && (
                            <Badge variant="outline" className="text-xs">
                              VLAN {network.vlan_id}
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <Switch
                id="test-only"
                checked={newIsTestNetwork}
                onCheckedChange={setNewIsTestNetwork}
              />
              <Label htmlFor="test-only" className="text-xs whitespace-nowrap">Test</Label>
            </div>

            <Button
              size="icon"
              onClick={handleAddMapping}
              disabled={isAddDisabled}
            >
              {addMapping.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Show unmapped VM networks warning */}
          {unmappedVmNetworks.length > 0 && (
            <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm">
                <span className="font-medium">Networks used by VMs without mappings:</span>
                <div className="flex flex-wrap gap-1 mt-2">
                  {unmappedVmNetworks.map((network) => (
                    <Badge
                      key={network.name}
                      variant="outline"
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => setNewSourceNetwork(network.name)}
                    >
                      {network.name}
                      {network.vlan_id && ` (VLAN ${network.vlan_id})`}
                    </Badge>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {mappings.length === 0 && unmappedVmNetworks.length === 0 && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No network mappings configured. Add mappings to control which DR networks VMs connect to during failover.
            </div>
          )}
        </>
      )}
    </div>
  );
}
