import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Info, Server, Key, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LocalModeHelper } from "./LocalModeHelper";
import { serverSchema, credentialSchema, safeValidateInput } from "@/lib/validations";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const AddServerDialog = ({ open, onOpenChange, onSuccess }: AddServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState("info");
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Form state
  const [formData, setFormData] = useState({
    ip_address: "",
    hostname: "",
    notes: "",
  });
  
  // Credential state
  const [credentialMode, setCredentialMode] = useState<"saved" | "manual">("saved");
  const [selectedCredentialSetId, setSelectedCredentialSetId] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [manualPassword, setManualPassword] = useState("");
  const [saveCredentials, setSaveCredentials] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [credentialSets, setCredentialSets] = useState<any[]>([]);
  
  // Discovery state
  const [autoDiscover, setAutoDiscover] = useState(true);
  
  // Test connection state
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'failed';
    message?: string;
    details?: any;
  } | null>(null);
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const [showLocalHelper, setShowLocalHelper] = useState(false);

  // Detect local mode
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('localhost');

  // Fetch credential sets on mount
  useEffect(() => {
    if (open) {
      fetchCredentialSets();
    }
  }, [open]);

  const fetchCredentialSets = async () => {
    const { data } = await supabase
      .from("credential_sets")
      .select("id, name, description, username")
      .order("priority");
    
    setCredentialSets(data || []);
    
    // Auto-select first credential set if available
    if (data && data.length > 0) {
      setSelectedCredentialSetId(data[0].id);
      setCredentialMode("saved");
    } else {
      setCredentialMode("manual");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate server data
      const serverValidation = safeValidateInput(serverSchema, formData);
      if (serverValidation.success === false) {
        toast({
          title: "Validation Error",
          description: serverValidation.errors.join(', '),
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate credentials if manual entry
      if (credentialMode === 'manual') {
        const credValidation = safeValidateInput(credentialSchema, {
          name: credentialName || 'Manual Entry',
          username: manualUsername,
          password: manualPassword,
          description: ''
        });
        
        if (credValidation.success === false) {
          toast({
            title: "Credential Validation Error",
            description: credValidation.errors.join(', '),
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      // Step 1: Create server record using validated data
      const validatedData = serverValidation.data;
      const serverData: any = {
        ip_address: validatedData.ip_address,
        hostname: validatedData.hostname || null,
        notes: validatedData.notes || null,
        last_seen: new Date().toISOString(),
        credential_set_id: credentialMode === "saved" ? selectedCredentialSetId : null,
      };

      const { data: newServer, error: serverError } = await supabase
        .from("servers")
        .insert([serverData])
        .select()
        .single();

      if (serverError) throw serverError;

      // Step 2: Handle credentials with encryption
      let credentialSetIdToUse = selectedCredentialSetId;
      
      if (credentialMode === "manual") {
        if (saveCredentials) {
          // Create new credential set without password
          const { data: newCredSet, error: credError } = await supabase
            .from("credential_sets")
            .insert([{
              name: credentialName || `${validatedData.ip_address} Credentials`,
              username: manualUsername,
              password_encrypted: null, // Will be encrypted via edge function
              description: `Credentials for ${validatedData.ip_address}`,
            }])
            .select()
            .single();

          if (credError) throw credError;

          // Encrypt and store password via edge function
          const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
            body: {
              type: 'credential_set',
              credential_set_id: newCredSet.id,
              password: manualPassword,
            }
          });

          if (encryptError) {
            // Clean up credential set if encryption fails
            await supabase.from("credential_sets").delete().eq('id', newCredSet.id);
            throw new Error('Failed to encrypt credentials: ' + encryptError.message);
          }

          credentialSetIdToUse = newCredSet.id;
        } else {
          // For manual credentials without save, encrypt for server record
          if (newServer?.id) {
            const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
              body: {
                type: 'server',
                server_id: newServer.id,
                username: manualUsername,
                password: manualPassword,
              }
            });

            if (encryptError) {
              console.error('Failed to encrypt server credentials:', encryptError);
              // Don't throw - server was created successfully
            }
          }
        }
      }

      // Step 2.5: Update server with credential_set_id if using saved credentials or created new credential set
      if (credentialSetIdToUse && (credentialMode === "saved" || (credentialMode === "manual" && saveCredentials))) {
        await supabase
          .from("servers")
          .update({ credential_set_id: credentialSetIdToUse })
          .eq('id', newServer.id);
      }

      // Step 3: Create discovery job if auto-discover is enabled
      if (autoDiscover && user) {
        const jobData: any = {
          job_type: "discovery_scan" as const,
          created_by: user.id,
          target_scope: {
            server_ids: [newServer.id],
          },
          credential_set_ids: credentialMode === "manual" && !saveCredentials
            ? null
            : [credentialSetIdToUse],
          details: credentialMode === "manual" && !saveCredentials
            ? {
                manual_credentials: {
                  username: manualUsername,
                  password: manualPassword,
                }
              }
            : null,
        };

        const { error: jobError } = await supabase
          .from("jobs")
          .insert([jobData]);

        if (jobError) throw jobError;

        toast({
          title: "Server Added Successfully",
          description: "Discovery job created - check Activity Monitor for progress",
        });
      } else {
        toast({
          title: "Server Added",
          description: "Server has been added to inventory",
        });
      }

      // Reset form
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error Adding Server",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ ip_address: "", hostname: "", notes: "" });
    setManualUsername("");
    setManualPassword("");
    setSaveCredentials(false);
    setCredentialName("");
    setAutoDiscover(true);
    setCurrentTab("info");
    setTestingConnection(false);
    setTestResult(null);
    setTestJobId(null);
  };

  const handleTestConnection = async () => {
    if (!formData.ip_address) {
      toast({ title: "Enter an IP address first", variant: "destructive" });
      return;
    }
    
    setTestingConnection(true);
    setTestResult({ status: 'idle' });
    
    try {
      // Create test_credentials job
      const jobPayload: any = {
        job_type: 'test_credentials' as const,
        target_scope: { ip_address: formData.ip_address },
        created_by: user?.id,
        status: 'pending' as const,
      };
      
      if (credentialMode === 'saved' && selectedCredentialSetId) {
        jobPayload.credential_set_ids = [selectedCredentialSetId];
      } else {
        // Pass manual credentials in details
        jobPayload.details = {
          username: manualUsername,
          password: manualPassword
        };
      }
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert([jobPayload])
        .select()
        .single();
      
      if (error) throw error;
      
      setTestJobId(job.id);
      
      // Poll job status
      let pollAttempts = 0;
      const maxAttempts = 15; // 30 seconds
      
      const pollInterval = setInterval(async () => {
        pollAttempts++;
        
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();
        
        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setTestingConnection(false);
          setShowLocalHelper(false); // Hide helper on success
          const details = updatedJob.details as any;
          setTestResult({
            status: 'success',
            message: details?.message || 'Connection successful',
            details: details
          });
          toast({ title: "✓ Connection successful", variant: "default" });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setTestingConnection(false);
          const details = updatedJob.details as any;
          setTestResult({
            status: 'failed',
            message: details?.message || 'Connection failed',
            details: details
          });
          toast({ 
            title: "✗ Connection failed", 
            description: details?.message || 'Connection failed',
            variant: "destructive" 
          });
        } else if (pollAttempts >= maxAttempts) {
          clearInterval(pollInterval);
          setTestingConnection(false);
          setShowLocalHelper(isLocalMode); // Show helper in local mode
          setTestResult({ 
            status: 'failed', 
            message: 'Test timed out - check Job Executor is running' 
          });
          toast({
            title: "Test timed out",
            description: "Make sure Job Executor is running",
            variant: "destructive"
          });
        }
      }, 2000); // Poll every 2 seconds
      
    } catch (error: any) {
      setTestingConnection(false);
      setTestResult({ status: 'failed', message: error.message });
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    }
  };

  const canProceedToCredentials = formData.ip_address.trim() !== "";
  const canProceedToDiscovery = canProceedToCredentials && (
    credentialMode === "saved" && selectedCredentialSetId ||
    credentialMode === "manual" && manualUsername && manualPassword
  );
  const canSubmit = canProceedToDiscovery;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add Dell Server</DialogTitle>
          <DialogDescription>
            Configure server details, credentials, and auto-discovery options
          </DialogDescription>
        </DialogHeader>

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="info" className="gap-2">
              <Server className="h-4 w-4" />
              Server Info
            </TabsTrigger>
            <TabsTrigger value="credentials" disabled={!canProceedToCredentials} className="gap-2">
              <Key className="h-4 w-4" />
              Credentials
            </TabsTrigger>
            <TabsTrigger value="discovery" disabled={!canProceedToDiscovery} className="gap-2">
              <Search className="h-4 w-4" />
              Discovery
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="max-h-[50vh] pr-4 mt-4">
            <form id="add-server-form" onSubmit={handleSubmit}>
              {/* Tab 1: Server Info */}
              <TabsContent value="info" className="space-y-4 mt-0">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ip_address">iDRAC IP Address *</Label>
                    <Input
                      id="ip_address"
                      value={formData.ip_address}
                      onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                      placeholder="192.168.1.100"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      The IP address of the Dell iDRAC interface
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="hostname">Hostname (Optional)</Label>
                    <Input
                      id="hostname"
                      value={formData.hostname}
                      onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                      placeholder="e.g., server01"
                    />
                    <p className="text-xs text-muted-foreground">
                      Will be fetched automatically during discovery
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes (Optional)</Label>
                    <Textarea
                      id="notes"
                      placeholder="Any additional notes about this server..."
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={() => setCurrentTab("credentials")}
                    disabled={!canProceedToCredentials}
                    className="w-full"
                  >
                    Next: Credentials
                  </Button>
                </div>
              </TabsContent>

              {/* Tab 2: Credentials */}
              <TabsContent value="credentials" className="space-y-4 mt-0">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    iDRAC credentials are required to fetch server details via the Redfish API
                  </AlertDescription>
                </Alert>

                <RadioGroup value={credentialMode} onValueChange={(v) => setCredentialMode(v as "saved" | "manual")}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="saved" id="saved" />
                    <Label htmlFor="saved" className="font-normal cursor-pointer">
                      Use saved credential set
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="manual" />
                    <Label htmlFor="manual" className="font-normal cursor-pointer">
                      Enter credentials manually
                    </Label>
                  </div>
                </RadioGroup>

                {credentialMode === "saved" ? (
                  <div className="space-y-2">
                    <Label>Credential Set</Label>
                    {credentialSets.length > 0 ? (
                      <Select value={selectedCredentialSetId} onValueChange={setSelectedCredentialSetId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select credential set" />
                        </SelectTrigger>
                        <SelectContent>
                          {credentialSets.map((set) => (
                            <SelectItem key={set.id} value={set.id}>
                              {set.name} ({set.username})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          No saved credentials found. Switch to manual entry or create credential sets in Settings.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="manual_username">Username *</Label>
                      <Input
                        id="manual_username"
                        value={manualUsername}
                        onChange={(e) => setManualUsername(e.target.value)}
                        placeholder="root"
                        required={credentialMode === "manual"}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="manual_password">Password *</Label>
                      <Input
                        id="manual_password"
                        type="password"
                        value={manualPassword}
                        onChange={(e) => setManualPassword(e.target.value)}
                        placeholder="••••••••"
                        required={credentialMode === "manual"}
                      />
                    </div>

                    <div className="flex items-start space-x-2 p-3 border rounded-md">
                      <Checkbox
                        id="save_credentials"
                        checked={saveCredentials}
                        onCheckedChange={(checked) => setSaveCredentials(checked as boolean)}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="save_credentials" className="font-normal cursor-pointer">
                          Save these credentials for future use
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Credentials will be stored securely and can be reused for other servers
                        </p>
                      </div>
                    </div>

                    {saveCredentials && (
                      <div className="space-y-2">
                        <Label htmlFor="credential_name">Credential Set Name</Label>
                        <Input
                          id="credential_name"
                          value={credentialName}
                          onChange={(e) => setCredentialName(e.target.value)}
                          placeholder={`${formData.ip_address} Credentials`}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Test Connection */}
                <div className="mt-6 space-y-3 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testingConnection || !formData.ip_address || 
                      (credentialMode === 'saved' && !selectedCredentialSetId) ||
                      (credentialMode === 'manual' && (!manualUsername || !manualPassword))}
                    className="w-full"
                  >
                    {testingConnection ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing Connection...
                      </>
                    ) : (
                      <>
                        <Key className="mr-2 h-4 w-4" />
                        Test Connection
                      </>
                    )}
                  </Button>
                  
                  {testResult && testResult.status !== 'idle' && (
                    <Alert variant={testResult.status === 'success' ? 'default' : 'destructive'}>
                      <AlertDescription>
                        {testResult.status === 'success' ? '✓' : '✗'} {testResult.message}
                        {testResult.details?.idrac_version && (
                          <div className="mt-1 text-xs opacity-80">
                            iDRAC Version: {testResult.details.idrac_version}
                          </div>
                        )}
                        {testResult.details?.product && (
                          <div className="text-xs opacity-80">
                            Product: {testResult.details.product}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {/* Show helper banner in local mode when job times out */}
                  <LocalModeHelper show={showLocalHelper} />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentTab("info")}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setCurrentTab("discovery")}
                    disabled={!canProceedToDiscovery}
                    className="flex-1"
                  >
                    Next: Discovery
                  </Button>
                </div>
              </TabsContent>

              {/* Tab 3: Discovery */}
              <TabsContent value="discovery" className="space-y-4 mt-0">
                <div className="flex items-start space-x-2 p-4 border rounded-md">
                  <Checkbox
                    id="auto_discover"
                    checked={autoDiscover}
                    onCheckedChange={(checked) => setAutoDiscover(checked as boolean)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="auto_discover" className="font-normal cursor-pointer text-base">
                      Automatically fetch server details from iDRAC
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Recommended - A discovery job will be created to populate all server information
                    </p>
                  </div>
                </div>

                {autoDiscover && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      <strong>What will be fetched:</strong>
                      <ul className="list-disc ml-4 mt-2 space-y-1 text-sm">
                        <li>Hostname and service tag</li>
                        <li>Server model and hardware specs (CPU, RAM)</li>
                        <li>iDRAC firmware version</li>
                        <li>BIOS version</li>
                        <li>Current connection status</li>
                      </ul>
                      <p className="mt-3 text-sm">
                        <strong>Note:</strong> The Job Executor must be running to process this discovery job.
                      </p>
                    </AlertDescription>
                  </Alert>
                )}

                {!autoDiscover && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Server will be added with minimal information only. You can run a discovery job later.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentTab("credentials")}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading || !canSubmit}
                    className="flex-1"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      "Add Server"
                    )}
                  </Button>
                </div>
              </TabsContent>
            </form>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
