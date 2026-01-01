import { useState, useEffect } from 'react';
import { SettingsTabLayout, SettingsTab, settingsClasses } from '@/components/settings';
import { LayoutDashboard, Radio, Zap, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useNotification } from '@/contexts/NotificationContext';
import type { ToastLevel } from '@/contexts/NotificationContext';
import {
  NotificationHealthOverview,
  EmailChannelCard,
  TeamsChannelCard,
  NotificationTriggersCard,
  NotificationHistoryCard,
} from '@/components/notifications/settings';

interface NotificationSettingsData {
  id?: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from_email: string;
  teams_webhook_url: string;
  teams_mention_users: string;
  mention_on_critical_failures: boolean;
  notify_on_job_started: boolean;
  notify_on_job_complete: boolean;
  notify_on_job_failed: boolean;
}

const defaultSettings: NotificationSettingsData = {
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  smtp_from_email: '',
  teams_webhook_url: '',
  teams_mention_users: '',
  mention_on_critical_failures: false,
  notify_on_job_started: false,
  notify_on_job_complete: true,
  notify_on_job_failed: true,
};

interface NotificationStats {
  sent24h: number;
  delivered24h: number;
  failed24h: number;
}

export function NotificationSettings() {
  const { toast } = useToast();
  const { settings: notificationContextSettings, updateSettings: updateContextSettings } = useNotification();
  
  const [settings, setSettings] = useState<NotificationSettingsData>(defaultSettings);
  const [stats, setStats] = useState<NotificationStats>({ sent24h: 0, delivered24h: 0, failed24h: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentSection, setCurrentSection] = useState('overview');
  
  // Channel enabled states (derived from whether config exists)
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [teamsEnabled, setTeamsEnabled] = useState(false);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          smtp_host: data.smtp_host || '',
          smtp_port: data.smtp_port || 587,
          smtp_user: data.smtp_user || '',
          smtp_password: data.smtp_password || '',
          smtp_from_email: data.smtp_from_email || '',
          teams_webhook_url: data.teams_webhook_url || '',
          teams_mention_users: data.teams_mention_users || '',
          mention_on_critical_failures: data.mention_on_critical_failures || false,
          notify_on_job_started: data.notify_on_job_started || false,
          notify_on_job_complete: data.notify_on_job_complete ?? true,
          notify_on_job_failed: data.notify_on_job_failed ?? true,
        });
        
        // Set enabled states based on whether config exists
        setEmailEnabled(!!data.smtp_host);
        setTeamsEnabled(!!data.teams_webhook_url);
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load notification settings',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('notification_logs')
        .select('status')
        .gte('created_at', twentyFourHoursAgo);

      if (error) throw error;

      const calculatedStats = (data || []).reduce(
        (acc, log) => {
          acc.sent24h++;
          if (log.status === 'delivered' || log.status === 'sent') {
            acc.delivered24h++;
          } else if (log.status === 'failed') {
            acc.failed24h++;
          }
          return acc;
        },
        { sent24h: 0, delivered24h: 0, failed24h: 0 }
      );

      setStats(calculatedStats);
    } catch (error) {
      console.error('Failed to load notification stats:', error);
    }
  };

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        smtp_host: emailEnabled ? settings.smtp_host : null,
        smtp_port: emailEnabled ? settings.smtp_port : null,
        smtp_user: emailEnabled ? settings.smtp_user : null,
        smtp_password: emailEnabled ? settings.smtp_password : null,
        smtp_from_email: emailEnabled ? settings.smtp_from_email : null,
        teams_webhook_url: teamsEnabled ? settings.teams_webhook_url : null,
        teams_mention_users: teamsEnabled ? settings.teams_mention_users : null,
        mention_on_critical_failures: settings.mention_on_critical_failures,
        notify_on_job_started: settings.notify_on_job_started,
        notify_on_job_complete: settings.notify_on_job_complete,
        notify_on_job_failed: settings.notify_on_job_failed,
        updated_at: new Date().toISOString(),
      };

      if (settings.id) {
        const { error } = await supabase
          .from('notification_settings')
          .update(payload)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('notification_settings')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setSettings(prev => ({ ...prev, id: data.id }));
      }

      toast({
        title: 'Settings saved',
        description: 'Notification settings have been updated',
      });
    } catch (error) {
      console.error('Failed to save notification settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save notification settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Map context toast level to display value
  const getToastLevelDisplay = (level: ToastLevel): string => {
    switch (level) {
      case 'errors_only': return 'error';
      case 'errors_and_warnings': return 'warning';
      case 'all': return 'all';
      default: return 'info';
    }
  };

  // Map display value back to context toast level
  const handleToastLevelChange = (displayValue: string) => {
    let contextValue: ToastLevel;
    switch (displayValue) {
      case 'error': contextValue = 'errors_only'; break;
      case 'warning': contextValue = 'errors_and_warnings'; break;
      case 'all': contextValue = 'all'; break;
      default: contextValue = 'all';
    }
    updateContextSettings({ toastLevel: contextValue });
  };

  const emailConfigured = !!(settings.smtp_host && settings.smtp_port && settings.smtp_user && settings.smtp_from_email);
  const teamsConfigured = !!settings.teams_webhook_url;
  const hasExternalChannels = (emailEnabled && emailConfigured) || (teamsEnabled && teamsConfigured);

  if (isLoading) {
    return (
      <div className={settingsClasses.loadingContainer}>
        <div className={settingsClasses.loadingSpinner}></div>
      </div>
    );
  }

  const tabs: SettingsTab[] = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: LayoutDashboard, 
      content: (
        <NotificationHealthOverview
          emailConfigured={emailEnabled && emailConfigured}
          teamsConfigured={teamsEnabled && teamsConfigured}
          toastLevel={getToastLevelDisplay(notificationContextSettings.toastLevel)}
          stats={stats}
          onNavigateToChannels={() => setCurrentSection('channels')}
          onNavigateToTriggers={() => setCurrentSection('triggers')}
        />
      )
    },
    { 
      id: 'channels', 
      label: 'Channels', 
      icon: Radio, 
      content: (
        <div className="space-y-4">
          <EmailChannelCard
            config={{
              smtp_host: settings.smtp_host,
              smtp_port: settings.smtp_port,
              smtp_user: settings.smtp_user,
              smtp_password: settings.smtp_password,
              smtp_from_email: settings.smtp_from_email,
            }}
            enabled={emailEnabled}
            onConfigChange={(config) => setSettings(prev => ({ ...prev, ...config }))}
            onEnabledChange={setEmailEnabled}
            onSave={handleSave}
            isSaving={isSaving}
          />
          <TeamsChannelCard
            config={{
              teams_webhook_url: settings.teams_webhook_url,
              teams_mention_users: settings.teams_mention_users,
              mention_on_critical_failures: settings.mention_on_critical_failures,
            }}
            enabled={teamsEnabled}
            onConfigChange={(config) => setSettings(prev => ({ ...prev, ...config }))}
            onEnabledChange={setTeamsEnabled}
            onSave={handleSave}
            isSaving={isSaving}
          />
        </div>
      )
    },
    { 
      id: 'triggers', 
      label: 'Triggers', 
      icon: Zap, 
      content: (
        <NotificationTriggersCard
          settings={{
            toast_level: getToastLevelDisplay(notificationContextSettings.toastLevel),
            notify_on_job_started: settings.notify_on_job_started,
            notify_on_job_complete: settings.notify_on_job_complete,
            notify_on_job_failed: settings.notify_on_job_failed,
          }}
          onChange={(triggerSettings) => {
            if (triggerSettings.toast_level) {
              handleToastLevelChange(triggerSettings.toast_level);
            }
            const { toast_level, ...rest } = triggerSettings;
            if (Object.keys(rest).length > 0) {
              setSettings(prev => ({ ...prev, ...rest }));
            }
          }}
          onSave={handleSave}
          isSaving={isSaving}
          hasExternalChannels={hasExternalChannels}
        />
      )
    },
    { 
      id: 'history', 
      label: 'History', 
      icon: History, 
      content: <NotificationHistoryCard />
    },
  ];

  return (
    <SettingsTabLayout 
      tabs={tabs} 
      defaultTab="overview"
      onSectionChange={setCurrentSection}
    />
  );
}
