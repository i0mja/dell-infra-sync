import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChevronDown,
  ChevronRight,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Server,
  Download,
} from 'lucide-react';
import type { UpdateAvailabilityResult, FirmwareComponent } from '@/hooks/useUpdateAvailabilityScan';
import { groupFirmwareComponents, type GroupedFirmwareComponent } from '@/lib/firmware-utils';

interface HostUpdateDetailsTableProps {
  results: UpdateAvailabilityResult[];
  isLoading?: boolean;
  onStartUpdate?: (serverId: string) => void;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Scanned</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    case 'skipped':
      return <Badge variant="secondary">Skipped</Badge>;
    case 'scanning':
      return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Scanning</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
}

function getComponentStatusIcon(status: FirmwareComponent['status']) {
  switch (status) {
    case 'up-to-date':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'critical-update':
      return <AlertTriangle className="h-4 w-4 text-destructive" />;
    case 'update-available':
      return <Download className="h-4 w-4 text-primary" />;
    case 'not-in-catalog':
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    default:
      return null;
  }
}

function getCriticalityBadge(criticality?: string) {
  if (!criticality) return null;
  switch (criticality) {
    case 'Critical':
      return <Badge variant="destructive" className="text-xs">Critical</Badge>;
    case 'Recommended':
      return <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/20">Recommended</Badge>;
    case 'Optional':
      return <Badge variant="secondary" className="text-xs">Optional</Badge>;
    default:
      return null;
  }
}

interface ExpandedRowProps {
  result: UpdateAvailabilityResult;
}

function ExpandedRow({ result }: ExpandedRowProps) {
  const groupedComponents = useMemo(() => 
    groupFirmwareComponents(result.firmware_components || []),
    [result.firmware_components]
  );

  return (
    <div className="p-4 bg-muted/30">
      {result.blockers && result.blockers.length > 0 && (
        <div className="mb-4 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
          <p className="font-medium text-destructive flex items-center gap-2 mb-2">
            <XCircle className="h-4 w-4" />
            Scan Issues
          </p>
          <ul className="text-sm space-y-1">
            {result.blockers.map((blocker, i) => (
              <li key={i} className="text-muted-foreground">• {blocker.message}</li>
            ))}
          </ul>
        </div>
      )}
      
      {groupedComponents.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10"></TableHead>
              <TableHead>Component</TableHead>
              <TableHead className="text-center w-20">Count</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Installed</TableHead>
              <TableHead>Available</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedComponents.map((comp, index) => (
              <TableRow key={index} className="hover:bg-muted/50">
                <TableCell>{getComponentStatusIcon(comp.status)}</TableCell>
                <TableCell className="font-medium">
                  {comp.instanceCount > 1 ? (
                    <Tooltip>
                      <TooltipTrigger className="text-left cursor-help underline decoration-dotted underline-offset-2">
                        {comp.name}
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-sm">
                        <p className="font-medium mb-1">{comp.instanceCount} instances:</p>
                        <ul className="text-xs max-h-48 overflow-auto space-y-0.5">
                          {comp.instanceNames.slice(0, 10).map((n, i) => (
                            <li key={i} className="text-muted-foreground">{n}</li>
                          ))}
                          {comp.instanceNames.length > 10 && (
                            <li className="text-muted-foreground italic">
                              ...and {comp.instanceNames.length - 10} more
                            </li>
                          )}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  ) : comp.name}
                </TableCell>
                <TableCell className="text-center">
                  {comp.instanceCount > 1 ? (
                    <Badge variant="outline" className="text-xs">
                      ×{comp.instanceCount}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{comp.type}</TableCell>
                <TableCell className="font-mono text-sm">{comp.installedVersion}</TableCell>
                <TableCell className="font-mono text-sm">
                  {comp.availableVersion || '-'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {comp.status === 'up-to-date' && (
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">Current</Badge>
                    )}
                    {comp.status === 'update-available' && (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Update</Badge>
                    )}
                    {comp.status === 'critical-update' && (
                      <Badge variant="destructive">Critical</Badge>
                    )}
                    {comp.status === 'not-in-catalog' && (
                      <Badge variant="secondary">Not in Catalog</Badge>
                    )}
                    {getCriticalityBadge(comp.criticality)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No firmware components found</p>
      )}
    </div>
  );
}

export function HostUpdateDetailsTable({ results, isLoading, onStartUpdate }: HostUpdateDetailsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filteredResults = results.filter(result => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      result.hostname?.toLowerCase().includes(search) ||
      result.server_model?.toLowerCase().includes(search) ||
      result.service_tag?.toLowerCase().includes(search)
    );
  });

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search hosts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline" className="text-muted-foreground">
          {filteredResults.length} hosts
        </Badge>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Service Tag</TableHead>
              <TableHead>ESXi</TableHead>
              <TableHead className="text-center">Components</TableHead>
              <TableHead className="text-center">Updates</TableHead>
              <TableHead className="text-center">Critical</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredResults.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No hosts found</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredResults.map((result) => (
                <Collapsible key={result.id} open={expandedRows.has(result.id)} asChild>
                  <>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleRow(result.id)}>
                      <TableCell>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            {expandedRows.has(result.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </TableCell>
                      <TableCell className="font-medium">
                        {result.hostname || 'Unknown'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {result.server_model || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {result.service_tag || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{result.esxi_version || '-'}</span>
                          {result.esxi_update_available && (
                            <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/20">
                              Update
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{result.total_components}</TableCell>
                      <TableCell className="text-center">
                        {result.updates_available > 0 ? (
                          <span className="text-primary font-medium">{result.updates_available}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {result.critical_updates > 0 ? (
                          <span className="text-destructive font-medium">{result.critical_updates}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(result.scan_status)}</TableCell>
                      <TableCell>
                        {result.updates_available > 0 && onStartUpdate && result.server_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartUpdate(result.server_id!);
                            }}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    <CollapsibleContent asChild>
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={10} className="p-0">
                          <ExpandedRow result={result} />
                        </TableCell>
                      </TableRow>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
