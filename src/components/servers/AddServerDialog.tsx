import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { refreshServerInfo } from "@/lib/idrac-client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface CredentialSet {
  id: string;
  name: string;
  username: string;
}

export const AddServerDialog = ({ open, onOpenChange, onSuccess }: AddServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [credentialSets, setCredentialSets] = useState<CredentialSet[]>([]);
  const [selectedCredentialSetId, setSelectedCredentialSetId] = useState<string>("");
  const [customCredentials, setCustomCredentials] = useState({ username: "root", password: "calvin" });
  const [useCustomCredentials, setUseCustomCredentials] = useState(false);
  const [manualEntryMode, setManualEntryMode] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ 
    success: boolean; 
    message: string; 
    responseTime?: number;
    idracVersion?: string;
  } | null>(null);
  
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

  // Fetch credential sets on mount
  useEffect(() => {
    if (open) {
      fetchCredentialSets();
    }
  }, [open]);

  const fetchCredentialSets = async () => {
    try {
      const { data, error } = await supabase
        .from("credential_sets")
        .select("id, name, username")
        .order("is_default", { ascending: false })
        .order("name");

      if (error) throw error;
      
      setCredentialSets(data || []);
      
      // Auto-select the first credential set if available
      if (data && data.length > 0 && !selectedCredentialSetId) {
        setSelectedCredentialSetId(data[0].id);
      }
    } catch (error: any) {
      console.error("Error fetching credential sets:", error);
    }
  };

  const handleFetchServerDetails = async () => {
    if (!formData.ip_address) {
      toast({
        title: "IP Address Required",
        description: "Please enter an IP address to fetch server details",
        variant: "destructive",
      });
      return;
    }

    if (!useCustomCredentials && !selectedCredentialSetId) {
      toast({
        title: "Credentials Required",
        description: "Please select a credential set or use custom credentials",
        variant: "destructive",
      });
      return;
    }

    setFetching(true);
    setFetchResult(null);

    try {
      const requestBody: any = {
        ip_address: formData.ip_address,
      };

      // Either pass credential_set_id or custom credentials
      if (useCustomCredentials) {
        requestBody.username = customCredentials.username;
        requestBody.password = customCredentials.password;
      } else {
        requestBody.credential_set_id = selectedCredentialSetId;
      }

      const { data, error } = await supabase.functions.invoke('refresh-server-info', {
        body: requestBody,
      });

      if (error) throw error;

      if (data.success && data.server_info) {
        // Auto-populate form fields
        setFormData(prev => ({
          ...prev,
          hostname: data.server_info.hostname || prev.hostname,
          model: data.server_info.model || prev.model,
          service_tag: data.server_info.service_tag || prev.service_tag,
          idrac_firmware: data.server_info.idrac_firmware || prev.idrac_firmware,
          bios_version: data.server_info.bios_version || prev.bios_version,
        }));

        setFetchResult({
          success: true,
          message: "Server details retrieved successfully",
          responseTime: data.response_time_ms,
          idracVersion: data.server_info.idrac_firmware,
        });

        toast({
          title: "Success",
          description: "Server information retrieved from iDRAC",
        });
      } else {
        setFetchResult({
          success: false,
          message: data.error || "Failed to retrieve server details",
        });
      }
    } catch (error: any) {
      setFetchResult({
        success: false,
        message: error.message || "Connection failed",
      });
      
      toast({
        title: "Connection Failed",
        description: error.message || "Could not connect to iDRAC",
        variant: "destructive",
      });
    } finally {
      setFetching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const serverData: any = {
        ip_address: formData.ip_address,
        hostname: formData.hostname || null,
        model: formData.model || null,
        service_tag: formData.service_tag || null,
        idrac_firmware: formData.idrac_firmware || null,
        bios_version: formData.bios_version || null,
        notes: formData.notes || null,
        last_seen: new Date().toISOString(),
      };

      // Add credential_set_id if a credential set was used (not custom credentials)
      if (!useCustomCredentials && selectedCredentialSetId) {
        serverData.credential_set_id = selectedCredentialSetId;
      }

      const { error } = await supabase.from("servers").insert([serverData]);

      if (error) throw error;

      toast({
        title: "Server Added",
        description: "Server has been successfully added to inventory",
      });

      // Reset form
      setFormData({
        ip_address: "",
        hostname: "",
        model: "",
        service_tag: "",
        idrac_firmware: "",
        bios_version: "",
        notes: "",
      });
      setFetchResult(null);
      setManualEntryMode(false);
      setUseCustomCredentials(false);
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

  const handleManualEntryToggle = () => {
    setManualEntryMode(!manualEntryMode);
    setFetchResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Add Server from iDRAC</DialogTitle>
          <DialogDescription>
            {manualEntryMode 
              ? "Enter server details manually. Required fields are marked with *"
              : "Enter IP address and credentials to automatically fetch server details from iDRAC"
            }
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 pr-4">
          <form id="add-server-form" onSubmit={handleSubmit} className="space-y-4 pb-2">
            {/* IP Address & Credentials Section */}
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div className="space-y-2">
                <Label htmlFor="ip_address">IP Address *</Label>
                <Input
                  id="ip_address"
                  placeholder="192.168.1.100"
                  value={formData.ip_address}
                  onChange={(e) => {
                    setFormData({ ...formData, ip_address: e.target.value });
                    setFetchResult(null);
                  }}
                  required
                />
              </div>

              {!manualEntryMode && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="credential_set">Credentials *</Label>
                    {!useCustomCredentials ? (
                      <div className="space-y-2">
                        <Select 
                          value={selectedCredentialSetId} 
                          onValueChange={setSelectedCredentialSetId}
                        >
                          <SelectTrigger id="credential_set">
                            <SelectValue placeholder="Select a credential set" />
                          </SelectTrigger>
                          <SelectContent>
                            {credentialSets.map((set) => (
                              <SelectItem key={set.id} value={set.id}>
                                {set.name} ({set.username})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => setUseCustomCredentials(true)}
                        >
                          Use custom credentials instead
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="custom_username" className="text-sm">Username</Label>
                            <Input
                              id="custom_username"
                              placeholder="root"
                              value={customCredentials.username}
                              onChange={(e) => setCustomCredentials({ ...customCredentials, username: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="custom_password" className="text-sm">Password</Label>
                            <Input
                              id="custom_password"
                              type="password"
                              placeholder="calvin"
                              value={customCredentials.password}
                              onChange={(e) => setCustomCredentials({ ...customCredentials, password: e.target.value })}
                            />
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => setUseCustomCredentials(false)}
                        >
                          Use saved credential set instead
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Custom credentials are only used for this fetch and are not stored
                        </p>
                      </div>
                    )}
                  </div>

                  <Button 
                    type="button" 
                    onClick={handleFetchServerDetails}
                    disabled={fetching || !formData.ip_address}
                    className="w-full"
                  >
                    {fetching ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Fetching Server Details...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Fetch Server Details from iDRAC
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>

            {/* Fetch Result Alert */}
            {fetchResult && !manualEntryMode && (
              <Alert variant={fetchResult.success ? "default" : "destructive"}>
                <div className="flex items-start gap-3">
                  {fetchResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 space-y-1">
                    <AlertDescription className="font-medium">
                      {fetchResult.message}
                    </AlertDescription>
                    {fetchResult.success && (
                      <div className="text-sm text-muted-foreground">
                        {fetchResult.idracVersion && `iDRAC ${fetchResult.idracVersion}`}
                        {fetchResult.responseTime && ` • Response time: ${fetchResult.responseTime}ms`}
                      </div>
                    )}
                  </div>
                </div>
              </Alert>
            )}

            {/* Server Information Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Server Information</h3>
                {!manualEntryMode && fetchResult?.success && (
                  <span className="text-xs text-muted-foreground">Auto-populated from iDRAC</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="hostname">Hostname</Label>
                  <Input
                    id="hostname"
                    placeholder="server01.example.com"
                    value={formData.hostname}
                    onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    placeholder="PowerEdge R750"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  />
                </div>
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="idrac_firmware" className="flex items-center gap-2">
                    iDRAC Firmware
                    {!manualEntryMode && (
                      <span className="text-xs text-muted-foreground font-normal">(Auto-filled)</span>
                    )}
                  </Label>
                  <Input
                    id="idrac_firmware"
                    placeholder="5.10.00.00"
                    value={formData.idrac_firmware}
                    onChange={(e) => setFormData({ ...formData, idrac_firmware: e.target.value })}
                    readOnly={!manualEntryMode}
                    className={!manualEntryMode ? "bg-muted cursor-not-allowed" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bios_version" className="flex items-center gap-2">
                    BIOS Version
                    {!manualEntryMode && (
                      <span className="text-xs text-muted-foreground font-normal">(Auto-filled)</span>
                    )}
                  </Label>
                  <Input
                    id="bios_version"
                    placeholder="2.15.0"
                    value={formData.bios_version}
                    onChange={(e) => setFormData({ ...formData, bios_version: e.target.value })}
                    readOnly={!manualEntryMode}
                    className={!manualEntryMode ? "bg-muted cursor-not-allowed" : ""}
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
            </div>

            {/* Manual Entry Toggle */}
            {!manualEntryMode && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={handleManualEntryToggle}
                >
                  Can't connect to iDRAC? Enter details manually
                </Button>
              </div>
            )}

            {manualEntryMode && (
              <Alert>
                <AlertDescription className="flex items-center justify-between">
                  <span className="text-sm">Manual entry mode: All fields are editable</span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={handleManualEntryToggle}
                  >
                    Switch back to auto-fetch
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </form>
        </ScrollArea>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t flex-shrink-0">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => {
              onOpenChange(false);
              setManualEntryMode(false);
              setFetchResult(null);
            }}
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            form="add-server-form"
            disabled={loading}
          >
            {loading ? "Adding..." : "Add Server"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
