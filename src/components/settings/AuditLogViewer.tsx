import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { Download, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import { format } from 'date-fns';

export function AuditLogViewer() {
  const [filters, setFilters] = useState({
    authSource: 'all',
    action: '',
    ipAddress: '',
  });

  const { logs, loading, totalCount, page, pageSize, fetchLogs, exportToCsv } = useAuditLogs(filters);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    await exportToCsv();
    setExporting(false);
  };

  const getAuthSourceBadge = (source: string | null) => {
    switch (source) {
      case 'local':
        return <Badge variant="secondary">Local</Badge>;
      case 'freeipa':
      case 'FreeIPA':
        return <Badge variant="default">FreeIPA</Badge>;
      case 'ad_trust':
        return <Badge className="bg-blue-500 text-white">AD Trust</Badge>;
      case 'break_glass':
        return <Badge variant="destructive">Break-Glass</Badge>;
      case 'system':
        return <Badge variant="outline">System</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getSeverityBadge = (action: string) => {
    if (action.includes('break_glass') || action.includes('fail')) {
      return <Badge variant="destructive">Critical</Badge>;
    }
    if (action.includes('logout') || action.includes('session')) {
      return <Badge variant="secondary">Info</Badge>;
    }
    return <Badge variant="default">Normal</Badge>;
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Security Audit Logs</CardTitle>
          <CardDescription>
            View authentication events, security actions, and break-glass usage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Auth Source</Label>
              <Select
                value={filters.authSource}
                onValueChange={(value) => setFilters({ ...filters, authSource: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="freeipa">FreeIPA</SelectItem>
                  <SelectItem value="ad_trust">AD Trust</SelectItem>
                  <SelectItem value="break_glass">Break-Glass</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Action</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search actions..."
                  className="pl-8"
                  value={filters.action}
                  onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>IP Address</Label>
              <Input
                placeholder="Filter by IP..."
                value={filters.ipAddress}
                onChange={(e) => setFilters({ ...filters, ipAddress: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => fetchLogs(1)}
                  disabled={loading}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExport}
                  disabled={exporting || loading}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </div>
            </div>
          </div>

          {/* Results Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Auth Source</TableHead>
                  <TableHead>Auth Method</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No audit logs found
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </TableCell>
                      <TableCell className="font-medium">{log.action}</TableCell>
                      <TableCell>{getAuthSourceBadge(log.auth_source)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.auth_method || 'N/A'}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.ip_address || 'N/A'}</TableCell>
                      <TableCell>{getSeverityBadge(log.action)}</TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedLog(log)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Audit Log Details</DialogTitle>
                              <DialogDescription>
                                {log.action} at {format(new Date(log.timestamp), 'PPpp')}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <Label>User ID</Label>
                                  <p className="text-sm font-mono">{log.user_id || 'N/A'}</p>
                                </div>
                                <div>
                                  <Label>IP Address</Label>
                                  <p className="text-sm font-mono">{log.ip_address || 'N/A'}</p>
                                </div>
                                <div>
                                  <Label>Auth Source</Label>
                                  <div>{getAuthSourceBadge(log.auth_source)}</div>
                                </div>
                                <div>
                                  <Label>Auth Method</Label>
                                  <p className="text-sm">{log.auth_method || 'N/A'}</p>
                                </div>
                              </div>

                              {log.idm_user_dn && (
                                <div>
                                  <Label>IDM User DN</Label>
                                  <p className="text-sm font-mono break-all">{log.idm_user_dn}</p>
                                </div>
                              )}

                              {log.idm_groups_at_login && (
                                <div>
                                  <Label>IDM Groups</Label>
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {(log.idm_groups_at_login as string[]).map((group, idx) => (
                                      <Badge key={idx} variant="secondary">{group}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {log.details && (
                                <div>
                                  <Label>Additional Details</Label>
                                  <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-60">
                                    {JSON.stringify(log.details, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} entries
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchLogs(page - 1)}
                  disabled={page === 1 || loading}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchLogs(page + 1)}
                  disabled={page >= totalPages || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
