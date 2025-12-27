# Workflows (Representative)

This file documents “how the system is supposed to behave”.

## Inventory sync
- OME sync:
  - Edge Function: `openmanage-sync`
  - Python script: `openmanage-sync-script.py` (where used)
  - Writes inventory/config into DB tables used by UI

- vCenter sync:
  - Edge Function: `vcenter-sync` and/or `sync-vcenter-direct`
  - Python script: `vcenter-sync-script.py` (where used)
  - Updates vCenter inventory tables (hosts, clusters, datastores, etc.)

## Job execution (executor)
- Jobs are created via `create-job` and inserted into `jobs`/`job_tasks`.
- Executor polls/claims work, executes handler logic, and updates status via `update-job` and/or direct DB writes (per implementation).
- Handlers in `job_executor/handlers/**` implement specific job types (firmware, power, media, replication).

## Maintenance window analysis/execution
- Analysis:
  - Edge Function: `analyze-maintenance-windows`
- Execution:
  - Edge Function: `execute-maintenance-windows`

## Notifications
- Edge Function: `send-notification`
- Writes notification log records; may integrate with external providers.

## Storage / replication (including ZFS examples)
- Treat replication targets as explicit resources.
- Never assume partial success; verify end state before marking job complete.
