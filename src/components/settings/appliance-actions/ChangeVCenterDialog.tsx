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
import { useVCenters } from "@/hooks/useVCenters";

interface ChangeVCenterDialogProps {
  template: ZfsTargetTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: { vcenter_id: string }) => Promise<void>;
}

export const ChangeVCenterDialog = ({
  template,
  open,
  onOpenChange,
  onSave,
}: ChangeVCenterDialogProps) => {
  const { vcenters, loading: vcentersLoading } = useVCenters();
  const [selectedVcenterId, setSelectedVcenterId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template?.vcenter_id) {
      setSelectedVcenterId(template.vcenter_id);
    }
  }, [template]);

  const handleSave = async () => {
    if (!template || !selectedVcenterId) return;
    setSaving(true);
    try {
      await onSave(template.id, { vcenter_id: selectedVcenterId });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const currentVcenter = vcenters.find((v) => v.id === template?.vcenter_id);
  const newVcenter = vcenters.find((v) => v.id === selectedVcenterId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Site / vCenter</DialogTitle>
          <DialogDescription>
            Move this appliance template to a different vCenter. The template VM
            must exist in the target vCenter.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Current Site</Label>
            <div className="text-sm text-muted-foreground">
              {currentVcenter?.name || "Not assigned"}
            </div>
          </div>
          <div className="space-y-2">
            <Label>New Site / vCenter</Label>
            <Select
              value={selectedVcenterId}
              onValueChange={setSelectedVcenterId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={vcentersLoading ? "Loading..." : "Select vCenter"}
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
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              saving ||
              !selectedVcenterId ||
              selectedVcenterId === template?.vcenter_id
            }
          >
            {saving ? "Saving..." : "Change Site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
