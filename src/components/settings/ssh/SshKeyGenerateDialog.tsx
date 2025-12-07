import { useState } from 'react';
import { Key, Copy, Calendar } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface SshKeyGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (params: { name: string; description?: string; expiresAt?: string }) => Promise<{ publicKey: string }>;
  isGenerating: boolean;
}

export function SshKeyGenerateDialog({
  open,
  onOpenChange,
  onGenerate,
  isGenerating,
}: SshKeyGenerateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hasExpiration, setHasExpiration] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!name.trim()) {
      toast.error('Please enter a key name');
      return;
    }

    try {
      const result = await onGenerate({
        name: name.trim(),
        description: description.trim() || undefined,
        expiresAt: hasExpiration && expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setGeneratedKey(result.publicKey);
    } catch (error) {
      console.error('Failed to generate key:', error);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setHasExpiration(false);
    setExpiresAt('');
    setGeneratedKey(null);
    onOpenChange(false);
  };

  const copyPublicKey = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      toast.success('Public key copied to clipboard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Generate SSH Key
          </DialogTitle>
          <DialogDescription>
            Generate a new Ed25519 SSH key pair for secure infrastructure access.
          </DialogDescription>
        </DialogHeader>

        {!generatedKey ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Key Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Production ZFS Backup Key"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isGenerating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Optional description of this key's purpose"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isGenerating}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="expiration">Set Expiration Date</Label>
                <p className="text-xs text-muted-foreground">
                  Key will be marked as expired after this date
                </p>
              </div>
              <Switch
                id="expiration"
                checked={hasExpiration}
                onCheckedChange={setHasExpiration}
                disabled={isGenerating}
              />
            </div>

            {hasExpiration && (
              <div className="space-y-2">
                <Label htmlFor="expiresAt">Expiration Date</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="expiresAt"
                    type="date"
                    className="pl-10"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    disabled={isGenerating}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                Key Generated Successfully!
              </p>
              <p className="text-xs text-green-700 dark:text-green-300">
                Copy the public key below to add to your target systems' authorized_keys file.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Public Key</Label>
              <div className="relative">
                <Textarea
                  value={generatedKey}
                  readOnly
                  rows={4}
                  className="font-mono text-xs pr-10"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-8 w-8"
                  onClick={copyPublicKey}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The private key is securely encrypted and stored. You don't need to save it manually.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!generatedKey ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={isGenerating || !name.trim()}>
                {isGenerating ? 'Generating...' : 'Generate Key'}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
