import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CredentialTestDialog } from './CredentialTestDialog';
import { Plus, Shield, Pencil, Trash2, FlaskConical, Loader2 } from 'lucide-react';

interface CredentialSet {
  id: string;
  name: string;
  username: string;
  description: string | null;
  priority: number | null;
  is_default: boolean | null;
  credential_type: 'idrac' | 'esxi';
  created_at: string | null;
}

export function CredentialsTabPanel() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<CredentialSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'idrac' | 'esxi'>('all');
  
  // Dialog states
  const [showDialog, setShowDialog] = useState(false);
  const [editingCredential, setEditingCredential] = useState<CredentialSet | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testCredential, setTestCredential] = useState<CredentialSet | null>(null);
  
  // Form state
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    description: '',
    priority: 100,
    is_default: false,
    credential_type: 'idrac' as 'idrac' | 'esxi',
  });

  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('credential_sets')
      .select('*')
      .order('priority', { ascending: true });
    if (data) setCredentials(data as CredentialSet[]);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (editingCredential) {
        const updates: any = {
          name: form.name,
          username: form.username,
          description: form.description,
          priority: form.priority,
          is_default: form.is_default,
        };

        if (form.password) {
          const { data: encrypted } = await supabase.functions.invoke('encrypt-credentials', {
            body: { password: form.password }
          });
          updates.password_encrypted = encrypted.encrypted;
        }

        await supabase
          .from('credential_sets')
          .update(updates)
          .eq('id', editingCredential.id);
      } else {
        const { data: encrypted } = await supabase.functions.invoke('encrypt-credentials', {
          body: { password: form.password }
        });

        await supabase.from('credential_sets').insert([{
          name: form.name,
          username: form.username,
          password_encrypted: encrypted.encrypted,
          description: form.description,
          priority: form.priority,
          is_default: form.is_default,
          credential_type: form.credential_type,
        }]);
      }

      toast({
        title: "Success",
        description: `Credential set ${editingCredential ? 'updated' : 'created'}`,
      });

      setShowDialog(false);
      loadCredentials();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('credential_sets')
      .delete()
      .eq('id', id);

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Credential set deleted",
      });
      loadCredentials();
    }
    setDeleteConfirmId(null);
  };

  const openCreateDialog = () => {
    setEditingCredential(null);
    setForm({
      name: '',
      username: '',
      password: '',
      description: '',
      priority: 100,
      is_default: false,
      credential_type: 'idrac',
    });
    setShowDialog(true);
  };

  const openEditDialog = (cred: CredentialSet) => {
    setEditingCredential(cred);
    setForm({
      name: cred.name,
      username: cred.username,
      password: '',
      description: cred.description || '',
      priority: cred.priority || 100,
      is_default: cred.is_default || false,
      credential_type: cred.credential_type,
    });
    setShowDialog(true);
  };

  const filteredCredentials = typeFilter === 'all' 
    ? credentials 
    : credentials.filter(c => c.credential_type === typeFilter);

  const idracCount = credentials.filter(c => c.credential_type === 'idrac').length;
  const esxiCount = credentials.filter(c => c.credential_type === 'esxi').length;

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Credential Sets</h3>
            <p className="text-sm text-muted-foreground">
              Manage iDRAC and ESXi credential sets with IP range auto-assignment
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Credential Set
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 text-sm bg-muted/30 rounded-lg p-3">
          <span className="text-muted-foreground">Total: <span className="font-medium text-foreground">{credentials.length}</span></span>
          <span className="text-muted-foreground">iDRAC: <span className="font-medium text-foreground">{idracCount}</span></span>
          <span className="text-muted-foreground">ESXi: <span className="font-medium text-foreground">{esxiCount}</span></span>
          {credentials.some(c => c.is_default) && (
            <Badge variant="secondary">Default Configured</Badge>
          )}
        </div>

        {/* Type Filter Tabs */}
        <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All ({credentials.length})</TabsTrigger>
            <TabsTrigger value="idrac">iDRAC ({idracCount})</TabsTrigger>
            <TabsTrigger value="esxi">ESXi ({esxiCount})</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Credentials Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredCredentials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {typeFilter === 'all' 
                ? 'No credential sets configured. Add your first credential set to get started.'
                : `No ${typeFilter === 'idrac' ? 'iDRAC' : 'ESXi'} credentials configured.`}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredCredentials.map((cred) => (
              <Card key={cred.id} className="relative">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{cred.name}</h4>
                        {cred.is_default && <Badge variant="secondary">Default</Badge>}
                      </div>
                      <Badge variant="outline">
                        {cred.credential_type === 'idrac' ? 'iDRAC' : 'ESXi'}
                      </Badge>
                    </div>

                    {cred.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{cred.description}</p>
                    )}

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>User: {cred.username}</span>
                      <span>Priority: {cred.priority}</span>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(cred)}>
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setTestCredential(cred)}>
                        <FlaskConical className="h-3 w-3 mr-1" />
                        Test
                      </Button>
                      {deleteConfirmId === cred.id ? (
                        <div className="flex gap-1 ml-auto">
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(cred.id)}>
                            Confirm
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setDeleteConfirmId(cred.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingCredential ? 'Edit' : 'Add'} Credential Set</DialogTitle>
              <VisuallyHidden.Root>
                <DialogDescription>
                  {editingCredential ? 'Edit an existing credential set' : 'Add a new credential set for server authentication'}
                </DialogDescription>
              </VisuallyHidden.Root>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.credential_type}
                  onValueChange={(v: 'idrac' | 'esxi') => setForm({ ...form, credential_type: v })}
                  disabled={!!editingCredential}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="idrac">iDRAC</SelectItem>
                    <SelectItem value="esxi">ESXi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Production iDRAC"
                />
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="root"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingCredential ? "Leave blank to keep current" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 100 })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Set as Default</Label>
                <Switch
                  checked={form.is_default}
                  onCheckedChange={(checked) => setForm({ ...form, is_default: checked })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Test Dialog */}
        <CredentialTestDialog
          open={!!testCredential}
          onOpenChange={(open) => !open && setTestCredential(null)}
          credential={testCredential}
        />
      </CardContent>
    </Card>
  );
}
