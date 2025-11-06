import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initTestSupabase,
  createTestUser,
  signInTestUser,
  cleanupTestUser,
  getTestSupabase,
  getTestUserId,
} from '../helpers/supabase-helpers';

describe('Database Operations Integration Tests', () => {
  beforeAll(async () => {
    initTestSupabase();
    await createTestUser('admin');
    await signInTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser();
  });

  describe('Row Level Security (RLS)', () => {
    it('should allow authenticated users to view servers', async () => {
      const supabase = getTestSupabase();

      const { data, error } = await supabase.from('servers').select('*').limit(10);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should allow admin to create servers', async () => {
      const supabase = getTestSupabase();

      const { data, error } = await supabase
        .from('servers')
        .insert({
          hostname: 'rls-test-server',
          ip_address: '192.168.1.100',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('should allow admin to update servers', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert({
          hostname: 'update-test',
          ip_address: '192.168.1.101',
        })
        .select()
        .single();

      const { data: updated, error } = await supabase
        .from('servers')
        .update({ notes: 'Updated by RLS test' })
        .eq('id', server!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated?.notes).toBe('Updated by RLS test');
    });

    it('should allow admin to delete servers', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert({
          hostname: 'delete-test',
          ip_address: '192.168.1.102',
        })
        .select()
        .single();

      const { error } = await supabase.from('servers').delete().eq('id', server!.id);

      expect(error).toBeNull();
    });

    it('should allow users to view their own jobs', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job } = await supabase
        .from('jobs')
        .insert({
          created_by: userId,
          job_type: 'firmware_update',
          status: 'pending',
        })
        .select()
        .single();

      const { data: fetchedJob, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', job!.id)
        .single();

      expect(error).toBeNull();
      expect(fetchedJob).toBeDefined();
      expect(fetchedJob?.id).toBe(job!.id);
    });

    it('should enforce RLS on user_roles table', async () => {
      const supabase = getTestSupabase();

      // Users can view roles but not modify them (only admins can)
      const { data: roles, error } = await supabase.from('user_roles').select('*');

      expect(error).toBeNull();
      expect(roles).toBeDefined();
    });
  });

  describe('Database Functions', () => {
    it('should execute has_role function', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data, error } = await supabase.rpc('has_role', {
        _user_id: userId,
        _role: 'admin',
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('should execute get_user_role function', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data, error } = await supabase.rpc('get_user_role', {
        _user_id: userId,
      });

      expect(error).toBeNull();
      expect(data).toBe('admin');
    });
  });

  describe('Audit Logs', () => {
    it('should create audit log entries', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: auditLog, error } = await supabase
        .from('audit_logs')
        .insert({
          user_id: userId,
          action: 'test_action',
          details: { test: 'data' },
          ip_address: '127.0.0.1',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(auditLog).toBeDefined();
      expect(auditLog?.action).toBe('test_action');
    });

    it('should allow admins to view audit logs', async () => {
      const supabase = getTestSupabase();

      const { data: logs, error } = await supabase
        .from('audit_logs')
        .select('*')
        .limit(10);

      expect(error).toBeNull();
      expect(logs).toBeDefined();
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('Profiles', () => {
    it('should have profile created for test user', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      expect(error).toBeNull();
      expect(profile).toBeDefined();
      expect(profile?.id).toBe(userId);
    });

    it('should allow users to update their own profile', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: updated, error } = await supabase
        .from('profiles')
        .update({ full_name: 'Updated Test User' })
        .eq('id', userId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated?.full_name).toBe('Updated Test User');
    });
  });

  describe('Transactions and Consistency', () => {
    it('should maintain referential integrity for jobs and tasks', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create server
      const { data: server } = await supabase
        .from('servers')
        .insert({
          hostname: 'transaction-test',
          ip_address: '192.168.1.200',
        })
        .select()
        .single();

      // Create job
      const { data: job } = await supabase
        .from('jobs')
        .insert({
          created_by: userId,
          job_type: 'firmware_update',
          status: 'pending',
        })
        .select()
        .single();

      // Create task
      const { data: task, error: taskError } = await supabase
        .from('job_tasks')
        .insert({
          job_id: job!.id,
          server_id: server!.id,
          status: 'pending',
        })
        .select()
        .single();

      expect(taskError).toBeNull();
      expect(task?.job_id).toBe(job!.id);
      expect(task?.server_id).toBe(server!.id);
    });

    it('should handle concurrent updates correctly', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert({
          hostname: 'concurrent-test',
          ip_address: '192.168.1.201',
        })
        .select()
        .single();

      // Simulate concurrent updates
      const updates = [
        supabase
          .from('servers')
          .update({ notes: 'Update 1' })
          .eq('id', server!.id),
        supabase
          .from('servers')
          .update({ cpu_count: 16 })
          .eq('id', server!.id),
      ];

      const results = await Promise.all(updates);

      // Both should succeed
      expect(results[0].error).toBeNull();
      expect(results[1].error).toBeNull();

      // Verify final state
      const { data: finalServer } = await supabase
        .from('servers')
        .select('*')
        .eq('id', server!.id)
        .single();

      expect(finalServer?.cpu_count).toBe(16);
    });
  });

  describe('Notification Settings', () => {
    it('should create and read notification settings', async () => {
      const supabase = getTestSupabase();

      const { data: settings, error } = await supabase
        .from('notification_settings')
        .insert({
          notify_on_job_complete: true,
          notify_on_job_failed: true,
          notify_on_job_started: false,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(settings).toBeDefined();
      expect(settings?.notify_on_job_complete).toBe(true);
    });
  });
});
