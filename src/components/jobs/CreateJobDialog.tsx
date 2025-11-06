import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Info } from "lucide-react";

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
}

export const CreateJobDialog = ({ open, onOpenChange, onSuccess }: CreateJobDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState<string>("");
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [scanRange, setScanRange] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [notes, setNotes] = useState("");
  const [firmwareUri, setFirmwareUri] = useState("");
  const [component, setComponent] = useState("BIOS");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchServers();
    }
  }, [open]);

  const fetchServers = async () => {
    const { data } = await supabase
      .from("servers")
      .select("id, ip_address, hostname, model")
      .order("ip_address");
    
    setServers(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let target_scope: any = {};
      let details: any = { notes };

      if (jobType === 'firmware_update') {
        if (selectedServers.length === 0) {
          throw new Error('Please select at least one server');
        }
        target_scope = { server_ids: selectedServers };
        details.firmware_uri = firmwareUri || undefined;
        details.component = component;
        details.version = "latest";
        details.apply_time = "OnReset";
      } else if (jobType === 'discovery_scan') {
        if (!scanRange) {
          throw new Error('Please enter an IP range to scan');
        }
        target_scope = { ip_range: scanRange };
        details.scan_type = 'redfish';
      }

      const { data, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: jobType,
          target_scope,
          details,
          schedule_at: scheduleAt || null,
        },
      });

      if (error) throw error;

      toast({
        title: "Job Created",
        description: `Job has been created and will be picked up by the job executor`,
      });

      // Reset form
      setJobType("");
      setSelectedServers([]);
      setScanRange("");
      setScheduleAt("");
      setNotes("");
      setFirmwareUri("");
      setComponent("BIOS");
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error creating job",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleServer = (serverId: string) => {
    setSelectedServers(prev =>
      prev.includes(serverId)
        ? prev.filter(id => id !== serverId)
        : [...prev, serverId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>
            Configure a firmware update or discovery scan job
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job_type">Job Type *</Label>
            <Select value={jobType} onValueChange={setJobType} required>
              <SelectTrigger>
                <SelectValue placeholder="Select job type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="firmware_update">Firmware Update</SelectItem>
                <SelectItem value="discovery_scan">IP Discovery Scan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {jobType === 'firmware_update' && (
            <>
              <div className="space-y-2">
                <Label>Target Servers * ({selectedServers.length} selected)</Label>
                <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                  {servers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No servers available</p>
                  ) : (
                    servers.map((server) => (
                      <div key={server.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={server.id}
                          checked={selectedServers.includes(server.id)}
                          onCheckedChange={() => toggleServer(server.id)}
                        />
                        <label
                          htmlFor={server.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {server.hostname || server.ip_address} ({server.model || 'Unknown model'})
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="component">Component to Update</Label>
                <Select value={component} onValueChange={setComponent}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BIOS">BIOS</SelectItem>
                    <SelectItem value="iDRAC">iDRAC / Lifecycle Controller</SelectItem>
                    <SelectItem value="RAID">RAID Controller</SelectItem>
                    <SelectItem value="NIC">Network Adapter</SelectItem>
                    <SelectItem value="CPLD">CPLD / FPGA</SelectItem>
                    <SelectItem value="Backplane">Backplane</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Will update to latest available version
                </p>
              </div>

              {/* Best Practices Guidance */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Dell Firmware Update Best Practices</AlertTitle>
                <AlertDescription className="text-sm space-y-1">
                  <div>Recommended update order:</div>
                  <ol className="list-decimal list-inside space-y-0.5 ml-2">
                    <li>iDRAC / Lifecycle Controller (first)</li>
                    <li>BIOS / System Firmware</li>
                    <li>CPLD / FPGA</li>
                    <li>RAID, Network, and other components</li>
                  </ol>
                </AlertDescription>
              </Alert>

              {/* BIOS Warning */}
              {component === "BIOS" && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Warning: BIOS Update</AlertTitle>
                  <AlertDescription>
                    Before updating BIOS, ensure iDRAC/Lifecycle Controller is already up to date. 
                    Updating BIOS before iDRAC may cause compatibility issues or update failures.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="firmware_uri">Firmware URI (Optional)</Label>
                <Input
                  id="firmware_uri"
                  placeholder="http://firmware.example.com/dell/BIOS_2.9.0.exe"
                  value={firmwareUri}
                  onChange={(e) => setFirmwareUri(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use default repository path based on component and version
                </p>
              </div>
            </>
          )}

          {jobType === 'discovery_scan' && (
            <div className="space-y-2">
              <Label htmlFor="scan_range">IP Range to Scan *</Label>
              <Input
                id="scan_range"
                placeholder="192.168.1.0/24 or 10.0.0.1-10.0.0.254"
                value={scanRange}
                onChange={(e) => setScanRange(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Enter a CIDR range (e.g., 192.168.1.0/24) or IP range (e.g., 192.168.1.1-192.168.1.100)
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="schedule_at">Schedule For (Optional)</Label>
            <Input
              id="schedule_at"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to start immediately when job executor picks it up
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this job..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !jobType}>
              {loading ? "Creating..." : "Create Job"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
