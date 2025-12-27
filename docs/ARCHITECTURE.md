# Architecture

## Control plane vs data plane

This system is intentionally split:

### Control plane (Cloud / central)
- Supabase Postgres stores state (jobs, tasks, inventory, credentials metadata)
- Supabase Edge Functions implement the API used by the UI and executor
- The React UI drives orchestration and operator workflows

### Data plane (On-prem / near infra)
- Python executor performs privileged actions against:
  - iDRAC endpoints
  - OpenManage Enterprise (OME)
  - vCenter / ESXi
  - Storage replication targets (including ZFS where applicable)

The control plane schedules and tracks; the data plane executes.

## Job model (high level)
- A `job` is a top-level orchestration unit (e.g. firmware update, vCenter sync, media mount).
- A job typically contains `job_tasks` representing steps or subtasks.
- Jobs must be resumable and auditable.

## Integration boundaries
- UI should not contain secrets; it uses Supabase auth and calls Edge Functions.
- Edge Functions handle privileged DB writes and service integrations where appropriate.
- Executor handles long-running / privileged operations and reports progress.

## Safety model
- Guard rails exist as explicit checks (e.g., maintenance windows, safety checks).
- Logging and audit trails are part of the product, not optional.
