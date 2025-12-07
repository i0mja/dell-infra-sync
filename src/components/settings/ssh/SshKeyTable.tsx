import { useState, useCallback, useMemo } from 'react';
import { Key, Copy, Eye, Ban, Trash2, Clock, CheckCircle, XCircle, AlertCircle, Upload, RotateCcw, ArrowUpDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { SshKey } from '@/hooks/useSshKeys';

interface SshKeyTableProps {
  keys: SshKey[];
  isLoading: boolean;
  onViewDetails: (key: SshKey) => void;
  onRevoke: (key: SshKey) => void;
  onDelete: (key: SshKey) => void;
  onDeploy?: (key: SshKey) => void;
  onRotate?: (key: SshKey) => void;
}

type SortField = 'name' | 'status' | 'created_at' | 'last_used_at' | 'use_count';
type SortDirection = 'asc' | 'desc';

export function SshKeyTable({ keys, isLoading, onViewDetails, onRevoke, onDelete, onDeploy, onRotate }: SshKeyTableProps) {
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`${label} copied to clipboard`);
    }).catch(() => {
      toast.error(`Failed to copy ${label}`);
    });
  }, []);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  const sortedKeys = useMemo(() => {
    return [...keys].sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'created_at':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'last_used_at':
          const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
          const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
          comparison = aTime - bTime;
          break;
        case 'use_count':
          comparison = a.use_count - b.use_count;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [keys, sortField, sortDirection]);

  const getStatusBadge = (status: SshKey['status']) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" aria-hidden="true" />Active</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" aria-hidden="true" />Pending</Badge>;
      case 'revoked':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" aria-hidden="true" />Revoked</Badge>;
      case 'expired':
        return <Badge variant="outline" className="text-amber-600 border-amber-600"><AlertCircle className="h-3 w-3 mr-1" aria-hidden="true" />Expired</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const truncateFingerprint = (fingerprint: string) => {
    if (!fingerprint) return 'N/A';
    if (fingerprint.length <= 20) return fingerprint;
    return `${fingerprint.substring(0, 16)}...`;
  };

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 data-[state=open]:bg-accent"
      onClick={() => handleSort(field)}
      aria-label={`Sort by ${field}`}
    >
      {children}
      <ArrowUpDown className="ml-2 h-4 w-4" aria-hidden="true" />
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading SSH keys">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
        <span className="sr-only">Loading SSH keys...</span>
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground" role="status">
        <Key className="h-12 w-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
        <p className="font-medium">No SSH keys configured</p>
        <p className="text-sm mt-1">Generate a new key to get started with secure infrastructure access</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <SortableHeader field="name">Name</SortableHeader>
            </TableHead>
            <TableHead>Fingerprint</TableHead>
            <TableHead>
              <SortableHeader field="status">Status</SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="created_at">Created</SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="last_used_at">Last Used</SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="use_count">Uses</SortableHeader>
            </TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedKeys.map((key) => (
            <TableRow key={key.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <div className="font-medium">{key.name}</div>
                    {key.description && (
                      <div className="text-xs text-muted-foreground">{key.description}</div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {truncateFingerprint(key.public_key_fingerprint)}
                  </code>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(key.public_key_fingerprint, 'Fingerprint')}
                        aria-label="Copy fingerprint to clipboard"
                      >
                        <Copy className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy fingerprint</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
              <TableCell>{getStatusBadge(key.status)}</TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(key.created_at), { addSuffix: true })}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {key.last_used_at
                    ? formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true })
                    : 'Never'}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm">{key.use_count}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1" role="group" aria-label={`Actions for ${key.name}`}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyToClipboard(key.public_key, 'Public key')}
                        aria-label="Copy public key"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy public key</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onViewDetails(key)}
                        aria-label="View key details"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View details</TooltipContent>
                  </Tooltip>
                  {key.status === 'active' && onDeploy && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary hover:text-primary/80"
                          onClick={() => onDeploy(key)}
                          aria-label="Deploy key to targets"
                        >
                          <Upload className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Deploy to targets</TooltipContent>
                    </Tooltip>
                  )}
                  {key.status === 'active' && onRotate && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600 hover:text-blue-700"
                          onClick={() => onRotate(key)}
                          aria-label="Rotate key"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Rotate key</TooltipContent>
                    </Tooltip>
                  )}
                  {key.status === 'active' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-amber-600 hover:text-amber-700"
                          onClick={() => onRevoke(key)}
                          aria-label="Revoke key"
                        >
                          <Ban className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Revoke key</TooltipContent>
                    </Tooltip>
                  )}
                  {key.status === 'revoked' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => onDelete(key)}
                          aria-label="Delete key"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete key</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
