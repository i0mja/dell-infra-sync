import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  AlertCircle,
  Cpu,
  HardDrive,
  Network,
  Zap,
  Shield
} from 'lucide-react';
import type { ComponentTypeSummary } from './types';

interface ComponentBreakdownTableProps {
  components: ComponentTypeSummary[];
  totalHosts: number;
  isLoading?: boolean;
}

function getComponentIcon(type: string) {
  const typeLower = type.toLowerCase();
  if (typeLower.includes('bios')) return Cpu;
  if (typeLower.includes('idrac')) return Shield;
  if (typeLower.includes('nic') || typeLower.includes('network')) return Network;
  if (typeLower.includes('raid') || typeLower.includes('storage') || typeLower.includes('disk')) return HardDrive;
  if (typeLower.includes('power') || typeLower.includes('psu')) return Zap;
  return Cpu;
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

export function ComponentBreakdownTable({ components, totalHosts, isLoading }: ComponentBreakdownTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (components.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Cpu className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No component data available</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component Type</TableHead>
            <TableHead className="text-center">Hosts Outdated</TableHead>
            <TableHead>Current Versions</TableHead>
            <TableHead>Available Version</TableHead>
            <TableHead>Update Impact</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {components.map((comp, index) => {
            const Icon = getComponentIcon(comp.type);
            const outdatedPercent = totalHosts > 0 
              ? Math.round((comp.hostsOutdated / totalHosts) * 100) 
              : 0;
            const isUpToDate = comp.hostsOutdated === 0;
            
            return (
              <TableRow key={index}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{comp.type}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 justify-center">
                    {isUpToDate ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : comp.criticality === 'Critical' ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Download className="h-4 w-4 text-primary" />
                    )}
                    <span className={isUpToDate ? 'text-success' : comp.hostsOutdated > 0 ? 'font-medium' : ''}>
                      {comp.hostsOutdated} / {totalHosts}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                    {comp.versionRange || '-'}
                  </code>
                </TableCell>
                <TableCell>
                  {comp.availableVersion ? (
                    <code className="text-sm bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                      {comp.availableVersion}
                    </code>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getCriticalityBadge(comp.criticality)}
                    {!isUpToDate && (
                      <div className="w-24">
                        <Progress 
                          value={outdatedPercent} 
                          className={`h-1.5 ${outdatedPercent >= 50 ? 'bg-destructive/20' : 'bg-primary/20'}`}
                        />
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
