import React, { useState } from "react";
import { useResolvedNetworks } from "@/hooks/useResolvedNetworks";
import { useNetworkMappings } from "@/hooks/useNetworkMappings";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Check, AlertTriangle, HelpCircle, Plus, Trash2, ArrowRight, Info, Network } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface NetworkMappingsEditorProps {
  protectionGroupId: string;
  sourceVCenterId?: string;
  drVCenterId?: string;
}

export function NetworkMappingsEditor({
  protectionGroupId,
  sourceVCenterId,
  drVCenterId,
}: NetworkMappingsEditorProps) {
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [newSourceNetwork, setNewSourceNetwork] = useState("");
  const [newTargetNetwork, setNewTargetNetwork] = useState("");

  const { networks, stats, isLoading, error } = useResolvedNetworks(
    protectionGroupId,
    sourceVCenterId,
    drVCenterId
  );

  const { mappings: overrides, addMapping, removeMapping, isLoading: overridesLoading } = useNetworkMappings(protectionGroupId);

  // Fetch target networks for override form
  const { data: targetNetworks } = useQuery({
    queryKey: ["vcenter-networks", drVCenterId],
    queryFn: async () => {
      if (!drVCenterId) return [];
      const { data, error } = await supabase
        .from("vcenter_networks")
        .select("id, name, vlan_id")
        .eq("vcenter_id", drVCenterId)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!drVCenterId
  });

  if (!sourceVCenterId || !drVCenterId) {
    return (
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Network className="h-4 w-4" />
            Network Mappings
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            Auto-resolved by VLAN ID matching between sites
          </p>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Configure source and DR vCenters in the Sites tab first to see network mappings.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading || overridesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Resolving networks by VLAN ID...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to resolve networks: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'matched':
        return <Check className="h-4 w-4 text-green-500" />;
      case 'ambiguous':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'not_found':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'no_vlan':
        return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Matched</Badge>;
      case 'ambiguous':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Ambiguous</Badge>;
      case 'not_found':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Not Found</Badge>;
      case 'no_vlan':
        return <Badge variant="outline" className="bg-muted text-muted-foreground">No VLAN</Badge>;
      default:
        return null;
    }
  };

  const handleAddOverride = async () => {
    if (!newSourceNetwork || !newTargetNetwork) return;
    
    await addMapping.mutateAsync({
      protection_group_id: protectionGroupId,
      source_network: newSourceNetwork,
      target_network: newTargetNetwork,
      is_test_network: false
    });

    setNewSourceNetwork("");
    setNewTargetNetwork("");
    setShowOverrideForm(false);
  };

  const hasOverride = (sourceNetworkName: string) => {
    return overrides?.some(o => o.source_network === sourceNetworkName);
  };

  // Get networks that need attention (not matched)
  const problemNetworks = networks.filter(n => n.status !== 'matched');

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4" />
          Network Mappings
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          Auto-resolved by VLAN ID matching between sites
        </p>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <Check className="h-4 w-4 text-green-500" />
          <span>{stats.matched} matched</span>
        </div>
        {stats.notFound > 0 && (
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-red-600">{stats.notFound} not found</span>
          </div>
        )}
        {stats.ambiguous > 0 && (
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-amber-600">{stats.ambiguous} ambiguous</span>
          </div>
        )}
        {stats.noVlan > 0 && (
          <div className="flex items-center gap-1">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{stats.noVlan} no VLAN ID</span>
          </div>
        )}
      </div>

      {networks.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No VMs in this protection group yet, or VMs have no networks attached.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Auto-resolved mappings table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source Network</TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Target Network (DR Site)</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {networks.map((network) => (
                  <TableRow key={network.sourceNetworkId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{network.sourceNetworkName}</span>
                        {network.sourceVlanId != null && (
                          <Badge variant="secondary" className="text-xs">
                            VLAN {network.sourceVlanId}
                          </Badge>
                        )}
                        {hasOverride(network.sourceNetworkName) && (
                          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600">
                            Override
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      {network.targetNetworkName ? (
                        <div className="flex items-center gap-2">
                          <span>{network.targetNetworkName}</span>
                          {network.targetVlanId != null && (
                            <Badge variant="secondary" className="text-xs">
                              VLAN {network.targetVlanId}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">No match found</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(network.status)}
                        {getStatusBadge(network.status)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Problem networks warning */}
          {problemNetworks.length > 0 && (
            <Alert variant="destructive" className="bg-amber-500/5 border-amber-500/20 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {problemNetworks.length} network{problemNetworks.length > 1 ? 's' : ''} could not be auto-resolved. 
                Add manual overrides below or ensure matching VLANs exist on the DR site.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Manual Overrides Section */}
      <div className="pt-4 border-t">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-medium">Manual Overrides</h4>
            <p className="text-xs text-muted-foreground">
              Override auto-resolution for specific networks
            </p>
          </div>
          {!showOverrideForm && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverrideForm(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Override
            </Button>
          )}
        </div>

        {/* Existing overrides */}
        {overrides && overrides.length > 0 && (
          <div className="space-y-2 mb-4">
            {overrides.map((override) => (
              <div
                key={override.id}
                className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{override.source_network}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span>{override.target_network}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMapping.mutate(override.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add override form */}
        {showOverrideForm && (
          <div className="flex items-end gap-2 p-3 bg-muted/30 rounded-lg">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Source Network Name</label>
              <Select value={newSourceNetwork} onValueChange={setNewSourceNetwork}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source network..." />
                </SelectTrigger>
                <SelectContent>
                  {networks.map((n) => (
                    <SelectItem key={n.sourceNetworkId} value={n.sourceNetworkName}>
                      {n.sourceNetworkName}
                      {n.sourceVlanId != null && ` (VLAN ${n.sourceVlanId})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground mb-3" />
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Target Network</label>
              <Select value={newTargetNetwork} onValueChange={setNewTargetNetwork}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target network..." />
                </SelectTrigger>
                <SelectContent>
                  {targetNetworks?.map((n) => (
                    <SelectItem key={n.id} value={n.name}>
                      {n.name}
                      {n.vlan_id != null && ` (VLAN ${n.vlan_id})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={handleAddOverride}
              disabled={!newSourceNetwork || !newTargetNetwork || addMapping.isPending}
            >
              {addMapping.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowOverrideForm(false);
                setNewSourceNetwork("");
                setNewTargetNetwork("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
