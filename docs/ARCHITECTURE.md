# Architecture

## System Overview

This is an enterprise infrastructure orchestration platform for managing Dell servers, VMware vCenter clusters, and associated infrastructure operations.

## Control Plane vs Data Plane

The system is intentionally split into two planes:

### Control Plane (Cloud/Central)

- **Supabase Postgres**: Stores all state (jobs, tasks, inventory, credentials metadata)
- **Supabase Edge Functions**: HTTP API for UI and executor communication
- **React Web UI**: Operator dashboard for orchestration and workflows

The control plane:
- Schedules and tracks work
- Provides the operator interface
- Stores audit trails
- Never touches infrastructure directly

### Data Plane (On-prem/Near Infrastructure)

- **Python Job Executor**: Performs privileged actions against infrastructure
- **Targets**:
  - iDRAC endpoints (Dell server management)
  - OpenManage Enterprise (OME)
  - vCenter / ESXi hosts
  - Storage replication targets (including ZFS)

The data plane:
- Executes work items
- Reports progress back to control plane
- Has direct network access to infrastructure
- Holds credentials for infrastructure access

```
┌─────────────────────────────────────────────────────────────┐
│                      CONTROL PLANE                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   React UI   │───►│Edge Functions│◄───│  PostgreSQL  │  │
│  │   (Browser)  │    │  (HTTP API)  │    │   (State)    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                            ▲                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────┼─────────────────────────────────┐
│                      DATA PLANE                              │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Python Job Executor                      │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │   │
│  │  │ iDRAC   │ │  OME    │ │ vCenter │ │ Storage │     │   │
│  │  │ Handler │ │ Handler │ │ Handler │ │ Handler │     │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘     │   │
│  └───────┼───────────┼───────────┼───────────┼───────────┘   │
│          ▼           ▼           ▼           ▼               │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │  iDRAC   │ │   OME    │ │ vCenter  │ │   ZFS    │       │
│   │Endpoints │ │  Server  │ │  Server  │ │ Storage  │       │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Job Model

### Hierarchy

```
Job (top-level orchestration unit)
├── Job Tasks (per-server subtasks)
└── Workflow Steps (granular progress tracking)
```

### Job Lifecycle

1. **Creation**: UI calls `create-job` Edge Function
2. **Pending**: Job waits for executor pickup
3. **Running**: Executor claims and processes job
4. **Progress**: Executor updates workflow steps in real-time
5. **Pause/Resume**: Job may pause for user input (blocker resolution)
6. **Completion**: Job reaches terminal state (completed/failed/cancelled)

### Job Types

| Type | Description |
|------|-------------|
| `rolling_cluster_update` | Update cluster hosts sequentially |
| `firmware_update` | Apply firmware to servers |
| `power_operation` | Power on/off/reset |
| `virtual_media_mount` | Mount ISO to server |
| `scp_backup` | Server Configuration Profile backup |
| `esxi_upgrade` | ESXi version upgrade |
| `vcenter_sync` | Sync vCenter inventory |
| `replication_sync` | Storage replication job |

## Data Flow: Rolling Cluster Update

This is the most complex workflow, demonstrating the system's architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                        USER ACTION                            │
│  1. User opens ServerUpdateWizard                             │
│  2. Selects cluster and update options                        │
│  3. Clicks "Start Update"                                     │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      CREATE-JOB EDGE FUNCTION                 │
│  1. Validate inputs                                           │
│  2. Insert job record with status='pending'                   │
│  3. Return job ID to UI                                       │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      PYTHON EXECUTOR                          │
│  1. Poll for pending jobs                                     │
│  2. Claim job (set status='running')                          │
│  3. Execute ClusterHandler.handle_rolling_cluster_update()    │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      WORKFLOW STEPS                           │
│                                                               │
│  Step 1: Pre-flight checks                                    │
│  ├── Verify cluster connectivity                              │
│  ├── Check Dell catalog for available updates                 │
│  └── Early exit if no updates needed                          │
│                                                               │
│  Step 2: Disable HA                                           │
│  └── Disable vSphere HA for DRS to work                       │
│                                                               │
│  Step 3: Comprehensive blocker scan                           │
│  ├── Scan all hosts for blocking VMs                          │
│  ├── Detect: USB, FT, vGPU, local storage, CD-ROM             │
│  └── IF blockers found: PAUSE job for resolution              │
│                                                               │
│  [USER INTERACTION: BlockerResolutionWizard]                  │
│  ├── User reviews blockers                                    │
│  ├── Decides: power off VMs, skip host, etc.                  │
│  └── Saves resolutions, resumes job                           │
│                                                               │
│  Step 4-N: Per-host updates                                   │
│  ├── SCP Backup (configuration snapshot)                      │
│  ├── Enter maintenance mode                                   │
│  ├── Apply firmware updates                                   │
│  ├── Reboot and wait for recovery                             │
│  └── Exit maintenance mode                                    │
│                                                               │
│  Step N+1: Re-enable HA                                       │
│  └── Restore vSphere HA settings                              │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      COMPLETION                               │
│  1. Set job status='completed'                                │
│  2. UI shows success notification                             │
│  3. Audit log records completion                              │
└──────────────────────────────────────────────────────────────┘
```

## Real-time Updates

The UI subscribes to real-time updates for responsive feedback:

```typescript
// Subscribe to workflow step updates
supabase
  .channel(`workflow-${jobId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'workflow_executions',
    filter: `job_id=eq.${jobId}`
  }, callback)
  .subscribe();

// Subscribe to job status/details updates
supabase
  .channel(`job-${jobId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'jobs',
    filter: `id=eq.${jobId}`
  }, callback)
  .subscribe();
```

## Authentication Model

### UI Authentication
- Supabase Auth (email/password or IDM/LDAP)
- Session stored in browser
- JWT tokens for API calls

### Edge Function Authentication
- User JWT for user-initiated operations
- Service role key for background operations
- Break-glass authentication for emergencies

### Executor Authentication
- Service role key (stored in environment)
- Communicates with control plane via HTTPS

## Security Model

### Credential Handling
1. Credentials entered in UI
2. Encrypted via `encrypt-credentials` Edge Function
3. Stored as `password_encrypted` in database
4. Decrypted only by executor when needed
5. Never logged or exposed to UI

### Row Level Security
- All user-facing tables have RLS enabled
- Policies restrict access based on user context
- Service role bypasses RLS for background operations

### Infrastructure Access
- All infrastructure operations go through executor
- Executor validates job ownership before execution
- Operations are logged with job/user context

## Integration Boundaries

| Boundary | Rule |
|----------|------|
| UI → Edge Functions | User JWT authentication |
| Edge Functions → Database | Service role or user context |
| Executor → Control Plane | Service role key |
| Executor → Infrastructure | Per-target credentials |

## Safety Model

### Guard Rails
- Maintenance windows with approval workflows
- Blocker detection before destructive operations
- Confirmation dialogs for high-risk actions

### Audit Trail
- All job state changes logged
- User actions recorded with context
- Infrastructure operations tracked

### Recovery Mechanisms
- Job pause/resume for blocking conditions
- Fallback data storage for large payloads
- Force-resume UI for stuck jobs

## Observability

### Logging
- UI: Browser console
- Edge Functions: Supabase function logs
- Executor: Stdout/stderr with structured format

### Metrics
- Executor heartbeats tracked in database
- Job duration and success rates
- API response times

### Alerting
- Teams/email notifications for job events
- Cluster safety status changes
- Failed job notifications
