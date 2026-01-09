import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, MapPin } from "lucide-react";

interface EditServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    hostname: string | null;
    idrac_hostname?: string | null;  // iDRAC-reported hostname (read-only)
    ip_address: string;
    notes: string | null;
    datacenter?: string | null;
    rack_id?: string | null;
    rack_position?: string | null;
    row_aisle?: string | null;
    room_floor?: string | null;
    location_notes?: string | null;
  };
  onSuccess: () => void;
}

export const EditServerDialog = ({ open, onOpenChange, server, onSuccess }: EditServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [hostname, setHostname] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  
  // Location fields
  const [datacenter, setDatacenter] = useState("");
  const [rackId, setRackId] = useState("");
  const [rackPosition, setRackPosition] = useState("");
  const [rowAisle, setRowAisle] = useState("");
  const [roomFloor, setRoomFloor] = useState("");
  const [locationNotes, setLocationNotes] = useState("");
  
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setHostname(server.hostname || "");
      setIpAddress(server.ip_address);
      setNotes(server.notes || "");
      setDatacenter(server.datacenter || "");
      setRackId(server.rack_id || "");
      setRackPosition(server.rack_position || "");
      setRowAisle(server.row_aisle || "");
      setRoomFloor(server.room_floor || "");
      setLocationNotes(server.location_notes || "");
      
      // Auto-expand location section if any location data exists
      const hasLocationData = server.datacenter || server.rack_id || server.rack_position || 
                              server.row_aisle || server.room_floor || server.location_notes;
      setLocationOpen(!!hasLocationData);
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
          datacenter: datacenter.trim() || null,
          rack_id: rackId.trim() || null,
          rack_position: rackPosition.trim() || null,
          row_aisle: rowAisle.trim() || null,
          room_floor: roomFloor.trim() || null,
          location_notes: locationNotes.trim() || null,
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
          location_updated: true,
        },
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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Server Details</DialogTitle>
          <DialogDescription>
            Update server hostname, IP address, location, and notes
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hostname">Display Name</Label>
            <Input
              id="hostname"
              placeholder="server01.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your custom name for this server. Won't be overwritten by iDRAC scans.
            </p>
          </div>

          {/* Show iDRAC-reported hostname if available and different */}
          {server.idrac_hostname && (
            <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
              <Label className="text-xs text-muted-foreground">iDRAC Reported Hostname</Label>
              <p className="text-sm font-mono">{server.idrac_hostname}</p>
              <p className="text-xs text-muted-foreground">
                Auto-updated by discovery scans. Use as reference for display name.
              </p>
            </div>
          )}

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
              rows={3}
            />
          </div>

          {/* Location Section */}
          <Collapsible open={locationOpen} onOpenChange={setLocationOpen}>
            <CollapsibleTrigger asChild>
              <Button 
                type="button" 
                variant="ghost" 
                className="w-full justify-between px-2 h-9 text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Location Information
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${locationOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="datacenter" className="text-xs">Datacenter / Site</Label>
                  <Input
                    id="datacenter"
                    placeholder="DC-East"
                    value={datacenter}
                    onChange={(e) => setDatacenter(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rack_id" className="text-xs">Rack ID</Label>
                  <Input
                    id="rack_id"
                    placeholder="R-A12"
                    value={rackId}
                    onChange={(e) => setRackId(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rack_position" className="text-xs">Rack Position (U)</Label>
                  <Input
                    id="rack_position"
                    placeholder="U22-U24"
                    value={rackPosition}
                    onChange={(e) => setRackPosition(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="row_aisle" className="text-xs">Row / Aisle</Label>
                  <Input
                    id="row_aisle"
                    placeholder="Row 3, Aisle B"
                    value={rowAisle}
                    onChange={(e) => setRowAisle(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="room_floor" className="text-xs">Room / Floor</Label>
                <Input
                  id="room_floor"
                  placeholder="Floor 2, Server Room A"
                  value={roomFloor}
                  onChange={(e) => setRoomFloor(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="location_notes" className="text-xs">Location Notes</Label>
                <Textarea
                  id="location_notes"
                  placeholder="Power circuit, cable runs, etc..."
                  value={locationNotes}
                  onChange={(e) => setLocationNotes(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

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
