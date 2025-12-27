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
