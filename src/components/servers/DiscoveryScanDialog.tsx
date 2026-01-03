import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useIdracSettings } from "@/hooks/useIdracSettings";
import { Info, Search, ChevronDown, Settings } from "lucide-react";

interface DiscoveryScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  quickScanIp?: string;
}

interface CredentialSet {
  id: string;
  name: string;
  description: string | null;
  priority: number;
}

const SCP_AGE_THRESHOLDS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

export const DiscoveryScanDialog = ({
  open,
  onOpenChange,
  onSuccess,
  quickScanIp,
}: DiscoveryScanDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [scanRange, setScanRange] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [notes, setNotes] = useState("");
  const [credentialSets, setCredentialSets] = useState<CredentialSet[]>([]);
  const [selectedCredentialSets, setSelectedCredentialSets] = useState<string[]>([]);
  const [parsedIpCount, setParsedIpCount] = useState(0);
  const [dataOptionsOpen, setDataOptionsOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Load global iDRAC settings for defaults
  const { globalSettings, loading: loadingSettings } = useIdracSettings();
  
  // Fetch options state (initialized from global settings)
  const [fetchFirmware, setFetchFirmware] = useState(true);
  const [fetchHealth, setFetchHealth] = useState(true);
  const [fetchBios, setFetchBios] = useState(true);
  const [fetchStorage, setFetchStorage] = useState(true);
  const [fetchNics, setFetchNics] = useState(true);
  const [fetchScpBackup, setFetchScpBackup] = useState(false);
  const [scpMaxAgeDays, setScpMaxAgeDays] = useState("30");
  const [scpOnlyIfStale, setScpOnlyIfStale] = useState(true);

  // Initialize fetch options from global settings when loaded
  useEffect(() => {
    if (!loadingSettings && globalSettings) {
      setFetchFirmware(globalSettings.fetch_firmware);
      setFetchHealth(globalSettings.fetch_health);
      setFetchBios(globalSettings.fetch_bios);
      setFetchStorage(globalSettings.fetch_storage);
      setFetchNics(globalSettings.fetch_nics);
      setFetchScpBackup(globalSettings.fetch_scp_backup);
      setScpMaxAgeDays(String(globalSettings.scp_backup_max_age_days ?? 30));
      setScpOnlyIfStale(globalSettings.scp_backup_only_if_stale ?? true);
    }
  }, [loadingSettings, globalSettings]);

  useEffect(() => {
    if (open) {
      fetchCredentialSets();
      // Quick scan mode for single server
      if (quickScanIp) {
        setScanRange(quickScanIp);
      }
    } else {
      // Reset form when closed
      setScanRange("");
      setScheduleAt("");
      setNotes("");
      setSelectedCredentialSets([]);
      setDataOptionsOpen(false);
    }
  }, [open, quickScanIp]);

  const fetchCredentialSets = async () => {
    const { data } = await supabase
      .from("credential_sets")
      .select("id, name, description, priority")
      .order("priority");
    
    setCredentialSets(data || []);
  };

  const parseIpInput = (input: string): { ips: string[], count: number } => {
    if (!input.trim()) return { ips: [], count: 0 };

    // Split by newlines and commas, then clean up
    const entries = input
      .split(/[\n,]+/)
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);

    // Basic IP validation (IPv4)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    const rangeRegex = /^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/;

    const validEntries = entries.filter(entry => 
      ipRegex.test(entry) || cidrRegex.test(entry) || rangeRegex.test(entry)
    );

    return { ips: validEntries, count: validEntries.length };
  };

  const handleIpInputChange = (value: string) => {
    setScanRange(value);
    const { count } = parseIpInput(value);
    setParsedIpCount(count);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!scanRange) {
        throw new Error('Please enter an IP range to scan');
      }

      const { ips } = parseIpInput(scanRange);
      
      const { data: result, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: "discovery_scan",
          created_by: user?.id,
          target_scope: ips.length === 1 ? { ip_range: ips[0] } : { ip_list: ips },
          details: {
            notes,
            scan_type: 'redfish',
            credential_set_ids: selectedCredentialSets,
            fetch_options: {
              firmware: fetchFirmware,
              health: fetchHealth,
              bios: fetchBios,
              storage: fetchStorage,
              nics: fetchNics,
              scp_backup: fetchScpBackup,
              scp_backup_max_age_days: parseInt(scpMaxAgeDays),
              scp_backup_only_if_stale: scpOnlyIfStale,
            }
          },
          schedule_at: scheduleAt || null,
          credential_set_ids: selectedCredentialSets,
        }
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed to create discovery job');

      toast({
        title: "Initial Server Sync Started",
        description: `Scanning ${scanRange}. The job executor will process this scan.`,
      });

      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast({
        title: "Error starting discovery scan",
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
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Initial Server Sync
          </DialogTitle>
          <DialogDescription>
            Scan your network to discover Dell servers with iDRAC interfaces. The job executor will attempt to connect using your configured credential sets.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              {quickScanIp ? "Server IP Address *" : "IP Addresses or Range *"}
            </Label>
            <Textarea
              id="scan-range"
              value={scanRange}
              onChange={(e) => handleIpInputChange(e.target.value)}
              placeholder={quickScanIp ? "192.168.1.100" : "192.168.1.10\n192.168.1.25\n192.168.1.50\n\nOr: 192.168.1.0/24\nOr: 192.168.1.1-192.168.1.254"}
              required
              rows={quickScanIp ? 1 : 6}
              className="font-mono text-sm"
            />
            {!quickScanIp && parsedIpCount > 0 && (
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <Info className="h-3 w-3" />
                {parsedIpCount} {parsedIpCount === 1 ? 'IP/range' : 'IPs/ranges'} detected
              </p>
            )}
            {!quickScanIp && (
              <p className="text-xs text-muted-foreground">
                Paste from Excel (one IP per line), comma-separated, or use CIDR (10.0.0.0/24) / range notation (192.168.1.1-192.168.1.254)
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

          {/* Data Options - Collapsible */}
          <Collapsible open={dataOptionsOpen} onOpenChange={setDataOptionsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" type="button" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Data Options
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${dataOptionsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3 border rounded-lg p-4 bg-muted/30">
              <p className="text-xs text-muted-foreground mb-3">
                Configure what data to fetch from each discovered server
              </p>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center space-x-2">
                  <Checkbox id="fetch-firmware" checked={fetchFirmware} onCheckedChange={(c) => setFetchFirmware(c === true)} />
                  <Label htmlFor="fetch-firmware" className="text-sm cursor-pointer">Firmware Versions</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="fetch-health" checked={fetchHealth} onCheckedChange={(c) => setFetchHealth(c === true)} />
                  <Label htmlFor="fetch-health" className="text-sm cursor-pointer">Health Status</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="fetch-bios" checked={fetchBios} onCheckedChange={(c) => setFetchBios(c === true)} />
                  <Label htmlFor="fetch-bios" className="text-sm cursor-pointer">BIOS Settings</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="fetch-storage" checked={fetchStorage} onCheckedChange={(c) => setFetchStorage(c === true)} />
                  <Label htmlFor="fetch-storage" className="text-sm cursor-pointer">Storage / WWNs</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="fetch-nics" checked={fetchNics} onCheckedChange={(c) => setFetchNics(c === true)} />
                  <Label htmlFor="fetch-nics" className="text-sm cursor-pointer">NIC MACs</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="fetch-scp" checked={fetchScpBackup} onCheckedChange={(c) => setFetchScpBackup(c === true)} />
                  <Label htmlFor="fetch-scp" className="text-sm cursor-pointer">SCP Config Backup</Label>
                </div>
              </div>

              {fetchScpBackup && (
                <div className="mt-3 p-3 border rounded-md bg-background space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="scp-only-stale"
                      checked={scpOnlyIfStale}
                      onCheckedChange={(c) => setScpOnlyIfStale(c === true)}
                    />
                    <Label htmlFor="scp-only-stale" className="text-xs cursor-pointer">
                      Only backup if older than
                    </Label>
                    <Select value={scpMaxAgeDays} onValueChange={setScpMaxAgeDays} disabled={!scpOnlyIfStale}>
                      <SelectTrigger className="w-24 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCP_AGE_THRESHOLDS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {scpOnlyIfStale 
                      ? `SCP backups will only run for servers without a backup in the last ${scpMaxAgeDays} days`
                      : "SCP backups will run for all servers (slower)"}
                  </p>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

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
              placeholder="Add any notes about this scan..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Starting Sync..." : "Start Initial Sync"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};