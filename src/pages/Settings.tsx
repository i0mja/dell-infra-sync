import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { validateNetworkPrerequisites } from "@/lib/network-validator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "next-themes";
import { Activity, AlertCircle, Bell, Briefcase, CheckCircle2, ChevronDown, ChevronRight, CloudCog, Copy, Database, Disc, FileText, Globe, Info, Loader2, Mail, MessageSquare, Monitor, Moon, Network, Palette, Plus, RefreshCw, Save, Server, Settings as SettingsIcon, Shield, ShieldAlert, Sun, Terminal, Users, X, XCircle } from "lucide-react";
import { ServerGroupsManagement } from "@/components/settings/ServerGroupsManagement";
import { IdentityProviderSettings } from "@/components/settings/IdentityProviderSettings";
import { AuditLogViewer } from "@/components/settings/AuditLogViewer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DiagnosticsDialog } from "@/components/settings/DiagnosticsDialog";
import { JobExecutorDiagnostics } from "@/components/settings/JobExecutorDiagnostics";
import { IsoImageLibrary } from "@/components/settings/IsoImageLibrary";
import { FirmwareLibrary } from "@/components/settings/FirmwareLibrary";
import { useSearchParams } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getTabMetadata, settingsTabs, mapLegacyTabId } from "@/config/settings-tabs";
import { SettingsSection } from "@/components/settings/SettingsSection";

export default function Settings() {
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  
  // Get default tab from query params or use 'general'
  const tabFromUrl = searchParams.get('tab');
  const sectionFromUrl = searchParams.get('section');
  
  // Map legacy tabs to new structure
  const mapped = mapLegacyTabId(tabFromUrl || 'appearance');
  const initialTab = mapped.tab;
  const initialSection = sectionFromUrl || mapped.section;
  
  const [activeTab, setActiveTab] = useState(initialTab);
  const [defaultOpenSection, setDefaultOpenSection] = useState(initialSection);

  // SMTP Settings
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");

  // Teams Settings
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [testingTeams, setTestingTeams] = useState(false);
  const [recentNotifications, setRecentNotifications] = useState<any[]>([]);
  const [teamsMentionUsers, setTeamsMentionUsers] = useState("");
  const [mentionOnCriticalFailures, setMentionOnCriticalFailures] = useState(true);
  const [criticalJobTypes, setCriticalJobTypes] = useState<string[]>(['firmware_update', 'full_server_update']);

  // Notification Preferences
  const [notifyOnJobComplete, setNotifyOnJobComplete] = useState(true);
  const [notifyOnJobFailed, setNotifyOnJobFailed] = useState(true);
  const [notifyOnJobStarted, setNotifyOnJobStarted] = useState(false);

  // OpenManage Settings
  const [omeSettingsId, setOmeSettingsId] = useState<string | null>(null);
  const [omeHost, setOmeHost] = useState("");
  const [omePort, setOmePort] = useState(443);
  const [omeUsername, setOmeUsername] = useState("");
  const [omePassword, setOmePassword] = useState("");
  const [omeVerifySSL, setOmeVerifySSL] = useState(true);
  const [omeSyncEnabled, setOmeSyncEnabled] = useState(false);
  const [omeLastSync, setOmeLastSync] = useState<string | null>(null);
  const [omeSyncing, setOmeSyncing] = useState(false);
  const [isOpenManageSyncing, setIsOpenManageSyncing] = useState(false);
  
  // API Token state
  const [apiTokens, setApiTokens] = useState<any[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showTokenDialog, setShowTokenDialog] = useState(false);

  // Activity Monitor Settings
  const [activitySettingsId, setActivitySettingsId] = useState<string | null>(null);
  // Job Executor is always enabled - iDRACs are always on private networks
  const useJobExecutorForIdrac = true;
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<'all' | 'errors_only' | 'slow_only'>('all');
  const [slowCommandThreshold, setSlowCommandThreshold] = useState(5000);
  const [maxRequestBodyKb, setMaxRequestBodyKb] = useState(100);
  const [maxResponseBodyKb, setMaxResponseBodyKb] = useState(100);

  // iDRAC Safety Settings (kill switch & throttling)
  const [pauseIdracOperations, setPauseIdracOperations] = useState(false);
  const [discoveryMaxThreads, setDiscoveryMaxThreads] = useState(5);
  const [idracRequestDelayMs, setIdracRequestDelayMs] = useState(500);
  const [idracMaxConcurrent, setIdracMaxConcurrent] = useState(4);

  // Deployment Mode Detection
  const getDeploymentMode = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    if (supabaseUrl.includes('supabase.co')) {
      return { mode: 'Cloud-Connected', color: 'bg-blue-500', description: 'Connected to Lovable Cloud' };
    }
    return { mode: 'Air-Gapped', color: 'bg-green-500', description: 'Self-hosted with local backend' };
  };

  const deploymentInfo = getDeploymentMode();
  const [alertOnFailures, setAlertOnFailures] = useState(true);
  const [alertOnSlowCommands, setAlertOnSlowCommands] = useState(false);
  const [keepStatistics, setKeepStatistics] = useState(true);
  const [statisticsRetentionDays, setStatisticsRetentionDays] = useState(365);
  const [cleaningUp, setCleaningUp] = useState(false);
  
  // Job Retention Settings
  const [jobRetentionDays, setJobRetentionDays] = useState(90);
  const [jobAutoCleanupEnabled, setJobAutoCleanupEnabled] = useState(true);
  const [jobLastCleanupAt, setJobLastCleanupAt] = useState<string | null>(null);
  const [jobCleaningUp, setJobCleaningUp] = useState(false);
  
  // Stale Job Settings
  const [stalePendingHours, setStalePendingHours] = useState(24);
  const [staleRunningHours, setStaleRunningHours] = useState(48);
  const [autoCancelStaleJobs, setAutoCancelStaleJobs] = useState(true);
  const [staleJobCount, setStaleJobCount] = useState(0);

  // SCP Share Settings (for older iDRAC firmware)
  const [scpShareEnabled, setScpShareEnabled] = useState(false);
  const [scpShareType, setScpShareType] = useState<'CIFS' | 'NFS'>('CIFS');
  const [scpSharePath, setScpSharePath] = useState("");
  const [scpShareUsername, setScpShareUsername] = useState("");
  const [scpSharePassword, setScpSharePassword] = useState("");

  // Scheduled cluster safety checks
  const [scheduledChecksEnabled, setScheduledChecksEnabled] = useState(false);
  const [checkFrequency, setCheckFrequency] = useState('0 */6 * * *');
  const [checkAllClusters, setCheckAllClusters] = useState(true);
  const [specificClusters, setSpecificClusters] = useState<string[]>([]);
  const [minRequiredHosts, setMinRequiredHosts] = useState(2);
  const [notifyOnUnsafeCluster, setNotifyOnUnsafeCluster] = useState(true);
  const [notifyOnClusterWarning, setNotifyOnClusterWarning] = useState(false);
  const [notifyOnClusterStatusChange, setNotifyOnClusterStatusChange] = useState(true);
  const [lastScheduledCheck, setLastScheduledCheck] = useState<any>(null);
  const [runningScheduledCheck, setRunningScheduledCheck] = useState(false);
  const [scheduledCheckId, setScheduledCheckId] = useState<string | null>(null);

  // Credential Sets State
  const [credentialSets, setCredentialSets] = useState<any[]>([]);
  const [editingCredential, setEditingCredential] = useState<any | null>(null);
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [testingCredential, setTestingCredential] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testIp, setTestIp] = useState("");

  // IP Range Management State
  const [showIpRangeDialog, setShowIpRangeDialog] = useState(false);
  const [selectedCredentialForIpRanges, setSelectedCredentialForIpRanges] = useState<any | null>(null);
  const [ipRanges, setIpRanges] = useState<any[]>([]);
  const [newIpRange, setNewIpRange] = useState("");
  const [newIpRangeDescription, setNewIpRangeDescription] = useState("");
  const [editingIpRange, setEditingIpRange] = useState<any | null>(null);
  
  // Temp state for inline IP range management in credential dialog
  const [tempIpRanges, setTempIpRanges] = useState<Array<{ start_ip: string; end_ip: string }>>([]);
  const [newInlineIpRange, setNewInlineIpRange] = useState({ start_ip: "", end_ip: "" });
  const [ipRangeExpanded, setIpRangeExpanded] = useState(false);

  // Form state for credential dialog
  const [credentialForm, setCredentialForm] = useState({
    name: '',
    username: '',
    password: '',
    description: '',
    priority: 100,
    is_default: false,
  });

  // Network Testing State
  const [servers, setServers] = useState<any[]>([]);
  const [vcenterSettings, setVCenterSettings] = useState<any | null>(null);
  const [testingServers, setTestingServers] = useState<Map<string, boolean>>(new Map());
  const [serverTestResults, setServerTestResults] = useState<Map<string, any>>(new Map());
  const [testingVCenter, setTestingVCenter] = useState(false);
  const [vcenterTestResult, setVCenterTestResult] = useState<any | null>(null);
  const [testingAllServers, setTestingAllServers] = useState(false);

  // Network Settings State
  const [networkSettingsId, setNetworkSettingsId] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [readTimeout, setReadTimeout] = useState(60);
  const [operationTimeout, setOperationTimeout] = useState(300);
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(3);
  const [retryBackoffType, setRetryBackoffType] = useState<'exponential' | 'linear' | 'fixed'>('exponential');
  const [retryDelay, setRetryDelay] = useState(2);
  const [maxConcurrentConnections, setMaxConcurrentConnections] = useState(5);
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = useState(60);
  const [requirePrereqValidation, setRequirePrereqValidation] = useState(true);
  const [monitorLatency, setMonitorLatency] = useState(true);
  const [latencyAlertThreshold, setLatencyAlertThreshold] = useState(1000);
  const [validatingPrereqs, setValidatingPrereqs] = useState(false);
  const [prereqResults, setPrereqResults] = useState<any | null>(null);

  // Virtual Media Settings
  const [vmSettingsId, setVmSettingsId] = useState<string | null>(null);
  const [vmShareType, setVmShareType] = useState<'nfs' | 'cifs' | 'http' | 'https'>('nfs');
  const [vmHost, setVmHost] = useState("");
  const [vmExportPath, setVmExportPath] = useState("");
  const [vmIsoPath, setVmIsoPath] = useState("");
  const [vmUseAuth, setVmUseAuth] = useState(false);
  const [vmUsername, setVmUsername] = useState("");
  const [vmPassword, setVmPassword] = useState("");
  const [vmNotes, setVmNotes] = useState("");
  const [vmTestResult, setVmTestResult] = useState<{ success: boolean; message: string; files?: string[]; baseUrl?: string; latency_ms?: number; port?: number; listing_error?: string; } | null>(null);
  const [testingVirtualMediaShare, setTestingVirtualMediaShare] = useState(false);

  // Job Executor Configuration
  const [serviceRoleKey, setServiceRoleKey] = useState<string | null>(null);
  const [loadingServiceKey, setLoadingServiceKey] = useState(false);
  const [serviceKeyCopied, setServiceKeyCopied] = useState(false);
  const [executionLog, setExecutionLog] = useState<any[]>([]);
  const [showExecutionLog, setShowExecutionLog] = useState(true);
  const [diagnosticsData, setDiagnosticsData] = useState<any | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [showDiagnosticsDialog, setShowDiagnosticsDialog] = useState(false);

  useEffect(() => {
    loadSettings();
    loadApiTokens();
    fetchStaleJobCount();
    loadRecentNotifications();
    loadCredentialSets();
    loadServersAndVCenter();
    loadNetworkSettings();
    loadVirtualMediaSettings();
  }, []);

  const loadServersAndVCenter = async () => {
    // Load servers
    const { data: serversData } = await supabase
      .from('servers')
      .select('*')
      .order('hostname');
    if (serversData) setServers(serversData);

    // Load vCenter settings
    const { data: vcenterData } = await supabase
      .from('vcenter_settings')
      .select('*')
      .maybeSingle();
    if (vcenterData) setVCenterSettings(vcenterData);
  };

  const testIdracServer = async (serverId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    // Check if server has credentials assigned
    if (!server.credential_set_id) {
      toast({
        title: "Credentials Required",
        description: "Assign credentials to this server first",
        variant: "destructive",
      });
      return;
    }

    setTestingServers(new Map(testingServers.set(serverId, true)));
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const startTime = Date.now();
      
      // Create test_credentials job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: server.ip_address },
          credential_set_ids: [server.credential_set_id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          const responseTime = Date.now() - startTime;
          const details = updatedJob.details as any;
          
          const testResult = {
            success: true,
            response_time_ms: details?.response_time_ms || responseTime,
            last_tested: new Date().toISOString(),
            error: undefined,
            version: details?.idrac_version,
          };

          setServerTestResults(new Map(serverTestResults.set(serverId, testResult)));
          setTestingServers(new Map(testingServers.set(serverId, false)));

          toast({
            title: "Connection Successful",
            description: `${server.hostname || server.ip_address} is online (${testResult.response_time_ms}ms)`,
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          const details = updatedJob.details as any;
          
          const testResult = {
            success: false,
            response_time_ms: 0,
            last_tested: new Date().toISOString(),
            error: details?.message || 'Connection failed',
          };
          
          setServerTestResults(new Map(serverTestResults.set(serverId, testResult)));
          setTestingServers(new Map(testingServers.set(serverId, false)));

          toast({
            title: "Connection Failed",
            description: testResult.error,
            variant: "destructive",
          });
        }
      }, 2000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (testingServers.get(serverId)) {
          setTestingServers(new Map(testingServers.set(serverId, false)));
          toast({
            title: "Test Timed Out",
            description: "Job Executor may not be running",
            variant: "destructive",
          });
        }
      }, 30000);

    } catch (error: any) {
      const result = {
        success: false,
        response_time_ms: 0,
        last_tested: new Date().toISOString(),
        error: error.message,
      };
      setServerTestResults(new Map(serverTestResults.set(serverId, result)));
      setTestingServers(new Map(testingServers.set(serverId, false)));
      
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const testAllServers = async () => {
    if (servers.length === 0) {
      toast({
        title: "No Servers",
        description: "Add servers first to test connectivity",
        variant: "destructive",
      });
      return;
    }

    setTestingAllServers(true);
    toast({
      title: "Testing All Servers",
      description: `Testing connectivity to ${servers.length} servers...`,
    });

    for (const server of servers) {
      await testIdracServer(server.id);
    }

    setTestingAllServers(false);
    toast({
      title: "Testing Complete",
      description: "All server connectivity tests completed",
    });
  };

  const testVCenterConnection = async () => {
    if (!vcenterSettings) {
      toast({
        title: "vCenter Not Configured",
        description: "Configure vCenter settings first",
        variant: "destructive",
      });
      return;
    }

    setTestingVCenter(true);
    
    try {
      // Call the edge function instead of direct browser fetch
      // This avoids CORS issues with vCenter API
      const { data, error } = await supabase.functions.invoke('test-vcenter-connection');
      
      if (error) {
        throw new Error(error.message);
      }

      setVCenterTestResult({
        success: true,
        response_time_ms: data.response_time_ms || 0,
        last_tested: new Date().toISOString(),
        version: data.version,
      });

      toast({
        title: "vCenter Connection Successful",
        description: `Connected to vCenter (${data.response_time_ms}ms)${data.version ? ` - Version: ${data.version}` : ''}`,
      });
    } catch (error: any) {
      setVCenterTestResult({
        success: false,
        response_time_ms: 0,
        last_tested: new Date().toISOString(),
        error: error.message,
      });
      
      toast({
        title: "vCenter Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTestingVCenter(false);
    }
  };

  // Sync activeTab with URL params when they change
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    const newTab = tabFromUrl === 'activity-monitor' ? 'activity' : tabFromUrl === 'jobs' ? 'jobs' : tabFromUrl || 'appearance';
    setActiveTab(newTab);
  }, [searchParams]);

  // Tab metadata for dynamic headers
  const tabMetadata = getTabMetadata();

  const loadRecentNotifications = async () => {
    const { data, error } = await supabase
      .from('notification_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Error loading notification logs:', error);
      return;
    }
    
    setRecentNotifications(data || []);
  };

  const handleTestTeamsNotification = async () => {
    if (!teamsWebhookUrl) {
      toast({
        title: "Webhook URL Required",
        description: "Please enter a Teams webhook URL before testing",
        variant: "destructive",
      });
      return;
    }

    setTestingTeams(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('send-notification', {
        body: { isTest: true, testMessage: 'Test notification from Dell Server Manager' }
      });
      
      if (error) throw error;

      if (result?.success) {
        toast({
          title: "Test Notification Sent",
          description: "Check your Teams channel for the test message",
        });
        await loadRecentNotifications();
      } else {
        throw new Error(result?.error || 'Failed to send notification');
      }
    } catch (error: any) {
      toast({
        title: "Test Failed",
        description: error.message || "Failed to send test notification",
        variant: "destructive",
      });
    } finally {
      setTestingTeams(false);
    }
  };

  const loadApiTokens = async () => {
    const { data, error } = await supabase
      .from('api_tokens')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast({
        title: "Error loading API tokens",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    
    setApiTokens(data || []);
  };

  const generateApiToken = async () => {
    if (!newTokenName.trim()) {
      toast({
        title: "Token name required",
        description: "Please enter a name for your API token",
        variant: "destructive",
      });
      return;
    }

    // Generate a random token (32 bytes = 64 hex chars)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Hash the token for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase
      .from('api_tokens')
      .insert([{
        user_id: user?.id,
        name: newTokenName,
        token_hash: tokenHash,
      }] as any);

    if (error) {
      toast({
        title: "Error generating token",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setGeneratedToken(token);
    setShowTokenDialog(true);
    setNewTokenName("");
    loadApiTokens();
    
    toast({
      title: "API token generated",
      description: "Make sure to copy it now, you won't be able to see it again",
    });
  };

  const deleteApiToken = async (tokenId: string) => {
    const { error } = await supabase
      .from('api_tokens')
      .delete()
      .eq('id', tokenId);

    if (error) {
      toast({
        title: "Error deleting token",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    loadApiTokens();
    toast({
      title: "Token deleted",
      description: "The API token has been revoked",
    });
  };

  const saveScheduledCheckConfig = async () => {
    if (userRole !== 'admin') {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify scheduled check settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const configData = {
        enabled: scheduledChecksEnabled,
        schedule_cron: checkFrequency,
        check_all_clusters: checkAllClusters,
        specific_clusters: specificClusters,
        min_required_hosts: minRequiredHosts,
        notify_on_unsafe: notifyOnUnsafeCluster,
        notify_on_warnings: notifyOnClusterWarning,
        notify_on_safe_to_unsafe_change: notifyOnClusterStatusChange,
        updated_at: new Date().toISOString()
      };

      if (scheduledCheckId) {
        const { error } = await supabase
          .from('scheduled_safety_checks')
          .update(configData)
          .eq('id', scheduledCheckId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('scheduled_safety_checks')
          .insert(configData)
          .select()
          .single();
        if (error) throw error;
        setScheduledCheckId(data.id);
      }

      toast({
        title: "Success",
        description: "Scheduled check configuration saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const runScheduledChecksNow = async () => {
    setRunningScheduledCheck(true);
    try {
      const { error } = await supabase.rpc('run_scheduled_cluster_safety_checks');
      if (error) throw error;
      
      toast({
        title: "Checks Started",
        description: "Cluster safety checks are running. Check Activity Monitor for results.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRunningScheduledCheck(false);
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setSmtpHost(data.smtp_host || "");
        setSmtpPort(data.smtp_port || 587);
        setSmtpUser(data.smtp_user || "");
        setSmtpPassword(data.smtp_password || "");
        setSmtpFromEmail(data.smtp_from_email || "");
      setTeamsWebhookUrl(data.teams_webhook_url || "");
      setNotifyOnJobComplete(data.notify_on_job_complete ?? true);
      setNotifyOnJobFailed(data.notify_on_job_failed ?? true);
      setNotifyOnJobStarted(data.notify_on_job_started ?? false);
      setTeamsMentionUsers(data.teams_mention_users || "");
      setMentionOnCriticalFailures(data.mention_on_critical_failures ?? true);
      setCriticalJobTypes(data.critical_job_types || ['firmware_update', 'full_server_update']);
      setTeamsMentionUsers(data.teams_mention_users || "");
      setMentionOnCriticalFailures(data.mention_on_critical_failures ?? true);
      setCriticalJobTypes(data.critical_job_types || ['firmware_update', 'full_server_update']);
      }
    } catch (error: any) {
      console.error("Error loading settings:", error);
      toast({
        title: "Error",
        description: "Failed to load notification settings",
        variant: "destructive",
      });
    }

    // Load scheduled safety check configuration
    try {
      const { data: scheduledCheckData } = await supabase
        .from('scheduled_safety_checks')
        .select('*')
        .single();

      if (scheduledCheckData) {
        setScheduledChecksEnabled(scheduledCheckData.enabled);
        setCheckFrequency(scheduledCheckData.schedule_cron);
        setCheckAllClusters(scheduledCheckData.check_all_clusters);
        setSpecificClusters(scheduledCheckData.specific_clusters || []);
        setMinRequiredHosts(scheduledCheckData.min_required_hosts);
        setNotifyOnUnsafeCluster(scheduledCheckData.notify_on_unsafe);
        setNotifyOnClusterWarning(scheduledCheckData.notify_on_warnings);
        setNotifyOnClusterStatusChange(scheduledCheckData.notify_on_safe_to_unsafe_change);
        setLastScheduledCheck(scheduledCheckData);
        setScheduledCheckId(scheduledCheckData.id);
      }
    } catch (error: any) {
      console.error("Error loading scheduled check settings:", error);
    }

    // Load OpenManage settings
    try {
      const { data: omeData, error: omeError } = await supabase
        .from("openmanage_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (omeError) throw omeError;

      if (omeData) {
        setOmeSettingsId(omeData.id);
        setOmeHost(omeData.host || "");
        setOmePort(omeData.port || 443);
        setOmeUsername(omeData.username || "");
        setOmePassword(omeData.password || "");
        setOmeVerifySSL(omeData.verify_ssl ?? true);
        setOmeSyncEnabled(omeData.sync_enabled ?? false);
        setOmeLastSync(omeData.last_sync);
      }
    } catch (error: any) {
      console.error("Error loading OpenManage settings:", error);
    }

    // Load Activity Monitor settings
    try {
      const { data: activityData, error: activityError } = await supabase
        .from("activity_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (activityError) throw activityError;

      if (activityData) {
        setActivitySettingsId(activityData.id);
        setLogRetentionDays(activityData.log_retention_days ?? 30);
        setAutoCleanupEnabled(activityData.auto_cleanup_enabled ?? true);
        setLastCleanupAt(activityData.last_cleanup_at);
        setLogLevel((activityData.log_level ?? 'all') as 'all' | 'errors_only' | 'slow_only');
        setSlowCommandThreshold(activityData.slow_command_threshold_ms ?? 5000);
        setMaxRequestBodyKb(activityData.max_request_body_kb ?? 100);
        setMaxResponseBodyKb(activityData.max_response_body_kb ?? 100);
        setAlertOnFailures(activityData.alert_on_failures ?? true);
        setAlertOnSlowCommands(activityData.alert_on_slow_commands ?? false);
        setKeepStatistics(activityData.keep_statistics ?? true);
        setStatisticsRetentionDays(activityData.statistics_retention_days ?? 365);
        setJobRetentionDays(activityData.job_retention_days ?? 90);
        setJobAutoCleanupEnabled(activityData.job_auto_cleanup_enabled ?? true);
        setJobLastCleanupAt(activityData.job_last_cleanup_at);
        setStalePendingHours(activityData.stale_pending_hours ?? 24);
        setStaleRunningHours(activityData.stale_running_hours ?? 48);
        setAutoCancelStaleJobs(activityData.auto_cancel_stale_jobs ?? true);
        // Load iDRAC safety settings
        setPauseIdracOperations(activityData.pause_idrac_operations ?? false);
        setDiscoveryMaxThreads(activityData.discovery_max_threads ?? 5);
        setIdracRequestDelayMs(activityData.idrac_request_delay_ms ?? 500);
        setIdracMaxConcurrent(activityData.idrac_max_concurrent ?? 4);
        // Load SCP Share settings (for older iDRAC firmware)
        setScpShareEnabled(activityData.scp_share_enabled ?? false);
        setScpShareType((activityData.scp_share_type as 'CIFS' | 'NFS') ?? 'CIFS');
        setScpSharePath(activityData.scp_share_path ?? "");
        setScpShareUsername(activityData.scp_share_username ?? "");
        setScpSharePassword(""); // Never load password from DB
        // useJobExecutorForIdrac is hardcoded to true - no longer stored in database
      }
    } catch (error: any) {
      console.error("Error loading activity settings:", error);
    }
  };

  const loadNetworkSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("network_settings" as any)
        .select("*")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const settings = data as any;
        setNetworkSettingsId(settings.id);
        setConnectionTimeout(settings.connection_timeout_seconds ?? 30);
        setReadTimeout(settings.read_timeout_seconds ?? 60);
        setOperationTimeout(settings.operation_timeout_seconds ?? 300);
        setMaxRetryAttempts(settings.max_retry_attempts ?? 3);
        setRetryBackoffType((settings.retry_backoff_type ?? 'exponential') as 'exponential' | 'linear' | 'fixed');
        setRetryDelay(settings.retry_delay_seconds ?? 2);
        setMaxConcurrentConnections(settings.max_concurrent_connections ?? 5);
        setMaxRequestsPerMinute(settings.max_requests_per_minute ?? 60);
        setRequirePrereqValidation(settings.require_prereq_validation ?? true);
        setMonitorLatency(settings.monitor_latency ?? true);
        setLatencyAlertThreshold(settings.latency_alert_threshold_ms ?? 1000);
      }
    } catch (error: any) {
      console.error("Error loading network settings:", error);
    }
  };

  const handleSaveNetworkSettings = async () => {
    if (!networkSettingsId) {
      toast({
        title: "Error",
        description: "Network settings not initialized",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("network_settings" as any)
        .update({
          connection_timeout_seconds: connectionTimeout,
          read_timeout_seconds: readTimeout,
          operation_timeout_seconds: operationTimeout,
          max_retry_attempts: maxRetryAttempts,
          retry_backoff_type: retryBackoffType,
          retry_delay_seconds: retryDelay,
          max_concurrent_connections: maxConcurrentConnections,
          max_requests_per_minute: maxRequestsPerMinute,
          require_prereq_validation: requirePrereqValidation,
          monitor_latency: monitorLatency,
          latency_alert_threshold_ms: latencyAlertThreshold,
        })
        .eq("id", networkSettingsId);

      if (error) throw error;

      toast({
        title: "Settings saved",
        description: "Network settings updated successfully",
      });
    } catch (error: any) {
      console.error("Error saving network settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save network settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleValidatePrerequisites = async () => {
    setValidatingPrereqs(true);
    setPrereqResults(null);
    setExecutionLog([]);

    try {
      const result = await validateNetworkPrerequisites();

      setPrereqResults(result.results);
      setExecutionLog(result.executionLog || []);
      setShowExecutionLog(true);

      if (result.results.overallStatus === 'passed') {
        toast({
          title: "Validation Passed",
          description: "All network prerequisites are met",
        });
      } else {
        const failedCount = Object.values(result.results).filter((r: any) => r.tested && !r.passed).length;
        toast({
          title: "Validation Issues",
          description: `${failedCount} issue(s) found`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Validation error:", error);
      toast({
        title: "Validation Failed",
        description: error.message || "Failed to validate network prerequisites",
        variant: "destructive",
      });
    } finally {
      setValidatingPrereqs(false);
    }
  };

  const loadVirtualMediaSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('virtual_media_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setVmSettingsId(data.id);
        setVmShareType((data.share_type || 'nfs') as any);
        setVmHost(data.host || "");
        setVmExportPath(data.export_path || "");
        setVmIsoPath(data.iso_path || "");
        setVmUseAuth(data.use_auth ?? false);
        setVmUsername(data.username || "");
        setVmPassword(data.password || "");
        setVmNotes(data.notes || "");
      }
    } catch (error: any) {
      console.error("Error loading virtual media settings:", error);
    }
  };

  const handleSaveVirtualMediaSettings = async () => {
    if (!vmHost) {
      toast({
        title: "Host required",
        description: "Please provide the share host before saving",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        share_type: vmShareType,
        host: vmHost,
        export_path: vmExportPath,
        iso_path: vmIsoPath,
        use_auth: vmUseAuth,
        username: vmUseAuth ? vmUsername : null,
        password: vmUseAuth ? vmPassword : null,
        notes: vmNotes,
      };

      if (vmSettingsId) {
        const { error } = await supabase
          .from('virtual_media_settings')
          .update(payload)
          .eq('id', vmSettingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('virtual_media_settings')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        if (data) setVmSettingsId(data.id);
      }

      toast({
        title: "Settings saved",
        description: "Virtual media defaults updated",
      });
    } catch (error: any) {
      console.error("Error saving virtual media settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save virtual media settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestVirtualMediaShare = async () => {
    if (!vmHost) {
      toast({
        title: "Share host required",
        description: "Enter a host to test virtual media connectivity",
        variant: "destructive",
      });
      return;
    }

    setTestingVirtualMediaShare(true);
    setVmTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-virtual-media-share', {
        body: {
          host: vmHost,
          export_path: vmExportPath,
          iso_path: vmIsoPath,
          share_type: vmShareType,
          username: vmUseAuth ? vmUsername : undefined,
          password: vmUseAuth ? vmPassword : undefined,
          list_files: true,
        }
      });

      if (error) throw error;

      const message = data?.success
        ? `Port ${data.port} reachable${data.latency_ms ? ` (${data.latency_ms}ms)` : ''}`
        : data?.error || 'Share not reachable';

      setVmTestResult({
        success: !!data?.success,
        message,
        files: data?.files || [],
        baseUrl: data?.base_url,
        latency_ms: data?.latency_ms,
        port: data?.port,
        listing_error: data?.listing_error,
      });

      if (data?.success) {
        toast({
          title: "Connectivity confirmed",
          description: message,
        });
      } else {
        toast({
          title: "Connectivity failed",
          description: message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Error testing virtual media share:", error);
      toast({
        title: "Test failed",
        description: error.message || "Unable to reach share",
        variant: "destructive",
      });
    } finally {
      setTestingVirtualMediaShare(false);
    }
  };

  const copyExecutionLog = () => {
    const logText = executionLog.map(entry => 
      `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.status.toUpperCase()} ${entry.method} ${entry.target} ${entry.response_time_ms}ms${entry.details ? ' - ' + entry.details : ''}`
    ).join('\n');
    navigator.clipboard.writeText(logText);
    toast({
      title: "Log Copied",
      description: "Execution log copied to clipboard",
    });
  };

  const loadDiagnostics = async () => {
    setLoadingDiagnostics(true);

    try {
      const { data: diagnosticsResult, error } = await supabase.functions.invoke('network-diagnostics');
      
      if (error) throw error;

      setDiagnosticsData(diagnosticsResult);
    } catch (error: any) {
      console.error("Diagnostics error:", error);
      toast({
        title: "Error",
        description: "Failed to load network diagnostics",
        variant: "destructive",
      });
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const handleSaveSettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify notification settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const settingsData = {
        smtp_host: smtpHost || null,
        smtp_port: smtpPort,
        smtp_user: smtpUser || null,
        smtp_password: smtpPassword || null,
        smtp_from_email: smtpFromEmail || null,
        teams_webhook_url: teamsWebhookUrl || null,
        notify_on_job_complete: notifyOnJobComplete,
        notify_on_job_failed: notifyOnJobFailed,
        notify_on_job_started: notifyOnJobStarted,
        teams_mention_users: teamsMentionUsers || null,
        mention_on_critical_failures: mentionOnCriticalFailures,
        critical_job_types: criticalJobTypes,
      };

      if (settingsId) {
        const { error } = await supabase
          .from("notification_settings")
          .update(settingsData)
          .eq("id", settingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("notification_settings")
          .insert(settingsData)
          .select()
          .single();

        if (error) throw error;
        setSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Notification settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save notification settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOmeSettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify OpenManage settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const omeData = {
        host: omeHost,
        port: omePort,
        username: omeUsername,
        password: omePassword,
        verify_ssl: omeVerifySSL,
        sync_enabled: omeSyncEnabled,
      };

      if (omeSettingsId) {
        const { error } = await supabase
          .from("openmanage_settings")
          .update(omeData)
          .eq("id", omeSettingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("openmanage_settings")
          .insert(omeData)
          .select()
          .single();

        if (error) throw error;
        setOmeSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "OpenManage settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving OpenManage settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save OpenManage settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveActivitySettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify activity settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Prepare activity data
      const activityData: any = {
        log_retention_days: logRetentionDays,
        auto_cleanup_enabled: autoCleanupEnabled,
        log_level: logLevel,
        slow_command_threshold_ms: slowCommandThreshold,
        max_request_body_kb: maxRequestBodyKb,
        max_response_body_kb: maxResponseBodyKb,
        alert_on_failures: alertOnFailures,
        alert_on_slow_commands: alertOnSlowCommands,
        keep_statistics: keepStatistics,
        statistics_retention_days: statisticsRetentionDays,
        job_retention_days: jobRetentionDays,
        job_auto_cleanup_enabled: jobAutoCleanupEnabled,
        stale_pending_hours: stalePendingHours,
        stale_running_hours: staleRunningHours,
        auto_cancel_stale_jobs: autoCancelStaleJobs,
        // iDRAC safety settings
        pause_idrac_operations: pauseIdracOperations,
        discovery_max_threads: discoveryMaxThreads,
        idrac_request_delay_ms: idracRequestDelayMs,
        idrac_max_concurrent: idracMaxConcurrent,
        // SCP Share settings (for older iDRAC firmware)
        scp_share_enabled: scpShareEnabled,
        scp_share_type: scpShareType,
        scp_share_path: scpSharePath.trim() || null,
        scp_share_username: scpShareUsername.trim() || null,
        // use_job_executor_for_idrac removed - always true
      };

      // Encrypt and add password if provided
      if (scpSharePassword.trim()) {
        const { data: encryptedPassword, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: { 
            password: scpSharePassword.trim(),
            type: 'activity_settings'
          }
        });
        if (encryptError) throw encryptError;
        activityData.scp_share_password_encrypted = encryptedPassword.encrypted;
      }

      if (activitySettingsId) {
        const { error } = await supabase
          .from("activity_settings")
          .update(activityData)
          .eq("id", activitySettingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("activity_settings")
          .insert(activityData)
          .select()
          .single();
        if (error) throw error;
        setActivitySettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Activity Monitor settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving activity settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save activity settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupNow = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can trigger cleanup",
        variant: "destructive",
      });
      return;
    }

    setCleaningUp(true);
    try {
      const { error } = await supabase.functions.invoke('cleanup-activity-logs');
      
      if (error) throw error;

      toast({
        title: "Cleanup Complete",
        description: "Old activity log entries have been deleted",
      });
      
      // Reload settings to get updated last_cleanup_at
      loadSettings();
    } catch (error: any) {
      console.error("Error triggering cleanup:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger cleanup",
        variant: "destructive",
      });
    } finally {
      setCleaningUp(false);
    }
  };

  const handleJobCleanupNow = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can trigger job cleanup",
        variant: "destructive",
      });
      return;
    }

    setJobCleaningUp(true);
    try {
      const { error } = await supabase.functions.invoke('cleanup-old-jobs');
      
      if (error) throw error;
      
      // Query to get the actual counts
      const deletedCount = 0; // Will be shown in activity logs
      const cancelledCount = 0;
      const message = cancelledCount > 0 
        ? `Deleted ${deletedCount} old jobs and cancelled ${cancelledCount} stale jobs`
        : `Deleted ${deletedCount} old jobs`;

      toast({
        title: "Job Cleanup Complete",
        description: message,
      });
      
      // Reload settings to get updated last_cleanup_at
      loadSettings();
      fetchStaleJobCount();
    } catch (error: any) {
      console.error("Error triggering job cleanup:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger job cleanup",
        variant: "destructive",
      });
    } finally {
      setJobCleaningUp(false);
    }
  };

  const fetchStaleJobCount = async () => {
    try {
      const { data: activityData } = await supabase
        .from('activity_settings')
        .select('stale_pending_hours, stale_running_hours')
        .limit(1)
        .maybeSingle();

      if (!activityData) return;

      const stalePendingCutoff = new Date();
      stalePendingCutoff.setHours(stalePendingCutoff.getHours() - activityData.stale_pending_hours);
      
      const staleRunningCutoff = new Date();
      staleRunningCutoff.setHours(staleRunningCutoff.getHours() - activityData.stale_running_hours);

      const { count: pendingCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', stalePendingCutoff.toISOString());

      const { count: runningCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'running')
        .lt('started_at', staleRunningCutoff.toISOString());

      setStaleJobCount((pendingCount || 0) + (runningCount || 0));
    } catch (error: any) {
      console.error("Error fetching stale job count:", error);
    }
  };

  const handleCancelStaleJobsNow = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can cancel stale jobs",
        variant: "destructive",
      });
      return;
    }

    if (staleJobCount === 0) {
      toast({
        title: "No Stale Jobs",
        description: "There are no stale jobs to cancel",
      });
      return;
    }

    setJobCleaningUp(true);
    try {
      const { error } = await supabase.functions.invoke('cleanup-old-jobs');
      
      if (error) throw error;

      toast({
        title: "Stale Jobs Cancelled",
        description: "Stale jobs have been cancelled",
      });
      
      fetchStaleJobCount();
    } catch (error: any) {
      console.error("Error cancelling stale jobs:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to cancel stale jobs",
        variant: "destructive",
      });
    } finally {
      setJobCleaningUp(false);
    }
  };

  const handleSyncNow = async () => {
    if (userRole !== "admin" && userRole !== "operator") {
      toast({
        title: "Permission Denied",
        description: "Only admins and operators can trigger sync",
        variant: "destructive",
      });
      return;
    }

    if (!omeHost || !omeUsername || !omePassword) {
      toast({
        title: "Configuration Required",
        description: "Please configure OpenManage settings first",
        variant: "destructive",
      });
      return;
    }

    setIsOpenManageSyncing(true);
    try {
      // Create openmanage_sync job using edge function
      const { data: result, error: jobError } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: 'openmanage_sync' as any,
          created_by: user?.id,
          target_scope: { type: 'all' },
          details: { triggered_by: 'manual' }
        }
      });
      
      if (jobError) throw jobError;
      if (!result?.success) throw new Error(result?.error || 'Failed to create job');
      
      const jobId = result.job_id;
      
      toast({
        title: "OpenManage Sync Started",
        description: `Job ${jobId.substring(0, 8)} created. Syncing devices from OpenManage...`,
      });
      
      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', jobId)
          .single();
        
        if (job?.status === 'completed') {
          clearInterval(pollInterval);
          setIsOpenManageSyncing(false);
          const details = job.details as any;
          toast({
            title: "OpenManage Sync Completed",
            description: `✓ ${details?.new || 0} new servers, ${details?.updated || 0} updated`,
          });
          // Reload OME last_sync timestamp
          const { data: omeData } = await supabase
            .from('openmanage_settings')
            .select('last_sync')
            .limit(1)
            .single();
          if (omeData?.last_sync) {
            setOmeLastSync(omeData.last_sync);
          }
        } else if (job?.status === 'failed') {
          clearInterval(pollInterval);
          setIsOpenManageSyncing(false);
          const details = job.details as any;
          toast({
            title: "OpenManage Sync Failed",
            description: details?.error || "Unknown error occurred",
            variant: "destructive",
          });
        }
      }, 2000);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isOpenManageSyncing) {
          setIsOpenManageSyncing(false);
          toast({
            title: "Sync Timed Out",
            description: "Job Executor may not be running or sync is taking longer than expected",
            variant: "destructive",
          });
        }
      }, 300000);
      
    } catch (error: any) {
      console.error("Error triggering sync:", error);
      setIsOpenManageSyncing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger sync",
        variant: "destructive",
      });
    }
  };

  // Credential Management Functions
  const loadCredentialSets = async () => {
    try {
      const { data, error } = await supabase
        .from('credential_sets')
        .select(`
          *,
          credential_ip_ranges (
            id,
            ip_range,
            description,
            priority
          )
        `)
        .order('priority', { ascending: true });
      
      if (error) throw error;
      setCredentialSets(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading credential sets",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // IP Range Management Functions
  const loadIpRanges = async (credentialSetId: string) => {
    try {
      const { data, error } = await supabase
        .from('credential_ip_ranges' as any)
        .select('*')
        .eq('credential_set_id', credentialSetId)
        .order('priority', { ascending: true });
      
      if (error) throw error;
      setIpRanges(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading IP ranges",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openIpRangeDialog = async (credentialSet: any) => {
    setSelectedCredentialForIpRanges(credentialSet);
    await loadIpRanges(credentialSet.id);
    setShowIpRangeDialog(true);
  };

  const handleAddIpRange = async () => {
    if (!newIpRange || !selectedCredentialForIpRanges) {
      toast({
        title: "Missing Required Fields",
        description: "Please enter an IP range",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_ip_ranges' as any)
        .insert({
          credential_set_id: selectedCredentialForIpRanges.id,
          ip_range: newIpRange,
          description: newIpRangeDescription || null,
          priority: 100,
        } as any);
      
      if (error) throw error;
      
      toast({
        title: "IP Range Added",
        description: "The IP range has been added successfully",
      });
      
      setNewIpRange("");
      setNewIpRangeDescription("");
      await loadIpRanges(selectedCredentialForIpRanges.id);
      await loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateIpRange = async () => {
    if (!editingIpRange || !newIpRange) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_ip_ranges' as any)
        .update({
          ip_range: newIpRange,
          description: newIpRangeDescription || null,
        })
        .eq('id', editingIpRange.id);
      
      if (error) throw error;
      
      toast({
        title: "IP Range Updated",
        description: "The IP range has been updated successfully",
      });
      
      setEditingIpRange(null);
      setNewIpRange("");
      setNewIpRangeDescription("");
      if (selectedCredentialForIpRanges) {
        await loadIpRanges(selectedCredentialForIpRanges.id);
        await loadCredentialSets();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteIpRange = async (id: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_ip_ranges' as any)
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "IP Range Deleted",
        description: "The IP range has been removed",
      });
      
      if (selectedCredentialForIpRanges) {
        await loadIpRanges(selectedCredentialForIpRanges.id);
        await loadCredentialSets();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startEditIpRange = (range: any) => {
    setEditingIpRange(range);
    setNewIpRange(range.ip_range);
    setNewIpRangeDescription(range.description || "");
  };

  const cancelEditIpRange = () => {
    setEditingIpRange(null);
    setNewIpRange("");
    setNewIpRangeDescription("");
  };

  const handleSaveCredential = async () => {
    if (!credentialForm.name || !credentialForm.username) {
      toast({
        title: "Missing Required Fields",
        description: "Please fill in name and username",
        variant: "destructive",
      });
      return;
    }

    if (!editingCredential && !credentialForm.password) {
      toast({
        title: "Password Required",
        description: "Password is required when creating a new credential set",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      if (editingCredential) {
        // Update existing credential set
        const payload: any = {
          name: credentialForm.name,
          username: credentialForm.username,
          description: credentialForm.description || null,
          priority: credentialForm.priority,
          is_default: credentialForm.is_default,
        };

        // Update basic fields (without password)
        const { error } = await supabase
          .from('credential_sets')
          .update(payload)
          .eq('id', editingCredential.id);
        
        if (error) throw error;

        // If password provided, encrypt it separately
        if (credentialForm.password) {
          const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
            body: {
              type: 'credential_set',
              credential_set_id: editingCredential.id,
              password: credentialForm.password,
            }
          });

          if (encryptError) {
            throw new Error('Failed to encrypt password: ' + encryptError.message);
          }
        }

        // Handle IP ranges - delete existing and insert new ones
        await supabase
          .from('credential_ip_ranges')
          .delete()
          .eq('credential_set_id', editingCredential.id);

        if (tempIpRanges.length > 0) {
          const { error: rangeError } = await supabase
            .from('credential_ip_ranges')
            .insert(
              tempIpRanges.map((range, idx) => ({
                credential_set_id: editingCredential.id,
                ip_range: `${range.start_ip}-${range.end_ip}`,
                priority: idx + 1,
              }))
            );

          if (rangeError) {
            console.error("Error updating IP ranges:", rangeError);
          }
        }
        
        toast({
          title: "Credential Set Updated",
          description: `${credentialForm.name} has been updated successfully`,
        });
      } else {
        // Create new credential set WITHOUT password first
        const payload: any = {
          name: credentialForm.name,
          username: credentialForm.username,
          description: credentialForm.description || null,
          priority: credentialForm.priority,
          is_default: credentialForm.is_default,
          password_encrypted: null, // Will be encrypted via edge function
        };

        const { data: newCred, error } = await supabase
          .from('credential_sets')
          .insert(payload)
          .select()
          .single();
        
        if (error) throw error;

        // Encrypt password via edge function
        const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            type: 'credential_set',
            credential_set_id: newCred.id,
            password: credentialForm.password,
          }
        });

        if (encryptError) {
          // Clean up credential set if encryption fails
          await supabase.from("credential_sets").delete().eq('id', newCred.id);
          throw new Error('Failed to encrypt credentials: ' + encryptError.message);
        }

        // Insert IP ranges if any
        if (tempIpRanges.length > 0) {
          const { error: rangeError } = await supabase
            .from('credential_ip_ranges')
            .insert(
              tempIpRanges.map((range, idx) => ({
                credential_set_id: newCred.id,
                ip_range: `${range.start_ip}-${range.end_ip}`,
                priority: idx + 1,
              }))
            );

          if (rangeError) {
            console.error("Error adding IP ranges:", rangeError);
          }
        }
        
        toast({
          title: "Credential Set Created",
          description: `${credentialForm.name} has been created successfully`,
        });
      }

      setShowCredentialDialog(false);
      setEditingCredential(null);
      setCredentialForm({
        name: '',
        username: '',
        password: '',
        description: '',
        priority: 100,
        is_default: false,
      });
      setTempIpRanges([]);
      setNewInlineIpRange({ start_ip: "", end_ip: "" });
      setIpRangeExpanded(false);
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCredential = async (id: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_sets')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "Credential Set Deleted",
        description: "The credential set has been removed",
      });
      
      setDeleteConfirmId(null);
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestCredential = async (credentialSet: any) => {
    if (!testIp) {
      toast({
        title: "IP Address Required",
        description: "Please enter an IP address to test against",
        variant: "destructive",
      });
      return;
    }

    setTestingCredential(credentialSet.id);
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create test_credentials job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: testIp },
          credential_set_ids: [credentialSet.id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setTestingCredential(null);
          
          toast({
            title: "Connection Successful",
            description: `Connected to ${testIp} successfully`,
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setTestingCredential(null);
          
          const details = updatedJob.details as any;
          throw new Error(details?.message || 'Connection failed');
        }
      }, 2000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (testingCredential === credentialSet.id) {
          setTestingCredential(null);
          toast({
            title: "Test Timed Out",
            description: "Job Executor may not be running - check Activity Monitor",
            variant: "destructive",
          });
        }
      }, 30000);

    } catch (error: any) {
      setTestingCredential(null);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect with these credentials",
        variant: "destructive",
      });
    }
  };

  const fetchServiceRoleKey = async () => {
    setLoadingServiceKey(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-service-key');
      
      if (error) throw error;
      
      setServiceRoleKey(data.service_role_key);
      toast({
        title: "Service Role Key Retrieved",
        description: "Copy this key to your Job Executor .env file",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to retrieve service role key",
        variant: "destructive",
      });
    } finally {
      setLoadingServiceKey(false);
    }
  };

  const copyServiceRoleKey = () => {
    if (serviceRoleKey) {
      navigator.clipboard.writeText(serviceRoleKey);
      setServiceKeyCopied(true);
      toast({
        title: "Copied!",
        description: "Service role key copied to clipboard",
      });
      setTimeout(() => setServiceKeyCopied(false), 2000);
    }
  };

  const handleMovePriority = async (id: string, direction: 'up' | 'down') => {
    const index = credentialSets.findIndex(cs => cs.id === id);
    if (index === -1) return;
    
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= credentialSets.length) return;
    
    const currentSet = credentialSets[index];
    const targetSet = credentialSets[targetIndex];
    
    setLoading(true);
    try {
      // Swap priorities
      const updates = [
        supabase
          .from('credential_sets')
          .update({ priority: targetSet.priority })
          .eq('id', currentSet.id),
        supabase
          .from('credential_sets')
          .update({ priority: currentSet.priority })
          .eq('id', targetSet.id),
      ];
      
      await Promise.all(updates);
      
      toast({
        title: "Priority Updated",
        description: "Credential set order has been changed",
      });
      
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    setLoading(true);
    try {
      // First, unset all defaults
      await supabase
        .from('credential_sets')
        .update({ is_default: false })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      // Then set the selected one as default
      const { error } = await supabase
        .from('credential_sets')
        .update({ is_default: true })
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "Default Credential Set",
        description: "This credential set is now the default",
      });
      
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  if (userRole !== "admin") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              Only administrators can access settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          {tabMetadata[activeTab]?.icon && (
            <div className="text-primary">
              {(() => {
                const IconComponent = tabMetadata[activeTab].icon;
                return <IconComponent className="h-8 w-8" />;
              })()}
            </div>
          )}
          <h1 className="text-3xl font-bold">
            {tabMetadata[activeTab]?.title || "Settings"}
          </h1>
        </div>
        <p className="text-muted-foreground">
          {tabMetadata[activeTab]?.description || "Manage your application settings"}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 mb-6">
          {settingsTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {tab.name}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* GENERAL TAB */}
        <TabsContent value="general" className="space-y-4">
          <SettingsSection
            id="appearance"
            title="Appearance"
            description="Customize the look and feel of the application"
            icon={Palette}
            defaultOpen={defaultOpenSection === 'appearance'}
          >
            <div className="space-y-4">
              <Card>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <Label>Theme</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose your preferred color scheme
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <Button
                        variant={theme === "light" ? "default" : "outline"}
                        onClick={() => setTheme("light")}
                        className="flex items-center gap-2"
                      >
                        <Sun className="h-4 w-4" />
                        Light
                      </Button>
                      <Button
                        variant={theme === "dark" ? "default" : "outline"}
                        onClick={() => setTheme("dark")}
                        className="flex items-center gap-2"
                      >
                        <Moon className="h-4 w-4" />
                        Dark
                      </Button>
                      <Button
                        variant={theme === "system" ? "default" : "outline"}
                        onClick={() => setTheme("system")}
                        className="flex items-center gap-2"
                      >
                        <Monitor className="h-4 w-4" />
                        System
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </SettingsSection>
        </TabsContent>

        {/* SECURITY TAB - TODO: Convert remaining sections */}
        <TabsContent value="security" className="space-y-4">
          <p className="text-muted-foreground">Security settings will be organized into accordion sections</p>
        </TabsContent>

        {/* NOTIFICATIONS TAB - TODO: Convert remaining sections */}
        <TabsContent value="notifications" className="space-y-4">
          <p className="text-muted-foreground">Notification settings will be organized into accordion sections</p>
        </TabsContent>

        {/* INFRASTRUCTURE TAB - TODO: Convert remaining sections */}
        <TabsContent value="infrastructure" className="space-y-4">
          <p className="text-muted-foreground">Infrastructure settings will be organized into accordion sections</p>
        </TabsContent>

        {/* SYSTEM TAB - TODO: Convert remaining sections */}
        <TabsContent value="system" className="space-y-4">
          <p className="text-muted-foreground">System settings will be organized into accordion sections</p>
        </TabsContent>

        {/* LEGACY TABS - Keep for backward compatibility during transition */}
          <TabsContent value="appearance">
            <div className="space-y-4">
              <Card>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <Label>Theme</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose your preferred color scheme
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <Button
                        variant={theme === "light" ? "default" : "outline"}
                        onClick={() => setTheme("light")}
                        className="flex items-center gap-2"
                      >
                        <Sun className="h-4 w-4" />
                        Light
                      </Button>
                      <Button
                        variant={theme === "dark" ? "default" : "outline"}
                        onClick={() => setTheme("dark")}
                        className="flex items-center gap-2"
                      >
                        <Moon className="h-4 w-4" />
                        Dark
                      </Button>
                      <Button
                        variant={theme === "system" ? "default" : "outline"}
                        onClick={() => setTheme("system")}
                        className="flex items-center gap-2"
                      >
                        <Monitor className="h-4 w-4" />
                        System
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="smtp">
            <Card>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp-host">SMTP Host</Label>
                  <Input
                    id="smtp-host"
                    placeholder="smtp.example.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-port">SMTP Port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    placeholder="587"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-user">SMTP Username</Label>
                  <Input
                    id="smtp-user"
                    placeholder="user@example.com"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-password">SMTP Password</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    placeholder="••••••••"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-from">From Email Address</Label>
                  <Input
                    id="smtp-from"
                    type="email"
                    placeholder="notifications@example.com"
                    value={smtpFromEmail}
                    onChange={(e) => setSmtpFromEmail(e.target.value)}
                  />
                </div>

                <Button onClick={handleSaveSettings} disabled={loading}>
                  {loading ? "Saving..." : "Save SMTP Settings"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teams">
            <Card>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="teams-webhook">Teams Webhook URL</Label>
                  <Input
                    id="teams-webhook"
                    placeholder="https://outlook.office.com/webhook/..."
                    value={teamsWebhookUrl}
                    onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Create an Incoming Webhook in your Teams channel to get this URL
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="teams-mention-users">Users to @Mention on Critical Failures</Label>
                  <Input
                    id="teams-mention-users"
                    type="text"
                    placeholder="user@company.com, ops-team@company.com"
                    value={teamsMentionUsers}
                    onChange={(e) => setTeamsMentionUsers(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Comma-separated email addresses or UPNs. These users will be @mentioned in Teams for critical failures.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>@Mention on Critical Failures</Label>
                    <p className="text-sm text-muted-foreground">
                      Notify mentioned users when critical jobs fail
                    </p>
                  </div>
                  <Switch
                    checked={mentionOnCriticalFailures}
                    onCheckedChange={setMentionOnCriticalFailures}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Critical Job Types</Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Failed jobs of these types will be marked as critical and trigger @mentions
                  </p>
                  <div className="space-y-2">
                    {[
                      { value: 'firmware_update', label: 'Firmware Update' },
                      { value: 'discovery_scan', label: 'Discovery Scan' },
                      { value: 'vcenter_sync', label: 'vCenter Sync' },
                      { value: 'full_server_update', label: 'Full Server Update' }
                    ].map((type) => (
                      <div key={type.value} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`critical-${type.value}`}
                          checked={criticalJobTypes.includes(type.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCriticalJobTypes([...criticalJobTypes, type.value]);
                            } else {
                              setCriticalJobTypes(criticalJobTypes.filter(t => t !== type.value));
                            }
                          }}
                          className="h-4 w-4 rounded border-input"
                        />
                        <Label htmlFor={`critical-${type.value}`} className="text-sm font-normal cursor-pointer">
                          {type.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Teams Settings"}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={handleTestTeamsNotification} 
                    disabled={testingTeams || !teamsWebhookUrl}
                  >
                    {testingTeams ? "Sending..." : "Send Test Notification"}
                  </Button>
                </div>

                {recentNotifications.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <Label className="text-base">Recent Notification Deliveries</Label>
                    <div className="rounded-md border">
                      <div className="divide-y">
                        {recentNotifications.slice(0, 5).map((log) => (
                          <div key={log.id} className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "h-2 w-2 rounded-full",
                                log.status === 'success' ? "bg-green-500" : "bg-destructive"
                              )} />
                              <div>
                                <p className="text-sm font-medium">
                                  {log.notification_type === 'teams' ? 'Teams' : 'Email'} 
                                  {log.is_test && ' (Test)'}
                                  {log.severity && log.severity !== 'normal' && (
                                    <span className={cn(
                                      "ml-2 text-xs font-bold px-2 py-0.5 rounded",
                                      log.severity === 'critical' ? "bg-red-600 text-white" : "bg-orange-600 text-white"
                                    )}>
                                      {log.severity.toUpperCase()}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(log.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                            <div className="text-sm">
                              {log.status === 'success' ? (
                                <span className="text-green-600">Delivered</span>
                              ) : (
                                <span className="text-destructive" title={log.error_message}>
                                  Failed
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="openmanage">
            <Card>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ome-host">OpenManage Host</Label>
                  <Input
                    id="ome-host"
                    placeholder="openmanage.example.com"
                    value={omeHost}
                    onChange={(e) => setOmeHost(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ome-port">Port</Label>
                  <Input
                    id="ome-port"
                    type="number"
                    placeholder="443"
                    value={omePort}
                    onChange={(e) => setOmePort(parseInt(e.target.value) || 443)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ome-username">Username</Label>
                  <Input
                    id="ome-username"
                    placeholder="admin"
                    value={omeUsername}
                    onChange={(e) => setOmeUsername(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ome-password">Password</Label>
                  <Input
                    id="ome-password"
                    type="password"
                    placeholder="••••••••"
                    value={omePassword}
                    onChange={(e) => setOmePassword(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="ome-verify-ssl">Verify SSL Certificate</Label>
                    <p className="text-sm text-muted-foreground">
                      Disable for self-signed certificates
                    </p>
                  </div>
                  <Switch
                    id="ome-verify-ssl"
                    checked={omeVerifySSL}
                    onCheckedChange={setOmeVerifySSL}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="ome-sync-enabled">Enable Daily Sync</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically sync servers daily
                    </p>
                  </div>
                  <Switch
                    id="ome-sync-enabled"
                    checked={omeSyncEnabled}
                    onCheckedChange={setOmeSyncEnabled}
                  />
                </div>

                {omeLastSync && (
                  <div className="text-sm text-muted-foreground">
                    Last sync: {new Date(omeLastSync).toLocaleString()}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleSaveOmeSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Settings"}
                  </Button>
                  <Button 
                    onClick={handleSyncNow} 
                    disabled={isOpenManageSyncing}
                    variant="outline"
                  >
                    {isOpenManageSyncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Sync Now
                      </>
                    )}
                  </Button>
                </div>

                <div className="mt-6 border-t pt-6">
                  <h3 className="text-lg font-medium mb-2">API Tokens</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate API tokens for authenticating the Python sync script
                  </p>
                  
                  <div className="flex gap-2 mb-4">
                    <Input
                      placeholder="Token name (e.g., 'Production Sync')"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                    />
                    <Button onClick={generateApiToken}>Generate Token</Button>
                  </div>

                  {apiTokens.length > 0 && (
                    <div className="border rounded-lg">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-3 text-sm font-medium">Name</th>
                            <th className="text-left p-3 text-sm font-medium">Created</th>
                            <th className="text-left p-3 text-sm font-medium">Last Used</th>
                            <th className="text-right p-3 text-sm font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiTokens.map((token) => (
                            <tr key={token.id} className="border-b last:border-0">
                              <td className="p-3">{token.name}</td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {new Date(token.created_at).toLocaleDateString()}
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'Never'}
                              </td>
                              <td className="p-3 text-right">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => deleteApiToken(token.id)}
                                >
                                  Revoke
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <p className="text-sm">
                    <strong>Note:</strong> To perform automated syncs, you need to run the <code>openmanage-sync-script.py</code> on your on-premise server. 
                    See the <a href="/docs/OPENMANAGE_SYNC_GUIDE.md" className="text-primary underline">OpenManage Sync Guide</a> for setup instructions.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="jobs">
            <Card>
              <CardContent className="space-y-6">
                
                {/* Job Retention & Cleanup Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Job Retention & Cleanup
                  </h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="job-retention-days">Job Retention Period (Days)</Label>
                    <Input
                      id="job-retention-days"
                      type="number"
                      min="1"
                      max="365"
                      value={jobRetentionDays}
                      onChange={(e) => setJobRetentionDays(parseInt(e.target.value) || 90)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Completed, failed, and cancelled jobs older than this will be automatically deleted (1-365 days)
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="job-auto-cleanup">Enable Automatic Job Cleanup</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically delete old jobs daily at 3 AM
                      </p>
                    </div>
                    <Switch
                      id="job-auto-cleanup"
                      checked={jobAutoCleanupEnabled}
                      onCheckedChange={setJobAutoCleanupEnabled}
                    />
                  </div>

                  {jobLastCleanupAt && (
                    <div className="text-sm text-muted-foreground">
                      Last job cleanup: {new Date(jobLastCleanupAt).toLocaleString()}
                    </div>
                  )}

                  <Button 
                    onClick={handleJobCleanupNow} 
                    disabled={jobCleaningUp}
                    variant="outline"
                  >
                    {jobCleaningUp ? "Cleaning Up..." : "Run Job Cleanup Now"}
                  </Button>
                </div>

                {/* Stale Job Management Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Stale Job Management
                  </h3>

                  {staleJobCount > 0 && (
                    <div className="p-4 bg-warning/10 border border-warning rounded-lg">
                      <p className="text-sm font-medium text-warning mb-1">
                        ⚠️ {staleJobCount} Stale Job{staleJobCount !== 1 ? 's' : ''} Detected
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Jobs stuck in pending or running state beyond configured thresholds
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="stale-pending-hours">Cancel Pending Jobs After (Hours)</Label>
                    <Input
                      id="stale-pending-hours"
                      type="number"
                      min="1"
                      max="168"
                      value={stalePendingHours}
                      onChange={(e) => setStalePendingHours(parseInt(e.target.value) || 24)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Auto-cancel jobs stuck in pending state for longer than this (1-168 hours)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stale-running-hours">Cancel Running Jobs After (Hours)</Label>
                    <Input
                      id="stale-running-hours"
                      type="number"
                      min="1"
                      max="168"
                      value={staleRunningHours}
                      onChange={(e) => setStaleRunningHours(parseInt(e.target.value) || 48)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Auto-cancel jobs stuck in running state for longer than this (1-168 hours)
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-cancel-stale">Enable Automatic Stale Job Cancellation</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically cancel stuck jobs during daily cleanup
                      </p>
                    </div>
                    <Switch
                      id="auto-cancel-stale"
                      checked={autoCancelStaleJobs}
                      onCheckedChange={setAutoCancelStaleJobs}
                    />
                  </div>

                  <Button 
                    onClick={handleCancelStaleJobsNow} 
                    disabled={jobCleaningUp || staleJobCount === 0}
                    variant={staleJobCount > 0 ? "default" : "outline"}
                  >
                    {jobCleaningUp ? "Cancelling..." : `Cancel Stale Jobs Now${staleJobCount > 0 ? ` (${staleJobCount})` : ''}`}
                  </Button>
                </div>

                <Button onClick={handleSaveActivitySettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Jobs Settings"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="operations-safety">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  Operations Safety Controls
                </CardTitle>
                <CardDescription>
                  Emergency kill switch and throttling controls for iDRAC operations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* iDRAC Safety Controls - Kill Switch & Throttling */}
                <div className="space-y-4 border-2 border-destructive/50 rounded-lg p-4 bg-destructive/5">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <h3 className="text-lg font-medium text-destructive">iDRAC Safety Controls</h3>
                  </div>
                  
                  <Alert className="border-destructive/50">
                    <AlertDescription>
                      <strong>Emergency Kill Switch:</strong> Immediately pause all iDRAC operations if you suspect lock-ups or credential issues.
                      The Job Executor will respect this setting and stop processing iDRAC jobs.
                    </AlertDescription>
                  </Alert>
                  
                  <div className="flex items-center justify-between py-2 px-3 bg-background rounded-md border-2 border-destructive">
                    <div className="space-y-0.5">
                      <Label htmlFor="pause-idrac" className="text-base font-semibold">
                        🛑 Pause All iDRAC Operations
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Stops Job Executor from processing any iDRAC-related jobs
                      </p>
                    </div>
                    <Switch
                      id="pause-idrac"
                      checked={pauseIdracOperations}
                      onCheckedChange={(checked) => {
                        setPauseIdracOperations(checked);
                        if (checked) {
                          toast({
                            title: "⚠️ iDRAC Operations Paused",
                            description: "Job Executor will stop processing iDRAC jobs. Remember to save settings!",
                            variant: "destructive",
                          });
                        }
                      }}
                    />
                  </div>

                  {pauseIdracOperations && (
                    <Alert className="border-yellow-500/50 bg-yellow-500/10">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <AlertDescription className="text-yellow-900 dark:text-yellow-200">
                        iDRAC operations are currently PAUSED. Click "Save Settings" to apply, then restart Job Executor.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="discovery-threads" className="text-sm">Discovery Threads</Label>
                      <Input
                        id="discovery-threads"
                        type="number"
                        min="1"
                        max="20"
                        value={discoveryMaxThreads}
                        onChange={(e) => setDiscoveryMaxThreads(parseInt(e.target.value) || 5)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Max concurrent threads for IP discovery (1-20)
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="request-delay" className="text-sm">Request Delay (ms)</Label>
                      <Input
                        id="request-delay"
                        type="number"
                        min="100"
                        max="5000"
                        value={idracRequestDelayMs}
                        onChange={(e) => setIdracRequestDelayMs(parseInt(e.target.value) || 500)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Minimum delay between requests to same iDRAC
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="max-concurrent" className="text-sm">Max Concurrent</Label>
                      <Input
                        id="max-concurrent"
                        type="number"
                        min="1"
                        max="20"
                        value={idracMaxConcurrent}
                        onChange={(e) => setIdracMaxConcurrent(parseInt(e.target.value) || 4)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Max concurrent iDRAC requests globally
                      </p>
                    </div>
                  </div>
                </div>

                <Button onClick={handleSaveActivitySettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Operations Safety Settings"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardContent className="space-y-6">

                {/* iDRAC Log Retention & Cleanup Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    iDRAC Log Retention & Cleanup
                  </h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="retention-days">Retention Period (Days)</Label>
                    <Input
                      id="retention-days"
                      type="number"
                      min="1"
                      max="365"
                      value={logRetentionDays}
                      onChange={(e) => setLogRetentionDays(parseInt(e.target.value) || 30)}
                    />
                    <p className="text-sm text-muted-foreground">
                      iDRAC activity logs older than this will be automatically deleted (1-365 days)
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-cleanup">Enable Automatic Cleanup</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically delete old logs daily at 2 AM
                      </p>
                    </div>
                    <Switch
                      id="auto-cleanup"
                      checked={autoCleanupEnabled}
                      onCheckedChange={setAutoCleanupEnabled}
                    />
                  </div>

                  {lastCleanupAt && (
                    <div className="text-sm text-muted-foreground">
                      Last cleanup: {new Date(lastCleanupAt).toLocaleString()}
                    </div>
                  )}

                  <Button 
                    onClick={handleCleanupNow} 
                    disabled={cleaningUp}
                    variant="outline"
                  >
                    {cleaningUp ? "Cleaning Up..." : "Run Log Cleanup Now"}
                  </Button>
                </div>

                {/* Verbosity Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-medium">Log Verbosity</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="log-level">Logging Level</Label>
                    <select
                      id="log-level"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                      value={logLevel}
                      onChange={(e) => setLogLevel(e.target.value as 'all' | 'errors_only' | 'slow_only')}
                    >
                      <option value="all">All Requests (Detailed)</option>
                      <option value="errors_only">Errors Only</option>
                      <option value="slow_only">Slow Requests Only</option>
                    </select>
                    <p className="text-sm text-muted-foreground">
                      Choose what types of commands to log
                    </p>
                  </div>

                  {logLevel === 'slow_only' && (
                    <div className="space-y-2">
                      <Label htmlFor="slow-threshold">Slow Command Threshold (ms)</Label>
                      <Input
                        id="slow-threshold"
                        type="number"
                        min="100"
                        value={slowCommandThreshold}
                        onChange={(e) => setSlowCommandThreshold(parseInt(e.target.value) || 5000)}
                      />
                      <p className="text-sm text-muted-foreground">
                        Log commands that take longer than this duration
                      </p>
                    </div>
                  )}
                </div>

                {/* Size Limits Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-medium">Size Limits</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="max-request">Max Request Body (KB)</Label>
                      <Input
                        id="max-request"
                        type="number"
                        min="10"
                        max="1000"
                        value={maxRequestBodyKb}
                        onChange={(e) => setMaxRequestBodyKb(parseInt(e.target.value) || 100)}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="max-response">Max Response Body (KB)</Label>
                      <Input
                        id="max-response"
                        type="number"
                        min="10"
                        max="1000"
                        value={maxResponseBodyKb}
                        onChange={(e) => setMaxResponseBodyKb(parseInt(e.target.value) || 100)}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Request/response bodies larger than these limits will be truncated
                  </p>
                </div>

                {/* Dell Online Repository Info */}
                <Alert className="border-t pt-6">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Dell Online Repository (downloads.dell.com)</strong>
                    <ul className="list-disc list-inside mt-2 text-sm space-y-1">
                      <li>iDRAC servers must have internet connectivity</li>
                      <li>Firewall must allow HTTPS (443) to downloads.dell.com</li>
                      <li>DNS resolution must be configured on iDRAC</li>
                      <li>For air-gapped environments, use Manual Repository option</li>
                      <li>Select firmware source when creating firmware update jobs</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                {/* Alerts Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Alerts & Notifications
                  </h3>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="alert-failures">Alert on Command Failures</Label>
                      <p className="text-sm text-muted-foreground">
                        Show toast notifications for failed iDRAC commands
                      </p>
                    </div>
                    <Switch
                      id="alert-failures"
                      checked={alertOnFailures}
                      onCheckedChange={setAlertOnFailures}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="alert-slow">Alert on Slow Commands</Label>
                      <p className="text-sm text-muted-foreground">
                        Show notifications for commands exceeding threshold
                      </p>
                    </div>
                    <Switch
                      id="alert-slow"
                      checked={alertOnSlowCommands}
                      onCheckedChange={setAlertOnSlowCommands}
                    />
                  </div>
                </div>

                {/* Statistics Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-medium">Statistics & Analytics</h3>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="keep-stats">Keep Aggregated Statistics</Label>
                      <p className="text-sm text-muted-foreground">
                        Preserve summary data after log deletion
                      </p>
                    </div>
                    <Switch
                      id="keep-stats"
                      checked={keepStatistics}
                      onCheckedChange={setKeepStatistics}
                    />
                  </div>

                  {keepStatistics && (
                    <div className="space-y-2">
                      <Label htmlFor="stats-retention">Statistics Retention (Days)</Label>
                      <Input
                        id="stats-retention"
                        type="number"
                        min="30"
                        max="730"
                        value={statisticsRetentionDays}
                        onChange={(e) => setStatisticsRetentionDays(parseInt(e.target.value) || 365)}
                      />
                      <p className="text-sm text-muted-foreground">
                        How long to keep aggregated statistics (30-730 days)
                      </p>
                    </div>
                  )}
                </div>

                <Button onClick={handleSaveActivitySettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Activity Settings"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Notification Center</CardTitle>
                  <CardDescription>
                    Configure the notification center that appears in the top navigation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="nc-enabled">Enable Notification Center</Label>
                      <p className="text-sm text-muted-foreground">
                        Show the notification bell icon with real-time job progress
                      </p>
                    </div>
                    <Switch
                      id="nc-enabled"
                      checked={true}
                      disabled
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="nc-progress">Show Progress Updates</Label>
                      <p className="text-sm text-muted-foreground">
                        Display detailed progress bars and status for active jobs
                      </p>
                    </div>
                    <Switch
                      id="nc-progress"
                      checked={true}
                      disabled
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nc-max-items">Recent Activity Items</Label>
                    <Input
                      id="nc-max-items"
                      type="number"
                      min="5"
                      max="50"
                      defaultValue={10}
                      disabled
                    />
                    <p className="text-sm text-muted-foreground">
                      Number of recent commands to show (5-50)
                    </p>
                  </div>

                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      Notification center settings are managed automatically. Use the bell icon in the top navigation to view active operations and recent activity.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Teams & Email Notifications</CardTitle>
                  <CardDescription>
                    Configure when to send notifications to Teams or email
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="notify-complete">Job Completed</Label>
                      <p className="text-sm text-muted-foreground">
                        Send notification when jobs complete successfully
                      </p>
                    </div>
                    <Switch
                      id="notify-complete"
                      checked={notifyOnJobComplete}
                      onCheckedChange={setNotifyOnJobComplete}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="notify-failed">Job Failed</Label>
                      <p className="text-sm text-muted-foreground">
                        Send notification when jobs fail
                      </p>
                    </div>
                    <Switch
                      id="notify-failed"
                      checked={notifyOnJobFailed}
                      onCheckedChange={setNotifyOnJobFailed}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="notify-started">Job Started</Label>
                      <p className="text-sm text-muted-foreground">
                        Send notification when jobs start
                      </p>
                    </div>
                    <Switch
                      id="notify-started"
                      checked={notifyOnJobStarted}
                      onCheckedChange={setNotifyOnJobStarted}
                    />
                  </div>

                  <Button onClick={handleSaveSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Preferences"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>System Diagnostics</CardTitle>
                  <CardDescription>
                    Generate a comprehensive diagnostic report for troubleshooting
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">
                        Generate a detailed diagnostic report that includes system information, database status, 
                        edge function health, server status, job statistics, activity logs, and recent errors. 
                        This report can be copied and shared when troubleshooting issues.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={() => setShowDiagnosticsDialog(true)}
                    variant="outline"
                    className="w-full"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Generate Diagnostics Report
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="credentials">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>iDRAC Credential Sets</CardTitle>
            <CardDescription>
              Manage credential profiles for server discovery and operations. Discovery jobs try credentials in priority order.
            </CardDescription>
                  </div>
                  <Button
                    onClick={() => {
                      setEditingCredential(null);
                      setCredentialForm({
                        name: '',
                        username: '',
                        password: '',
                        description: '',
                        priority: credentialSets.length > 0 
                          ? Math.max(...credentialSets.map(cs => cs.priority)) + 10 
                          : 100,
                        is_default: credentialSets.length === 0,
                      });
                      setShowCredentialDialog(true);
                    }}
                  >
                    Add Credential Set
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {credentialSets.length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No Credential Sets</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Create credential sets for server discovery. Optionally assign IP ranges to auto-select credentials for specific networks.
                    </p>
                    <Button
                      onClick={() => {
                        setCredentialForm({
                          name: '',
                          username: '',
                          password: '',
                          description: '',
                          priority: 100,
                          is_default: true,
                        });
                        setShowCredentialDialog(true);
                      }}
                    >
                      Create First Credential Set
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {credentialSets.map((credentialSet, index) => (
                      <Card key={credentialSet.id} className="border-2">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-lg">{credentialSet.name}</h3>
                                {credentialSet.is_default && (
                                  <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                                    Default
                                  </span>
                                )}
                                <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-inset ring-secondary/20">
                                  Priority: {credentialSet.priority}
                                </span>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="text-muted-foreground">Username:</span>
                                  <span className="ml-2 font-mono">{credentialSet.username}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Password:</span>
                                  <span className="ml-2">••••••••</span>
                                </div>
                              </div>
                              
                              {credentialSet.description && (
                                <p className="text-sm text-muted-foreground">
                                  {credentialSet.description}
                                </p>
                              )}

                              {credentialSet.credential_ip_ranges && credentialSet.credential_ip_ranges.length > 0 && (
                                <div className="mt-3 pt-3 border-t">
                                  <span className="text-sm text-muted-foreground font-medium">IP Ranges:</span>
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {credentialSet.credential_ip_ranges.map((range: any) => (
                                      <span key={range.id} className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-950 px-2 py-1 text-xs font-mono text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-600/20">
                                        {range.ip_range}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex flex-col gap-2">
                              {/* Priority Controls */}
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleMovePriority(credentialSet.id, 'up')}
                                  disabled={index === 0 || loading}
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleMovePriority(credentialSet.id, 'down')}
                                  disabled={index === credentialSets.length - 1 || loading}
                                >
                                  ↓
                                </Button>
                              </div>
                              
                              {/* Action Buttons */}
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openIpRangeDialog(credentialSet)}
                                className="gap-1"
                              >
                                <Network className="h-3.5 w-3.5" />
                                IP Ranges ({credentialSet.credential_ip_ranges?.length || 0})
                              </Button>
                                
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingCredential(credentialSet);
                                    setCredentialForm({
                                      name: credentialSet.name,
                                      username: credentialSet.username,
                                      password: '',
                                      description: credentialSet.description || '',
                                      priority: credentialSet.priority,
                                      is_default: credentialSet.is_default,
                                    });
                                    // Load existing IP ranges into temp state - parse ip_range format
                                    const ranges = (credentialSet.credential_ip_ranges || []).map((r: any) => {
                                      const [start_ip, end_ip] = r.ip_range.split('-');
                                      return { start_ip: start_ip.trim(), end_ip: end_ip.trim() };
                                    });
                                    setTempIpRanges(ranges);
                                    setIpRangeExpanded(ranges.length > 0);
                                    setShowCredentialDialog(true);
                                  }}
                                >
                                  Edit
                                </Button>
                                
                                {!credentialSet.is_default && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSetDefault(credentialSet.id)}
                                    disabled={loading}
                                  >
                                    Set Default
                                  </Button>
                                )}
                                
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setDeleteConfirmId(credentialSet.id)}
                                  disabled={loading}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                
                {/* Test Connection Section */}
                <div className="mt-6 p-4 border rounded-lg bg-muted/50">
                  <h4 className="font-medium mb-3">Test Credentials</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Test any credential set against an iDRAC IP address to verify connectivity
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="192.168.1.100"
                      value={testIp}
                      onChange={(e) => setTestIp(e.target.value)}
                    />
                    {credentialSets.map((credentialSet) => (
                      <Button
                        key={credentialSet.id}
                        variant="outline"
                        disabled={testingCredential !== null || !testIp}
                        onClick={() => handleTestCredential(credentialSet)}
                      >
                        {testingCredential === credentialSet.id ? "Testing..." : `Test ${credentialSet.name}`}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="identity-provider">
            <IdentityProviderSettings />
          </TabsContent>

          <TabsContent value="audit-logs">
            <AuditLogViewer />
          </TabsContent>

          <TabsContent value="cluster-monitoring">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CloudCog className="h-5 w-5" />
                  Scheduled Cluster Safety Checks
                </CardTitle>
                <CardDescription>
                  Automatically monitor cluster health and receive alerts when conditions become unsafe for maintenance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Enable scheduled checks */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Scheduled Checks</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically run safety checks on a schedule
                    </p>
                  </div>
                  <Switch
                    checked={scheduledChecksEnabled}
                    onCheckedChange={setScheduledChecksEnabled}
                    disabled={userRole !== 'admin'}
                  />
                </div>

                {scheduledChecksEnabled && (
                  <>
                    {/* Schedule frequency */}
                    <div className="space-y-2">
                      <Label>Check Frequency</Label>
                      <Select 
                        value={checkFrequency} 
                        onValueChange={setCheckFrequency}
                        disabled={userRole !== 'admin'}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0 */4 * * *">Every 4 hours</SelectItem>
                          <SelectItem value="0 */6 * * *">Every 6 hours (recommended)</SelectItem>
                          <SelectItem value="0 */12 * * *">Every 12 hours</SelectItem>
                          <SelectItem value="0 0 * * *">Daily at midnight</SelectItem>
                          <SelectItem value="0 6,18 * * *">Twice daily (6 AM, 6 PM)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        More frequent checks provide earlier warnings but use more resources
                      </p>
                    </div>

                    {/* Min required hosts */}
                    <div className="space-y-2">
                      <Label>Minimum Required Hosts</Label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={minRequiredHosts}
                        onChange={(e) => setMinRequiredHosts(parseInt(e.target.value))}
                        disabled={userRole !== 'admin'}
                      />
                      <p className="text-xs text-muted-foreground">
                        Minimum healthy hosts required after taking one offline
                      </p>
                    </div>

                    {/* Notification preferences */}
                    <div className="space-y-3 pt-4 border-t">
                      <Label className="text-base">Alert Preferences</Label>
                      
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="font-normal">Alert on Unsafe Conditions</Label>
                          <p className="text-xs text-muted-foreground">
                            Send alert when cluster becomes unsafe for maintenance
                          </p>
                        </div>
                        <Switch
                          checked={notifyOnUnsafeCluster}
                          onCheckedChange={setNotifyOnUnsafeCluster}
                          disabled={userRole !== 'admin'}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="font-normal">Alert on Warnings</Label>
                          <p className="text-xs text-muted-foreground">
                            Send alert for warnings (DRS disabled, low capacity)
                          </p>
                        </div>
                        <Switch
                          checked={notifyOnClusterWarning}
                          onCheckedChange={setNotifyOnClusterWarning}
                          disabled={userRole !== 'admin'}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="font-normal">Alert on Status Changes</Label>
                          <p className="text-xs text-muted-foreground">
                            Send alert when cluster status changes (safe ↔ unsafe)
                          </p>
                        </div>
                        <Switch
                          checked={notifyOnClusterStatusChange}
                          onCheckedChange={setNotifyOnClusterStatusChange}
                          disabled={userRole !== 'admin'}
                        />
                      </div>
                    </div>

                    {/* Last check status */}
                    {lastScheduledCheck?.last_run_at && (
                      <div className="p-3 bg-muted rounded-lg space-y-1">
                        <p className="text-sm font-medium">Last Scheduled Check</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(lastScheduledCheck.last_run_at).toLocaleString()}
                        </p>
                        {lastScheduledCheck.last_status && (
                          <Badge variant={lastScheduledCheck.last_status === 'safe' ? 'default' : 'destructive'}>
                            {lastScheduledCheck.last_status.toUpperCase()}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={saveScheduledCheckConfig}
                        disabled={loading || userRole !== 'admin'}
                        className="flex-1"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Configuration
                          </>
                        )}
                      </Button>
                      
                      <Button
                        onClick={runScheduledChecksNow}
                        disabled={runningScheduledCheck || userRole !== 'admin'}
                        variant="outline"
                      >
                        {runningScheduledCheck ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Run Now
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="virtual-media">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Disc className="h-5 w-5" />
                        Virtual Media & SCP Backup
                      </CardTitle>
                      <CardDescription>
                        Configure ISO share defaults and SCP export share for backups
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Share Type</Label>
                      <Select value={vmShareType} onValueChange={(value) => setVmShareType(value as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nfs">NFS (recommended)</SelectItem>
                          <SelectItem value="cifs">SMB/CIFS</SelectItem>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="https">HTTPS</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Host must be reachable from the Job Executor and iDRAC.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Share Host</Label>
                      <Input
                        placeholder="nfs-gateway.internal"
                        value={vmHost}
                        onChange={(e) => setVmHost(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Export / Root Path</Label>
                      <Input
                        placeholder="/exports/isos"
                        value={vmExportPath}
                        onChange={(e) => setVmExportPath(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Path on the share that exposes your ISO library.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>ISO Subdirectory (optional)</Label>
                      <Input
                        placeholder="linux/"
                        value={vmIsoPath}
                        onChange={(e) => setVmIsoPath(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Appended to the export path for a cleaner browse list.</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center justify-between">
                      Require authentication
                      <Switch checked={vmUseAuth} onCheckedChange={setVmUseAuth} />
                    </Label>
                    <div className="grid md:grid-cols-2 gap-3">
                      <Input
                        placeholder="share-user"
                        value={vmUsername}
                        onChange={(e) => setVmUsername(e.target.value)}
                        disabled={!vmUseAuth}
                      />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={vmPassword}
                        onChange={(e) => setVmPassword(e.target.value)}
                        disabled={!vmUseAuth}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Credentials are stored encrypted alongside other settings.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      placeholder="Firewall rules, maintenance windows, or cleanup policy for this share"
                      value={vmNotes}
                      onChange={(e) => setVmNotes(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={handleTestVirtualMediaShare}
                      disabled={testingVirtualMediaShare}
                    >
                      {testingVirtualMediaShare && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Test share
                    </Button>
                    <Button onClick={handleSaveVirtualMediaSettings} disabled={loading}>
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save defaults
                    </Button>
                  </div>

                  {vmTestResult && (
                    <Alert variant={vmTestResult.success ? "default" : "destructive"}>
                      <AlertDescription className="space-y-2">
                        <div className="flex items-center gap-2">
                          {vmTestResult.success ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <AlertCircle className="h-4 w-4" />
                          )}
                          <span>{vmTestResult.message}</span>
                        </div>
                        {vmTestResult.baseUrl && (
                          <p className="text-xs text-muted-foreground">
                            Base URL: {vmTestResult.baseUrl} (port {vmTestResult.port || 'auto'})
                          </p>
                        )}
                        {vmTestResult.listing_error && (
                          <p className="text-xs text-muted-foreground">Directory listing: {vmTestResult.listing_error}</p>
                        )}
                        {vmTestResult.files && vmTestResult.files.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">Discovered images</p>
                            <ScrollArea className="h-32 rounded-md border p-2">
                              <div className="space-y-1 text-xs">
                                {vmTestResult.files.map((file) => (
                                  <div key={file} className="flex items-center gap-2">
                                    <Disc className="h-3 w-3" />
                                    <span className="font-mono break-all">{file}</span>
                                  </div>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {/* ISO Image Library */}
              <IsoImageLibrary />

              {/* SCP Export Share Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Disc className="h-5 w-5" />
                    SCP Export Share Configuration
                  </CardTitle>
                  <CardDescription>
                    Configure network share for SCP backups on older iDRAC firmware
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-sm">
                      <strong>For older iDRAC firmware:</strong> If iDRAC doesn't support Local export method (iDRAC 8 v2.70+, iDRAC 9 v4.x+), 
                      configure a network share as fallback. The Job Executor will automatically use this when Local export fails.
                      <br /><br />
                      <strong>Supported:</strong> Windows SMB/CIFS shares or Linux NFS shares accessible from iDRAC network.
                    </AlertDescription>
                  </Alert>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="scp-share-enabled">Enable Network Share Export Fallback</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically use network share when Local export is not supported
                      </p>
                    </div>
                    <Switch
                      id="scp-share-enabled"
                      checked={scpShareEnabled}
                      onCheckedChange={setScpShareEnabled}
                    />
                  </div>

                  {scpShareEnabled && (
                    <div className="space-y-4 pl-4 border-l-2 border-border">
                      <div className="space-y-2">
                        <Label htmlFor="scp-share-type">Share Type</Label>
                        <Select value={scpShareType} onValueChange={(value: 'CIFS' | 'NFS') => setScpShareType(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CIFS">CIFS / SMB (Windows)</SelectItem>
                            <SelectItem value="NFS">NFS (Linux/Unix)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {scpShareType === 'CIFS' 
                            ? 'Windows file share (SMB/CIFS protocol)' 
                            : 'Unix/Linux network file system'}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="scp-share-path">Share Path *</Label>
                        <Input
                          id="scp-share-path"
                          placeholder={scpShareType === 'CIFS' ? '\\\\server\\share\\exports' : '/export/scp_backups'}
                          value={scpSharePath}
                          onChange={(e) => setScpSharePath(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          {scpShareType === 'CIFS' 
                            ? 'UNC path to Windows share (e.g., \\\\fileserver\\idrac$\\scp_exports)' 
                            : 'NFS mount path (e.g., /mnt/nfs_share/scp_exports)'}
                        </p>
                      </div>

                      {scpShareType === 'CIFS' && (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="scp-share-username">Share Username</Label>
                            <Input
                              id="scp-share-username"
                              placeholder="domain\\username or username"
                              value={scpShareUsername}
                              onChange={(e) => setScpShareUsername(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              Username with write access to the share
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="scp-share-password">Share Password</Label>
                            <Input
                              id="scp-share-password"
                              type="password"
                              placeholder="••••••••"
                              value={scpSharePassword}
                              onChange={(e) => setScpSharePassword(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              Password for share access (encrypted in database). Leave blank to keep existing.
                            </p>
                          </div>
                        </>
                      )}

                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          <strong>Requirements:</strong>
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>Share must be accessible from iDRAC network (test connectivity)</li>
                            <li>iDRAC must have network route to share server</li>
                            <li>Share must have write permissions for the specified user</li>
                            <li>For CIFS: Port 445 must be open between iDRAC and file server</li>
                            <li>For NFS: NFS ports (2049, 111) must be accessible</li>
                          </ul>
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}

                  <Button onClick={handleSaveActivitySettings} disabled={loading}>
                    {loading ? "Saving..." : "Save SCP Settings"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="firmware-library">
            <FirmwareLibrary />
          </TabsContent>

          <TabsContent value="network">
            <div className="space-y-4">
              {/* Deployment Mode Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Deployment Mode</CardTitle>
                  <CardDescription>
                    Current backend connectivity status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-3 h-3 rounded-full", deploymentInfo.color)} />
                    <div>
                      <div className="font-medium">{deploymentInfo.mode}</div>
                      <div className="text-sm text-muted-foreground">{deploymentInfo.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Backend: {import.meta.env.VITE_SUPABASE_URL?.replace(/^https?:\/\//, '').split('/')[0] || 'Unknown'}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* iDRAC Operations Architecture - Informational Only */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>iDRAC Operations Architecture</CardTitle>
                  <CardDescription>
                    How this application connects to iDRAC devices
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      <strong>All iDRAC operations use the Job Executor</strong>
                      <br />
                      <br />
                      iDRACs are always on private networks that edge functions cannot reach. 
                      The Job Executor runs on your local network with full access to iDRAC devices.
                      <br />
                      <br />
                      <strong>Supported operations:</strong>
                      <ul className="list-disc ml-4 mt-2 space-y-1">
                        <li>Firmware updates and full server updates</li>
                        <li>Network discovery scans</li>
                        <li>Credential testing</li>
                        <li>Server information refresh</li>
                      </ul>
                      <br />
                      <strong>Requirements:</strong>
                      <ul className="list-disc ml-4 space-y-1">
                        <li>Job Executor service running on a machine with network access to iDRACs</li>
                        <li>Proper network configuration to reach iDRAC IP addresses</li>
                        <li>Valid iDRAC credentials configured in credential sets</li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Job Executor Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" />
                    Job Executor Configuration
                  </CardTitle>
                  <CardDescription>
                    Retrieve your SERVICE_ROLE_KEY for local Job Executor setup
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      The Job Executor requires a SERVICE_ROLE_KEY to access the database and perform administrative operations.
                      This key should be added to your Job Executor <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code> file.
                    </AlertDescription>
                  </Alert>

                  {!serviceRoleKey ? (
                    <Button 
                      onClick={fetchServiceRoleKey} 
                      disabled={loadingServiceKey}
                      className="w-full"
                    >
                      {loadingServiceKey ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Retrieving Key...
                        </>
                      ) : (
                        <>
                          <Terminal className="mr-2 h-4 w-4" />
                          Retrieve SERVICE_ROLE_KEY
                        </>
                      )}
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">SERVICE_ROLE_KEY</Label>
                        <div className="relative">
                          <Input
                            value={serviceRoleKey}
                            readOnly
                            className="font-mono text-xs pr-10"
                            type="password"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="absolute right-1 top-1 h-7"
                            onClick={copyServiceRoleKey}
                          >
                            {serviceKeyCopied ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <Alert className="bg-muted">
                        <Terminal className="h-4 w-4" />
                        <AlertDescription className="text-xs space-y-2">
                          <div>
                            <strong>Add this to your Job Executor .env file:</strong>
                          </div>
                          <code className="block bg-background p-2 rounded text-xs overflow-x-auto">
                            SUPABASE_SERVICE_ROLE_KEY={serviceRoleKey}
                          </code>
                          <div className="text-muted-foreground mt-2">
                            ⚠️ Keep this key secure - it grants full database access
                          </div>
                        </AlertDescription>
                      </Alert>

                      <div className="flex gap-2">
                        <Button 
                          onClick={copyServiceRoleKey} 
                          variant="outline"
                          className="flex-1"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          {serviceKeyCopied ? "Copied!" : "Copy Key"}
                        </Button>
                        <Button 
                          onClick={() => setServiceRoleKey(null)}
                          variant="outline"
                          className="flex-1"
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Hide Key
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Job Executor Diagnostics */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" />
                    Job Executor Diagnostics
                  </CardTitle>
                  <CardDescription>
                    Test Job Executor connectivity, credential access, and iDRAC reachability
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <JobExecutorDiagnostics />
                </CardContent>
              </Card>

              {/* Network Resilience Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Network Resilience</CardTitle>
                  <CardDescription>
                    Configure timeouts, retries, and connection pooling for reliable operations
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted">
                      <h3 className="font-medium">Timeouts</h3>
                      <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="connection-timeout">Connection (seconds)</Label>
                          <Input
                            id="connection-timeout"
                            type="number"
                            min="5"
                            max="120"
                            value={connectionTimeout}
                            onChange={(e) => setConnectionTimeout(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="read-timeout">Read (seconds)</Label>
                          <Input
                            id="read-timeout"
                            type="number"
                            min="10"
                            max="300"
                            value={readTimeout}
                            onChange={(e) => setReadTimeout(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="operation-timeout">Operation (seconds)</Label>
                          <Input
                            id="operation-timeout"
                            type="number"
                            min="60"
                            max="1800"
                            value={operationTimeout}
                            onChange={(e) => setOperationTimeout(parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted">
                      <h3 className="font-medium">Retry Policy</h3>
                      <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="max-retries">Max Attempts</Label>
                          <Input
                            id="max-retries"
                            type="number"
                            min="0"
                            max="10"
                            value={maxRetryAttempts}
                            onChange={(e) => setMaxRetryAttempts(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="retry-delay">Delay (seconds)</Label>
                          <Input
                            id="retry-delay"
                            type="number"
                            min="1"
                            max="60"
                            value={retryDelay}
                            onChange={(e) => setRetryDelay(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="backoff-type">Backoff Strategy</Label>
                          <select
                            id="backoff-type"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={retryBackoffType}
                            onChange={(e) => setRetryBackoffType(e.target.value as 'exponential' | 'linear' | 'fixed')}
                          >
                            <option value="exponential">Exponential</option>
                            <option value="linear">Linear</option>
                            <option value="fixed">Fixed</option>
                          </select>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted">
                      <h3 className="font-medium">Connection & Rate Limits</h3>
                      <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="max-connections">Max Concurrent Connections</Label>
                          <Input
                            id="max-connections"
                            type="number"
                            min="1"
                            max="50"
                            value={maxConcurrentConnections}
                            onChange={(e) => setMaxConcurrentConnections(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rate-limit">Requests Per Minute</Label>
                          <Input
                            id="rate-limit"
                            type="number"
                            min="1"
                            max="300"
                            value={maxRequestsPerMinute}
                            onChange={(e) => setMaxRequestsPerMinute(parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Button onClick={handleSaveNetworkSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Network Settings"}
                  </Button>
                </CardContent>
              </Card>

              {/* Pre-Job Validation */}
              <Card>
                <CardHeader>
                  <CardTitle>Pre-Job Validation</CardTitle>
                  <CardDescription>
                    Validate network prerequisites before starting autonomous update jobs
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Require Pre-Job Validation</Label>
                      <p className="text-sm text-muted-foreground">
                        Block job execution if critical network checks fail
                      </p>
                    </div>
                    <Switch
                      checked={requirePrereqValidation}
                      onCheckedChange={setRequirePrereqValidation}
                    />
                  </div>

                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Network Validation via Job Executor</strong>
                      <br />
                      <br />
                      Network validation requires edge functions to reach iDRACs directly, which cannot access private networks.
                      <br />
                      <br />
                      <strong>To test iDRAC connectivity:</strong>
                      <ol className="list-decimal ml-4 mt-2 space-y-1">
                        <li>Ensure Job Executor is running on a machine with network access to iDRACs</li>
                        <li>Use a discovery job to test multiple servers automatically</li>
                        <li>Check the Activity Monitor to verify successful iDRAC commands</li>
                        <li>Manual testing: See <code>docs/JOB_EXECUTOR_GUIDE.md</code> for curl commands</li>
                      </ol>
                    </AlertDescription>
                  </Alert>

                  {prereqResults && (
                    <div className="space-y-3 p-4 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">Validation Results</h4>
                        <Badge variant={prereqResults.overallStatus === 'passed' ? "default" : "destructive"}>
                          {prereqResults.overallStatus === 'passed' ? "All Checks Passed" : "Issues Found"}
                        </Badge>
                      </div>

                      {prereqResults.overallStatus === 'failed' && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-destructive">
                            Some tests failed. Check the logs below for details.
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                        <div>
                          <p className="text-sm font-medium">Servers</p>
                          <p className="text-xs text-muted-foreground">
                            {prereqResults.servers.reachable}/{prereqResults.servers.tested} reachable
                          </p>
                        </div>
                        {prereqResults.vcenter.configured && (
                          <div>
                            <p className="text-sm font-medium">vCenter</p>
                            <p className="text-xs text-muted-foreground">
                              {prereqResults.vcenter.reachable ? "Reachable" : "Unreachable"}
                            </p>
                          </div>
                        )}
                      </div>

                      {executionLog.length > 0 && (
                        <div className="mt-4">
                          <div 
                            className="flex items-center justify-between p-2 rounded-t-lg bg-muted cursor-pointer hover:bg-muted/80"
                            onClick={() => setShowExecutionLog(!showExecutionLog)}
                          >
                            <div className="flex items-center gap-2">
                              <Terminal className="h-4 w-4" />
                              <span className="font-medium text-sm">Execution Log</span>
                              <span className="text-xs text-muted-foreground">({executionLog.length} steps)</span>
                            </div>
                            <ChevronDown className={`h-4 w-4 transition-transform ${showExecutionLog ? 'rotate-180' : ''}`} />
                          </div>
                          
                          {showExecutionLog && (
                            <div className="border border-t-0 rounded-b-lg">
                              <div className="flex justify-end gap-2 p-2 border-b bg-muted/30">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={copyExecutionLog}
                                  className="h-7"
                                >
                                  <Copy className="h-3 w-3 mr-1" />
                                  Copy
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setExecutionLog([])}
                                  className="h-7"
                                >
                                  Clear
                                </Button>
                              </div>
                              <ScrollArea className="h-[300px] w-full">
                                <div className="p-3 font-mono text-xs space-y-1">
                                  {executionLog.map((entry, idx) => {
                                    const statusColors = {
                                      success: 'text-green-400',
                                      failed: 'text-red-400',
                                      warning: 'text-yellow-400'
                                    };
                                    const statusIcons = {
                                      success: '✓',
                                      failed: '✗',
                                      warning: '⚠'
                                    };
                                    
                                    return (
                                      <div key={idx} className="leading-relaxed">
                                        <span className="text-muted-foreground">
                                          [{new Date(entry.timestamp).toLocaleTimeString()}]
                                        </span>
                                        {' '}
                                        <span className={statusColors[entry.status as keyof typeof statusColors]}>
                                          {statusIcons[entry.status as keyof typeof statusIcons]}
                                        </span>
                                        {' '}
                                        <span className="text-blue-400">{entry.method}</span>
                                        {' '}
                                        <span className="text-foreground">{entry.target}</span>
                                        {entry.response_time_ms > 0 && (
                                          <>
                                            {' | '}
                                            <span className="text-muted-foreground">{entry.response_time_ms}ms</span>
                                          </>
                                        )}
                                        {entry.status_code && (
                                          <>
                                            {' | '}
                                            <span className="text-purple-400">HTTP {entry.status_code}</span>
                                          </>
                                        )}
                                        {entry.details && (
                                          <div className="ml-6 text-muted-foreground">
                                            {entry.details}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </ScrollArea>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Network Monitoring */}
              <Card>
                <CardHeader>
                  <CardTitle>Network Monitoring</CardTitle>
                  <CardDescription>
                    Real-time network health and diagnostics
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="space-y-0.5">
                      <Label>Monitor Latency</Label>
                      <p className="text-sm text-muted-foreground">
                        Track response times and alert on slow connections
                      </p>
                    </div>
                    <Switch
                      checked={monitorLatency}
                      onCheckedChange={setMonitorLatency}
                    />
                  </div>

                  {monitorLatency && (
                    <div className="space-y-2">
                      <Label htmlFor="latency-threshold">Alert Threshold (ms)</Label>
                      <Input
                        id="latency-threshold"
                        type="number"
                        min="100"
                        max="10000"
                        value={latencyAlertThreshold}
                        onChange={(e) => setLatencyAlertThreshold(parseInt(e.target.value))}
                      />
                    </div>
                  )}

                  <Button 
                    onClick={loadDiagnostics}
                    disabled={loadingDiagnostics}
                    variant="outline"
                    className="w-full"
                  >
                    {loadingDiagnostics ? "Loading..." : "Refresh Diagnostics"}
                  </Button>

                  {diagnosticsData && (
                    <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Active Connections</p>
                        <p className="text-2xl font-bold">{diagnosticsData.activeConnections}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Average Latency</p>
                        <p className="text-2xl font-bold">{diagnosticsData.avgLatency}ms</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Success Rate</p>
                        <p className="text-2xl font-bold">{diagnosticsData.successRate}%</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Recent Errors</p>
                        <p className="text-2xl font-bold">{diagnosticsData.recentErrors.length}</p>
                      </div>

                      {diagnosticsData.recentErrors.length > 0 && (
                        <div className="col-span-2 pt-2 border-t">
                          <p className="text-sm font-medium mb-2">Recent Network Errors:</p>
                          <ScrollArea className="h-[120px]">
                            <div className="space-y-2">
                              {diagnosticsData.recentErrors.map((error: any, idx: number) => (
                                <div key={idx} className="text-xs p-2 bg-destructive/10 rounded">
                                  <div className="font-mono">{error.endpoint}</div>
                                  <div className="text-muted-foreground">{error.error}</div>
                                  <div className="text-muted-foreground">
                                    {new Date(error.timestamp).toLocaleString()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="server-groups">
            <ServerGroupsManagement />
          </TabsContent>
        </Tabs>

        {/* Token Generation Dialog */}
        <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>API Token Generated</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-mono break-all">{generatedToken}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedToken || '');
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  Copy Token
                </Button>
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => {
                    setShowTokenDialog(false);
                    setGeneratedToken(null);
                  }}
                >
                  Close
                </Button>
              </div>
              <p className="text-sm text-destructive">
                ⚠️ Save this token now. You won't be able to see it again!
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Credential Set Dialog */}
        <Dialog open={showCredentialDialog} onOpenChange={setShowCredentialDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                {editingCredential ? 'Edit Credential Set' : 'Add Credential Set'}
              </DialogTitle>
            </DialogHeader>
            
            <ScrollArea className="max-h-[calc(90vh-12rem)] pr-4">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Left Column: Basic Credentials */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Basic Credentials</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cred-name">Name *</Label>
                    <Input
                      id="cred-name"
                      placeholder="Production iDRAC"
                      value={credentialForm.name}
                      onChange={(e) => setCredentialForm({...credentialForm, name: e.target.value})}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cred-username">Username *</Label>
                    <Input
                      id="cred-username"
                      placeholder="root"
                      value={credentialForm.username}
                      onChange={(e) => setCredentialForm({...credentialForm, username: e.target.value})}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cred-password">
                      Password * {editingCredential && "(leave blank to keep unchanged)"}
                    </Label>
                    <Input
                      id="cred-password"
                      type="password"
                      placeholder="••••••••"
                      value={credentialForm.password}
                      onChange={(e) => setCredentialForm({...credentialForm, password: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                      Credentials are encrypted at rest and protected by Row Level Security policies
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cred-description">Description (Optional)</Label>
                    <Input
                      id="cred-description"
                      placeholder="Used for production environment servers"
                      value={credentialForm.description}
                      onChange={(e) => setCredentialForm({...credentialForm, description: e.target.value})}
                    />
                  </div>
                </div>

                {/* Right Column: Configuration & IP Ranges */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Configuration</h3>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cred-priority">Priority</Label>
                    <Input
                      id="cred-priority"
                      type="number"
                      value={credentialForm.priority}
                      onChange={(e) => setCredentialForm({...credentialForm, priority: parseInt(e.target.value) || 100})}
                    />
                    <p className="text-xs text-muted-foreground">
                      Lower numbers = higher priority. Discovery will try credentials in ascending priority order.
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="cred-default"
                      checked={credentialForm.is_default}
                      onCheckedChange={(checked) => setCredentialForm({...credentialForm, is_default: checked})}
                    />
                    <Label htmlFor="cred-default">Set as default credential set</Label>
                  </div>

                  {/* IP Range Assignment Section - Always visible */}
                  <Collapsible 
                    open={ipRangeExpanded} 
                    onOpenChange={setIpRangeExpanded}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent">
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4" />
                          <span className="font-medium">IP Range Assignment</span>
                          {tempIpRanges.length > 0 && (
                            <Badge variant="secondary" className="ml-2">{tempIpRanges.length}</Badge>
                          )}
                        </div>
                        <ChevronRight className={cn(
                          "h-4 w-4 transition-transform",
                          ipRangeExpanded && "rotate-90"
                        )} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-3">
                      <p className="text-sm text-muted-foreground">
                        Assign specific IP ranges to use this credential set automatically. Leave empty to use as a general credential set.
                      </p>
                      
                      {/* Existing IP Ranges */}
                      {tempIpRanges.length > 0 && (
                        <div className="space-y-2">
                          {tempIpRanges.map((range, idx) => (
                            <div key={idx} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                              <span className="text-sm flex-1 font-mono">
                                {range.start_ip} - {range.end_ip}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setTempIpRanges(tempIpRanges.filter((_, i) => i !== idx));
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Add New IP Range Inline */}
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="text-xs font-medium">Add IP Range</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Start IP"
                            value={newInlineIpRange.start_ip}
                            onChange={(e) => setNewInlineIpRange({...newInlineIpRange, start_ip: e.target.value})}
                          />
                          <Input
                            placeholder="End IP"
                            value={newInlineIpRange.end_ip}
                            onChange={(e) => setNewInlineIpRange({...newInlineIpRange, end_ip: e.target.value})}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            if (newInlineIpRange.start_ip && newInlineIpRange.end_ip) {
                              setTempIpRanges([...tempIpRanges, newInlineIpRange]);
                              setNewInlineIpRange({ start_ip: "", end_ip: "" });
                            }
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Range
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => {
                setShowCredentialDialog(false);
                setEditingCredential(null);
              }}>
                Cancel
              </Button>
              <Button onClick={handleSaveCredential} disabled={loading}>
                {loading ? "Saving..." : editingCredential ? "Update" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Credential Set</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this credential set? This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => deleteConfirmId && handleDeleteCredential(deleteConfirmId)}
                disabled={loading}
              >
                {loading ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* IP Range Management Dialog */}
        <Dialog open={showIpRangeDialog} onOpenChange={setShowIpRangeDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                IP Range Assignment for "{selectedCredentialForIpRanges?.name}"
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Automatically use these credentials for servers in specific IP ranges during discovery. This helps apply the right credentials to different network segments without manual selection.
              </p>
              <div className="mt-2 p-3 rounded-md bg-muted/50 space-y-1">
                <p className="text-xs font-medium">Supported Formats:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5 ml-4 list-disc">
                  <li><span className="font-mono">10.0.0.0/8</span> - CIDR notation for network ranges</li>
                  <li><span className="font-mono">192.168.1.1-192.168.1.50</span> - Hyphenated range for consecutive IPs</li>
                  <li><span className="font-mono">172.16.0.100</span> - Single IP address</li>
                </ul>
              </div>
            </DialogHeader>
            
            <ScrollArea className="max-h-[500px] pr-4">
              <div className="space-y-4">
                {ipRanges.length === 0 ? (
                  <div className="text-center py-12 space-y-3">
                    <Network className="mx-auto h-12 w-12 text-muted-foreground" />
                    <div>
                      <h4 className="font-medium text-base mb-1">No IP Ranges Configured</h4>
                      <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        Add IP ranges below to automatically apply these credentials to specific network segments. This is useful when different server groups require different authentication.
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 max-w-md mx-auto">
                      <p className="font-medium mb-2">Example Use Cases:</p>
                      <ul className="text-left space-y-1 ml-4 list-disc">
                        <li>Production servers (10.0.0.0/24) use admin credentials</li>
                        <li>Test environment (192.168.1.0/24) uses test credentials</li>
                        <li>DMZ servers (172.16.0.0/16) use restricted credentials</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ipRanges.map((range) => (
                      <div key={range.id} className="flex items-start justify-between border rounded-lg p-3 hover:bg-accent/50">
                        <div className="flex-1">
                          <span className="font-mono text-sm font-medium">{range.ip_range}</span>
                          {range.description && (
                            <p className="text-xs text-muted-foreground mt-1">{range.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => startEditIpRange(range)}
                          >
                            Edit
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => handleDeleteIpRange(range.id)}
                            disabled={loading}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="border-t pt-4 space-y-3">
                  <h4 className="font-medium">{editingIpRange ? "Edit IP Range" : "Add IP Range"}</h4>
                  <div className="space-y-2">
                    <Label>IP Range *</Label>
                    <Input
                      placeholder="10.0.0.0/8 or 192.168.1.1-192.168.1.50"
                      value={newIpRange}
                      onChange={(e) => setNewIpRange(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (Optional)</Label>
                    <Input
                      placeholder="e.g., US-East Production Datacenter"
                      value={newIpRangeDescription}
                      onChange={(e) => setNewIpRangeDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    {editingIpRange ? (
                      <>
                        <Button 
                          onClick={handleUpdateIpRange}
                          disabled={loading}
                          className="flex-1"
                        >
                          {loading ? "Updating..." : "Update IP Range"}
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={cancelEditIpRange}
                          disabled={loading}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button 
                        onClick={handleAddIpRange}
                        disabled={loading}
                        className="flex-1"
                      >
                        {loading ? "Adding..." : "Add IP Range"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        <DiagnosticsDialog 
          open={showDiagnosticsDialog}
          onOpenChange={setShowDiagnosticsDialog}
        />
    </div>
  );
}