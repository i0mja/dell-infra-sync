import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Server, CheckCircle2, XCircle, AlertTriangle, Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SshKey } from "@/hooks/useSshKeys";

interface ReplicationTarget {
  id: string;
  name: string;
  hostname: string;
  port: number;
  ssh_username: string;
  health_status: string;
  ssh_key_id: string | null;
}

interface DeploymentResult {
  target_id: string;
  hostname: string;
  success: boolean;
  error?: string;
  message?: string;
}

interface SshKeyDeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sshKey: SshKey | null;
  onDeployComplete?: () => void;
}

export function SshKeyDeployDialog({ open, onOpenChange, sshKey, onDeployComplete }: SshKeyDeployDialogProps) {
  const [targets, setTargets] = useState<ReplicationTarget[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [adminPassword, setAdminPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResults, setDeploymentResults] = useState<DeploymentResult[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadTargets();
      setSelectedTargets([]);
      setDeploymentResults(null);
      setAdminPassword("");
      setJobId(null);
    }
  }, [open]);

  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;

    if (jobId && isDeploying) {
      pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', jobId)
          .single();

        if (job) {
          if (job.status === 'completed' || job.status === 'failed') {
            setIsDeploying(false);
            const details = job.details as { results?: DeploymentResult[]; message?: string };
            setDeploymentResults(details?.results || []);
            
            if (job.status === 'completed') {
              toast.success(details?.message || 'Deployment completed');
              onDeployComplete?.();
            } else {
              toast.error('Deployment failed');
            }
            
            if (pollInterval) clearInterval(pollInterval);
          }
        }
      }, 2000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [jobId, isDeploying, onDeployComplete]);

  const loadTargets = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('replication_targets')
        .select('id, name, hostname, port, ssh_username, health_status, ssh_key_id')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTargets(data || []);
    } catch (error) {
      console.error('Failed to load targets:', error);
      toast.error('Failed to load targets');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (!sshKey || selectedTargets.length === 0) return;

    setIsDeploying(true);
    setDeploymentResults(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Encrypt password before storing in job details
      let encryptedPassword: string | undefined;
      if (adminPassword) {
        const { data: encryptData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            password: adminPassword,
            type: 'return_only'
          }
        });
        if (encryptError) throw encryptError;
        encryptedPassword = encryptData?.encrypted;
      }

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_deploy',
          status: 'pending',
          created_by: user.id,
          details: {
            ssh_key_id: sshKey.id,
            target_ids: selectedTargets,
            admin_password_encrypted: encryptedPassword,
          },
        })
        .select()
        .single();

      if (error) throw error;

      setJobId(job.id);
      toast.info('Deployment job created');
    } catch (error) {
      console.error('Failed to create deploy job:', error);
      toast.error('Failed to start deployment');
      setIsDeploying(false);
    }
  };

  const toggleTarget = (targetId: string) => {
    setSelectedTargets(prev =>
      prev.includes(targetId)
        ? prev.filter(id => id !== targetId)
        : [...prev, targetId]
    );
  };

  const selectAll = () => {
    if (selectedTargets.length === targets.length) {
      setSelectedTargets([]);
    } else {
      setSelectedTargets(targets.map(t => t.id));
    }
  };

  const getResultForTarget = (targetId: string) => {
    return deploymentResults?.find(r => r.target_id === targetId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Deploy SSH Key
          </DialogTitle>
          <DialogDescription>
            Deploy "{sshKey?.name}" to selected replication targets
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Key Info */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="text-sm">
              <span className="text-muted-foreground">Fingerprint: </span>
              <code className="text-xs">{sshKey?.public_key_fingerprint}</code>
            </div>
          </div>

          {/* Admin Password (optional) */}
          <div className="space-y-2">
            <Label htmlFor="admin-password">Admin Password (optional)</Label>
            <Input
              id="admin-password"
              type="password"
              placeholder="For targets without existing SSH keys"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              disabled={isDeploying}
            />
            <p className="text-xs text-muted-foreground">
              Required for initial deployment to targets that don't have SSH keys configured yet
            </p>
          </div>

          {/* Target Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select Targets</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                disabled={isLoading || isDeploying}
              >
                {selectedTargets.length === targets.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : targets.length === 0 ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No active replication targets found. Configure targets in DR/Replication settings first.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                {targets.map((target) => {
                  const result = getResultForTarget(target.id);
                  const isSelected = selectedTargets.includes(target.id);
                  const alreadyHasKey = target.ssh_key_id === sshKey?.id;

                  return (
                    <div
                      key={target.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isSelected ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id={target.id}
                          checked={isSelected}
                          onCheckedChange={() => toggleTarget(target.id)}
                          disabled={isDeploying || alreadyHasKey}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{target.name}</span>
                            {alreadyHasKey && (
                              <Badge variant="secondary" className="text-xs">Already deployed</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {target.ssh_username}@{target.hostname}:{target.port}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant={target.health_status === 'healthy' ? 'default' : 'secondary'}
                        >
                          {target.health_status}
                        </Badge>
                        {result && (
                          result.success ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Deployment Results */}
          {deploymentResults && deploymentResults.length > 0 && (
            <Alert>
              <AlertDescription>
                <div className="space-y-1">
                  {deploymentResults.map((result, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span>{result.hostname}:</span>
                      <span className={result.success ? 'text-green-600' : 'text-destructive'}>
                        {result.message || result.error || (result.success ? 'Success' : 'Failed')}
                      </span>
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeploying}>
            {deploymentResults ? 'Close' : 'Cancel'}
          </Button>
          {!deploymentResults && (
            <Button
              onClick={handleDeploy}
              disabled={selectedTargets.length === 0 || isDeploying}
            >
              {isDeploying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                `Deploy to ${selectedTargets.length} Target${selectedTargets.length !== 1 ? 's' : ''}`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
