# API Contract — Supabase Edge Functions & Control Plane

This document exists to prevent “agent drift” when modifying Edge Functions or the job executor.
Edge Functions are the primary **control-plane API** used by the web UI and/or executor.

## Invocation

Supabase Edge Functions are typically invoked at:

- `{SUPABASE_URL}/functions/v1/<function-name>`

Most functions implement CORS and accept JSON request bodies.

## Authentication model (as implemented)

There are three broad classes:

1. **User-authenticated functions**  
   These expect an `Authorization: Bearer <JWT>` header and use the caller’s identity/roles.

2. **Break-glass / credential bootstrap**  
   These accept credentials and issue/authenticate sessions (no Authorization header required).

3. **Service/automation functions**  
   These are intended for scheduled cleanup or backend processing and typically use the Supabase service role key.

Codex must preserve this separation. Do not quietly move a function between classes.

## Edge Functions implemented in this repo

- `analyze-maintenance-windows` (auth required)
- `break-glass-authenticate` (no auth / service role)
- `cleanup-activity-logs` (no auth / service role)
- `cleanup-old-jobs` (no auth / service role)
- `create-job` (auth required)
- `delete-managed-user` (auth required)
- `delete-user` (auth required)
- `encrypt-credentials` (auth required)
- `execute-maintenance-windows` (no auth / service role)
- `generate-ssh-keypair` (no auth / service role)
- `get-service-key` (auth required)
- `idm-authenticate` (no auth / service role)
- `idm-provision` (no auth / service role)
- `network-diagnostics` (auth required)
- `openmanage-sync` (auth required)
- `send-notification` (no auth / service role)
- `sync-vcenter-direct` (auth required)
- `test-vcenter-connection` (auth required)
- `test-virtual-media-share` (no auth / service role)
- `update-job` (no auth / service role)
- `validate-network-prerequisites` (auth required)
- `vcenter-sync` (auth required)

## Tables touched by Edge Functions

These are the tables referenced directly via `supabase.from('<table>')` in Edge Functions:

- `activity_settings`
- `audit_logs`
- `break_glass_admins`
- `cluster_safety_checks`
- `credential_sets`
- `idm_auth_sessions`
- `idm_group_mappings`
- `idm_settings`
- `idrac_commands`
- `job_tasks`
- `jobs`
- `maintenance_windows`
- `managed_users`
- `notification_logs`
- `notification_settings`
- `openmanage_settings`
- `profiles`
- `server_group_members`
- `servers`
- `ssh_keys`
- `user_roles`
- `vcenter_hosts`
- `vcenter_settings`
- `vcenters`
- `workflow_executions`
- `zfs_target_templates`

If you introduce a new table dependency, you must:
- Add a migration under `supabase/migrations/`
- Update this document

## Function-by-function notes (high level)

### `create-job`
Creates a job row and associated task rows. Request includes:
- `job_type` (enumerated union in source)
- `target_scope` (opaque JSON; must remain backwards compatible)
- optional `details`, `schedule_at`, `credential_set_ids`

Codex warning: job types are used across UI + executor; do not rename casually.

### `update-job`
Updates job state/progress. Treat as write-path for executor and/or UI workflow control.

### `vcenter-sync` / `sync-vcenter-direct` / `test-vcenter-connection`
vCenter inventory and connectivity. Must not log secrets. Must keep timeout/error details.

### `openmanage-sync`
OpenManage Enterprise (OME) sync. Must remain robust to partial inventory failures.

### `encrypt-credentials`
Encrypts/normalizes credential payloads before persistence. Never downgrade crypto posture.

### `generate-ssh-keypair`
Generates an SSH keypair for managed operations; ensure private key handling remains restricted.

### `break-glass-authenticate`
Authenticates a privileged “break glass” operator. Keep audit logging intact.

### `network-diagnostics` / `validate-network-prerequisites`
Runs validation flows. Must remain safe: read-only, no config mutation.

### `send-notification`
Records notification activity. Avoid leaking secrets into notification logs.

### Cleanup functions
- `cleanup-old-jobs`
- `cleanup-activity-logs`

These should be safe, bounded, and non-destructive beyond intended retention behavior.

## Logging and error behavior requirements
- Never log passwords, tokens, private keys, or raw credential objects.
- Return structured errors (HTTP status + JSON body) where possible.
- Include correlation IDs/job IDs in logs when available.

## Backwards compatibility rule
Edge Function request/response shapes are part of the API.
If you must change a shape:
- Add versioning (new function) or feature flag
- Maintain old behavior until migrated

---

## Job Details Schema

### Common Fields (all job types)

```typescript
interface BaseJobDetails {
  console_log?: string[];           // Diagnostic log entries for UI
  error?: string;                   // Error message if failed
}
```

### rolling_cluster_update

```typescript
interface RollingClusterUpdateDetails extends BaseJobDetails {
  // Cluster context
  cluster_id: string;
  cluster_name: string;
  vcenter_id: string;
  
  // Progress
  current_host?: string;
  current_host_ip?: string;
  current_host_server_id?: string;
  current_step?: string;
  hosts_total?: number;
  hosts_completed?: number;
  progress_pct?: number;
  
  // Maintenance window
  maintenance_window_id?: string;
  maintenance_window?: { id: string; title: string; };
  
  // Blocker resolution (when paused)
  awaiting_blocker_resolution?: boolean;
  pause_reason?: string;
  current_blockers?: Record<string, HostBlockerAnalysis>;
  hosts_with_blockers?: number;
  total_critical_blockers?: number;
  raw_blockers_backup?: Record<string, any>;  // Fallback storage
  
  // User resolutions (after wizard)
  maintenance_blocker_resolutions?: Record<string, HostResolution>;
  host_update_order?: string[];
  
  // Pre-flight results
  hosts_needing_updates?: string[];
  update_check_results?: Record<string, any>;
}

interface HostBlockerAnalysis {
  host_name: string;
  vcenter_host_id?: string;
  server_id?: string;
  blockers: Array<{
    vm_name: string;
    reason: string;
    severity: 'critical' | 'warning';
    details?: string;
    remediation?: string;
    auto_fixable?: boolean;
  }>;
  total_blockers: number;
  critical_count: number;
}

interface HostResolution {
  skip_host: boolean;
  vms_to_power_off: Array<{
    vm_name: string;
    reason: string;
    action: 'power_off' | 'migrate' | 'acknowledge';
  }>;
  update_order?: number;
}
```

### Workflow Step Details

```typescript
interface WorkflowStepDetails {
  // Progress
  current_step?: string;
  progress_pct?: number;
  
  // Host context
  host_name?: string;
  management_ip?: string;
  
  // Blocker scan results
  current_blockers?: Record<string, HostBlockerAnalysis>;
  awaiting_resolution?: boolean;
  hosts_scanned?: number;
  hosts_with_blockers?: number;
  total_critical_blockers?: number;
  
  // Error recovery
  recovery_available?: boolean;
  error_details?: string;
}
