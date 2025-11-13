import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor, Database, Shield, AlertCircle, Palette, Mail, MessageSquare, Server, Briefcase, Activity, Bell, Network, ChevronRight, Plus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export default function Settings() {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  
  // Get default tab from query params or use 'appearance'
  const tabFromUrl = searchParams.get('tab');
  const initialTab = tabFromUrl === 'activity-monitor' ? 'activity' : tabFromUrl === 'jobs' ? 'jobs' : tabFromUrl || 'appearance';
  const [activeTab, setActiveTab] = useState(initialTab);

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
  
  // API Token state
  const [apiTokens, setApiTokens] = useState<any[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showTokenDialog, setShowTokenDialog] = useState(false);

  // Activity Monitor Settings
  const [activitySettingsId, setActivitySettingsId] = useState<string | null>(null);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<'all' | 'errors_only' | 'slow_only'>('all');
  const [slowCommandThreshold, setSlowCommandThreshold] = useState(5000);
  const [maxRequestBodyKb, setMaxRequestBodyKb] = useState(100);
  const [maxResponseBodyKb, setMaxResponseBodyKb] = useState(100);
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

  useEffect(() => {
    loadSettings();
    loadApiTokens();
    fetchStaleJobCount();
    loadRecentNotifications();
    loadCredentialSets();
  }, []);

  // Sync activeTab with URL params when they change
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    const newTab = tabFromUrl === 'activity-monitor' ? 'activity' : tabFromUrl === 'jobs' ? 'jobs' : tabFromUrl || 'appearance';
    setActiveTab(newTab);
  }, [searchParams]);

  // Tab metadata for dynamic headers
  const tabMetadata: Record<string, { title: string; description: string; icon: any }> = {
    appearance: {
      title: "Appearance",
      description: "Customize how the application looks and feels",
      icon: Palette,
    },
    smtp: {
      title: "SMTP Configuration",
      description: "Configure your SMTP server for email notifications",
      icon: Mail,
    },
    teams: {
      title: "Microsoft Teams Integration",
      description: "Configure Teams webhook for job notifications",
      icon: MessageSquare,
    },
    openmanage: {
      title: "Dell OpenManage Enterprise",
      description: "Configure automatic server discovery from OpenManage Enterprise",
      icon: Server,
    },
    jobs: {
      title: "Jobs Configuration",
      description: "Configure job retention, cleanup, and stale job management",
      icon: Briefcase,
    },
    activity: {
      title: "Activity Monitor Settings",
      description: "Configure log retention, cleanup, and monitoring preferences",
      icon: Activity,
    },
    preferences: {
      title: "Notification Preferences",
      description: "Choose which events trigger notifications",
      icon: Bell,
    },
    credentials: {
      title: "Credential Management",
      description: "Manage iDRAC credential sets for server discovery and operations",
      icon: Shield,
    },
  };

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
      const { data, error } = await supabase.functions.invoke('send-notification', {
        body: {
          isTest: true,
          testMessage: 'This is a test notification from your Server Management System',
        },
      });

      if (error) throw error;

      if (data?.results?.teams?.success) {
        toast({
          title: "Test Notification Sent",
          description: "Check your Teams channel for the test message",
        });
        // Refresh notification logs
        await loadRecentNotifications();
      } else if (data?.results?.teams?.error) {
        throw new Error(data.results.teams.error);
      } else {
        throw new Error('Unexpected response from notification service');
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
      }
    } catch (error: any) {
      console.error("Error loading activity settings:", error);
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
      const activityData = {
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
      };

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
      const { data, error } = await supabase.functions.invoke('cleanup-activity-logs');
      
      if (error) throw error;

      toast({
        title: "Cleanup Complete",
        description: `Deleted ${data.deleted_count || 0} old log entries`,
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
      const { data, error } = await supabase.functions.invoke('cleanup-old-jobs');
      
      if (error) throw error;

      const deletedCount = data.deleted_count || 0;
      const cancelledCount = data.stale_cancelled_count || 0;
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
      const { data, error } = await supabase.functions.invoke('cleanup-old-jobs');
      
      if (error) throw error;

      const cancelledCount = data.stale_cancelled_count || 0;
      toast({
        title: "Stale Jobs Cancelled",
        description: `Cancelled ${cancelledCount} stale jobs`,
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

    setOmeSyncing(true);
    try {
      toast({
        title: "Sync Started",
        description: "OpenManage sync initiated. This may take a few moments...",
      });

      // Note: This requires the openmanage-sync-script.py to be run
      // The edge function expects devices array from the script
      toast({
        title: "Manual Sync Required",
        description: "Please run the openmanage-sync-script.py on your on-premise server to perform the sync. See documentation for details.",
      });
    } catch (error: any) {
      console.error("Error triggering sync:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger sync",
        variant: "destructive",
      });
    } finally {
      setOmeSyncing(false);
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
      const payload: any = {
        name: credentialForm.name,
        username: credentialForm.username,
        description: credentialForm.description || null,
        priority: credentialForm.priority,
        is_default: credentialForm.is_default,
      };

      // Only include password if it's provided
      if (credentialForm.password) {
        payload.password_encrypted = credentialForm.password;
      }

      if (editingCredential) {
        // Update existing
        const { error } = await supabase
          .from('credential_sets')
          .update(payload)
          .eq('id', editingCredential.id);
        
        if (error) throw error;

        // Handle IP ranges - delete existing and insert new ones
        await (supabase as any)
          .from('credential_ip_ranges')
          .delete()
          .eq('credential_set_id', editingCredential.id);

        if (tempIpRanges.length > 0) {
          const { error: rangeError } = await (supabase as any)
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
        // Create new
        const { data: newCred, error } = await supabase
          .from('credential_sets')
          .insert(payload)
          .select()
          .single();
        
        if (error) throw error;

        // Insert IP ranges if any
        if (tempIpRanges.length > 0 && newCred) {
          const { error: rangeError } = await (supabase as any)
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
      const { data, error } = await supabase.functions.invoke('test-idrac-connection', {
        body: {
          ip_address: testIp,
          username: credentialSet.username,
          password: credentialSet.password_encrypted,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Connection Successful",
          description: `Connected to ${testIp} successfully. Model: ${data.model || 'Unknown'}`,
        });
      } else {
        throw new Error(data.error || 'Connection failed');
      }
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect with these credentials",
        variant: "destructive",
      });
    } finally {
      setTestingCredential(null);
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

          <TabsContent value="appearance">
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
                    disabled={omeSyncing}
                    variant="outline"
                  >
                    {omeSyncing ? "Syncing..." : "Sync Now"}
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
            <Card>
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
    </div>
  );
}