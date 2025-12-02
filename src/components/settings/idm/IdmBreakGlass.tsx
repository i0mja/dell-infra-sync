import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBreakGlassAdmins } from '@/hooks/useBreakGlassAdmins';
import { ShieldAlert, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';

export function IdmBreakGlass() {
  const { admins, loading, createAdmin, activateAdmin, deactivateAdmin, deleteAdmin } = useBreakGlassAdmins();
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<any>(null);
  const [activationReason, setActivationReason] = useState('');
  const [adminForm, setAdminForm] = useState({
    email: '',
    full_name: '',
    password: '',
  });

  const handleCreateAdmin = async () => {
    await createAdmin(adminForm);
    setAdminForm({ email: '', full_name: '', password: '' });
    setShowAdminDialog(false);
  };

  const handleActivateAdmin = async () => {
    if (selectedAdmin && activationReason) {
      await activateAdmin(selectedAdmin.id, activationReason);
      setShowActivateDialog(false);
      setActivationReason('');
      setSelectedAdmin(null);
    }
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
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          <strong>Break-Glass Administrators</strong> are emergency local admin accounts that bypass IDM authentication. 
          They should only be used when FreeIPA is unavailable or during emergencies. All usage is logged for audit purposes.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                Break-Glass Administrators
              </CardTitle>
              <CardDescription>Emergency local admin accounts that bypass IDM</CardDescription>
            </div>
            <Dialog open={showAdminDialog} onOpenChange={setShowAdminDialog}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Admin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Break-Glass Administrator</DialogTitle>
                  <DialogDescription>Create an emergency local admin account</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={adminForm.email}
                      onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Full Name</Label>
                    <Input
                      value={adminForm.full_name}
                      onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      value={adminForm.password}
                      onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                    />
                  </div>
                  <Alert>
                    <ShieldAlert className="h-4 w-4" />
                    <AlertDescription>
                      This account will bypass IDM authentication and should only be used in emergencies.
                    </AlertDescription>
                  </Alert>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateAdmin}>Create Admin</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Use Count</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No break-glass administrators configured
                  </TableCell>
                </TableRow>
              ) : (
                admins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell className="font-medium">{admin.email}</TableCell>
                    <TableCell>{admin.full_name}</TableCell>
                    <TableCell>
                      {admin.is_active ? (
                        <Badge variant="destructive">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>{admin.use_count || 0}</TableCell>
                    <TableCell>
                      {admin.last_used_at ? new Date(admin.last_used_at).toLocaleDateString() : 'Never'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {admin.is_active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deactivateAdmin(admin.id)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedAdmin(admin);
                              setShowActivateDialog(true);
                            }}
                          >
                            Activate
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAdmin(admin.id)}
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

      {/* Activation Reason Dialog */}
      <Dialog open={showActivateDialog} onOpenChange={setShowActivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate Break-Glass Administrator</DialogTitle>
            <DialogDescription>Provide a reason for activating this emergency account</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Activation Reason</Label>
              <Textarea
                placeholder="Describe why this emergency account needs to be activated..."
                value={activationReason}
                onChange={(e) => setActivationReason(e.target.value)}
                rows={4}
              />
            </div>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This action will be logged in the audit trail for security compliance.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActivateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleActivateAdmin} disabled={!activationReason}>
              Activate Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
