import { useState, useEffect } from 'react';
import { Key, Copy, Calendar, Clock, User, Hash, Shield, Activity } from 'lucide-react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { SshKey, SshKeyDeployment } from '@/hooks/useSshKeys';

interface SshKeyDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sshKey: SshKey | null;
  fetchDeployments: (keyId: string) => Promise<SshKeyDeployment[]>;
}

export function SshKeyDetailsDialog({
  open,
  onOpenChange,
  sshKey,
  fetchDeployments,
}: SshKeyDetailsDialogProps) {
  const [deployments, setDeployments] = useState<SshKeyDeployment[]>([]);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);

  useEffect(() => {
    if (open && sshKey) {
      loadDeployments();
    }
  }, [open, sshKey?.id]);

  const loadDeployments = async () => {
    if (!sshKey) return;
    setIsLoadingDeployments(true);
    try {
      const data = await fetchDeployments(sshKey.id);
      setDeployments(data);
    } catch (error) {
      console.error('Failed to load deployments:', error);
    } finally {
      setIsLoadingDeployments(false);
    }
  };

  const copyPublicKey = () => {
    if (sshKey) {
      navigator.clipboard.writeText(sshKey.public_key);
      toast.success('Public key copied to clipboard');
    }
  };

  const getStatusColor = (status: SshKey['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-600';
      case 'pending':
        return 'bg-yellow-600';
      case 'revoked':
        return 'bg-red-600';
      case 'expired':
        return 'bg-amber-600';
      default:
        return 'bg-gray-600';
    }
  };

  if (!sshKey) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {sshKey.name}
          </DialogTitle>
          <DialogDescription>
            SSH key details and deployment information
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Status and Key Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div>
                <Badge className={getStatusColor(sshKey.status)}>
                  {sshKey.status.charAt(0).toUpperCase() + sshKey.status.slice(1)}
                </Badge>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Key Type</Label>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-sm">{sshKey.key_type}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          {sshKey.description && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <p className="text-sm">{sshKey.description}</p>
            </div>
          )}

          {/* Fingerprint */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Hash className="h-3 w-3" />
              Fingerprint
            </Label>
            <code className="block text-xs bg-muted px-3 py-2 rounded font-mono break-all">
              {sshKey.public_key_fingerprint}
            </code>
          </div>

          {/* Public Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Public Key</Label>
              <Button variant="ghost" size="sm" onClick={copyPublicKey}>
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
            </div>
            <Textarea
              value={sshKey.public_key}
              readOnly
              rows={3}
              className="font-mono text-xs"
            />
          </div>

          <Separator />

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Created
              </Label>
              <p className="text-sm">{format(new Date(sshKey.created_at), 'PPp')}</p>
            </div>
            {sshKey.activated_at && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Activated
                </Label>
                <p className="text-sm">{format(new Date(sshKey.activated_at), 'PPp')}</p>
              </div>
            )}
            {sshKey.expires_at && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Expires</Label>
                <p className="text-sm">{format(new Date(sshKey.expires_at), 'PPp')}</p>
              </div>
            )}
            {sshKey.revoked_at && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground text-red-600">Revoked</Label>
                <p className="text-sm text-red-600">{format(new Date(sshKey.revoked_at), 'PPp')}</p>
              </div>
            )}
          </div>

          {/* Revocation Reason */}
          {sshKey.revocation_reason && (
            <div className="space-y-1 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <Label className="text-xs text-red-700 dark:text-red-300">Revocation Reason</Label>
              <p className="text-sm text-red-800 dark:text-red-200">{sshKey.revocation_reason}</p>
            </div>
          )}

          {/* Usage Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Activity className="h-3 w-3" />
                Total Uses
              </Label>
              <p className="text-lg font-semibold">{sshKey.use_count}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Last Used</Label>
              <p className="text-sm">
                {sshKey.last_used_at
                  ? format(new Date(sshKey.last_used_at), 'PPp')
                  : 'Never'}
              </p>
            </div>
          </div>

          <Separator />

          {/* Deployments */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Deployments</Label>
            {isLoadingDeployments ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : deployments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deployments for this key</p>
            ) : (
              <div className="space-y-2">
                {deployments.map((deployment) => (
                  <div
                    key={deployment.id}
                    className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2"
                  >
                    <div className="text-sm">
                      {deployment.replication_target_id && 'Replication Target'}
                      {deployment.zfs_template_id && 'ZFS Template'}
                    </div>
                    <Badge variant={deployment.status === 'verified' ? 'default' : 'secondary'}>
                      {deployment.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
