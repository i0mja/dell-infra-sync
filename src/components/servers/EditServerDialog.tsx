import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EditServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    hostname: string | null;
    ip_address: string;
    notes: string | null;
  };
  onSuccess: () => void;
}

export const EditServerDialog = ({ open, onOpenChange, server, onSuccess }: EditServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [hostname, setHostname] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setHostname(server.hostname || "");
      setIpAddress(server.ip_address);
      setNotes(server.notes || "");
    }
  }, [open, server]);

  const validateIpAddress = (ip: string): boolean => {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateIpAddress(ipAddress)) {
      toast({
        title: "Invalid IP address",
        description: "Please enter a valid IPv4 address",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase
        .from("servers")
        .update({
          hostname: hostname.trim() || null,
          ip_address: ipAddress.trim(),
          notes: notes.trim() || null,
        })
        .eq("id", server.id);

      if (error) throw error;

      // Create audit log
      await supabase.from("audit_logs").insert({
        action: "server_updated",
        details: {
          server_id: server.id,
          old_hostname: server.hostname,
          new_hostname: hostname.trim() || null,
          old_ip: server.ip_address,
          new_ip: ipAddress.trim(),
        },
      });

      toast({
        title: "Server updated",
        description: "Server details have been updated successfully",
      });

      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error updating server",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Server Details</DialogTitle>
          <DialogDescription>
            Update server hostname, IP address, and notes
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hostname">Hostname</Label>
            <Input
              id="hostname"
              placeholder="server01.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ip_address">IP Address *</Label>
            <Input
              id="ip_address"
              placeholder="192.168.1.100"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this server..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
