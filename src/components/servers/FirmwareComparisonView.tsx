import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, AlertCircle, ArrowUpCircle, HelpCircle, RefreshCw, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface FirmwareComparisonViewProps {
  serverId: string;
  serverModel?: string;
}

interface InstalledFirmware {
  name: string;
  version: string;
  component_type?: string;
  updateable?: boolean;
}

interface CatalogFirmware {
  id: string;
  component_type: string;
  dell_version: string;
  filename: string;
  criticality?: string;
  applicable_models?: string[];
}

interface ComparisonRow {
  component: string;
  componentType: string;
  installedVersion: string | null;
  catalogVersion: string | null;
  status: 'up-to-date' | 'update-available' | 'not-in-catalog' | 'not-installed';
  criticality?: string;
}

export const FirmwareComparisonView = ({ serverId, serverModel }: FirmwareComparisonViewProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch installed firmware from server
  const { data: installedData, isLoading: installedLoading, refetch: refetchInstalled } = useQuery({
    queryKey: ['server-firmware', serverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servers')
        .select('idrac_firmware, bios_version, model')
        .eq('id', serverId)
        .single();
      
      if (error) throw error;
      
      // Build inventory from available fields
      const inventory: InstalledFirmware[] = [];
      
      if (data?.idrac_firmware) {
        inventory.push({ name: 'iDRAC', version: data.idrac_firmware, component_type: 'FRMW' });
      }
      if (data?.bios_version) {
        inventory.push({ name: 'BIOS', version: data.bios_version, component_type: 'BIOS' });
      }
      
      return { inventory, model: data?.model };
    }
  });

  // Fetch catalog firmware packages
  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ['firmware-packages', serverModel],
    queryFn: async () => {
      let query = supabase
        .from('firmware_packages')
        .select('*')
        .eq('upload_status', 'completed')
        .order('component_type', { ascending: true });
      
      const { data, error } = await query;
      if (error) throw error;
      
      return data as CatalogFirmware[];
    }
  });

  // Compare installed vs catalog
  const comparisonData: ComparisonRow[] = (() => {
    if (!installedData?.inventory) return [];
    
    const rows: ComparisonRow[] = [];
    const processedCatalog = new Set<string>();
    
    // For each installed component, find matching catalog entry
    installedData.inventory.forEach(installed => {
      const componentType = installed.component_type || installed.name;
      
      // Find matching catalog entry by component type or name pattern
      const catalogMatch = catalogData?.find(cat => {
        const typeMatch = cat.component_type.toLowerCase() === componentType?.toLowerCase();
        const nameMatch = installed.name.toLowerCase().includes(cat.component_type.toLowerCase()) ||
                          cat.component_type.toLowerCase().includes(installed.name.toLowerCase().split(' ')[0]);
        return typeMatch || nameMatch;
      });
      
      if (catalogMatch) {
        processedCatalog.add(catalogMatch.id);
        
        // Compare versions (simple string comparison - could be enhanced)
        const isUpToDate = installed.version === catalogMatch.dell_version ||
                          installed.version >= catalogMatch.dell_version;
        
        rows.push({
          component: installed.name,
          componentType: componentType || 'Unknown',
          installedVersion: installed.version,
          catalogVersion: catalogMatch.dell_version,
          status: isUpToDate ? 'up-to-date' : 'update-available',
          criticality: catalogMatch.criticality
        });
      } else {
        // No catalog entry for this component
        rows.push({
          component: installed.name,
          componentType: componentType || 'Unknown',
          installedVersion: installed.version,
          catalogVersion: null,
          status: 'not-in-catalog'
        });
      }
    });
    
    // Add catalog entries that aren't installed (optional - model must match)
    catalogData?.forEach(cat => {
      if (processedCatalog.has(cat.id)) return;
      
      // Check if applicable to this server model
      const modelMatch = !cat.applicable_models || 
                         cat.applicable_models.length === 0 ||
                         cat.applicable_models.some(m => 
                           serverModel?.toLowerCase().includes(m.toLowerCase()) ||
                           m.toLowerCase().includes(serverModel?.toLowerCase() || '')
                         );
      
      if (modelMatch) {
        rows.push({
          component: cat.component_type,
          componentType: cat.component_type,
          installedVersion: null,
          catalogVersion: cat.dell_version,
          status: 'not-installed'
        });
      }
    });
    
    return rows;
  })();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetchInstalled();
    setIsRefreshing(false);
  };

  const getStatusIcon = (status: ComparisonRow['status']) => {
    switch (status) {
      case 'up-to-date':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'update-available':
        return <ArrowUpCircle className="h-4 w-4 text-amber-500" />;
      case 'not-in-catalog':
        return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
      case 'not-installed':
        return <AlertCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  const getStatusBadge = (status: ComparisonRow['status']) => {
    switch (status) {
      case 'up-to-date':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Up-to-date</Badge>;
      case 'update-available':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">Update Available</Badge>;
      case 'not-in-catalog':
        return <Badge variant="outline" className="bg-muted text-muted-foreground">Not in Catalog</Badge>;
      case 'not-installed':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Not Installed</Badge>;
    }
  };

  const isLoading = installedLoading || catalogLoading;

  // Summary stats
  const upToDateCount = comparisonData.filter(r => r.status === 'up-to-date').length;
  const updateAvailableCount = comparisonData.filter(r => r.status === 'update-available').length;
  const notInCatalogCount = comparisonData.filter(r => r.status === 'not-in-catalog').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Firmware Comparison
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Compares installed firmware versions against available packages in your firmware catalog.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
            <CardDescription>
              Installed firmware vs. catalog packages
              {serverModel && <span className="ml-1">for {serverModel}</span>}
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
        
        {/* Summary badges */}
        {!isLoading && comparisonData.length > 0 && (
          <div className="flex gap-2 mt-3">
            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {upToDateCount} Up-to-date
            </Badge>
            {updateAvailableCount > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                <ArrowUpCircle className="h-3 w-3 mr-1" />
                {updateAvailableCount} Updates Available
              </Badge>
            )}
            {notInCatalogCount > 0 && (
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                <HelpCircle className="h-3 w-3 mr-1" />
                {notInCatalogCount} Not in Catalog
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : comparisonData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <HelpCircle className="h-8 w-8 mx-auto mb-2" />
            <p>No firmware data available.</p>
            <p className="text-sm">Run a firmware inventory scan to populate this data.</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Installed</TableHead>
                  <TableHead>Catalog</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonData.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(row.status)}
                        <span>{row.component}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.installedVersion || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.catalogVersion || <span className="text-muted-foreground">-</span>}
                      {row.criticality && (
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "ml-2 text-xs",
                            row.criticality === 'Critical' && 'bg-red-500/10 text-red-500 border-red-500/20',
                            row.criticality === 'Recommended' && 'bg-amber-500/10 text-amber-500 border-amber-500/20',
                            row.criticality === 'Optional' && 'bg-muted text-muted-foreground'
                          )}
                        >
                          {row.criticality}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(row.status)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
