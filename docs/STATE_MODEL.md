# State Model

This document describes the canonical job, workflow step, and task states in the system.

## Job States

Jobs are the top-level orchestration unit. They have the following states:

| State | Description | Transitions To |
|-------|-------------|----------------|
| `pending` | Job created, awaiting executor pickup | `running`, `cancelled` |
| `running` | Executor is actively processing the job | `completed`, `failed`, `paused`, `cancelled` |
| `paused` | Job paused, awaiting user action (e.g., blocker resolution) | `pending` (to resume), `cancelled` |
| `completed` | Job finished successfully | (terminal) |
| `failed` | Job finished with error | (terminal) |
| `cancelled` | Job was cancelled by user | (terminal) |

### State Transition Diagram

```
         ┌──────────┐
         │ pending  │
         └────┬─────┘
              │ executor picks up
              ▼
         ┌──────────┐
    ┌────│ running  │────┐
    │    └────┬─────┘    │
    │         │          │
    │    blockers        │ error/cancel
    │    detected        │
    │         ▼          │
    │    ┌──────────┐    │
    │    │  paused  │    │
    │    └────┬─────┘    │
    │         │          │
    │    user resumes    │
    │    (set pending)   │
    │         │          │
    │         ▼          │
    │    ┌──────────┐    │
    ├───►│ completed│    │
    │    └──────────┘    │
    │                    │
    │    ┌──────────┐    │
    └───►│  failed  │◄───┘
         └──────────┘
```

### Pause/Resume Mechanics

1. **Pause triggers**:
   - Executor detects maintenance blockers during rolling cluster update
   - Sets `status = 'paused'` with `details.awaiting_blocker_resolution = true`
   - Stores `details.current_blockers` for UI display

2. **Resume requirements**:
   - User opens BlockerResolutionWizard
   - User makes decisions (power off VMs, skip hosts, etc.)
   - Resolutions stored in `details.maintenance_blocker_resolutions`
   - UI sets `status = 'pending'` and clears `awaiting_blocker_resolution`
   - Executor picks up job again, reads resolutions, continues

3. **Key detail fields during pause**:
   - `pause_reason`: Human-readable explanation
   - `awaiting_blocker_resolution`: Boolean flag for UI
   - `current_blockers`: Structured blocker data per host
   - `hosts_with_blockers`: Count for summary display
   - `total_critical_blockers`: Count for summary display

## Workflow Step States

Workflow steps track granular progress within a job. States:

| State | Description |
|-------|-------------|
| `pending` | Step created, not yet started |
| `running` | Step actively executing |
| `completed` | Step finished successfully |
| `failed` | Step finished with error |
| `skipped` | Step was skipped (e.g., host not needing update) |
| `paused` | Step paused (mirrors job pause) |

### Workflow Step Fields

```sql
workflow_executions (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES jobs(id),
  step_number INTEGER,
  step_name TEXT,
  step_status TEXT,
  step_started_at TIMESTAMPTZ,
  step_completed_at TIMESTAMPTZ,
  step_details JSONB,
  step_error TEXT,
  server_id UUID,
  host_id UUID,
  cluster_id UUID,
  workflow_type TEXT,
  created_at TIMESTAMPTZ
)
```

### Step Details Schema (common fields)

```typescript
interface StepDetails {
  // Progress tracking
  current_step?: string;
  progress_pct?: number;
  
  // Host context
  host_name?: string;
  management_ip?: string;
  
  // Blocker-specific
  current_blockers?: Record<string, HostBlockerAnalysis>;
  awaiting_resolution?: boolean;
  
  // Duration tracking
  duration_ms?: number;
  
  // Error context
  error_details?: string;
  recovery_available?: boolean;
}
```

## Job Task States

Job tasks are server-specific subtasks within a job:

| State | Description |
|-------|-------------|
| `pending` | Task created, not started |
| `running` | Task in progress |
| `completed` | Task finished successfully |
| `failed` | Task finished with error |

### Task Fields

```sql
job_tasks (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES jobs(id),
  server_id UUID REFERENCES servers(id),
  vcenter_host_id UUID REFERENCES vcenter_hosts(id),
  status TEXT,
  progress INTEGER,
  log TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```

## Rolling Cluster Update Workflow Steps

The `rolling_cluster_update` workflow has these step types:

1. **Pre-flight checks** (`step_name: 'Pre-flight checks'`)
   - Connectivity verification
   - Update availability check against Dell catalog
   - Early exit if no updates needed

2. **Disable HA** (`step_name: 'Disable HA on cluster: {name}'`)
   - Disables vSphere HA before host updates
   - Required for DRS to function during maintenance

3. **Comprehensive blocker scan** (`step_name: 'Comprehensive blocker scan'`)
   - Scans all hosts for VMs blocking maintenance mode
   - Detects: USB passthrough, FT, vGPU, local storage, CD-ROM mounts
   - If blockers found: job pauses for wizard resolution

4. **SCP Backup** (`step_name: 'SCP Backup: {hostname}'`)
   - Per-host configuration backup via Server Configuration Profile
   - Only for hosts requiring updates

5. **Host Update** (`step_name: 'Update host: {hostname}'`)
   - Enter maintenance mode
   - Apply firmware updates
   - Reboot and wait for reconnection
   - Exit maintenance mode

6. **Re-enable HA** (`step_name: 'Re-enable HA on cluster: {name}'`)
   - Restores vSphere HA after all hosts updated

## Scheduled Jobs

Jobs can have a `schedule_at` timestamp for deferred execution:

- Executor only picks up jobs where `schedule_at <= NOW()`
- UI shows "Scheduled for X" countdown badge
- At execution time, job runs pre-flight checks with current data
- If pre-flight determines no action needed, job completes immediately

## Job Details Schema (by job type)

### rolling_cluster_update

```typescript
interface RollingClusterUpdateDetails {
  // Cluster context
  cluster_id: string;
  cluster_name: string;
  vcenter_id: string;
  
  // Progress tracking
  current_host?: string;
  current_host_ip?: string;
  current_host_server_id?: string;
  current_step?: string;
  hosts_total?: number;
  hosts_completed?: number;
  progress_pct?: number;
  
  // Maintenance window context
  maintenance_window_id?: string;
  maintenance_window?: MaintenanceWindowMetadata;
  
  // Blocker resolution state
  awaiting_blocker_resolution?: boolean;
  pause_reason?: string;
  current_blockers?: Record<string, HostBlockerAnalysis>;
  maintenance_blocker_resolutions?: Record<string, HostResolution>;
  
  // Pre-flight results
  hosts_needing_updates?: string[];
  update_check_results?: Record<string, any>;
  
  // Console log for UI display
  console_log?: string[];
}
```

## Invariants

1. A job in `running` state must have exactly one executor processing it
2. A job in `paused` state must have `awaiting_blocker_resolution = true` OR a valid `pause_reason`
3. A job transitioning `paused → pending` must have resolutions saved OR be explicitly force-resumed
4. Workflow steps must be created before job transitions to `running`
5. `completed_at` must be set when status becomes `completed`, `failed`, or `cancelled`
6. `started_at` must be set when status becomes `running`
