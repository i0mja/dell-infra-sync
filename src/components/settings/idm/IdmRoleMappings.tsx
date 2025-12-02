import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useIdmGroupMappings } from '@/hooks/useIdmGroupMappings';
import { Plus, Trash2, Loader2 } from 'lucide-react';

export function IdmRoleMappings() {
  const { mappings, loading, createMapping, updateMapping, deleteMapping } = useIdmGroupMappings();
  const [showDialog, setShowDialog] = useState(false);
  const [mappingForm, setMappingForm] = useState({
    idm_group_dn: '',
    idm_group_name: '',
    app_role: 'viewer' as 'admin' | 'operator' | 'viewer',
    priority: 100,
    is_active: true,
    description: '',
  });

  const handleCreateMapping = async () => {
    await createMapping(mappingForm);
    setMappingForm({
      idm_group_dn: '',
      idm_group_name: '',
      app_role: 'viewer',
      priority: 100,
      is_active: true,
      description: '',
    });
    setShowDialog(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Group-to-Role Mappings</CardTitle>
              <CardDescription>Map FreeIPA groups to application roles</CardDescription>
            </div>
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Mapping
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Group Mapping</DialogTitle>
                  <DialogDescription>Map a FreeIPA group to an application role</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Group DN</Label>
                    <Input
                      placeholder="cn=admins,cn=groups,cn=accounts,dc=example,dc=com"
                      value={mappingForm.idm_group_dn}
                      onChange={(e) => setMappingForm({ ...mappingForm, idm_group_dn: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Group Name</Label>
                    <Input
                      placeholder="admins"
                      value={mappingForm.idm_group_name}
                      onChange={(e) => setMappingForm({ ...mappingForm, idm_group_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>App Role</Label>
                    <Select
                      value={mappingForm.app_role}
                      onValueChange={(value: any) => setMappingForm({ ...mappingForm, app_role: value })}
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
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Input
                      type="number"
                      value={mappingForm.priority}
                      onChange={(e) => setMappingForm({ ...mappingForm, priority: parseInt(e.target.value) })}
                    />
                    <p className="text-sm text-muted-foreground">Higher priority = evaluated first</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Input
                      value={mappingForm.description}
                      onChange={(e) => setMappingForm({ ...mappingForm, description: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateMapping}>Create Mapping</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group Name</TableHead>
                <TableHead>App Role</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No group mappings configured. Add a mapping to get started.
                  </TableCell>
                </TableRow>
              ) : (
                mappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">{mapping.idm_group_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{mapping.app_role}</Badge>
                    </TableCell>
                    <TableCell>{mapping.priority}</TableCell>
                    <TableCell>
                      {mapping.is_active ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateMapping(mapping.id, { is_active: !mapping.is_active })}
                        >
                          {mapping.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMapping(mapping.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
