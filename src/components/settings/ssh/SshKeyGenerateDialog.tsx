import { useState, useCallback, useEffect, useRef } from 'react';
import { Key, Copy, Calendar, Loader2, AlertCircle } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input when dialog opens
  useEffect(() => {
    if (open && !generatedKey) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [open, generatedKey]);

  const validateForm = useCallback(() => {
    if (!name.trim()) {
      return 'Key name is required';
    }
    if (name.trim().length < 3) {
      return 'Key name must be at least 3 characters';
    }
    if (name.trim().length > 100) {
      return 'Key name must be less than 100 characters';
    }
    if (hasExpiration && !expiresAt) {
      return 'Please select an expiration date';
    }
    if (hasExpiration && expiresAt) {
      const expDate = new Date(expiresAt);
      if (expDate <= new Date()) {
        return 'Expiration date must be in the future';
      }
    }
    return null;
  }, [name, hasExpiration, expiresAt]);

  const handleGenerate = useCallback(async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
      return;
    }

    setError(null);

    try {
      const result = await onGenerate({
        name: name.trim(),
        description: description.trim() || undefined,
        expiresAt: hasExpiration && expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setGeneratedKey(result.publicKey);
      toast.success('SSH key generated successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate key';
      setError(message);
      console.error('Failed to generate key:', err);
    }
  }, [name, description, hasExpiration, expiresAt, onGenerate, validateForm]);

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setHasExpiration(false);
    setExpiresAt('');
    setGeneratedKey(null);
    setError(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const copyPublicKey = useCallback(() => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey).then(() => {
        toast.success('Public key copied to clipboard');
      }).catch(() => {
        toast.error('Failed to copy public key');
      });
    }
  }, [generatedKey]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !generatedKey && name.trim()) {
      e.preventDefault();
      handleGenerate();
    }
  }, [generatedKey, name, handleGenerate]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent 
        className="sm:max-w-[500px]"
        onKeyDown={handleKeyDown}
        aria-describedby="generate-dialog-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" aria-hidden="true" />
            Generate SSH Key
          </DialogTitle>
          <DialogDescription id="generate-dialog-description">
            Generate a new Ed25519 SSH key pair for secure infrastructure access.
          </DialogDescription>
        </DialogHeader>

        {!generatedKey ? (
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">
                Key Name <span className="text-destructive">*</span>
              </Label>
              <Input
                ref={nameInputRef}
                id="name"
                placeholder="e.g., Production ZFS Backup Key"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isGenerating}
                aria-required="true"
                aria-invalid={!!error && !name.trim()}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Choose a descriptive name to identify this key's purpose
              </p>
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
                maxLength={500}
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
                aria-describedby="expiration-description"
              />
            </div>

            {hasExpiration && (
              <div className="space-y-2">
                <Label htmlFor="expiresAt">Expiration Date</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="expiresAt"
                    type="date"
                    className="pl-10"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    disabled={isGenerating}
                    aria-required={hasExpiration}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <AlertDescription>
                <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                  Key Generated Successfully!
                </p>
                <p className="text-xs text-green-700 dark:text-green-300">
                  Copy the public key below to add to your target systems' authorized_keys file.
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="publicKey">Public Key</Label>
              <div className="relative">
                <Textarea
                  id="publicKey"
                  value={generatedKey}
                  readOnly
                  rows={4}
                  className="font-mono text-xs pr-10"
                  aria-label="Generated public key"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-8 w-8"
                  onClick={copyPublicKey}
                  aria-label="Copy public key to clipboard"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
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
              <Button 
                onClick={handleGenerate} 
                disabled={isGenerating || !name.trim()}
                aria-busy={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Generating...
                  </>
                ) : (
                  'Generate Key'
                )}
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
