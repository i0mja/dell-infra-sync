import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  initTestSupabase,
  createTestUser,
  signInTestUser,
  cleanupTestUser,
  getTestSupabase,
  getTestUserId,
} from '../helpers/supabase-helpers';

describe('SSH Key Management Integration Tests', () => {
  beforeAll(async () => {
    initTestSupabase();
    await createTestUser('admin');
    await signInTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser();
  });

  describe('SSH Keys Table Operations', () => {
    let testKeyId: string;

    it('should allow admin to create SSH key', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: sshKey, error } = await supabase
        .from('ssh_keys')
        .insert({
          name: 'Test SSH Key',
          description: 'Integration test key',
          key_type: 'ed25519',
          public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest test@example.com',
          public_key_fingerprint: 'SHA256:TestFingerprint123456789',
          private_key_encrypted: 'encrypted-test-private-key',
          status: 'pending',
          created_by: userId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(sshKey).toBeDefined();
      expect(sshKey?.name).toBe('Test SSH Key');
      expect(sshKey?.status).toBe('pending');
      testKeyId = sshKey!.id;
    });

    it('should allow admin to view SSH keys', async () => {
      const supabase = getTestSupabase();

      const { data: keys, error } = await supabase
        .from('ssh_keys')
        .select('*')
        .limit(10);

      expect(error).toBeNull();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys?.length).toBeGreaterThan(0);
    });

    it('should allow admin to activate SSH key', async () => {
      const supabase = getTestSupabase();

      const { data: activated, error } = await supabase
        .from('ssh_keys')
        .update({
          status: 'active',
          activated_at: new Date().toISOString(),
        })
        .eq('id', testKeyId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(activated?.status).toBe('active');
      expect(activated?.activated_at).toBeTruthy();
    });

    it('should allow admin to update key usage', async () => {
      const supabase = getTestSupabase();

      // Get current use_count
      const { data: before } = await supabase
        .from('ssh_keys')
        .select('use_count')
        .eq('id', testKeyId)
        .single();

      const previousCount = before?.use_count || 0;

      // Update usage
      const { error } = await supabase
        .from('ssh_keys')
        .update({
          last_used_at: new Date().toISOString(),
          use_count: previousCount + 1,
        })
        .eq('id', testKeyId);

      expect(error).toBeNull();

      // Verify update
      const { data: after } = await supabase
        .from('ssh_keys')
        .select('use_count, last_used_at')
        .eq('id', testKeyId)
        .single();

      expect(after?.use_count).toBe(previousCount + 1);
      expect(after?.last_used_at).toBeTruthy();
    });

    it('should allow admin to revoke SSH key', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: revoked, error } = await supabase
        .from('ssh_keys')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: userId,
          revocation_reason: 'Test revocation',
        })
        .eq('id', testKeyId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(revoked?.status).toBe('revoked');
      expect(revoked?.revocation_reason).toBe('Test revocation');
    });

    it('should allow admin to delete revoked SSH key', async () => {
      const supabase = getTestSupabase();

      const { error } = await supabase
        .from('ssh_keys')
        .delete()
        .eq('id', testKeyId);

      expect(error).toBeNull();

      // Verify deletion
      const { data: deleted } = await supabase
        .from('ssh_keys')
        .select('id')
        .eq('id', testKeyId)
        .single();

      expect(deleted).toBeNull();
    });
  });

  describe('SSH Key Deployments', () => {
    let keyId: string;
    let deploymentId: string;

    beforeAll(async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create a test key for deployment tests
      const { data: key } = await supabase
        .from('ssh_keys')
        .insert({
          name: 'Deployment Test Key',
          key_type: 'ed25519',
          public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeploy deploy@test.com',
          public_key_fingerprint: 'SHA256:DeploymentTest123',
          private_key_encrypted: 'encrypted-deploy-key',
          status: 'active',
          created_by: userId,
          activated_at: new Date().toISOString(),
        })
        .select()
        .single();

      keyId = key!.id;
    });

    afterAll(async () => {
      const supabase = getTestSupabase();
      await supabase.from('ssh_keys').delete().eq('id', keyId);
    });

    it('should allow creating deployment records', async () => {
      const supabase = getTestSupabase();

      const { data: deployment, error } = await supabase
        .from('ssh_key_deployments')
        .insert({
          ssh_key_id: keyId,
          status: 'pending',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(deployment?.ssh_key_id).toBe(keyId);
      expect(deployment?.status).toBe('pending');
      deploymentId = deployment!.id;
    });

    it('should allow updating deployment status', async () => {
      const supabase = getTestSupabase();

      const { data: deployed, error } = await supabase
        .from('ssh_key_deployments')
        .update({
          status: 'deployed',
          deployed_at: new Date().toISOString(),
        })
        .eq('id', deploymentId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(deployed?.status).toBe('deployed');
    });

    it('should allow marking deployment as verified', async () => {
      const supabase = getTestSupabase();

      const { data: verified, error } = await supabase
        .from('ssh_key_deployments')
        .update({
          status: 'verified',
          verified_at: new Date().toISOString(),
        })
        .eq('id', deploymentId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(verified?.status).toBe('verified');
    });

    it('should fetch deployments for a key', async () => {
      const supabase = getTestSupabase();

      const { data: deployments, error } = await supabase
        .from('ssh_key_deployments')
        .select('*')
        .eq('ssh_key_id', keyId);

      expect(error).toBeNull();
      expect(Array.isArray(deployments)).toBe(true);
      expect(deployments?.length).toBeGreaterThan(0);
    });
  });

  describe('SSH Key Jobs', () => {
    it('should allow creating ssh_key_deploy job', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_deploy',
          status: 'pending',
          created_by: userId,
          details: {
            ssh_key_id: 'test-key-id',
            target_ids: ['target-1', 'target-2'],
          },
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(job?.job_type).toBe('ssh_key_deploy');
      expect((job?.details as any)?.ssh_key_id).toBe('test-key-id');

      // Cleanup
      await supabase.from('jobs').delete().eq('id', job!.id);
    });

    it('should allow creating ssh_key_verify job', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_verify',
          status: 'pending',
          created_by: userId,
          details: {
            ssh_key_id: 'verify-key-id',
            target_ids: ['target-1'],
          },
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(job?.job_type).toBe('ssh_key_verify');

      // Cleanup
      await supabase.from('jobs').delete().eq('id', job!.id);
    });

    it('should allow creating ssh_key_remove job', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_remove',
          status: 'pending',
          created_by: userId,
          details: {
            ssh_key_id: 'remove-key-id',
            target_ids: ['target-1', 'target-2'],
          },
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(job?.job_type).toBe('ssh_key_remove');

      // Cleanup
      await supabase.from('jobs').delete().eq('id', job!.id);
    });
  });

  describe('Key Status Filtering', () => {
    it('should filter keys by status', async () => {
      const supabase = getTestSupabase();

      const { data: activeKeys, error } = await supabase
        .from('ssh_keys')
        .select('*')
        .eq('status', 'active');

      expect(error).toBeNull();
      expect(Array.isArray(activeKeys)).toBe(true);
      
      // All returned keys should be active
      activeKeys?.forEach(key => {
        expect(key.status).toBe('active');
      });
    });

    it('should filter keys by expiration', async () => {
      const supabase = getTestSupabase();

      // Keys expiring within 30 days
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const { data: expiringKeys, error } = await supabase
        .from('ssh_keys')
        .select('*')
        .eq('status', 'active')
        .not('expires_at', 'is', null)
        .lte('expires_at', thirtyDaysFromNow.toISOString());

      expect(error).toBeNull();
      expect(Array.isArray(expiringKeys)).toBe(true);
    });
  });

  describe('Data Integrity', () => {
    it('should enforce unique fingerprints', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      const fingerprint = 'SHA256:UniqueTest' + Date.now();

      // Create first key
      const { data: first } = await supabase
        .from('ssh_keys')
        .insert({
          name: 'First Key',
          key_type: 'ed25519',
          public_key: 'ssh-ed25519 first-key',
          public_key_fingerprint: fingerprint,
          private_key_encrypted: 'encrypted-1',
          status: 'active',
          created_by: userId,
        })
        .select()
        .single();

      // Attempt to create second key with same fingerprint
      const { error: duplicateError } = await supabase
        .from('ssh_keys')
        .insert({
          name: 'Second Key',
          key_type: 'ed25519',
          public_key: 'ssh-ed25519 second-key',
          public_key_fingerprint: fingerprint,
          private_key_encrypted: 'encrypted-2',
          status: 'active',
          created_by: userId,
        });

      expect(duplicateError).toBeTruthy();

      // Cleanup
      if (first?.id) {
        await supabase.from('ssh_keys').delete().eq('id', first.id);
      }
    });

    it('should cascade delete deployments when key is deleted', async () => {
      const supabase = getTestSupabase();
      const userId = getTestUserId()!;

      // Create key
      const { data: key } = await supabase
        .from('ssh_keys')
        .insert({
          name: 'Cascade Test Key',
          key_type: 'ed25519',
          public_key: 'ssh-ed25519 cascade-test',
          public_key_fingerprint: 'SHA256:CascadeTest' + Date.now(),
          private_key_encrypted: 'encrypted-cascade',
          status: 'active',
          created_by: userId,
        })
        .select()
        .single();

      // Create deployment
      await supabase
        .from('ssh_key_deployments')
        .insert({
          ssh_key_id: key!.id,
          status: 'deployed',
        });

      // Delete key
      await supabase.from('ssh_keys').delete().eq('id', key!.id);

      // Verify deployment was also deleted
      const { data: orphanedDeployments } = await supabase
        .from('ssh_key_deployments')
        .select('*')
        .eq('ssh_key_id', key!.id);

      expect(orphanedDeployments?.length).toBe(0);
    });
  });
});
