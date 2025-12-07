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

// Error messages for better user feedback
const ERROR_MESSAGES = {
  NOT_AUTHENTICATED: 'You must be logged in to perform this action',
  KEY_NOT_FOUND: 'SSH key not found',
  KEY_ALREADY_REVOKED: 'This key has already been revoked',
  KEY_GENERATION_FAILED: 'Failed to generate SSH key pair. Please try again.',
  ENCRYPTION_FAILED: 'Failed to encrypt private key. Please try again.',
  DATABASE_ERROR: 'Database operation failed. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection and try again.',
  NO_TARGETS_SELECTED: 'Please select at least one target',
  INVALID_KEY_NAME: 'Key name must be between 3 and 100 characters',
} as const;

// Helper to get user-friendly error message
function getErrorMessage(error: unknown, defaultMessage: string): string {
  if (error instanceof Error) {
    // Check for specific error types
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }
    if (error.message.includes('auth') || error.message.includes('unauthorized')) {
      return ERROR_MESSAGES.NOT_AUTHENTICATED;
    }
    return error.message;
  }
  return defaultMessage;
}

// Helper to log errors to audit
async function logAuditError(action: string, error: unknown, details?: Record<string, unknown>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('audit_logs').insert({
      user_id: user?.id || null,
      action: `ssh_key_${action}_error`,
      details: {
        error: error instanceof Error ? error.message : String(error),
        ...details,
      },
    });
  } catch (logError) {
    console.error('Failed to log audit error:', logError);
  }
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

      if (error) {
        console.error('Failed to fetch SSH keys:', error);
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }
      return data as SshKey[];
    },
    retry: 2,
    retryDelay: 1000,
  });

  // Fetch deployments for a specific key
  const fetchDeployments = async (keyId: string): Promise<SshKeyDeployment[]> => {
    if (!keyId) {
      throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
    }

    const { data, error } = await supabase
      .from('ssh_key_deployments')
      .select('*')
      .eq('ssh_key_id', keyId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch deployments:', error);
      throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
    }
    return data as SshKeyDeployment[];
  };

  // Generate new SSH key
  const generateKeyMutation = useMutation({
    mutationFn: async ({ name, description, expiresAt }: GenerateKeyParams) => {
      // Validate input
      if (!name || name.trim().length < 3 || name.trim().length > 100) {
        throw new Error(ERROR_MESSAGES.INVALID_KEY_NAME);
      }

      // First generate the key pair
      const { data: keyData, error: keyError } = await supabase.functions.invoke('generate-ssh-keypair', {
        body: { comment: name, returnFingerprint: true },
      });

      if (keyError || !keyData) {
        await logAuditError('generate', keyError, { name });
        throw new Error(ERROR_MESSAGES.KEY_GENERATION_FAILED);
      }

      // Encrypt the private key - use 'ssh_key' type without ID to get encrypted value
      const { data: encryptedData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
        body: { 
          password: keyData.privateKey,
          type: 'ssh_key'  // Returns encrypted value without storing
        },
      });

      if (encryptError || !encryptedData?.encrypted) {
        await logAuditError('encrypt', encryptError, { name });
        throw new Error(ERROR_MESSAGES.ENCRYPTION_FAILED);
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(ERROR_MESSAGES.NOT_AUTHENTICATED);
      }

      // Store in database
      const { data: sshKey, error: insertError } = await supabase
        .from('ssh_keys')
        .insert({
          name: name.trim(),
          description: description?.trim() || null,
          key_type: keyData.keyType || 'ed25519',
          public_key: keyData.publicKey,
          public_key_fingerprint: keyData.fingerprint,
          private_key_encrypted: encryptedData.encrypted,
          status: 'active',
          created_by: user.id,
          activated_at: new Date().toISOString(),
          expires_at: expiresAt || null,
        })
        .select()
        .single();

      if (insertError) {
        await logAuditError('insert', insertError, { name });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }

      return { sshKey, publicKey: keyData.publicKey };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key generated successfully');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to generate SSH key');
      console.error('SSH key generation failed:', error);
      toast.error(message);
    },
  });

  // Activate a pending key
  const activateKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      if (!keyId) {
        throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
      }

      const { data, error } = await supabase
        .from('ssh_keys')
        .update({
          status: 'active',
          activated_at: new Date().toISOString(),
        })
        .eq('id', keyId)
        .select()
        .single();

      if (error) {
        await logAuditError('activate', error, { keyId });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key activated');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to activate SSH key');
      console.error('SSH key activation failed:', error);
      toast.error(message);
    },
  });

  // Revoke a key
  const revokeKeyMutation = useMutation({
    mutationFn: async ({ keyId, reason, hardRevoke }: RevokeKeyParams) => {
      if (!keyId) {
        throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
      }

      // Check if key is already revoked
      const { data: existingKey } = await supabase
        .from('ssh_keys')
        .select('status')
        .eq('id', keyId)
        .single();

      if (existingKey?.status === 'revoked') {
        throw new Error(ERROR_MESSAGES.KEY_ALREADY_REVOKED);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(ERROR_MESSAGES.NOT_AUTHENTICATED);
      }

      const { data, error } = await supabase
        .from('ssh_keys')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
          revocation_reason: reason,
        })
        .eq('id', keyId)
        .select()
        .single();

      if (error) {
        await logAuditError('revoke', error, { keyId, reason });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }

      // Log the revocation for audit
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'ssh_key_revoked',
        details: { keyId, reason, hardRevoke },
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key revoked');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to revoke SSH key');
      console.error('SSH key revocation failed:', error);
      toast.error(message);
    },
  });

  // Delete a key (only if not deployed)
  const deleteKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      if (!keyId) {
        throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
      }

      const { error } = await supabase
        .from('ssh_keys')
        .delete()
        .eq('id', keyId);

      if (error) {
        await logAuditError('delete', error, { keyId });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      toast.success('SSH key deleted');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to delete SSH key');
      console.error('SSH key deletion failed:', error);
      toast.error(message);
    },
  });

  // Update key usage (called by Job Executor)
  const updateKeyUsage = async (keyId: string) => {
    if (!keyId) return;

    try {
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
    } catch (error) {
      console.error('Failed to update key usage:', error);
      // Don't throw - this is a non-critical operation
    }
  };

  // Deploy key to targets (creates job)
  const deployKeyMutation = useMutation({
    mutationFn: async ({ keyId, targetIds, adminPassword }: DeployKeyParams) => {
      if (!keyId) {
        throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
      }
      if (!targetIds || targetIds.length === 0) {
        throw new Error(ERROR_MESSAGES.NO_TARGETS_SELECTED);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(ERROR_MESSAGES.NOT_AUTHENTICATED);
      }

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

      if (error) {
        await logAuditError('deploy', error, { keyId, targetCount: targetIds.length });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }
      return job;
    },
    onSuccess: () => {
      toast.success('Deployment job created');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to start deployment');
      console.error('SSH key deployment failed:', error);
      toast.error(message);
    },
  });

  // Verify key on targets (creates job)
  const verifyKeyMutation = useMutation({
    mutationFn: async ({ keyId, targetIds }: VerifyKeyParams) => {
      if (!keyId) {
        throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
      }
      if (!targetIds || targetIds.length === 0) {
        throw new Error(ERROR_MESSAGES.NO_TARGETS_SELECTED);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(ERROR_MESSAGES.NOT_AUTHENTICATED);
      }

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

      if (error) {
        await logAuditError('verify', error, { keyId, targetCount: targetIds.length });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }
      return job;
    },
    onSuccess: () => {
      toast.success('Verification job created');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to start verification');
      console.error('SSH key verification failed:', error);
      toast.error(message);
    },
  });

  // Remove key from targets (creates job)
  const removeFromTargetsMutation = useMutation({
    mutationFn: async ({ keyId, targetIds }: VerifyKeyParams) => {
      if (!keyId) {
        throw new Error(ERROR_MESSAGES.KEY_NOT_FOUND);
      }
      if (!targetIds || targetIds.length === 0) {
        throw new Error(ERROR_MESSAGES.NO_TARGETS_SELECTED);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(ERROR_MESSAGES.NOT_AUTHENTICATED);
      }

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

      if (error) {
        await logAuditError('remove', error, { keyId, targetCount: targetIds.length });
        throw new Error(ERROR_MESSAGES.DATABASE_ERROR);
      }
      return { job, jobId: job.id };
    },
    onSuccess: () => {
      toast.success('Removal job created');
    },
    onError: (error) => {
      const message = getErrorMessage(error, 'Failed to start removal');
      console.error('SSH key removal failed:', error);
      toast.error(message);
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
