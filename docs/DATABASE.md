# Database Overview (Supabase Postgres)

This is a pragmatic overview for Codex and maintainers. The authoritative schema is in:
- `supabase/migrations/*.sql`

## Tables referenced directly by Edge Functions

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

## High-signal table roles (based on usage)

- `jobs`  
  Job records: type, scope, scheduling, status/progress. Core orchestration entity.

- `job_tasks`  
  Subtasks/steps for a job. Used to drive resumability and progress reporting.

- `servers`, `server_group_members`  
  Inventory and grouping for managed hosts.

- `credential_sets`, `credential_ip_ranges`, `ssh_keys`  
  Secrets metadata and access control envelopes. Ensure RLS and encryption posture remains intact.

- `vcenters`, `vcenter_settings`, `vcenter_hosts` (+ other vCenter inventory tables)  
  vCenter configuration and discovered inventory.

- `openmanage_settings`  
  OME connectivity/config.

- `audit_logs`, `user_activity`, `notification_logs`  
  Compliance and traceability. These must not be weakened.

- `maintenance_windows`, `cluster_safety_checks`, `workflow_executions`  
  Scheduling and safety rails.

## Migration rules

If you add/modify schema:
1. Create a new migration in `supabase/migrations/`
2. Update `docs/API_CONTRACT.md` if Edge Functions start using new tables
3. Avoid breaking changes: add columns rather than rename/drop where feasible
