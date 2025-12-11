import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ZfsTargetTemplate } from "@/hooks/useZfsTemplates";
import { useSshKeys } from "@/hooks/useSshKeys";
import { Key, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ChangeSshKeyDialogProps {
  template: ZfsTargetTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: { ssh_key_id: string | null }) => Promise<void>;
}

export const ChangeSshKeyDialog = ({
  template,
  open,
  onOpenChange,
  onSave,
}: ChangeSshKeyDialogProps) => {
  const { sshKeys, isLoading: keysLoading } = useSshKeys();
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template?.ssh_key_id) {
      setSelectedKeyId(template.ssh_key_id);
    } else {
      setSelectedKeyId("");
    }
  }, [template]);

  const handleSave = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await onSave(template.id, {
        ssh_key_id: selectedKeyId || null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const currentKey = sshKeys.find((k) => k.id === template?.ssh_key_id);
  const newKey = sshKeys.find((k) => k.id === selectedKeyId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change SSH Key</DialogTitle>
          <DialogDescription>
            Select the SSH key to use for accessing deployed appliances.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {currentKey ? (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Key className="h-4 w-4 text-green-600" />
              <div>
                <div className="text-sm font-medium">Current: {currentKey.name}</div>
                <div className="text-xs text-muted-foreground">
                  {currentKey.key_type} • {currentKey.public_key_fingerprint?.slice(0, 20)}...
                </div>
              </div>
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No SSH key currently assigned
              </AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-2">
            <Label>New SSH Key</Label>
            <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={keysLoading ? "Loading..." : "Select SSH key"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None (remove key)</SelectItem>
                {sshKeys.map((key) => (
                  <SelectItem key={key.id} value={key.id}>
                    {key.name} ({key.key_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || selectedKeyId === (template?.ssh_key_id || "")}
          >
            {saving ? "Saving..." : "Update SSH Key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
