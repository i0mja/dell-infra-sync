import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initTestSupabase,
  createTestUser,
  signInTestUser,
  cleanupTestUser,
  getTestSupabase,
  getTestUserId,
} from '../helpers/supabase-helpers';
import { createTestJob, createTestServer } from '../helpers/test-factories';

describe('Job Integration Tests', () => {
  let testServerId: string;

  beforeAll(async () => {
    initTestSupabase();
    await createTestUser('admin');
    await signInTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser();
  });

  beforeEach(async () => {
    // Create a test server for job operations
    const supabase = getTestSupabase();
    const serverData = createTestServer();
    const { data: server, error } = await supabase
      .from('servers')
      .insert(serverData)
      .select()
      .single();

    if (error) throw error;
    testServerId = server.id;
  });

  describe('Job Creation', () => {
    it('should create a firmware update job', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const jobData = createTestJob(userId, {
        job_type: 'firmware_update',
        target_scope: {
          server_ids: [testServerId],
        },
      });

      const { data: job, error } = await supabase
        .from('jobs')
        .insert(jobData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(job).toBeDefined();
      expect(job?.job_type).toBe('firmware_update');
      expect(job?.status).toBe('pending');
      expect(job?.created_by).toBe(userId);
    });

    it('should create a job with multiple servers in scope', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create second test server
      const { data: server2 } = await supabase
        .from('servers')
        .insert(createTestServer())
        .select()
        .single();

      const jobData = createTestJob(userId, {
        job_type: 'discovery_scan',
        target_scope: {
          server_ids: [testServerId, server2!.id],
        },
      });

      const { data: job, error } = await supabase
        .from('jobs')
        .insert(jobData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(job).toBeDefined();
      expect(job?.target_scope).toHaveProperty('server_ids');
      expect((job?.target_scope as any).server_ids).toHaveLength(2);
    });

    it('should create job tasks for each server', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create job
      const { data: job } = await supabase
        .from('jobs')
        .insert(
          createTestJob(userId, {
            job_type: 'firmware_update',
            target_scope: { server_ids: [testServerId] },
          })
        )
        .select()
        .single();

      // Create associated task
      const { data: task, error: taskError } = await supabase
        .from('job_tasks')
        .insert({
          job_id: job!.id,
          server_id: testServerId,
          status: 'pending',
        })
        .select()
        .single();

      expect(taskError).toBeNull();
      expect(task).toBeDefined();
      expect(task?.job_id).toBe(job!.id);
      expect(task?.server_id).toBe(testServerId);
      expect(task?.status).toBe('pending');
    });
  });

  describe('Job Status Updates', () => {
    it('should update job status from pending to running', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create job
      const { data: job } = await supabase
        .from('jobs')
        .insert(createTestJob(userId))
        .select()
        .single();

      // Update status
      const { data: updatedJob, error } = await supabase
        .from('jobs')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .eq('id', job!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updatedJob?.status).toBe('running');
      expect(updatedJob?.started_at).toBeDefined();
    });

    it('should update job status to completed with timestamp', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job } = await supabase
        .from('jobs')
        .insert(createTestJob(userId))
        .select()
        .single();

      const completedAt = new Date().toISOString();
      const { data: updatedJob, error } = await supabase
        .from('jobs')
        .update({
          status: 'completed',
          completed_at: completedAt,
        })
        .eq('id', job!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updatedJob?.status).toBe('completed');
      expect(updatedJob?.completed_at).toBe(completedAt);
    });

    it('should update job with failure status and error details', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job } = await supabase
        .from('jobs')
        .insert(createTestJob(userId))
        .select()
        .single();

      const errorDetails = { error: 'Connection timeout', code: 'ETIMEDOUT' };
      const { data: updatedJob, error } = await supabase
        .from('jobs')
        .update({
          status: 'failed',
          details: errorDetails,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.details).toEqual(errorDetails);
    });
  });

  describe('Job Queries and Filtering', () => {
    it('should fetch only pending jobs', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create jobs with different statuses
      await supabase.from('jobs').insert([
        createTestJob(userId, { status: 'pending' }),
        createTestJob(userId, { status: 'running' }),
        createTestJob(userId, { status: 'completed' }),
      ]);

      const { data: pendingJobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'pending')
        .eq('created_by', userId);

      expect(error).toBeNull();
      expect(pendingJobs).toBeDefined();
      expect(pendingJobs!.length).toBeGreaterThanOrEqual(1);
      expect(pendingJobs!.every((job) => job.status === 'pending')).toBe(true);
    });

    it('should fetch jobs by type', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      await supabase.from('jobs').insert([
        createTestJob(userId, { job_type: 'firmware_update' }),
        createTestJob(userId, { job_type: 'discovery_scan' }),
      ]);

      const { data: firmwareJobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_type', 'firmware_update')
        .eq('created_by', userId);

      expect(error).toBeNull();
      expect(firmwareJobs).toBeDefined();
      expect(firmwareJobs!.every((job) => job.job_type === 'firmware_update')).toBe(true);
    });

    it('should fetch jobs with tasks', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job } = await supabase
        .from('jobs')
        .insert(createTestJob(userId))
        .select()
        .single();

      await supabase.from('job_tasks').insert({
        job_id: job!.id,
        server_id: testServerId,
        status: 'pending',
      });

      const { data: jobWithTasks, error } = await supabase
        .from('jobs')
        .select('*, job_tasks(*)')
        .eq('id', job!.id)
        .single();

      expect(error).toBeNull();
      expect(jobWithTasks).toBeDefined();
      expect((jobWithTasks as any).job_tasks).toBeDefined();
      expect((jobWithTasks as any).job_tasks.length).toBeGreaterThan(0);
    });
  });

  describe('Full Server Update Jobs', () => {
    it('should create parent job for full server update', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const jobData = createTestJob(userId, {
        job_type: 'full_server_update',
        target_scope: { server_ids: [testServerId] },
      });

      const { data: parentJob, error } = await supabase
        .from('jobs')
        .insert(jobData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(parentJob).toBeDefined();
      expect(parentJob?.job_type).toBe('full_server_update');
      expect(parentJob?.parent_job_id).toBeNull();
    });
  });
});
