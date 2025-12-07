# SSH Key Management System - Implementation Plan

> **Status**: Planning  
> **Created**: 2024-12-07  
> **Author**: AI Assistant  
> **Priority**: Medium  

## Executive Summary

This document outlines a comprehensive SSH key management system for the Dell Server Manager application. The system will provide centralized key generation, rotation, revocation, and audit capabilities for SSH keys used to access ZFS replication targets and other infrastructure components.

---

## 1. Current State Analysis

### 1.1 Existing Implementation

**Key Storage Locations:**
- `zfs_target_templates.ssh_key_encrypted` - SSH keys for ZFS target deployment templates
- `replication_targets.ssh_key_encrypted` - SSH keys for active replication targets

**Key Generation:**
- Edge function `generate-ssh-keypair` creates Ed25519 key pairs
- Keys are encrypted via `encrypt-credentials` edge function before storage
- Public keys are returned but not persisted separately

**Key Usage:**
- Job Executor decrypts keys at runtime for SSH operations
- Keys are used for:
  - ZFS target health checks
  - Replication job execution
  - Target deployment operations

### 1.2 Current Gaps

| Gap | Risk | Impact |
|-----|------|--------|
| No key revocation mechanism | High | Compromised keys cannot be invalidated |
| No key rotation workflow | Medium | Keys remain static indefinitely |
| No audit trail for key usage | Medium | Cannot track when/where keys are used |
| No visibility into deployed keys | Low | Cannot identify which targets have which keys |
| No expiration support | Low | Keys never expire automatically |
| Inline key storage | Low | Keys are duplicated across templates/targets |

---

## 2. Proposed Architecture

### 2.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SSH Key Management                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │   Frontend   │────▶│   Database   │◀────│ Job Executor │        │
│  │   Settings   │     │   ssh_keys   │     │  (Key Usage) │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
│         │                    │                     │                 │
│         │                    ▼                     │                 │
│         │            ┌──────────────┐              │                 │
│         └───────────▶│ Edge Functions│◀────────────┘                │
│                      │ - generate   │                                │
│                      │ - encrypt    │                                │
│                      └──────────────┘                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Target Systems                              │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │  │
│  │  │ ZFS #1  │  │ ZFS #2  │  │ ZFS #3  │  │  ...    │          │  │
│  │  │ pubkey  │  │ pubkey  │  │ pubkey  │  │         │          │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Lifecycle States

```
     ┌─────────┐
     │ pending │  (key generated, not yet deployed)
     └────┬────┘
          │ deploy to target(s)
          ▼
     ┌─────────┐
     │ active  │  (key in use, authorized on targets)
     └────┬────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌─────────┐ ┌─────────┐
│ revoked │ │ expired │
└─────────┘ └─────────┘
```

---

## 3. Database Schema

### 3.1 New Table: `ssh_keys`

```sql
CREATE TABLE public.ssh_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Key identification
  name TEXT NOT NULL,
  description TEXT,
  key_type TEXT NOT NULL DEFAULT 'ed25519',  -- 'ed25519' | 'rsa-4096'
  
  -- Key material
  public_key TEXT NOT NULL,                   -- Full public key (safe to display)
  public_key_fingerprint TEXT NOT NULL,       -- SHA256 fingerprint for quick ID
  private_key_encrypted TEXT NOT NULL,        -- Encrypted private key
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'active' | 'revoked' | 'expired'
  
  -- Lifecycle timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  activated_at TIMESTAMPTZ,                   -- When first deployed
  expires_at TIMESTAMPTZ,                     -- Optional expiration
  
  -- Revocation info
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id),
  revocation_reason TEXT,
  
  -- Usage tracking
  last_used_at TIMESTAMPTZ,
  use_count INTEGER DEFAULT 0,
  
  -- Audit
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ssh_keys_status ON ssh_keys(status);
CREATE INDEX idx_ssh_keys_fingerprint ON ssh_keys(public_key_fingerprint);
CREATE INDEX idx_ssh_keys_expires_at ON ssh_keys(expires_at) WHERE expires_at IS NOT NULL;

-- RLS Policies
ALTER TABLE ssh_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage SSH keys"
  ON ssh_keys FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Operators can view SSH keys"
  ON ssh_keys FOR SELECT
  USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));
```

### 3.2 New Table: `ssh_key_deployments`

Tracks which keys are deployed to which targets:

```sql
CREATE TABLE public.ssh_key_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  ssh_key_id UUID NOT NULL REFERENCES ssh_keys(id) ON DELETE CASCADE,
  
  -- Target reference (one of these will be set)
  replication_target_id UUID REFERENCES replication_targets(id) ON DELETE CASCADE,
  zfs_template_id UUID REFERENCES zfs_target_templates(id) ON DELETE CASCADE,
  
  -- Deployment status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'deployed' | 'verified' | 'failed' | 'removed'
  
  -- Timestamps
  deployed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  
  -- Error tracking
  last_error TEXT,
  retry_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure one key per target
  UNIQUE(ssh_key_id, replication_target_id),
  UNIQUE(ssh_key_id, zfs_template_id)
);

-- RLS
ALTER TABLE ssh_key_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can manage deployments"
  ON ssh_key_deployments FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'operator'));
```

### 3.3 Schema Modifications

Update existing tables to reference centralized keys:

```sql
-- Add optional FK to ssh_keys (maintain backward compatibility)
ALTER TABLE zfs_target_templates 
ADD COLUMN ssh_key_id UUID REFERENCES ssh_keys(id) ON DELETE SET NULL;

ALTER TABLE replication_targets 
ADD COLUMN ssh_key_id UUID REFERENCES ssh_keys(id) ON DELETE SET NULL;

-- Note: Existing ssh_key_encrypted columns remain for backward compatibility
-- during migration period, then can be deprecated
```

---

## 4. Backend API Design

### 4.1 Job Executor Endpoints

Add to `job_executor/api_server.py`:

```python
# GET /api/ssh-keys
# Returns list of SSH keys (without private key material)

# POST /api/ssh-keys/{key_id}/record-usage
# Called by Job Executor after successful SSH operation
{
  "target_type": "replication_target",
  "target_id": "uuid",
  "operation": "health_check"
}

# POST /api/ssh-keys/{key_id}/verify-on-target
# Test if key is authorized on a specific target
{
  "target_hostname": "192.168.1.100",
  "target_username": "root",
  "target_port": 22
}

# POST /api/ssh-keys/{key_id}/deploy-to-target
# Add public key to target's authorized_keys
{
  "target_hostname": "192.168.1.100",
  "target_username": "root",
  "target_port": 22,
  "existing_key_id": "uuid"  # Optional: use existing key for auth
}

# POST /api/ssh-keys/{key_id}/remove-from-target
# Remove public key from target's authorized_keys
{
  "target_hostname": "192.168.1.100",
  "target_username": "root",
  "target_port": 22,
  "auth_key_id": "uuid"  # Key to use for authentication
}
```

### 4.2 Job Types

New job types for key management:

```python
# In job_type enum
'ssh_key_deploy'        # Deploy key to target(s)
'ssh_key_verify'        # Verify key works on target(s)
'ssh_key_remove'        # Remove key from target(s)
'ssh_key_rotate'        # Full rotation workflow
'ssh_key_health_check'  # Check all keys on all targets
```

### 4.3 Key Usage Tracking

In Job Executor, after successful SSH operations:

```python
async def record_key_usage(self, key_id: str, target_id: str, operation: str):
    """Record that an SSH key was used successfully"""
    await self.supabase.from_('ssh_keys').update({
        'last_used_at': datetime.utcnow().isoformat(),
        'use_count': self.supabase.sql('use_count + 1')
    }).eq('id', key_id).execute()
```

---

## 5. Frontend UI Components

### 5.1 Settings Navigation

Add new section to `src/config/settings-tabs.ts`:

```typescript
{
  id: 'ssh-keys',
  label: 'SSH Keys',
  icon: Key,
  path: 'ssh-keys',
  description: 'Manage SSH key pairs for infrastructure access',
  requiredRole: 'admin'
}
```

### 5.2 Main Components

#### `src/pages/settings/SshKeySettings.tsx`
- Main settings page for SSH key management
- Key inventory table
- Quick actions (generate, rotate)

#### `src/components/settings/ssh/SshKeyTable.tsx`
- Displays all SSH keys with status badges
- Columns: Name, Fingerprint, Status, Targets, Last Used, Actions
- Row actions: View Details, Revoke, Rotate, Copy Public Key

#### `src/components/settings/ssh/SshKeyGenerateDialog.tsx`
- Generate new key pair
- Options: key type (ed25519/rsa), name, expiration

#### `src/components/settings/ssh/SshKeyDetailsDialog.tsx`
- Full key details and audit trail
- Associated targets list
- Usage statistics
- Public key display with copy button

#### `src/components/settings/ssh/SshKeyRevokeDialog.tsx`
- Confirmation dialog for revocation
- Options: Revoke only vs Revoke & Remove from targets
- Reason input field

#### `src/components/settings/ssh/SshKeyRotateWizard.tsx`
- Step-by-step rotation workflow
- Progress tracking per target
- Rollback capability

### 5.3 UI Mockups

#### Key Inventory Table
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SSH Keys                                                    [+ Generate Key] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Name              │ Fingerprint      │ Status  │ Targets │ Last Used │ ⋮    │
├───────────────────┼──────────────────┼─────────┼─────────┼───────────┼──────┤
│ zfs-primary       │ SHA256:abc123... │ ● Active│ 3       │ 2 min ago │ ⋮    │
│ zfs-backup        │ SHA256:def456... │ ● Active│ 2       │ 1 hr ago  │ ⋮    │
│ old-key-2023      │ SHA256:xyz789... │ ○ Revoked│ 0      │ 30 days   │ ⋮    │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Key Details Dialog
```
┌─────────────────────────────────────────────────────────────┐
│ SSH Key Details                                        [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Name: zfs-primary                                          │
│  Type: Ed25519                                              │
│  Status: ● Active                                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Public Key                                    [Copy]│   │
│  │ ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Fingerprint: SHA256:abc123def456ghi789jkl012mno345         │
│                                                             │
│  ── Statistics ──────────────────────────────────────────   │
│  Created: Dec 1, 2024 by admin@example.com                  │
│  Last Used: 2 minutes ago                                   │
│  Total Uses: 1,247                                          │
│                                                             │
│  ── Deployed To ─────────────────────────────────────────   │
│  • zfs-target-01.example.com (verified ✓)                   │
│  • zfs-target-02.example.com (verified ✓)                   │
│  • zfs-backup.example.com (verified ✓)                      │
│                                                             │
│  [Rotate Key]  [Revoke Key]                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Key Revocation Workflow

### 6.1 Revocation Process

```
┌─────────────────────────────────────────────────────────────────┐
│                     Key Revocation Workflow                      │
└─────────────────────────────────────────────────────────────────┘

1. Admin initiates revocation
          │
          ▼
   ┌──────────────────┐
   │ Revocation Mode? │
   └────────┬─────────┘
            │
   ┌────────┴────────┐
   │                 │
   ▼                 ▼
┌──────────┐   ┌──────────────┐
│ Soft     │   │ Hard         │
│ Revoke   │   │ Revoke       │
└────┬─────┘   └──────┬───────┘
     │                │
     │                ▼
     │         ┌──────────────┐
     │         │ Create job:  │
     │         │ ssh_key_remove│
     │         └──────┬───────┘
     │                │
     │                ▼
     │         ┌──────────────┐
     │         │ For each     │
     │         │ target:      │
     │         │ - SSH connect│
     │         │ - Remove from│
     │         │   auth_keys  │
     │         └──────┬───────┘
     │                │
     ▼                ▼
┌─────────────────────────────────┐
│ Update ssh_keys:                │
│ - status = 'revoked'            │
│ - revoked_at = now()            │
│ - revoked_by = current_user     │
│ - revocation_reason = input     │
└─────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│ Log to audit_logs:              │
│ - action: 'ssh_key_revoked'     │
│ - details: { key_id, reason }   │
└─────────────────────────────────┘
```

### 6.2 Post-Revocation Behavior

- Revoked keys cannot be used for new operations
- Templates/targets referencing revoked keys show warning badge
- Revoked keys remain in database for audit purposes
- After configurable retention period, can be archived/deleted

---

## 7. Key Rotation Workflow

### 7.1 Rotation Process

```
┌─────────────────────────────────────────────────────────────────┐
│                     Key Rotation Workflow                        │
└─────────────────────────────────────────────────────────────────┘

Step 1: Generate New Key
┌────────────────────────────────────────┐
│ • Create new key pair                  │
│ • Status: 'pending'                    │
│ • Link to same targets as old key      │
└────────────────────────────────────────┘
                    │
                    ▼
Step 2: Deploy New Key (parallel per target)
┌────────────────────────────────────────┐
│ For each target:                       │
│ • SSH using OLD key                    │
│ • Append NEW public key to auth_keys   │
│ • Update deployment status             │
└────────────────────────────────────────┘
                    │
                    ▼
Step 3: Verify New Key (parallel per target)
┌────────────────────────────────────────┐
│ For each target:                       │
│ • SSH using NEW key                    │
│ • Run test command                     │
│ • Mark deployment as 'verified'        │
└────────────────────────────────────────┘
                    │
                    ▼
Step 4: Activate New Key
┌────────────────────────────────────────┐
│ • Update new key status: 'active'      │
│ • Update templates/targets to use      │
│   new key ID                           │
└────────────────────────────────────────┘
                    │
                    ▼
Step 5: Remove Old Key (parallel per target)
┌────────────────────────────────────────┐
│ For each target:                       │
│ • SSH using NEW key                    │
│ • Remove OLD public key from auth_keys │
│ • Mark old deployment as 'removed'     │
└────────────────────────────────────────┘
                    │
                    ▼
Step 6: Revoke Old Key
┌────────────────────────────────────────┐
│ • Update old key status: 'revoked'     │
│ • Set revocation_reason: 'rotated'     │
│ • Link to new key for audit trail      │
└────────────────────────────────────────┘
```

### 7.2 Rollback Capability

If rotation fails at any step:
1. Keep old key active
2. Remove new key from any targets where deployed
3. Mark new key as 'failed'
4. Alert administrator with failure details

---

## 8. Audit & Compliance

### 8.1 Audit Log Events

All key operations logged to `audit_logs`:

| Action | Details |
|--------|---------|
| `ssh_key_generated` | key_id, name, type, created_by |
| `ssh_key_deployed` | key_id, target_id, target_type |
| `ssh_key_verified` | key_id, target_id, verification_method |
| `ssh_key_used` | key_id, target_id, operation |
| `ssh_key_revoked` | key_id, reason, revoked_by |
| `ssh_key_rotated` | old_key_id, new_key_id, target_count |
| `ssh_key_removed` | key_id, target_id |
| `ssh_key_expired` | key_id, expired_at |

### 8.2 Compliance Reports

Generate reports for:

1. **Key Inventory Report**
   - All keys with status, age, usage stats
   - Export as CSV/PDF

2. **Expiring Keys Report**
   - Keys expiring in next 30/60/90 days
   - Email notification option

3. **Unused Keys Report**
   - Keys not used in configurable period
   - Recommendation to revoke

4. **Revocation Report**
   - All revoked keys with reasons
   - Compliance audit trail

5. **Key Usage Report**
   - Usage frequency by key
   - Usage by target
   - Peak usage times

### 8.3 Automated Alerts

Configure alerts for:
- Key approaching expiration (7 days, 30 days)
- Key not used in X days
- Failed key operations
- Unauthorized key usage attempts

---

## 9. Migration Strategy

### 9.1 Phase 1: Schema Addition (Non-Breaking)

1. Create new `ssh_keys` table
2. Create new `ssh_key_deployments` table
3. Add `ssh_key_id` columns to existing tables
4. Deploy UI components (hidden behind feature flag)

### 9.2 Phase 2: Data Migration

```sql
-- Migrate existing keys from zfs_target_templates
INSERT INTO ssh_keys (
  name, 
  public_key, 
  public_key_fingerprint,
  private_key_encrypted,
  status,
  created_at
)
SELECT 
  CONCAT('migrated-', t.name) as name,
  -- Note: Public key needs to be regenerated or extracted
  '' as public_key,
  '' as public_key_fingerprint,
  t.ssh_key_encrypted,
  'active' as status,
  t.created_at
FROM zfs_target_templates t
WHERE t.ssh_key_encrypted IS NOT NULL;

-- Similar for replication_targets
```

### 9.3 Phase 3: Code Migration

1. Update Job Executor to prefer `ssh_key_id` over inline keys
2. Update UI to use new key management
3. Add deprecation warnings for inline key usage

### 9.4 Phase 4: Cleanup (Future)

1. Remove inline `ssh_key_encrypted` columns
2. Make `ssh_key_id` required for new templates/targets
3. Archive old migrated keys

---

## 10. Security Considerations

### 10.1 Key Storage

- Private keys encrypted using AES-256 via `encrypt_password()` function
- Encryption key stored in `activity_settings.encryption_key`
- Keys never logged or exposed in API responses
- Memory cleared after use in Job Executor

### 10.2 Access Control

- Only admins can generate, revoke, or rotate keys
- Operators can view key metadata (not private keys)
- Viewers have no access to key management

### 10.3 Key Strength Requirements

- Ed25519 (recommended): 256-bit security
- RSA: Minimum 4096-bit
- No DSA or ECDSA (deprecated)

### 10.4 Network Security

- All SSH operations use key-based auth only
- No password fallback
- Host key verification (future enhancement)

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create database schema
- [ ] Create basic CRUD API
- [ ] Generate key UI
- [ ] Key inventory table

### Phase 2: Core Features (Week 3-4)
- [ ] Key deployment workflow
- [ ] Key verification
- [ ] Revocation workflow
- [ ] Audit logging

### Phase 3: Advanced Features (Week 5-6)
- [ ] Rotation wizard
- [ ] Migration tools
- [ ] Compliance reports
- [ ] Expiration alerts

### Phase 4: Polish (Week 7-8)
- [ ] UI refinements
- [ ] Documentation
- [ ] Testing & QA
- [ ] Production rollout

---

## 12. Success Metrics

| Metric | Target |
|--------|--------|
| Key generation time | < 2 seconds |
| Key deployment time per target | < 10 seconds |
| Key rotation total time | < 5 minutes for 10 targets |
| Audit log completeness | 100% of operations logged |
| UI response time | < 500ms for key list |

---

## Appendix A: API Reference

See `docs/API_SSH_KEYS.md` (to be created during implementation)

## Appendix B: Database ERD

```
┌─────────────────┐     ┌─────────────────────┐     ┌───────────────────┐
│    ssh_keys     │────<│ ssh_key_deployments │>────│replication_targets│
├─────────────────┤     ├─────────────────────┤     ├───────────────────┤
│ id              │     │ id                  │     │ id                │
│ name            │     │ ssh_key_id (FK)     │     │ ssh_key_id (FK)   │
│ public_key      │     │ replication_target_id│    │ ...               │
│ private_key_enc │     │ zfs_template_id     │     └───────────────────┘
│ status          │     │ status              │
│ ...             │     │ ...                 │     ┌───────────────────┐
└─────────────────┘     └─────────────────────┘────>│zfs_target_templates│
                                                     ├───────────────────┤
                                                     │ id                │
                                                     │ ssh_key_id (FK)   │
                                                     │ ...               │
                                                     └───────────────────┘
```

---

*Document Version: 1.0*  
*Last Updated: 2024-12-07*
