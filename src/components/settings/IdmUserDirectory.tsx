import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIdmUsers } from '@/hooks/useIdmUsers';
import { IdmUserDetailsDialog } from './IdmUserDetailsDialog';
import { Ban, CheckCircle, FileText, Loader2, RefreshCw, Search, UserCheck } from 'lucide-react';

export function IdmUserDirectory() {
  const [filters, setFilters] = useState({
    idmSource: 'all',
    status: 'all',
    search: '',
  });

  const { users, loading, loadUsers, toggleUserDisabled, forceResyncUser } = useIdmUsers(filters);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  const getSourceBadge = (source: string | null) => {
    switch (source) {
      case 'local':
        return <Badge variant="secondary">Local</Badge>;
      case 'freeipa':
        return <Badge variant="default">FreeIPA</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getStatusBadge = (disabled: boolean | null) => {
    if (disabled) {
      return <Badge variant="destructive">Disabled</Badge>;
    }
    return <Badge variant="default">Active</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>IDM User Directory</CardTitle>
          <CardDescription>
            View and manage users synced from FreeIPA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>IDM Source</Label>
              <Select
                value={filters.idmSource}
                onValueChange={(value) => setFilters({ ...filters, idmSource: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="freeipa">FreeIPA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters({ ...filters, status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Name, email, or UID..."
                  className="pl-8"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Users Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>IDM UID</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Groups</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No IDM users found
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name || 'N/A'}</TableCell>
                      <TableCell className="font-mono text-sm">{user.email}</TableCell>
                      <TableCell className="font-mono text-sm">{user.idm_uid || 'N/A'}</TableCell>
                      <TableCell>{getSourceBadge(user.idm_source)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.idm_groups ? (
                            (user.idm_groups as string[]).slice(0, 2).map((group, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {group}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">None</span>
                          )}
                          {user.idm_groups && (user.idm_groups as string[]).length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{(user.idm_groups as string[]).length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {user.last_idm_sync ? new Date(user.last_idm_sync).toLocaleDateString() : 'Never'}
                      </TableCell>
                      <TableCell>{getStatusBadge(user.idm_disabled)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user);
                              setShowDetailsDialog(true);
                            }}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleUserDisabled(user.id, !user.idm_disabled)}
                          >
                            {user.idm_disabled ? (
                              <CheckCircle className="h-4 w-4" />
                            ) : (
                              <Ban className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => forceResyncUser(user.id)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* User Details Dialog */}
      {selectedUser && (
        <IdmUserDetailsDialog
          user={selectedUser}
          open={showDetailsDialog}
          onOpenChange={setShowDetailsDialog}
        />
      )}
    </div>
  );
}
