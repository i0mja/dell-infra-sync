import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  quickScanIp?: string;
  defaultJobType?: 'discovery_scan' | '';
}

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
}

interface CredentialSet {
  id: string;
  name: string;
  description: string | null;
  priority: number;
}

export const CreateJobDialog = ({
  open,
  onOpenChange,
  onSuccess,
  quickScanIp,
  defaultJobType = ''
}: CreateJobDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState<'discovery_scan' | ''>("");
  const [scanRange, setScanRange] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [notes, setNotes] = useState("");
  const [credentialSets, setCredentialSets] = useState<CredentialSet[]>([]);
  const [selectedCredentialSets, setSelectedCredentialSets] = useState<string[]>([]);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchCredentialSets();
      // Set default job type if provided
      if (defaultJobType) {
        setJobType(defaultJobType);
      }
      // Quick scan mode for discovery
      if (quickScanIp) {
        setJobType('discovery_scan');
        setScanRange(quickScanIp);
      }
    } else {
      // Reset type so subsequent opens reflect latest defaults
      setJobType('');
    }
  }, [open, quickScanIp, defaultJobType]);

  const fetchCredentialSets = async () => {
    const { data } = await supabase
      .from("credential_sets")
      .select("id, name, description, priority")
      .order("priority");
    
    setCredentialSets(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createJob();
  };

  const createJob = async () => {
    setLoading(true);

    try {
      let target_scope: any = {};
      let details: any = { notes };

      if (jobType === 'discovery_scan') {
        if (!scanRange) {
          throw new Error('Please enter an IP range to scan');
        }
        target_scope = { ip_range: scanRange };
        details.scan_type = 'redfish';
        details.credential_set_ids = selectedCredentialSets;
      }

      const { data: result, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: jobType as "discovery_scan",
          created_by: user?.id,
          target_scope,
          details,
          schedule_at: scheduleAt || null,
          credential_set_ids: selectedCredentialSets,
        }
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed to create job');

      toast({
        title: "Job Created",
        description: `Job has been created and will be picked up by the job executor`,
      });

      // Reset form
      setJobType('');
      setScanRange("");
      setScheduleAt("");
      setNotes("");
      setSelectedCredentialSets([]);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>
            Create a discovery scan job to find and inventory Dell servers on your network. For firmware updates and server configuration, use the dedicated dialogs from the Servers page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job_type">Job Type *</Label>
            <Select value={jobType} onValueChange={(value) => setJobType(value as any)} required>
              <SelectTrigger>
                <SelectValue placeholder="Select job type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discovery_scan">IP Discovery Scan</SelectItem>
              </SelectContent>
            </Select>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                For firmware updates, boot configuration, virtual media, SCP backups, and BIOS settings, use the dedicated dialogs available from the server context menus on the Servers page.
              </AlertDescription>
            </Alert>
          </div>

          {jobType === 'discovery_scan' && (
            <>
              {quickScanIp && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    This will fetch complete server details from iDRAC and update the server record you just created.
                    The Job Executor must be running on your host machine.
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="scan-range">
                  {quickScanIp ? "Server IP Address *" : "IP Range to Scan *"}
                </Label>
                <Input
                  id="scan-range"
                  value={scanRange}
                  onChange={(e) => setScanRange(e.target.value)}
                  placeholder={quickScanIp ? "192.168.1.100" : "e.g., 192.168.1.1-192.168.1.254 or 10.0.0.0/24"}
                  required
                />
                {!quickScanIp && (
                  <p className="text-sm text-muted-foreground">
                    Enter a range (192.168.1.1-192.168.1.254) or CIDR notation (10.0.0.0/24)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Credential Sets to Try *</Label>
                <div className="border rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
                  {credentialSets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No credential sets available</p>
                  ) : (
                    credentialSets.map((set) => (
                      <div key={set.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={set.id}
                          checked={selectedCredentialSets.includes(set.id)}
                          onCheckedChange={(checked) => {
                            setSelectedCredentialSets(prev =>
                              checked
                                ? [...prev, set.id]
                                : prev.filter(id => id !== set.id)
                            );
                          }}
                        />
                        <label
                          htmlFor={set.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {set.name} {set.description && `(${set.description})`}
                        </label>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  The job executor will try each credential set in priority order
                </p>
              </div>
            </>
          )}

          {jobType && (
            <>
              <div className="space-y-2">
                <Label htmlFor="schedule_at">Schedule At (Optional)</Label>
                <Input
                  id="schedule_at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to start immediately
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes about this job..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

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
