import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ZfsTargetTemplate } from "@/hooks/useZfsTemplates";

interface EditApplianceDialogProps {
  template: ZfsTargetTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: Partial<ZfsTargetTemplate>) => Promise<void>;
}

export const EditApplianceDialog = ({
  template,
  open,
  onOpenChange,
  onSave,
}: EditApplianceDialogProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("");
  const [cpuCount, setCpuCount] = useState(2);
  const [memoryGb, setMemoryGb] = useState(8);
  const [zfsDiskGb, setZfsDiskGb] = useState(500);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || "");
      setVersion(template.version || "");
      setCpuCount(template.default_cpu_count);
      setMemoryGb(template.default_memory_gb);
      setZfsDiskGb(template.default_zfs_disk_gb);
    }
  }, [template]);

  const handleSave = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await onSave(template.id, {
        name,
        description: description || undefined,
        version: version || undefined,
        default_cpu_count: cpuCount,
        default_memory_gb: memoryGb,
        default_zfs_disk_gb: zfsDiskGb,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Appliance Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Version</Label>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g., 1.0.0"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>vCPU</Label>
              <Input
                type="number"
                value={cpuCount}
                onChange={(e) => setCpuCount(Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>RAM (GB)</Label>
              <Input
                type="number"
                value={memoryGb}
                onChange={(e) => setMemoryGb(Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>ZFS Disk (GB)</Label>
              <Input
                type="number"
                value={zfsDiskGb}
                onChange={(e) => setZfsDiskGb(Number(e.target.value))}
                min={10}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
