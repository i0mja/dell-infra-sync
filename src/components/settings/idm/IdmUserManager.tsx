import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Search,
  UserPlus,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ManagedUser {
  id: string;
  ad_username: string;
  ad_domain: string;
  display_name: string | null;
  email: string | null;
  app_role: 'admin' | 'operator' | 'viewer';
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface ADUser {
  sam_account_name: string;
  display_name: string;
  email: string | null;
  dn: string | null;
  department: string | null;
  title: string | null;
}

export function IdmUserManager() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [adSearchTerm, setAdSearchTerm] = useState('');
  const [adSearchResults, setAdSearchResults] = useState<ADUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  
  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [selectedAdUser, setSelectedAdUser] = useState<ADUser | null>(null);
  
  // Form state for add/edit
  const [formData, setFormData] = useState({
    ad_username: '',
    ad_domain: '',
    display_name: '',
    email: '',
    app_role: 'viewer' as 'admin' | 'operator' | 'viewer',
    is_active: true,
    notes: '',
  });

  // Fetch managed users
  const { data: managedUsers = [], isLoading, refetch } = useQuery({
    queryKey: ['managed-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('managed_users')
        .select('*')
        .order('ad_username');
      if (error) throw error;
      return data as ManagedUser[];
    },
  });

  // Fetch IDM settings for domain info
  const { data: idmSettings } = useQuery({
    queryKey: ['idm-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('idm_settings')
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: async (userData: Omit<ManagedUser, 'id' | 'created_at'>) => {
      const { error } = await supabase
        .from('managed_users')
        .insert({
          ...userData,
          created_by: session?.user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('User added successfully');
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      if (error.message?.includes('duplicate key')) {
        toast.error('User already exists with this username and domain');
      } else {
        toast.error(`Failed to add user: ${error.message}`);
      }
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, ...userData }: Partial<ManagedUser> & { id: string }) => {
      const { error } = await supabase
        .from('managed_users')
        .update(userData)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('User updated successfully');
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
      setEditUser(null);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(`Failed to update user: ${error.message}`);
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('managed_users')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('User removed');
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to remove user: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      ad_username: '',
      ad_domain: idmSettings?.ad_domain_fqdn || '',
      display_name: '',
      email: '',
      app_role: 'viewer',
      is_active: true,
      notes: '',
    });
    setSelectedAdUser(null);
    setAdSearchResults([]);
    setAdSearchTerm('');
    setSearchError(null);
  };

  const searchAdUsers = async () => {
    if (!adSearchTerm.trim()) {
      toast.error('Enter a search term');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setAdSearchResults([]);

    try {
      // Create job to search AD users
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'idm_search_ad_users',
          created_by: session?.user?.id,
          status: 'pending',
          details: {
            search_term: adSearchTerm,
            max_results: 50,
          },
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll for completion
      let attempts = 0;
      const maxAttempts = 30;
      
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;

        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          const details = updatedJob.details as Record<string, any> | null;
          const users = details?.users || [];
          setAdSearchResults(users);
          if (users.length === 0) {
            setSearchError('No users found matching your search');
          }
          break;
        }

        if (updatedJob?.status === 'failed') {
          const details = updatedJob.details as Record<string, any> | null;
          throw new Error(details?.error || 'Search failed');
        }
      }

      if (attempts >= maxAttempts) {
        throw new Error('Search timed out - Job Executor may be offline');
      }
    } catch (error: any) {
      console.error('AD search error:', error);
      setSearchError(error.message);
      toast.error(`Search failed: ${error.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const selectAdUser = (adUser: ADUser) => {
    setSelectedAdUser(adUser);
    setFormData({
      ...formData,
      ad_username: adUser.sam_account_name,
      ad_domain: idmSettings?.ad_domain_fqdn || '',
      display_name: adUser.display_name || '',
      email: adUser.email || '',
    });
  };

  const handleAddUser = () => {
    if (!formData.ad_username || !formData.ad_domain) {
      toast.error('Username and domain are required');
      return;
    }
    addUserMutation.mutate(formData);
  };

  const handleUpdateUser = () => {
    if (!editUser) return;
    updateUserMutation.mutate({
      id: editUser.id,
      ...formData,
    });
  };

  const openEditDialog = (user: ManagedUser) => {
    setEditUser(user);
    setFormData({
      ad_username: user.ad_username,
      ad_domain: user.ad_domain,
      display_name: user.display_name || '',
      email: user.email || '',
      app_role: user.app_role,
      is_active: user.is_active,
      notes: user.notes || '',
    });
  };

  const filteredUsers = managedUsers.filter(user =>
    user.ad_username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.ad_domain.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin': return 'destructive';
      case 'operator': return 'default';
      default: return 'secondary';
    }
  };

  // Deduplicate domains (normalize to lowercase and trim)
  const domains = Array.from(new Set(
    [
      idmSettings?.ad_domain_fqdn,
      ...(idmSettings?.trusted_domains || []),
    ]
      .filter((d): d is string => Boolean(d))
      .map(d => d.trim().toLowerCase())
  ));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Managed Users
              </CardTitle>
              <CardDescription>
                Add AD users and assign roles directly. Users in this list will receive their assigned role when logging in.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={() => { resetForm(); setAddDialogOpen(true); }}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No managed users yet</p>
              <p className="text-sm">Add users to control access</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.ad_username}</TableCell>
                    <TableCell className="text-muted-foreground">{user.ad_domain}</TableCell>
                    <TableCell>{user.display_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.app_role)}>
                        {user.app_role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? 'outline' : 'secondary'}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(user)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Remove this user?')) {
                            deleteUserMutation.mutate(user.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Managed User</DialogTitle>
            <DialogDescription>
              Search for an AD user or enter details manually
            </DialogDescription>
          </DialogHeader>

          {/* AD Search Section */}
          <div className="space-y-4 border-b pb-4">
            <Label>Search Active Directory</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Search by username, name, or email..."
                value={adSearchTerm}
                onChange={(e) => setAdSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchAdUsers()}
              />
              <Button onClick={searchAdUsers} disabled={isSearching}>
                {isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            {searchError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{searchError}</AlertDescription>
              </Alert>
            )}

            {adSearchResults.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {adSearchResults.map((adUser) => (
                  <div
                    key={adUser.dn || adUser.sam_account_name}
                    className={`p-2 cursor-pointer hover:bg-muted flex justify-between items-center ${
                      selectedAdUser?.sam_account_name === adUser.sam_account_name ? 'bg-muted' : ''
                    }`}
                    onClick={() => selectAdUser(adUser)}
                  >
                    <div>
                      <div className="font-medium">{adUser.sam_account_name}</div>
                      <div className="text-sm text-muted-foreground">
                        {adUser.display_name} {adUser.email && `• ${adUser.email}`}
                      </div>
                    </div>
                    {selectedAdUser?.sam_account_name === adUser.sam_account_name && (
                      <ShieldCheck className="h-4 w-4 text-primary" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual Entry / Edit Form */}
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username *</Label>
                <Input
                  value={formData.ad_username}
                  onChange={(e) => setFormData({ ...formData, ad_username: e.target.value })}
                  placeholder="e.g., jalexander"
                />
              </div>
              <div className="space-y-2">
                <Label>Domain *</Label>
                <Select
                  value={formData.ad_domain}
                  onValueChange={(v) => setFormData({ ...formData, ad_domain: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select domain" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((domain, index) => (
                      <SelectItem key={`domain-${index}-${domain}`} value={domain}>{domain}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="user@domain.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Role *</Label>
              <Select
                value={formData.app_role}
                onValueChange={(v: 'admin' | 'operator' | 'viewer') => setFormData({ ...formData, app_role: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin - Full access</SelectItem>
                  <SelectItem value="operator">Operator - Can manage servers</SelectItem>
                  <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Optional notes about this user..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddUser} disabled={addUserMutation.isPending}>
              {addUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user details and role assignment
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input value={formData.ad_username} disabled />
              </div>
              <div className="space-y-2">
                <Label>Domain</Label>
                <Input value={formData.ad_domain} disabled />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.app_role}
                onValueChange={(v: 'admin' | 'operator' | 'viewer') => setFormData({ ...formData, app_role: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUser} disabled={updateUserMutation.isPending}>
              {updateUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}