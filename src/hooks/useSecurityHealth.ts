import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSshKeys } from '@/hooks/useSshKeys';

interface SecurityHealthData {
  credentials: {
    total: number;
    idrac: number;
    esxi: number;
    hasDefault: boolean;
  };
  sshKeys: {
    total: number;
    active: number;
    expired: number;
    expiringWithin30Days: number;
  };
  auditLogs: {
    last24hCount: number;
    criticalCount: number;
  };
  scheduledChecks: {
    enabled: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
  };
  securityScore: number;
}

export function useSecurityHealth() {
  const { sshKeys } = useSshKeys();
  const [credentials, setCredentials] = useState<any[]>([]);
  const [auditStats, setAuditStats] = useState({ last24hCount: 0, criticalCount: 0 });
  const [scheduledCheckConfig, setScheduledCheckConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      
      // Fetch credentials
      const { data: credData } = await supabase
        .from('credential_sets')
        .select('*');
      
      if (credData) setCredentials(credData);

      // Fetch audit stats (last 24h)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: totalCount } = await supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .gte('timestamp', twentyFourHoursAgo);

      const { count: criticalCount } = await supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .gte('timestamp', twentyFourHoursAgo)
        .or('action.ilike.%break_glass%,action.ilike.%fail%');

      setAuditStats({
        last24hCount: totalCount || 0,
        criticalCount: criticalCount || 0,
      });

      // Fetch scheduled check config
      const { data: checkConfig } = await supabase
        .from('scheduled_safety_checks')
        .select('*')
        .maybeSingle();

      setScheduledCheckConfig(checkConfig);
      setLoading(false);
    }

    fetchData();
  }, []);

  const healthData: SecurityHealthData = useMemo(() => {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const activeKeys = sshKeys.filter(k => k.status === 'active');
    const expiredKeys = sshKeys.filter(k => k.status === 'expired');
    const expiringKeys = sshKeys.filter(k => {
      if (!k.expires_at || k.status !== 'active') return false;
      const expiresAt = new Date(k.expires_at);
      return expiresAt <= thirtyDaysFromNow && expiresAt > now;
    });

    const idracCreds = credentials.filter(c => c.credential_type === 'idrac');
    const esxiCreds = credentials.filter(c => c.credential_type === 'esxi');
    const hasDefault = credentials.some(c => c.is_default);

    // Calculate security score
    let score = 0;
    if (credentials.length > 0) score += 20;
    if (activeKeys.length > 0) score += 20;
    if (expiredKeys.length === 0 && activeKeys.length > 0) score += 15;
    if (scheduledCheckConfig?.enabled) score += 15;
    if (scheduledCheckConfig?.last_status === 'completed') score += 15;
    if (auditStats.criticalCount === 0) score += 15;

    return {
      credentials: {
        total: credentials.length,
        idrac: idracCreds.length,
        esxi: esxiCreds.length,
        hasDefault,
      },
      sshKeys: {
        total: sshKeys.length,
        active: activeKeys.length,
        expired: expiredKeys.length,
        expiringWithin30Days: expiringKeys.length,
      },
      auditLogs: auditStats,
      scheduledChecks: {
        enabled: scheduledCheckConfig?.enabled || false,
        lastRunAt: scheduledCheckConfig?.last_run_at || null,
        lastStatus: scheduledCheckConfig?.last_status || null,
      },
      securityScore: score,
    };
  }, [credentials, sshKeys, auditStats, scheduledCheckConfig]);

  return { healthData, loading, refetch: () => {} };
}
