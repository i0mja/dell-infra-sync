# Architecture

## System intent

This platform manages and automates datacenter operations across:
- Dell servers (iDRAC/Redfish)
- OpenManage Enterprise inventory
- VMware vCenter / ESXi hosts
- Additional private-network targets (e.g., ZFS replication endpoints), where configured

It is intentionally split into **cloud control plane** and **on-prem data plane**:

- Cloud plane: UI + Supabase (database, auth, edge functions)
- On-prem plane: Python executors and sync agents that can reach private IPs

This separation ensures private resources are never exposed directly to the public internet.

## Component diagram (conceptual)

1. Web UI (Vite/React)
   - Presents inventory, jobs, activity, and configuration
   - Creates “jobs” (desired actions) and persists them

2. Supabase (control plane)
   - Postgres stores inventory, jobs, logs, and config
   - Auth provides user identity and RBAC via RLS
   - Edge Functions provide API endpoints for:
     - sync ingestion (OpenManage / vCenter)
     - job dispatch / coordination
     - cleanup and automation tasks

3. On-prem Agents (data plane)
   - Sync agents:
     - `openmanage-sync-script.py`
     - `vcenter-sync-script.py`
   - Job executor:
     - `job-executor.py` + `job_executor/**`
   - These agents:
     - authenticate to Supabase/edge functions
     - pull desired work (jobs) and push results/logs
     - interact with private infra (iDRAC, vCenter, ESXi, storage targets)

## Primary data flows

### Inventory sync
- Agent queries OME/vCenter locally
- Agent calls Supabase Edge Function to upsert inventory
- UI reads inventory from Supabase

### Job execution
- UI creates a job and persists it
- On-prem job executor polls for pending jobs
- Executor runs handler phases against private infra
- Executor streams status/logs back to Supabase
- UI displays progress in real time

## Cross-cutting concerns

- Observability: activity logs must be end-to-end traceable (UI → edge function → executor)
- Safety: infrastructure actions must require explicit job intent and must be auditable
- Idempotency: jobs should be resumable or safely retryable when feasible
- Throttling: iDRAC and similar endpoints must be rate limited and concurrency constrained
