import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const AddServerDialog = ({ open, onOpenChange, onSuccess }: AddServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    ip_address: "",
    hostname: "",
    model: "",
    service_tag: "",
    idrac_firmware: "",
    bios_version: "",
    notes: "",
  });
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from("servers").insert([
        {
          ip_address: formData.ip_address,
          hostname: formData.hostname || null,
          model: formData.model || null,
          service_tag: formData.service_tag || null,
          idrac_firmware: formData.idrac_firmware || null,
          bios_version: formData.bios_version || null,
          notes: formData.notes || null,
          last_seen: new Date().toISOString(),
        },
      ]);

      if (error) throw error;

      toast({
        title: "Server Added",
        description: "Server has been successfully added to inventory",
      });

      setFormData({
        ip_address: "",
        hostname: "",
        model: "",
        service_tag: "",
        idrac_firmware: "",
        bios_version: "",
        notes: "",
      });
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error adding server",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Server Manually</DialogTitle>
          <DialogDescription>
            Add a Dell server to inventory. Required fields are marked with *
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ip_address">IP Address *</Label>
              <Input
                id="ip_address"
                placeholder="192.168.1.100"
                value={formData.ip_address}
                onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hostname">Hostname</Label>
              <Input
                id="hostname"
                placeholder="server01.example.com"
                value={formData.hostname}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                placeholder="PowerEdge R750"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service_tag">Service Tag</Label>
              <Input
                id="service_tag"
                placeholder="1ABC234"
                value={formData.service_tag}
                onChange={(e) => setFormData({ ...formData, service_tag: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="idrac_firmware">iDRAC Firmware</Label>
              <Input
                id="idrac_firmware"
                placeholder="5.10.00.00"
                value={formData.idrac_firmware}
                onChange={(e) => setFormData({ ...formData, idrac_firmware: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bios_version">BIOS Version</Label>
              <Input
                id="bios_version"
                placeholder="2.15.0"
                value={formData.bios_version}
                onChange={(e) => setFormData({ ...formData, bios_version: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional information about this server..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Adding..." : "Add Server"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
