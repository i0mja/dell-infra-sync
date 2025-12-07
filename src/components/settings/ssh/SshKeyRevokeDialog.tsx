import { useState } from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
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
import { SshKey } from '@/hooks/useSshKeys';
import { toast } from 'sonner';

interface SshKeyRevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sshKey: SshKey | null;
  onRevoke: (params: { keyId: string; reason: string; hardRevoke: boolean }) => Promise<unknown>;
  isRevoking: boolean;
}

export function SshKeyRevokeDialog({
  open,
  onOpenChange,
  sshKey,
  onRevoke,
  isRevoking,
}: SshKeyRevokeDialogProps) {
  const [reason, setReason] = useState('');
  const [revokeType, setRevokeType] = useState<'soft' | 'hard'>('soft');
  const [showConfirm, setShowConfirm] = useState(false);

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

    try {
      await onRevoke({
        keyId: sshKey.id,
        reason: reason.trim(),
        hardRevoke: revokeType === 'hard',
      });
      handleClose();
    } catch (error) {
      console.error('Failed to revoke key:', error);
    }
  };

  const handleClose = () => {
    setReason('');
    setRevokeType('soft');
    setShowConfirm(false);
    onOpenChange(false);
  };

  if (!sshKey) return null;

  return (
    <>
      <Dialog open={open && !showConfirm} onOpenChange={handleClose}>
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
                disabled={isRevoking}
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
                  <RadioGroupItem value="hard" id="hard" className="mt-1" />
                  <div className="space-y-1">
                    <Label htmlFor="hard" className="font-medium cursor-pointer">
                      Hard Revoke
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Mark as revoked AND attempt to remove the public key from all deployed target
                      systems via SSH. (Phase 2 feature)
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

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Key Revocation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke the SSH key "{sshKey.name}"?
              {revokeType === 'hard' && ' The system will attempt to remove it from all deployed targets.'}
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
