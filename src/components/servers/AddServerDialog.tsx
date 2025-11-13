import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const AddServerDialog = ({ open, onOpenChange, onSuccess }: AddServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState({ username: "root", password: "calvin" });
  const [formData, setFormData] = useState({
    ip_address: "",
    hostname: "",
    model: "",
    service_tag: "",
    idrac_firmware: "",
    bios_version: "",
    notes: "",
    idrac_username: "",
    idrac_password: "",
  });
  const { toast } = useToast();

  const handleTestConnection = async () => {
    if (!formData.ip_address) {
      toast({
        title: "IP Address Required",
        description: "Please enter an IP address to test",
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-idrac-connection', {
        body: {
          ip_address: formData.ip_address,
          username: credentials.username,
          password: credentials.password,
        },
      });

      if (error) throw error;

      if (data.success) {
        setTestResult({
          success: true,
          message: `✓ Connection successful (${data.response_time_ms}ms) - Redfish ${data.idrac_version}`,
          data: data,
        });

        // Offer to fetch full details
        toast({
          title: "Connection Successful",
          description: "Would you like to auto-fill server details from iDRAC?",
        });
      } else {
        setTestResult({
          success: false,
          message: `✗ ${data.error}`,
        });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: `✗ ${error.message || 'Connection test failed'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleAutoFill = async () => {
    if (!formData.ip_address) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-server-info', {
        body: {
          ip_address: formData.ip_address,
          username: credentials.username,
          password: credentials.password,
        },
      });

      if (error) throw error;

      if (data.success && data.server_info) {
        setFormData(prev => ({
          ...prev,
          hostname: data.server_info.hostname || prev.hostname,
          model: data.server_info.model || prev.model,
          service_tag: data.server_info.service_tag || prev.service_tag,
          idrac_firmware: data.server_info.idrac_firmware || prev.idrac_firmware,
          bios_version: data.server_info.bios_version || prev.bios_version,
        }));

        toast({
          title: "Details Retrieved",
          description: "Server information auto-filled from iDRAC",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error retrieving details",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

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
        idrac_username: "",
        idrac_password: "",
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
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ip_address">IP Address *</Label>
              <div className="flex gap-2">
                <Input
                  id="ip_address"
                  placeholder="192.168.1.100"
                  value={formData.ip_address}
                  onChange={(e) => {
                    setFormData({ ...formData, ip_address: e.target.value });
                    setTestResult(null);
                  }}
                  required
                  className="flex-1"
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleTestConnection}
                  disabled={testing || !formData.ip_address}
                >
                  {testing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    "Test Connection"
                  )}
                </Button>
              </div>
            </div>

            {testResult && (
              <Alert variant={testResult.success ? "default" : "destructive"}>
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertDescription className="flex-1">{testResult.message}</AlertDescription>
                  {testResult.success && (
                    <Button 
                      type="button" 
                      size="sm" 
                      onClick={handleAutoFill}
                      disabled={loading}
                    >
                      Auto-fill Details
                    </Button>
                  )}
                </div>
              </Alert>
            )}

            <Collapsible open={showCredentials} onOpenChange={setShowCredentials}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="w-full">
                  {showCredentials ? (
                    <>
                      <ChevronUp className="mr-2 h-4 w-4" />
                      Hide iDRAC Credentials
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-2 h-4 w-4" />
                      Show iDRAC Credentials (Optional)
                    </>
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="idrac_username">iDRAC Username</Label>
                    <Input
                      id="idrac_username"
                      placeholder="root"
                      value={credentials.username}
                      onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="idrac_password">iDRAC Password</Label>
                    <Input
                      id="idrac_password"
                      type="password"
                      placeholder="calvin"
                      value={credentials.password}
                      onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Credentials are only used for testing and auto-fill. They are not stored.
                </p>
              </CollapsibleContent>
            </Collapsible>
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
