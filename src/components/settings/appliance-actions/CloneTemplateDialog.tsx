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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ZfsTargetTemplate } from "@/hooks/useZfsTemplates";
import { useVCenters } from "@/hooks/useVCenters";

interface CloneTemplateDialogProps {
  template: ZfsTargetTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (data: Partial<ZfsTargetTemplate>) => Promise<void>;
}

export const CloneTemplateDialog = ({
  template,
  open,
  onOpenChange,
  onClone,
}: CloneTemplateDialogProps) => {
  const { vcenters, loading: vcentersLoading } = useVCenters();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vcenterId, setVcenterId] = useState("");
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    if (template) {
      setName(`${template.name} (Copy)`);
      setDescription(template.description || "");
      setVcenterId(template.vcenter_id || "");
    }
  }, [template]);

  const handleClone = async () => {
    if (!template) return;
    setCloning(true);
    try {
      await onClone({
        ...template,
        id: undefined as any, // Will be auto-generated
        name,
        description: description || undefined,
        vcenter_id: vcenterId || undefined,
        status: "draft" as const,
        deployment_count: 0,
        last_deployed_at: undefined,
        created_at: undefined as any,
        updated_at: undefined as any,
      });
      onOpenChange(false);
    } finally {
      setCloning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clone Template</DialogTitle>
          <DialogDescription>
            Create a copy of this template, optionally for a different site.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>New Template Name</Label>
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
            <Label>Target Site / vCenter</Label>
            <Select value={vcenterId} onValueChange={setVcenterId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={vcentersLoading ? "Loading..." : "Same as source"}
                />
              </SelectTrigger>
              <SelectContent>
                {vcenters.map((vc) => (
                  <SelectItem key={vc.id} value={vc.id}>
                    {vc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Note: The template VM must exist in the target vCenter
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleClone} disabled={cloning || !name}>
            {cloning ? "Cloning..." : "Clone Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
