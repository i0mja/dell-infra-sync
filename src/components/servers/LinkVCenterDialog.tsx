import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check } from "lucide-react";

interface LinkVCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    hostname: string | null;
    ip_address: string;
    service_tag: string | null;
  };
  onSuccess: () => void;
}

interface VCenterHost {
  id: string;
  name: string;
  cluster: string | null;
  serial_number: string | null;
  esxi_version: string | null;
  server_id: string | null;
}

export const LinkVCenterDialog = ({ open, onOpenChange, server, onSuccess }: LinkVCenterDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [vcenterHosts, setVcenterHosts] = useState<VCenterHost[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchVCenterHosts();
    }
  }, [open]);

  const fetchVCenterHosts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("vcenter_hosts")
        .select("*")
        .order("name");

      if (error) throw error;
      setVcenterHosts(data || []);

      // Auto-select if there's a match by serial number
      if (server.service_tag) {
        const match = data?.find(h => h.serial_number === server.service_tag && !h.server_id);
        if (match) setSelectedHostId(match.id);
      }
    } catch (error: any) {
      toast({
        title: "Error loading vCenter hosts",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async () => {
    if (!selectedHostId) {
      toast({
        title: "No host selected",
        description: "Please select a vCenter host to link",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmitting(true);

      // Update server to link to vCenter host
      const { error: serverError } = await supabase
        .from("servers")
        .update({ vcenter_host_id: selectedHostId })
        .eq("id", server.id);

      if (serverError) throw serverError;

      // Update vCenter host to link back to server
      const { error: hostError } = await supabase
        .from("vcenter_hosts")
        .update({ server_id: server.id })
        .eq("id", selectedHostId);

      if (hostError) throw hostError;

      // Create audit log
      await supabase.from("audit_logs").insert({
        action: "server_vcenter_linked",
        details: {
          server_id: server.id,
          vcenter_host_id: selectedHostId,
          server_name: server.hostname || server.ip_address,
        },
      });

      toast({
        title: "Successfully linked",
        description: "Server has been linked to vCenter host",
      });

      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error linking server",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isMatch = (host: VCenterHost) => {
    return host.serial_number === server.service_tag;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Link to vCenter Host</DialogTitle>
          <DialogDescription>
            Link {server.hostname || server.ip_address} to a vCenter host
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Server Details</Label>
            <div className="p-3 border rounded-lg text-sm space-y-1">
              <div><span className="text-muted-foreground">Name:</span> {server.hostname || server.ip_address}</div>
              <div><span className="text-muted-foreground">Service Tag:</span> {server.service_tag || "N/A"}</div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Select vCenter Host</Label>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : vcenterHosts.length === 0 ? (
              <div className="text-center p-8 border rounded-lg">
                <p className="text-muted-foreground">No vCenter hosts available</p>
              </div>
            ) : (
              <div className="border rounded-lg max-h-96 overflow-y-auto">
                {vcenterHosts.map((host) => (
                  <div
                    key={host.id}
                    onClick={() => !host.server_id && setSelectedHostId(host.id)}
                    className={`p-3 border-b last:border-b-0 cursor-pointer transition-colors ${
                      selectedHostId === host.id
                        ? "bg-primary/10 border-primary"
                        : host.server_id
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{host.name}</span>
                          {isMatch(host) && !host.server_id && (
                            <Badge variant="secondary">Suggested Match</Badge>
                          )}
                          {host.server_id && (
                            <Badge variant="outline">Already Linked</Badge>
                          )}
                          {selectedHostId === host.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          {host.cluster && <div>Cluster: {host.cluster}</div>}
                          {host.serial_number && <div>Serial: {host.serial_number}</div>}
                          {host.esxi_version && <div>ESXi: {host.esxi_version}</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleLink} disabled={!selectedHostId || submitting}>
              {submitting ? "Linking..." : "Link Server"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
