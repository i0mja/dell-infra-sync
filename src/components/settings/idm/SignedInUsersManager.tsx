import { useState } from 'react';
import { useSignedInUsers, SignedInUserFilters, SignedInUser } from '@/hooks/useSignedInUsers';
import { useAuth } from '@/hooks/useAuth';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, Search, Trash2, UserCog, Shield, Eye, Crown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

const roleIcons: Record<AppRole, React.ReactNode> = {
  admin: <Crown className="h-3 w-3" />,
  operator: <UserCog className="h-3 w-3" />,
  viewer: <Eye className="h-3 w-3" />,
};

const roleColors: Record<AppRole, string> = {
  admin: 'bg-destructive/10 text-destructive border-destructive/20',
  operator: 'bg-primary/10 text-primary border-primary/20',
  viewer: 'bg-muted text-muted-foreground border-border',
};

export function SignedInUsersManager() {
  const { user: currentUser } = useAuth();
  const [filters, setFilters] = useState<SignedInUserFilters>({});
  const { users, loading, refresh, updateUserRole, deleteUser } = useSignedInUsers(filters);
  const [deleteConfirm, setDeleteConfirm] = useState<SignedInUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    await updateUserRole(userId, newRole);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    await deleteUser(deleteConfirm.id);
    setIsDeleting(false);
    setDeleteConfirm(null);
  };

  const getSourceBadge = (user: SignedInUser) => {
    if (user.idm_source) {
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
          {user.idm_source === 'freeipa' ? 'FreeIPA' : user.idm_source === 'active_directory' ? 'AD' : user.idm_source}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-muted text-muted-foreground">
        Local
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Signed-In Users
            </CardTitle>
            <CardDescription>
              Manage users who have signed into the application. Change roles or remove access.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              className="pl-9"
              value={filters.search || ''}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
          <Select
            value={filters.source || 'all'}
            onValueChange={(v) => setFilters({ ...filters, source: v as SignedInUserFilters['source'] })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="idm">IDM Only</SelectItem>
              <SelectItem value="local">Local Only</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.role || 'all'}
            onValueChange={(v) => setFilters({ ...filters, role: v as SignedInUserFilters['role'] })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Users Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const isCurrentUser = user.id === currentUser?.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {user.full_name || user.idm_uid || 'Unknown'}
                            {isCurrentUser && (
                              <Badge variant="secondary" className="ml-2 text-xs">You</Badge>
                            )}
                          </span>
                          <span className="text-sm text-muted-foreground">{user.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getSourceBadge(user)}</TableCell>
                      <TableCell>
                        <Select
                          value={user.role || 'viewer'}
                          onValueChange={(v) => handleRoleChange(user.id, v as AppRole)}
                          disabled={isCurrentUser}
                        >
                          <SelectTrigger className={`w-[130px] ${user.role ? roleColors[user.role] : ''}`}>
                            <SelectValue>
                              <span className="flex items-center gap-2">
                                {user.role && roleIcons[user.role]}
                                {user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Viewer'}
                              </span>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">
                              <span className="flex items-center gap-2">
                                <Crown className="h-3 w-3" /> Admin
                              </span>
                            </SelectItem>
                            <SelectItem value="operator">
                              <span className="flex items-center gap-2">
                                <UserCog className="h-3 w-3" /> Operator
                              </span>
                            </SelectItem>
                            <SelectItem value="viewer">
                              <span className="flex items-center gap-2">
                                <Eye className="h-3 w-3" /> Viewer
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {user.last_idm_sync
                          ? formatDistanceToNow(new Date(user.last_idm_sync), { addSuffix: true })
                          : formatDistanceToNow(new Date(user.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={isCurrentUser}
                          onClick={() => setDeleteConfirm(user)}
                          title={isCurrentUser ? "You can't delete yourself" : 'Delete user'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="text-sm text-muted-foreground">
          {users.length} user{users.length !== 1 ? 's' : ''} total
        </div>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteConfirm?.full_name || deleteConfirm?.email}</strong>?
              This will permanently remove their account and all associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
