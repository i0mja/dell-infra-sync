import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: string | null;
  action: string;
  auth_source: string | null;
  auth_method: string | null;
  ip_address: string | null;
  details: any;
  idm_user_dn: string | null;
  idm_groups_at_login: any;
  created_at: string;
}

export interface AuditFilters {
  startDate?: Date;
  endDate?: Date;
  authSource?: string;
  action?: string;
  userId?: string;
  ipAddress?: string;
}

export function useAuditLogs(filters: AuditFilters = {}) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { toast } = useToast();

  const fetchLogs = async (currentPage: number = 1) => {
    setLoading(true);
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      // Apply filters
      if (filters.startDate) {
        query = query.gte('timestamp', filters.startDate.toISOString());
      }
      if (filters.endDate) {
        query = query.lte('timestamp', filters.endDate.toISOString());
      }
      if (filters.authSource && filters.authSource !== 'all') {
        query = query.eq('auth_source', filters.authSource);
      }
      if (filters.action) {
        query = query.ilike('action', `%${filters.action}%`);
      }
      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters.ipAddress) {
        query = query.ilike('ip_address', `%${filters.ipAddress}%`);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      setLogs(data || []);
      setTotalCount(count || 0);
      setPage(currentPage);
    } catch (error: any) {
      console.error('Failed to fetch audit logs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load audit logs',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const exportToCsv = async () => {
    try {
      // Fetch all filtered logs (no pagination)
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      // Apply same filters
      if (filters.startDate) {
        query = query.gte('timestamp', filters.startDate.toISOString());
      }
      if (filters.endDate) {
        query = query.lte('timestamp', filters.endDate.toISOString());
      }
      if (filters.authSource && filters.authSource !== 'all') {
        query = query.eq('auth_source', filters.authSource);
      }
      if (filters.action) {
        query = query.ilike('action', `%${filters.action}%`);
      }
      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters.ipAddress) {
        query = query.ilike('ip_address', `%${filters.ipAddress}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Convert to CSV
      const headers = ['Timestamp', 'User ID', 'Action', 'Auth Source', 'Auth Method', 'IP Address'];
      const rows = data?.map(log => [
        log.timestamp,
        log.user_id || '',
        log.action,
        log.auth_source || '',
        log.auth_method || '',
        log.ip_address || ''
      ]);

      const csv = [
        headers.join(','),
        ...(rows || []).map(row => row.join(','))
      ].join('\n');

      // Download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Export Complete',
        description: `Exported ${data?.length || 0} audit log entries`,
      });
    } catch (error: any) {
      console.error('Failed to export audit logs:', error);
      toast({
        title: 'Export Failed',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [filters]);

  return {
    logs,
    loading,
    totalCount,
    page,
    pageSize,
    fetchLogs,
    exportToCsv,
  };
}
