import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SshKey {
  id: string;
  name: string;
  description: string | null;
  key_type: string;
  public_key: string;
  public_key_fingerprint: string;
  status: 'pending' | 'active' | 'revoked' | 'expired';
  created_at: string;
  created_by: string | null;
  activated_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  last_used_at: string | null;
  use_count: number;
  updated_at: string;
}

export interface SshKeyDeployment {
  id: string;
  ssh_key_id: string;
  replication_target_id: string | null;
  zfs_template_id: string | null;
  status: 'pending' | 'deployed' | 'verified' | 'failed' | 'removed';
  deployed_at: string | null;
  verified_at: string | null;
  removed_at: string | null;
  last_error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

interface GenerateKeyParams {
  name: string;
  description?: string;
  expiresAt?: string;
}

interface RevokeKeyParams {
  keyId: string;
  reason: string;
  hardRevoke?: boolean;
}

interface DeployKeyParams {
  keyId: string;
  targetIds: string[];
  adminPassword?: string;
}

interface VerifyKeyParams {
  keyId: string;
  targetIds: string[];
}

export function useSshKeys() {
  const queryClient = useQueryClient();

  // Fetch all SSH keys
  const { data: sshKeys, isLoading, error, refetch } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ssh_keys')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SshKey[];
    },
  });

  // Fetch deployments for a specific key
  const fetchDeployments = async (keyId: string) => {
    const { data, error } = await supabase
      .from('ssh_key_deployments')
      .select('*')
      .eq('ssh_key_id', keyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as SshKeyDeployment[];
  };

  // Generate new SSH key
  const generateKeyMutation = useMutation({
    mutationFn: async ({ name, description, expiresAt }: GenerateKeyParams) => {
      // First generate the key pair
      const { data: keyData, error: keyError } = await supabase.functions.invoke('generate-ssh-keypair', {
        body: { comment: name, returnFingerprint: true },
      });

      if (keyError) throw keyError;

      // Encrypt the private key
      const { data: encryptedData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
        body: { password: keyData.privateKey },
      });

      if (encryptError) throw encryptError;

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Store in database
      const { data: sshKey, error: insertError } = await supabase
        .from('ssh_keys')
        .insert({
          name,
          description: description || null,
          key_type: keyData.keyType || 'ed25519',
          public_key: keyData.publicKey,
          public_key_fingerprint: keyData.fingerprint,
          private_key_encrypted: encryptedData.encrypted,
          status: 'active',
          created_by: user?.id,
          activated_at: new Date().toISOString(),
          expires_at: expiresAt || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      return { sshKey, publicKey: keyData.publicKey };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key generated successfully');
    },
    onError: (error) => {
      console.error('Failed to generate SSH key:', error);
      toast.error('Failed to generate SSH key');
    },
  });

  // Activate a pending key
  const activateKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const { data, error } = await supabase
        .from('ssh_keys')
        .update({
          status: 'active',
          activated_at: new Date().toISOString(),
        })
        .eq('id', keyId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key activated');
    },
    onError: (error) => {
      console.error('Failed to activate SSH key:', error);
      toast.error('Failed to activate SSH key');
    },
  });

  // Revoke a key
  const revokeKeyMutation = useMutation({
    mutationFn: async ({ keyId, reason, hardRevoke }: RevokeKeyParams) => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('ssh_keys')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: user?.id,
          revocation_reason: reason,
        })
        .eq('id', keyId)
        .select()
        .single();

      if (error) throw error;

      // If hard revoke, trigger job to remove from targets (future phase)
      if (hardRevoke) {
        console.log('Hard revoke requested - will remove from targets in Phase 2');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key revoked');
    },
    onError: (error) => {
      console.error('Failed to revoke SSH key:', error);
      toast.error('Failed to revoke SSH key');
    },
  });

  // Delete a key (only if not deployed)
  const deleteKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase
        .from('ssh_keys')
        .delete()
        .eq('id', keyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key deleted');
    },
    onError: (error) => {
      console.error('Failed to delete SSH key:', error);
      toast.error('Failed to delete SSH key');
    },
  });

  // Update key usage (called by Job Executor)
  const updateKeyUsage = async (keyId: string) => {
    // First get current use_count
    const { data: currentKey } = await supabase
      .from('ssh_keys')
      .select('use_count')
      .eq('id', keyId)
      .single();

    await supabase
      .from('ssh_keys')
      .update({
        last_used_at: new Date().toISOString(),
        use_count: (currentKey?.use_count || 0) + 1,
      })
      .eq('id', keyId);
  };

  // Deploy key to targets (creates job)
  const deployKeyMutation = useMutation({
    mutationFn: async ({ keyId, targetIds, adminPassword }: DeployKeyParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_deploy',
          status: 'pending',
          created_by: user.id,
          details: {
            ssh_key_id: keyId,
            target_ids: targetIds,
            admin_password: adminPassword,
          },
        })
        .select()
        .single();

      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast.success('Deployment job created');
    },
    onError: (error) => {
      console.error('Failed to create deploy job:', error);
      toast.error('Failed to start deployment');
    },
  });

  // Verify key on targets (creates job)
  const verifyKeyMutation = useMutation({
    mutationFn: async ({ keyId, targetIds }: VerifyKeyParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_verify',
          status: 'pending',
          created_by: user.id,
          details: {
            ssh_key_id: keyId,
            target_ids: targetIds,
          },
        })
        .select()
        .single();

      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast.success('Verification job created');
    },
    onError: (error) => {
      console.error('Failed to create verify job:', error);
      toast.error('Failed to start verification');
    },
  });

  // Remove key from targets (creates job)
  const removeFromTargetsMutation = useMutation({
    mutationFn: async ({ keyId, targetIds }: VerifyKeyParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_remove',
          status: 'pending',
          created_by: user.id,
          details: {
            ssh_key_id: keyId,
            target_ids: targetIds,
          },
        })
        .select()
        .single();

      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast.success('Removal job created');
    },
    onError: (error) => {
      console.error('Failed to create remove job:', error);
      toast.error('Failed to start removal');
    },
  });

  return {
    sshKeys: sshKeys ?? [],
    isLoading,
    error,
    refetch,
    fetchDeployments,
    generateKey: generateKeyMutation.mutateAsync,
    isGenerating: generateKeyMutation.isPending,
    activateKey: activateKeyMutation.mutateAsync,
    revokeKey: revokeKeyMutation.mutateAsync,
    isRevoking: revokeKeyMutation.isPending,
    deleteKey: deleteKeyMutation.mutateAsync,
    isDeleting: deleteKeyMutation.isPending,
    updateKeyUsage,
    deployKey: deployKeyMutation.mutateAsync,
    isDeploying: deployKeyMutation.isPending,
    verifyKey: verifyKeyMutation.mutateAsync,
    isVerifying: verifyKeyMutation.isPending,
    removeFromTargets: removeFromTargetsMutation.mutateAsync,
    isRemoving: removeFromTargetsMutation.isPending,
  };
}
