import { SettingsSection } from "@/components/settings/SettingsSection";
import { AuditLogViewer } from "@/components/settings/AuditLogViewer";
import { Shield, FileText, Key } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { useSshKeys, SshKey } from "@/hooks/useSshKeys";
import { SshKeyTable, SshKeyGenerateDialog, SshKeyDetailsDialog, SshKeyRevokeDialog } from "@/components/settings/ssh";

export function SecuritySettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  // Credential Sets State
  const [credentialSets, setCredentialSets] = useState<any[]>([]);
  const [editingCredential, setEditingCredential] = useState<any | null>(null);
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [testingCredential, setTestingCredential] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testIp, setTestIp] = useState("");
  const [credentialForm, setCredentialForm] = useState({
    name: '',
    username: '',
    password: '',
    description: '',
    priority: 100,
    is_default: false,
    credential_type: 'idrac' as 'idrac' | 'esxi',
  });

  // Scheduled cluster safety checks
  const [scheduledChecksEnabled, setScheduledChecksEnabled] = useState(false);
  const [checkFrequency, setCheckFrequency] = useState('0 */6 * * *');
  const [checkAllClusters, setCheckAllClusters] = useState(true);
  const [minRequiredHosts, setMinRequiredHosts] = useState(2);
  const [notifyOnUnsafeCluster, setNotifyOnUnsafeCluster] = useState(true);
  const [lastScheduledCheck, setLastScheduledCheck] = useState<any>(null);
  const [runningScheduledCheck, setRunningScheduledCheck] = useState(false);
  const [scheduledCheckId, setScheduledCheckId] = useState<string | null>(null);

  // SSH Keys state
  const { sshKeys, isLoading: sshKeysLoading, generateKey, isGenerating, revokeKey, isRevoking, deleteKey, fetchDeployments } = useSshKeys();
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [selectedSshKey, setSelectedSshKey] = useState<SshKey | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);

  useEffect(() => {
    loadCredentialSets();
    loadScheduledCheckConfig();
  }, []);

  const loadCredentialSets = async () => {
    const { data } = await supabase
      .from('credential_sets')
      .select('*')
      .order('priority', { ascending: true });
    if (data) setCredentialSets(data);
  };

  const loadScheduledCheckConfig = async () => {
    const { data } = await supabase
      .from('scheduled_safety_checks')
      .select('*')
      .maybeSingle();
    
    if (data) {
      setScheduledCheckId(data.id);
      setScheduledChecksEnabled(data.enabled || false);
      setCheckFrequency(data.schedule_cron || '0 */6 * * *');
      setCheckAllClusters(data.check_all_clusters || true);
      setMinRequiredHosts(data.min_required_hosts || 2);
      setNotifyOnUnsafeCluster(data.notify_on_unsafe || true);
      setLastScheduledCheck(data);
    }
  };

  const saveScheduledCheckConfig = async () => {
    setLoading(true);
    try {
      const config = {
        enabled: scheduledChecksEnabled,
        schedule_cron: checkFrequency,
        check_all_clusters: checkAllClusters,
        min_required_hosts: minRequiredHosts,
        notify_on_unsafe: notifyOnUnsafeCluster,
      };

      if (scheduledCheckId) {
        await supabase
          .from('scheduled_safety_checks')
          .update(config)
          .eq('id', scheduledCheckId);
      } else {
        const { data } = await supabase
          .from('scheduled_safety_checks')
          .insert([config])
          .select()
          .single();
        if (data) setScheduledCheckId(data.id);
      }

      toast({
        title: "Success",
        description: "Scheduled check configuration saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const runScheduledChecksNow = async () => {
    setRunningScheduledCheck(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke('analyze-maintenance-windows', {
        body: { action: 'run_scheduled_checks' }
      });

      if (error) throw error;

      toast({
        title: "Check Started",
        description: "Running cluster safety checks now",
      });

      setTimeout(() => loadScheduledCheckConfig(), 3000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRunningScheduledCheck(false);
    }
  };

  const handleSaveCredential = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (editingCredential) {
        const updates: any = {
          name: credentialForm.name,
          username: credentialForm.username,
          description: credentialForm.description,
          priority: credentialForm.priority,
          is_default: credentialForm.is_default,
        };

        if (credentialForm.password) {
          const { data: encrypted } = await supabase.functions.invoke('encrypt-credentials', {
            body: { password: credentialForm.password }
          });
          updates.password_encrypted = encrypted.encrypted;
        }

        await supabase
          .from('credential_sets')
          .update(updates)
          .eq('id', editingCredential.id);
      } else {
        const { data: encrypted } = await supabase.functions.invoke('encrypt-credentials', {
          body: { password: credentialForm.password }
        });

        await supabase.from('credential_sets').insert([{
          name: credentialForm.name,
          username: credentialForm.username,
          password_encrypted: encrypted.encrypted,
          description: credentialForm.description,
          priority: credentialForm.priority,
          is_default: credentialForm.is_default,
          credential_type: credentialForm.credential_type,
        }]);
      }

      toast({
        title: "Success",
        description: `Credential set ${editingCredential ? 'updated' : 'created'}`,
      });

      setShowCredentialDialog(false);
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestCredential = async (cred: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: testIp },
          credential_set_ids: [cred.id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (jobError) throw jobError;

      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setTestingCredential(null);
          toast({
            title: "Connection Successful",
            description: "Credentials are valid",
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setTestingCredential(null);
          toast({
            title: "Connection Failed",
            description: (updatedJob.details as any)?.message || 'Connection failed',
            variant: "destructive",
          });
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(pollInterval);
        if (testingCredential === cred.id) {
          setTestingCredential(null);
          toast({
            title: "Test Timed Out",
            description: "Job Executor may not be running",
            variant: "destructive",
          });
        }
      }, 30000);

    } catch (error: any) {
      setTestingCredential(null);
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Credentials */}
      <SettingsSection
        id="credentials"
        title="Credentials"
        description="Manage iDRAC and ESXi credential sets with IP range auto-assignment"
        icon={Shield}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="text-sm font-medium">Credential Sets</h4>
              <p className="text-sm text-muted-foreground">
                Create reusable credential sets for iDRAC and ESXi servers
              </p>
            </div>
            <Button onClick={() => {
              setEditingCredential(null);
              setCredentialForm({
                name: '',
                username: '',
                password: '',
                description: '',
                priority: 100,
                is_default: false,
                credential_type: 'idrac',
              });
              setShowCredentialDialog(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Credential Set
            </Button>
          </div>

          {credentialSets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  No credential sets configured. Add your first credential set to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {credentialSets.map((cred) => (
                <Card key={cred.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{cred.name}</h4>
                          {cred.is_default && (
                            <Badge variant="secondary">Default</Badge>
                          )}
                          <Badge variant="outline">
                            {cred.credential_type === 'idrac' ? 'iDRAC' : 'ESXi'}
                          </Badge>
                        </div>
                        {cred.description && (
                          <p className="text-sm text-muted-foreground mb-2">{cred.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>Username: {cred.username}</span>
                          <span>Priority: {cred.priority}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingCredential(cred);
                            setCredentialForm({
                              name: cred.name,
                              username: cred.username,
                              password: '',
                              description: cred.description || '',
                              priority: cred.priority || 100,
                              is_default: cred.is_default || false,
                              credential_type: cred.credential_type,
                            });
                            setShowCredentialDialog(true);
                          }}
                        >
                          Edit
                        </Button>
                        {testingCredential === cred.id ? (
                          <Button variant="outline" size="sm" disabled>
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setTestingCredential(cred.id);
                              setTestIp("");
                            }}
                          >
                            Test
                          </Button>
                        )}
                        {deleteConfirmId === cred.id ? (
                          <div className="flex gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={async () => {
                                const { error } = await supabase
                                  .from('credential_sets')
                                  .delete()
                                  .eq('id', cred.id);

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
                                  loadCredentialSets();
                                }
                                setDeleteConfirmId(null);
                              }}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(cred.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {testingCredential === cred.id && (
                      <div className="mt-3 pt-3 border-t">
                        <Label htmlFor={`test-ip-${cred.id}`}>Test IP Address</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            id={`test-ip-${cred.id}`}
                            placeholder="192.168.1.100"
                            value={testIp}
                            onChange={(e) => setTestIp(e.target.value)}
                          />
                          <Button
                            onClick={async () => {
                              if (!testIp) {
                                toast({
                                  title: "IP Required",
                                  description: "Enter an IP address to test",
                                  variant: "destructive",
                                });
                                return;
                              }
                              await handleTestCredential(cred);
                            }}
                          >
                            Test Connection
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setTestingCredential(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Audit Logs */}
      <SettingsSection
        id="audit-logs"
        title="Audit Logs"
        description="Track user actions and system events"
        icon={FileText}
      >
        <AuditLogViewer />
      </SettingsSection>

      {/* Cluster Safety Checks */}
      <SettingsSection
        id="operations-safety"
        title="Operations Safety"
        description="Configure scheduled cluster health checks and emergency controls"
        icon={Shield}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Scheduled Checks</Label>
              <p className="text-sm text-muted-foreground">
                Automatically run cluster safety checks on a schedule
              </p>
            </div>
            <Switch
              checked={scheduledChecksEnabled}
              onCheckedChange={setScheduledChecksEnabled}
            />
          </div>

          {scheduledChecksEnabled && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label>Check Frequency (Cron Expression)</Label>
                <Input
                  placeholder="0 */6 * * *"
                  value={checkFrequency}
                  onChange={(e) => setCheckFrequency(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Examples: "0 */6 * * *" (every 6 hours), "0 0 * * *" (daily at midnight)
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Label>Check All Clusters</Label>
                <Switch
                  checked={checkAllClusters}
                  onCheckedChange={setCheckAllClusters}
                />
              </div>

              <div className="space-y-2">
                <Label>Minimum Required Hosts</Label>
                <Input
                  type="number"
                  value={minRequiredHosts}
                  onChange={(e) => setMinRequiredHosts(parseInt(e.target.value) || 2)}
                  min={1}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Notify on Unsafe Cluster</Label>
                <Switch
                  checked={notifyOnUnsafeCluster}
                  onCheckedChange={setNotifyOnUnsafeCluster}
                />
              </div>

              {lastScheduledCheck && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Last check: {new Date(lastScheduledCheck.last_run_at).toLocaleString()} - {lastScheduledCheck.last_status}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button onClick={saveScheduledCheckConfig} disabled={loading}>
                  {loading ? "Saving..." : "Save Schedule"}
                </Button>
                <Button
                  variant="outline"
                  onClick={runScheduledChecksNow}
                  disabled={runningScheduledCheck}
                >
                  {runningScheduledCheck ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    'Run Check Now'
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* SSH Keys */}
      <SettingsSection
        id="ssh-keys"
        title="SSH Keys"
        description="Manage SSH key pairs for secure infrastructure access"
        icon={Key}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="text-sm font-medium">SSH Key Inventory</h4>
              <p className="text-sm text-muted-foreground">
                Centralized SSH key management for ZFS targets and replication
              </p>
            </div>
            <Button onClick={() => setShowGenerateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Generate Key
            </Button>
          </div>

          <SshKeyTable
            keys={sshKeys}
            isLoading={sshKeysLoading}
            onViewDetails={(key) => {
              setSelectedSshKey(key);
              setShowDetailsDialog(true);
            }}
            onRevoke={(key) => {
              setSelectedSshKey(key);
              setShowRevokeDialog(true);
            }}
            onDelete={async (key) => {
              if (confirm(`Delete SSH key "${key.name}"? This cannot be undone.`)) {
                await deleteKey(key.id);
              }
            }}
          />
        </div>
      </SettingsSection>

      {/* SSH Key Dialogs */}
      <SshKeyGenerateDialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
        onGenerate={generateKey}
        isGenerating={isGenerating}
      />

      <SshKeyDetailsDialog
        open={showDetailsDialog}
        onOpenChange={setShowDetailsDialog}
        sshKey={selectedSshKey}
        fetchDeployments={fetchDeployments}
      />

      <SshKeyRevokeDialog
        open={showRevokeDialog}
        onOpenChange={setShowRevokeDialog}
        sshKey={selectedSshKey}
        onRevoke={revokeKey}
        isRevoking={isRevoking}
      />

      {/* Credential Dialog */}
      <Dialog open={showCredentialDialog} onOpenChange={setShowCredentialDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingCredential ? 'Edit' : 'Add'} Credential Set
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={credentialForm.credential_type}
                onValueChange={(v: 'idrac' | 'esxi') => setCredentialForm({ ...credentialForm, credential_type: v })}
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
                value={credentialForm.name}
                onChange={(e) => setCredentialForm({ ...credentialForm, name: e.target.value })}
                placeholder="Production iDRAC"
              />
            </div>
            <div className="space-y-2">
              <Label>Username</Label>
              <Input
                value={credentialForm.username}
                onChange={(e) => setCredentialForm({ ...credentialForm, username: e.target.value })}
                placeholder="root"
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={credentialForm.password}
                onChange={(e) => setCredentialForm({ ...credentialForm, password: e.target.value })}
                placeholder={editingCredential ? "Leave blank to keep current" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={credentialForm.description}
                onChange={(e) => setCredentialForm({ ...credentialForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Input
                type="number"
                value={credentialForm.priority}
                onChange={(e) => setCredentialForm({ ...credentialForm, priority: parseInt(e.target.value) || 100 })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Set as Default</Label>
              <Switch
                checked={credentialForm.is_default}
                onCheckedChange={(checked) => setCredentialForm({ ...credentialForm, is_default: checked })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCredentialDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCredential} disabled={loading}>
                {loading ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
