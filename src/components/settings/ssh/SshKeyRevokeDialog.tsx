import { useState, useEffect } from 'react';
import { AlertTriangle, Ban, Loader2, CheckCircle, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { SshKey, SshKeyDeployment } from '@/hooks/useSshKeys';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SshKeyRevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sshKey: SshKey | null;
  onRevoke: (params: { keyId: string; reason: string; hardRevoke: boolean }) => Promise<unknown>;
  isRevoking: boolean;
  fetchDeployments?: (keyId: string) => Promise<SshKeyDeployment[]>;
  removeFromTargets?: (params: { keyId: string; targetIds: string[] }) => Promise<unknown>;
}

interface RemovalResult {
  targetId: string;
  targetName: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
}

export function SshKeyRevokeDialog({
  open,
  onOpenChange,
  sshKey,
  onRevoke,
  isRevoking,
  fetchDeployments,
  removeFromTargets,
}: SshKeyRevokeDialogProps) {
  const [reason, setReason] = useState('');
  const [revokeType, setRevokeType] = useState<'soft' | 'hard'>('soft');
  const [showConfirm, setShowConfirm] = useState(false);
  const [deployments, setDeployments] = useState<SshKeyDeployment[]>([]);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const [removalJobId, setRemovalJobId] = useState<string | null>(null);
  const [removalResults, setRemovalResults] = useState<RemovalResult[]>([]);
  const [isRemovingFromTargets, setIsRemovingFromTargets] = useState(false);

  // Load deployments when dialog opens
  useEffect(() => {
    if (open && sshKey && fetchDeployments) {
      setIsLoadingDeployments(true);
      fetchDeployments(sshKey.id)
        .then((deps) => {
          setDeployments(deps.filter(d => d.status === 'deployed'));
        })
        .finally(() => setIsLoadingDeployments(false));
    }
  }, [open, sshKey, fetchDeployments]);

  // Poll job status for hard revoke
  useEffect(() => {
    if (!removalJobId) return;

    const pollInterval = setInterval(async () => {
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', removalJobId)
        .single();

      if (job?.status === 'completed') {
        clearInterval(pollInterval);
        setIsRemovingFromTargets(false);
        
        // Update results based on job details
        const details = job.details as any;
        if (details?.results) {
          setRemovalResults(prev => prev.map(r => {
            const result = details.results.find((jr: any) => jr.target_id === r.targetId);
            if (result) {
              return {
                ...r,
                status: result.success ? 'success' : 'failed',
                error: result.error,
              };
            }
            return r;
          }));
        } else {
          // Assume all succeeded if no details
          setRemovalResults(prev => prev.map(r => ({ ...r, status: 'success' })));
        }
        
        // Now complete the soft revoke
        await onRevoke({
          keyId: sshKey!.id,
          reason: reason.trim(),
          hardRevoke: false, // Already removed, just mark as revoked
        });
        
        toast.success('Key revoked and removed from all targets');
        handleClose();
      } else if (job?.status === 'failed') {
        clearInterval(pollInterval);
        setIsRemovingFromTargets(false);
        
        const details = job.details as any;
        if (details?.results) {
          setRemovalResults(prev => prev.map(r => {
            const result = details.results.find((jr: any) => jr.target_id === r.targetId);
            if (result) {
              return {
                ...r,
                status: result.success ? 'success' : 'failed',
                error: result.error,
              };
            }
            return { ...r, status: 'failed', error: details.message || 'Unknown error' };
          }));
        }
        
        toast.error('Some targets failed to remove key. Check results below.');
      }
    }, 2000);

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      setIsRemovingFromTargets(false);
      toast.error('Key removal timed out');
    }, 120000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [removalJobId, sshKey, reason, onRevoke]);

  const handleRevoke = async () => {
    if (!sshKey) return;
    if (!reason.trim()) {
      toast.error('Please provide a reason for revocation');
      return;
    }

    setShowConfirm(true);
  };

  const confirmRevoke = async () => {
    if (!sshKey) return;
    setShowConfirm(false);

    if (revokeType === 'hard' && deployments.length > 0 && removeFromTargets) {
      // Start hard revoke - remove from all targets first
      setIsRemovingFromTargets(true);
      const targetIds = deployments.map(d => d.replication_target_id || d.zfs_template_id).filter(Boolean) as string[];
      setRemovalResults(deployments.map(d => ({
        targetId: d.replication_target_id || d.zfs_template_id || d.id,
        targetName: d.replication_target_id || d.zfs_template_id || 'Unknown target',
        status: 'pending' as const,
      })));

      try {
        const result = await removeFromTargets({
          keyId: sshKey.id,
          targetIds,
        }) as { jobId?: string };
        
        if (result?.jobId) {
          setRemovalJobId(result.jobId);
        } else {
          // No job created, just do soft revoke
          await onRevoke({
            keyId: sshKey.id,
            reason: reason.trim(),
            hardRevoke: true,
          });
          handleClose();
        }
      } catch (error) {
        console.error('Failed to start key removal:', error);
        setIsRemovingFromTargets(false);
        toast.error('Failed to start key removal');
      }
    } else {
      // Soft revoke
      try {
        await onRevoke({
          keyId: sshKey.id,
          reason: reason.trim(),
          hardRevoke: false,
        });
        handleClose();
      } catch (error) {
        console.error('Failed to revoke key:', error);
      }
    }
  };

  const handleClose = () => {
    setReason('');
    setRevokeType('soft');
    setShowConfirm(false);
    setDeployments([]);
    setRemovalJobId(null);
    setRemovalResults([]);
    setIsRemovingFromTargets(false);
    onOpenChange(false);
  };

  if (!sshKey) return null;

  const completedCount = removalResults.filter(r => r.status !== 'pending').length;
  const progress = removalResults.length > 0 ? (completedCount / removalResults.length) * 100 : 0;

  return (
    <>
      <Dialog open={open && !showConfirm && !isRemovingFromTargets} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <Ban className="h-5 w-5" />
              Revoke SSH Key
            </DialogTitle>
            <DialogDescription>
              Revoking a key will prevent it from being used for future operations.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Key Info */}
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="font-medium">{sshKey.name}</p>
              <code className="text-xs text-muted-foreground">
                {sshKey.public_key_fingerprint}
              </code>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Revocation *</Label>
              <Textarea
                id="reason"
                placeholder="e.g., Key compromised, rotation policy, no longer needed..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isRevoking}
                rows={3}
              />
            </div>

            {/* Revoke Type */}
            <div className="space-y-3">
              <Label>Revocation Type</Label>
              <RadioGroup
                value={revokeType}
                onValueChange={(value) => setRevokeType(value as 'soft' | 'hard')}
                disabled={isRevoking || isLoadingDeployments}
              >
                <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                  <RadioGroupItem value="soft" id="soft" className="mt-1" />
                  <div className="space-y-1">
                    <Label htmlFor="soft" className="font-medium cursor-pointer">
                      Soft Revoke
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Mark the key as revoked in the database. The key will remain on target systems
                      until manually removed.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                  <RadioGroupItem value="hard" id="hard" className="mt-1" disabled={!removeFromTargets} />
                  <div className="space-y-1">
                    <Label htmlFor="hard" className="font-medium cursor-pointer">
                      Hard Revoke
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Mark as revoked AND remove the public key from all deployed target systems via SSH.
                      {isLoadingDeployments ? (
                        <span className="flex items-center gap-1 mt-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading deployments...
                        </span>
                      ) : deployments.length > 0 ? (
                        <span className="block mt-1 text-amber-600">
                          Will remove from {deployments.length} target{deployments.length > 1 ? 's' : ''}.
                        </span>
                      ) : (
                        <span className="block mt-1 text-muted-foreground">
                          No active deployments found.
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-200">
                <p className="font-medium">This action cannot be undone.</p>
                <p>Any operations using this key will fail after revocation.</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={isRevoking}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={isRevoking || !reason.trim()}
            >
              {isRevoking ? 'Revoking...' : 'Revoke Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hard Revoke Progress Dialog */}
      <Dialog open={isRemovingFromTargets} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Removing Key from Targets
            </DialogTitle>
            <DialogDescription>
              Removing SSH key from {removalResults.length} target{removalResults.length > 1 ? 's' : ''}...
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground text-center">
              {completedCount} of {removalResults.length} completed
            </p>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {removalResults.map((result) => (
                <div
                  key={result.targetId}
                  className="flex items-center justify-between p-2 bg-muted/50 rounded"
                >
                  <span className="text-sm">{result.targetName}</span>
                  {result.status === 'pending' && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {result.status === 'success' && (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  )}
                  {result.status === 'failed' && (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Key Revocation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke the SSH key "{sshKey.name}"?
              {revokeType === 'hard' && deployments.length > 0 && (
                <span className="block mt-2">
                  The system will attempt to remove it from {deployments.length} deployed target{deployments.length > 1 ? 's' : ''}.
                </span>
              )}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? 'Revoking...' : 'Revoke Key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
