# SSH Key Management API Reference

> **Version**: 1.0  
> **Last Updated**: 2024-12-07  
> **Status**: Complete

## Overview

This document provides a comprehensive API reference for the SSH Key Management System. The system enables centralized SSH key generation, deployment, rotation, and revocation for secure infrastructure access.

---

## Table of Contents

1. [Database Schema](#database-schema)
2. [React Hook: useSshKeys](#react-hook-usesshkeys)
3. [Job Types](#job-types)
4. [Edge Functions](#edge-functions)
5. [Examples](#examples)
6. [Troubleshooting](#troubleshooting)

---

## Database Schema

### Table: `ssh_keys`

Stores all SSH key pairs with metadata and lifecycle information.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Human-readable key name |
| `description` | TEXT | Optional description |
| `key_type` | TEXT | Key algorithm (`ed25519`, `rsa-4096`) |
| `public_key` | TEXT | Full public key (safe to display) |
| `public_key_fingerprint` | TEXT | SHA256 fingerprint for identification |
| `private_key_encrypted` | TEXT | Encrypted private key material |
| `status` | TEXT | Key status: `pending`, `active`, `revoked`, `expired` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `created_by` | UUID | User who created the key |
| `activated_at` | TIMESTAMPTZ | When the key was activated |
| `expires_at` | TIMESTAMPTZ | Optional expiration date |
| `revoked_at` | TIMESTAMPTZ | When the key was revoked |
| `revoked_by` | UUID | User who revoked the key |
| `revocation_reason` | TEXT | Reason for revocation |
| `last_used_at` | TIMESTAMPTZ | Last successful usage timestamp |
| `use_count` | INTEGER | Total usage count |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Table: `ssh_key_deployments`

Tracks key deployments to target systems.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ssh_key_id` | UUID | Reference to ssh_keys |
| `replication_target_id` | UUID | Reference to replication_targets (optional) |
| `zfs_template_id` | UUID | Reference to zfs_target_templates (optional) |
| `status` | TEXT | Deployment status: `pending`, `deployed`, `verified`, `failed`, `removed` |
| `deployed_at` | TIMESTAMPTZ | Deployment timestamp |
| `verified_at` | TIMESTAMPTZ | Verification timestamp |
| `removed_at` | TIMESTAMPTZ | Removal timestamp |
| `last_error` | TEXT | Last error message |
| `retry_count` | INTEGER | Number of retry attempts |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

---

## React Hook: useSshKeys

The `useSshKeys` hook provides all SSH key management functionality.

### Import

```typescript
import { useSshKeys, SshKey, SshKeyDeployment } from '@/hooks/useSshKeys';
```

### Types

```typescript
interface SshKey {
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

interface SshKeyDeployment {
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
```

### Returned Values

| Property | Type | Description |
|----------|------|-------------|
| `sshKeys` | `SshKey[]` | Array of all SSH keys |
| `isLoading` | `boolean` | Loading state for fetching keys |
| `error` | `Error \| null` | Error from fetching keys |
| `refetch` | `() => void` | Refetch keys from database |
| `fetchDeployments` | `(keyId: string) => Promise<SshKeyDeployment[]>` | Fetch deployments for a key |
| `generateKey` | `(params) => Promise<{sshKey, publicKey}>` | Generate new key pair |
| `isGenerating` | `boolean` | Key generation in progress |
| `activateKey` | `(keyId: string) => Promise<SshKey>` | Activate a pending key |
| `revokeKey` | `(params) => Promise<SshKey>` | Revoke a key |
| `isRevoking` | `boolean` | Key revocation in progress |
| `deleteKey` | `(keyId: string) => Promise<void>` | Delete a revoked key |
| `isDeleting` | `boolean` | Key deletion in progress |
| `deployKey` | `(params) => Promise<Job>` | Create deployment job |
| `isDeploying` | `boolean` | Deployment job creation in progress |
| `verifyKey` | `(params) => Promise<Job>` | Create verification job |
| `isVerifying` | `boolean` | Verification job creation in progress |
| `removeFromTargets` | `(params) => Promise<Job>` | Create removal job |
| `isRemoving` | `boolean` | Removal job creation in progress |
| `updateKeyUsage` | `(keyId: string) => Promise<void>` | Update key usage stats |

---

## Job Types

### `ssh_key_deploy`

Deploys an SSH key's public key to target systems.

**Job Details Schema:**
```typescript
{
  ssh_key_id: string;      // UUID of the key to deploy
  target_ids: string[];    // Array of replication target UUIDs
  admin_password?: string; // Optional password for initial deployment
}
```

**Job Results:**
```typescript
{
  results: Array<{
    target_id: string;
    hostname: string;
    success: boolean;
    message?: string;
    error?: string;
  }>;
}
```

### `ssh_key_verify`

Verifies an SSH key works on target systems.

**Job Details Schema:**
```typescript
{
  ssh_key_id: string;    // UUID of the key to verify
  target_ids: string[];  // Array of target UUIDs to check
}
```

### `ssh_key_remove`

Removes an SSH key from target systems' authorized_keys.

**Job Details Schema:**
```typescript
{
  ssh_key_id: string;    // UUID of the key to remove
  target_ids: string[];  // Array of target UUIDs
}
```

### `ssh_key_rotate`

Full rotation workflow: generate new key, deploy, verify, activate, remove old.

**Job Details Schema:**
```typescript
{
  old_key_id: string;    // UUID of the key being rotated
  new_key_name: string;  // Name for the new key
  admin_password?: string;
}
```

---

## Edge Functions

### `generate-ssh-keypair`

Generates a new SSH key pair.

**Request:**
```typescript
{
  comment?: string;           // Key comment/name
  keyType?: 'ed25519' | 'rsa-4096';
  returnFingerprint?: boolean;
}
```

**Response:**
```typescript
{
  publicKey: string;     // Full public key
  privateKey: string;    // Private key (PEM format)
  fingerprint?: string;  // SHA256 fingerprint
  keyType: string;       // Key algorithm
}
```

### `encrypt-credentials`

Encrypts sensitive data for storage.

**Request:**
```typescript
{
  password: string;  // Data to encrypt
}
```

**Response:**
```typescript
{
  encrypted: string;  // Encrypted data
}
```

---

## Examples

### Generate a New Key

```typescript
import { useSshKeys } from '@/hooks/useSshKeys';

function KeyGenerator() {
  const { generateKey, isGenerating } = useSshKeys();

  const handleGenerate = async () => {
    try {
      const { sshKey, publicKey } = await generateKey({
        name: 'Production ZFS Key',
        description: 'Key for production replication targets',
        expiresAt: '2025-12-31T23:59:59Z', // Optional
      });
      
      console.log('Key created:', sshKey.id);
      console.log('Public key:', publicKey);
    } catch (error) {
      console.error('Generation failed:', error);
    }
  };

  return (
    <Button onClick={handleGenerate} disabled={isGenerating}>
      {isGenerating ? 'Generating...' : 'Generate Key'}
    </Button>
  );
}
```

### Deploy Key to Targets

```typescript
import { useSshKeys } from '@/hooks/useSshKeys';

function KeyDeployer({ keyId, targetIds }: { keyId: string; targetIds: string[] }) {
  const { deployKey, isDeploying } = useSshKeys();

  const handleDeploy = async () => {
    const job = await deployKey({
      keyId,
      targetIds,
      adminPassword: 'optional-password', // For targets without existing keys
    });
    
    // Poll job.id for completion status
    console.log('Deployment job started:', job.id);
  };

  return (
    <Button onClick={handleDeploy} disabled={isDeploying}>
      Deploy to {targetIds.length} targets
    </Button>
  );
}
```

### Rotate a Key

```typescript
import { SshKeyRotateWizard } from '@/components/settings/ssh';

function RotationExample({ oldKey, deployments }) {
  const [showWizard, setShowWizard] = useState(false);

  return (
    <>
      <Button onClick={() => setShowWizard(true)}>
        Rotate Key
      </Button>
      
      <SshKeyRotateWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        oldKey={oldKey}
        deployments={deployments}
        onComplete={() => {
          console.log('Rotation complete');
          refetchKeys();
        }}
      />
    </>
  );
}
```

### Revoke a Key

```typescript
import { useSshKeys } from '@/hooks/useSshKeys';

function KeyRevoker({ keyId }: { keyId: string }) {
  const { revokeKey, isRevoking, removeFromTargets } = useSshKeys();

  // Soft revoke - just mark as revoked
  const handleSoftRevoke = async () => {
    await revokeKey({
      keyId,
      reason: 'No longer needed',
      hardRevoke: false,
    });
  };

  // Hard revoke - remove from targets first
  const handleHardRevoke = async (targetIds: string[]) => {
    // First remove from targets
    const job = await removeFromTargets({ keyId, targetIds });
    
    // Wait for job completion, then revoke
    // (Handled by SshKeyRevokeDialog component)
  };

  return (
    <Button variant="destructive" onClick={handleSoftRevoke} disabled={isRevoking}>
      Revoke Key
    </Button>
  );
}
```

---

## Troubleshooting

### Common Issues

#### "Failed to generate SSH key"

**Cause:** Edge function `generate-ssh-keypair` failed or is unavailable.

**Solution:**
1. Check edge function logs for errors
2. Verify the edge function is deployed
3. Check network connectivity

#### "Key verification failed"

**Cause:** The public key is not in the target's `authorized_keys` file.

**Solution:**
1. Verify the target is reachable via SSH
2. Check target's `/root/.ssh/authorized_keys` or equivalent
3. Verify correct username is configured
4. Check SSH daemon configuration

#### "Permission denied during deployment"

**Cause:** Cannot write to target's `authorized_keys` file.

**Solution:**
1. Provide admin password for initial deployment
2. Use an existing key with write access
3. Manually add the public key to the target

#### "Key not found in database"

**Cause:** Key was deleted or never created.

**Solution:**
1. Refresh the key list
2. Check if key was deleted by another admin
3. Verify the key ID is correct

### Logging

All SSH key operations are logged:

- **Database:** `idrac_commands` table with `command_type = 'ssh_key_*'`
- **Audit:** `audit_logs` table for administrative actions
- **Jobs:** `jobs` and `job_tasks` tables for deployment operations

### Debug Mode

Enable verbose logging in the Job Executor:

```python
# In activity_settings
log_level = 'debug'
```

---

## Security Considerations

1. **Private keys are never exposed** - Only encrypted private keys are stored
2. **Public keys are safe to display** - Can be copied and shared
3. **Revocation is immediate** - Jobs using revoked keys will fail
4. **Audit trail** - All operations are logged with user attribution
5. **RLS protection** - Only admins can manage keys, operators can view

---

## Migration from Inline Keys

If you have existing inline SSH keys in `replication_targets` or `zfs_target_templates`, use the Migration Dialog in Security Settings to centralize them.

The migration process:
1. Scans for inline `ssh_key_encrypted` values
2. Creates entries in `ssh_keys` table
3. Links targets via `ssh_key_id` foreign key
4. Optionally clears inline keys after migration
