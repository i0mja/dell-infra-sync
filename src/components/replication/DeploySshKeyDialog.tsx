import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Key, Loader2, Server, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSshKeys, SshKey } from "@/hooks/useSshKeys";

interface DeploySshKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: {
    id: string;
    name: string;
    hostname: string;
    ssh_key_id?: string | null;
  } | null;
  onDeployComplete?: () => void;
}

export function DeploySshKeyDialog({
  open,
  onOpenChange,
  target,
  onDeployComplete,
}: DeploySshKeyDialogProps) {
  const { toast } = useToast();
  const { sshKeys, isLoading: loadingKeys } = useSshKeys();
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState("");
  const [deploying, setDeploying] = useState(false);

  // Available SSH keys (active or pending)
  const availableKeys = sshKeys?.filter(k => k.status === 'active' || k.status === 'pending') || [];

  // Pre-select the assigned key if one exists
  useEffect(() => {
    if (open && target?.ssh_key_id) {
      setSelectedKeyId(target.ssh_key_id);
    } else if (open) {
      setSelectedKeyId("");
    }
    setAdminPassword("");
  }, [open, target?.ssh_key_id]);

  const selectedKey = availableKeys.find(k => k.id === selectedKeyId);

  const handleDeploy = async () => {
    if (!target || !selectedKeyId) return;

    setDeploying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Encrypt password before storing in job details
      let encryptedPassword: string | undefined;
      if (adminPassword) {
        const { data: encryptData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: { password: adminPassword, type: 'return_only' }
        });
        if (encryptError) throw encryptError;
        encryptedPassword = encryptData?.encrypted;
      }

      // Create ssh_key_deploy job
      const { error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_deploy' as any,
          status: 'pending',
          created_by: user?.id,
          details: {
            ssh_key_id: selectedKeyId,
            target_ids: [target.id],
            admin_password_encrypted: encryptedPassword,
            force: true,
          },
        });

      if (error) throw error;

      toast({
        title: "SSH key deploy job created",
        description: `Deploying "${selectedKey?.name || 'key'}" to ${target.name}`,
      });

      onOpenChange(false);
      onDeployComplete?.();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDeploying(false);
    }
  };

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Deploy SSH Key
          </DialogTitle>
          <DialogDescription>
            Deploy an SSH public key to enable passwordless authentication
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Target info */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{target.name}</span>
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {target.hostname}
            </div>
          </div>

          {/* Key selection */}
          <div className="space-y-2">
            <Label>SSH Key to Deploy</Label>
            <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select SSH key..." />
              </SelectTrigger>
              <SelectContent>
                {loadingKeys ? (
                  <div className="flex items-center justify-center p-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : availableKeys.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">
                    No SSH keys available. Create one in Settings → SSH Keys.
                  </div>
                ) : (
                  availableKeys.map(key => (
                    <SelectItem key={key.id} value={key.id}>
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        {key.name}
                        <Badge variant={key.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                          {key.status}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Admin password */}
          <div className="space-y-2">
            <Label htmlFor="admin-password">Root/Admin Password</Label>
            <Input
              id="admin-password"
              type="password"
              placeholder="Required for initial key deployment"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Password is encrypted before transmission and used only for this deployment
            </p>
          </div>

          {/* Warning if no key selected */}
          {!selectedKeyId && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-700 dark:text-amber-400">
                Select an SSH key to deploy to this target
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={deploying || !selectedKeyId || !adminPassword}
          >
            {deploying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Key className="h-4 w-4 mr-2" />
                Deploy Key
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
