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
import { Loader2, Info, Server, Key, Search, FolderPlus, Cpu, Activity, Settings, HardDrive, Network, MemoryStick, FileArchive, Zap, Sparkles, RefreshCw } from "lucide-react";
import { parseIdracError } from "@/lib/idrac-errors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BackendStatusHelper } from "./BackendStatusHelper";
import { serverSchema, credentialSchema, safeValidateInput } from "@/lib/validations";
import { useIdracSettings } from "@/hooks/useIdracSettings";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Fetch options configuration - consistent with IdracSettingsDialog
const FETCH_OPTIONS = [
  {
    key: "firmware" as const,
    label: "Firmware Versions",
    description: "iDRAC, BIOS, NIC, RAID firmware",
    icon: Cpu,
  },
  {
    key: "health" as const,
    label: "Health Status",
    description: "Power, sensors, fans, temps",
    icon: Activity,
  },
  {
    key: "bios" as const,
    label: "BIOS Settings",
    description: "Current configuration",
    icon: Settings,
  },
  {
    key: "storage" as const,
    label: "Storage / WWNs",
    description: "Drives, RAID, datastore correlation",
    icon: HardDrive,
  },
  {
    key: "nics" as const,
    label: "NIC MACs",
    description: "Network adapters",
    icon: Network,
  },
  {
    key: "memory" as const,
    label: "Memory/DIMMs",
    description: "Per-DIMM health and slots",
    icon: MemoryStick,
  },
  {
    key: "scp_backup" as const,
    label: "SCP Backup",
    description: "Full config backup (slower)",
    icon: FileArchive,
  },
];

const SCP_AGE_THRESHOLDS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

export const AddServerDialog = ({ open, onOpenChange, onSuccess }: AddServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState("info");
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Detect local mode first (before using it)
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
  
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
  
  // Discovery state - default OFF in Local Mode for safety
  const [autoDiscover, setAutoDiscover] = useState(!isLocalMode);
  
  // Fetch options state - granular control over what to collect
  const [fetchOptions, setFetchOptions] = useState({
    firmware: true,
    health: true,
    bios: true,
    storage: true,
    nics: true,
    memory: true,
    scp_backup: false,
  });
  const [scpMaxAgeDays, setScpMaxAgeDays] = useState("30");
  const [scpOnlyIfStale, setScpOnlyIfStale] = useState(true);
  
  // Group assignment state
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [serverGroups, setServerGroups] = useState<any[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  
  // Test connection state
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'failed';
    message?: string;
    details?: any;
  } | null>(null);
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const [showLocalHelper, setShowLocalHelper] = useState(false);

  // Load global iDRAC settings as defaults
  const { globalSettings, loading: loadingSettings } = useIdracSettings();

  // Fetch credential sets and groups on mount
  useEffect(() => {
    if (open) {
      fetchCredentialSets();
      fetchServerGroups();
    }
  }, [open]);

  // Initialize fetch options from global settings
  useEffect(() => {
    if (!loadingSettings && globalSettings) {
      setFetchOptions({
        firmware: globalSettings.fetch_firmware,
        health: globalSettings.fetch_health,
        bios: globalSettings.fetch_bios,
        storage: globalSettings.fetch_storage,
        nics: globalSettings.fetch_nics,
        memory: (globalSettings as any).fetch_memory ?? true,
        scp_backup: globalSettings.fetch_scp_backup,
      });
      setScpMaxAgeDays(String(globalSettings.scp_backup_max_age_days ?? 30));
      setScpOnlyIfStale(globalSettings.scp_backup_only_if_stale ?? true);
    }
  }, [loadingSettings, globalSettings]);

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

  const fetchServerGroups = async () => {
    setLoadingGroups(true);
    try {
      const { data } = await supabase
        .from("server_groups")
        .select("id, name, description")
        .order("name");
      setServerGroups(data || []);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleFetchOptionChange = (key: keyof typeof fetchOptions, checked: boolean) => {
    setFetchOptions(prev => ({ ...prev, [key]: checked }));
  };

  const applyPreset = (preset: "essential" | "full") => {
    if (preset === "essential") {
      setFetchOptions({
        firmware: true,
        health: true,
        bios: false,
        storage: true,
        nics: false,
        memory: false,
        scp_backup: false,
      });
    } else {
      setFetchOptions({
        firmware: true,
        health: true,
        bios: true,
        storage: true,
        nics: true,
        memory: true,
        scp_backup: false,
      });
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
      
      // Check if test connection detected legacy SSL requirement
      const requiresLegacySsl = testResult?.details?.legacy_ssl === true;
      
      const serverData: any = {
        ip_address: validatedData.ip_address,
        hostname: validatedData.hostname || null,
        notes: validatedData.notes || null,
        last_seen: new Date().toISOString(),
        credential_set_id: credentialMode === "saved" ? selectedCredentialSetId : null,
        requires_legacy_ssl: requiresLegacySsl,
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

      // Step 2.6: Add server to group if selected
      if (selectedGroupId && newServer?.id) {
        await supabase.from("server_group_members").insert({
          group_id: selectedGroupId,
          server_id: newServer.id,
        });
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
          details: {
            ...(credentialMode === "manual" && !saveCredentials ? {
              manual_credentials: {
                username: manualUsername,
                password: manualPassword,
              }
            } : {}),
            fetch_options: {
              ...fetchOptions,
              scp_backup_max_age_days: parseInt(scpMaxAgeDays),
              scp_backup_only_if_stale: scpOnlyIfStale,
            },
          },
        };

        const { error: jobError } = await supabase
          .from("jobs")
          .insert([jobData]);

        if (jobError) throw jobError;
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
    setAutoDiscover(!isLocalMode);
    setFetchOptions({
      firmware: true,
      health: true,
      bios: true,
      storage: true,
      nics: true,
      memory: true,
      scp_backup: false,
    });
    setSelectedGroupId(null);
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
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setTestingConnection(false);
          const details = updatedJob.details as any;
          const rawError = details?.error || details?.message || 'Connection failed';
          
          // Parse iDRAC-specific error for better UX
          const parsedError = parseIdracError(rawError);
          
          setTestResult({
            status: 'failed',
            message: parsedError?.message || rawError,
            details: {
              ...details,
              parsedError, // Include parsed error info for UI
            }
          });
          toast({ 
            title: parsedError?.title || "Connection failed", 
            description: parsedError?.message || rawError,
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

  // Count enabled fetch options for summary
  const enabledOptionsCount = Object.values(fetchOptions).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add Dell Server</DialogTitle>
          <DialogDescription>
            Configure server details, credentials, discovery options, and group assignment
          </DialogDescription>
        </DialogHeader>

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info" className="gap-2">
              <Server className="h-4 w-4" />
              Info
            </TabsTrigger>
            <TabsTrigger value="credentials" disabled={!canProceedToCredentials} className="gap-2">
              <Key className="h-4 w-4" />
              Credentials
            </TabsTrigger>
            <TabsTrigger value="discovery" disabled={!canProceedToDiscovery} className="gap-2">
              <Search className="h-4 w-4" />
              Discovery
            </TabsTrigger>
            <TabsTrigger value="group" disabled={!canProceedToDiscovery} className="gap-2">
              <FolderPlus className="h-4 w-4" />
              Group
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
                      <AlertDescription className="space-y-2">
                        {testResult.status === 'success' ? (
                          <>
                            <div>✓ {testResult.message}</div>
                            {testResult.details?.legacy_ssl && (
                              <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                                <span className="font-medium text-warning">⚠ Legacy TLS Mode (iDRAC 8)</span>
                                <p className="mt-0.5 opacity-80">
                                  This iDRAC uses older TLS protocols. Compatibility mode enabled automatically.
                                </p>
                              </div>
                            )}
                            {testResult.details?.idrac_version && (
                              <div className="mt-1 text-xs opacity-80">
                                iDRAC Version: {testResult.details.idrac_version}
                                {testResult.details?.legacy_ssl && ' (iDRAC 8)'}
                              </div>
                            )}
                            {testResult.details?.product && (
                              <div className="text-xs opacity-80">
                                Product: {testResult.details.product}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="font-medium">
                              ✗ {testResult.details?.parsedError?.title || 'Connection Failed'}
                            </div>
                            <p className="text-sm">{testResult.message}</p>
                            
                            {testResult.details?.parsedError?.suggestedAction && (
                              <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                                <span className="font-medium">Suggested Action:</span>
                                <p className="mt-0.5 opacity-90">{testResult.details.parsedError.suggestedAction}</p>
                              </div>
                            )}
                            
                            {testResult.details?.parsedError?.isRecoverable && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleTestConnection}
                                disabled={testingConnection}
                                className="mt-2"
                              >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Retry Connection
                              </Button>
                            )}
                          </>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {/* Show helper banner when backend is not responding */}
                  <BackendStatusHelper show={showLocalHelper} />
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
                      A discovery job will be created to populate server information
                    </p>
                  </div>
                </div>

                {autoDiscover && (
                  <>
                    {/* Quick presets */}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyPreset("essential")}
                        className="gap-2"
                      >
                        <Zap className="h-4 w-4" />
                        Essential Only
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyPreset("full")}
                        className="gap-2"
                      >
                        <Sparkles className="h-4 w-4" />
                        Full Onboarding
                      </Button>
                    </div>

                    {/* Granular fetch options */}
                    <div className="border rounded-md p-4 space-y-3">
                      <Label className="text-sm font-medium">Data to Collect</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {FETCH_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          return (
                            <div
                              key={option.key}
                              className="flex items-start space-x-2 p-2 rounded hover:bg-muted/50"
                            >
                              <Checkbox
                                id={`fetch_${option.key}`}
                                checked={fetchOptions[option.key]}
                                onCheckedChange={(checked) =>
                                  handleFetchOptionChange(option.key, checked as boolean)
                                }
                              />
                              <div className="space-y-0.5 flex-1">
                                <Label
                                  htmlFor={`fetch_${option.key}`}
                                  className="font-normal cursor-pointer flex items-center gap-2 text-sm"
                                >
                                  <Icon className="h-4 w-4 text-muted-foreground" />
                                  {option.label}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  {option.description}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* SCP backup options */}
                      {fetchOptions.scp_backup && (
                        <div className="mt-3 pt-3 border-t space-y-3">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id="scp_only_if_stale"
                                checked={scpOnlyIfStale}
                                onCheckedChange={(checked) => setScpOnlyIfStale(checked as boolean)}
                              />
                              <Label htmlFor="scp_only_if_stale" className="text-sm font-normal cursor-pointer">
                                Only if older than
                              </Label>
                            </div>
                            <Select value={scpMaxAgeDays} onValueChange={setScpMaxAgeDays}>
                              <SelectTrigger className="w-[120px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SCP_AGE_THRESHOLDS.map((threshold) => (
                                  <SelectItem key={threshold.value} value={threshold.value}>
                                    {threshold.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Dynamic summary */}
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <strong>What will be fetched ({enabledOptionsCount} options):</strong>
                        <ul className="list-disc ml-4 mt-2 space-y-1 text-sm">
                          {fetchOptions.firmware && <li>Firmware versions (iDRAC, BIOS, NIC, RAID)</li>}
                          {fetchOptions.health && <li>Health status (power, sensors, fans, temps)</li>}
                          {fetchOptions.bios && <li>BIOS settings and boot configuration</li>}
                          {fetchOptions.storage && <li>Storage configuration, RAID volumes, WWNs</li>}
                          {fetchOptions.nics && <li>NIC MAC addresses and configuration</li>}
                          {fetchOptions.memory && <li>Memory/DIMM health and slot information</li>}
                          {fetchOptions.scp_backup && <li>Full SCP configuration backup</li>}
                        </ul>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Estimated time: ~10-15 seconds per server
                        </p>
                      </AlertDescription>
                    </Alert>
                  </>
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
                    type="button"
                    onClick={() => setCurrentTab("group")}
                    className="flex-1"
                  >
                    Next: Group
                  </Button>
                </div>
              </TabsContent>

              {/* Tab 4: Group Assignment */}
              <TabsContent value="group" className="space-y-4 mt-0">
                <Alert>
                  <FolderPlus className="h-4 w-4" />
                  <AlertDescription>
                    Optionally assign this server to a group for easier management and bulk operations.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>Server Group (Optional)</Label>
                  {loadingGroups ? (
                    <div className="flex items-center gap-2 p-4 border rounded-md">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading groups...</span>
                    </div>
                  ) : serverGroups.length > 0 ? (
                    <div className="space-y-2">
                      <div
                        className={`flex items-center space-x-3 p-3 border rounded-md cursor-pointer transition-colors ${
                          selectedGroupId === null ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedGroupId(null)}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          selectedGroupId === null ? "border-primary" : "border-muted-foreground"
                        }`}>
                          {selectedGroupId === null && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">No Group</p>
                          <p className="text-xs text-muted-foreground">Server will be ungrouped</p>
                        </div>
                      </div>
                      
                      {serverGroups.map((group) => (
                        <div
                          key={group.id}
                          className={`flex items-center space-x-3 p-3 border rounded-md cursor-pointer transition-colors ${
                            selectedGroupId === group.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedGroupId(group.id)}
                        >
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedGroupId === group.id ? "border-primary" : "border-muted-foreground"
                          }`}>
                            {selectedGroupId === group.id && (
                              <div className="w-2 h-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{group.name}</p>
                            {group.description && (
                              <p className="text-xs text-muted-foreground">{group.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        No server groups exist yet. You can create groups from the Servers page after adding this server.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentTab("discovery")}
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
