# Workflows

This file documents the “contract” of how the system behaves end-to-end.
If code changes alter these flows, this file must be updated.

## 1. OpenManage sync workflow (OME → Supabase)

1. Operator runs `openmanage-sync-script.py` in the private network
2. Script authenticates to OME and fetches:
   - device inventory
   - health status
   - identity fields needed to correlate with iDRAC/ServiceTag/etc.
3. Script calls Supabase Edge Function (default: `openmanage-sync`) to upsert inventory
4. UI reflects updated inventory

Failure handling:
- SSL / auth errors must be explicit
- Partial sync should report counts and failed devices
- Script should be cron-friendly and non-interactive when env vars are set

## 2. vCenter sync workflow (vCenter/ESXi → Supabase)

1. Operator runs `vcenter-sync-script.py` in the private network
2. Script authenticates to DSM/Supabase and then to vCenter
3. Script enumerates:
   - datacenters / clusters
   - ESXi hosts (and relevant metadata)
4. Script calls Edge Function to persist/refresh vCenter inventory

Failure handling:
- vCenter auth and SSL issues are common; must be logged with actionable hints
- Inventory deltas should avoid destructive deletes unless explicitly configured

## 3. Job execution workflow (Cloud job → On-prem execution)

1. UI creates a job (type + target(s) + parameters)
2. Job is stored in Supabase with status = queued/pending
3. On-prem `job-executor.py` polls for pending jobs
4. Executor performs:
   - Preflight (connectivity + auth + constraints)
   - Execution phases (handler-specific)
   - Post checks (verification + status persistence)
5. Executor updates status + logs continuously
6. UI presents progress and final result

Failure handling:
- A job that fails must preserve:
  - failure reason
  - step where it failed
  - logs sufficient for operator remediation
- Retrying should be explicit and safe (idempotency checks required)

## 4. Replication / live copy workflows (example category)

This repo contains handlers referencing replication and ZFS targets.
Replication semantics are handler-defined and may vary by environment, but MUST follow:
- explicit source/target validation
- explicit snapshot/point-in-time markers where applicable
- no implicit destructive actions
