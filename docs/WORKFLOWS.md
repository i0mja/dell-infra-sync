# Workflows

This document describes "how the system is supposed to behave" for each major workflow.

## Inventory Sync

### OpenManage Enterprise (OME) Sync

| Component | Implementation |
|-----------|----------------|
| Edge Function | `openmanage-sync` |
| Python Script | `openmanage-sync-script.py` |
| Tables Updated | `servers`, `server_components`, `firmware_inventory` |

**Flow:**
1. Edge Function or script authenticates with OME
2. Fetches device inventory from OME API
3. Upserts server records with current state
4. Updates firmware inventory per server

### vCenter Sync

| Component | Implementation |
|-----------|----------------|
| Edge Function | `vcenter-sync`, `sync-vcenter-direct` |
| Python Script | `vcenter-sync-script.py` |
| Tables Updated | `vcenters`, `vcenter_hosts`, `vcenter_vms`, `vcenter_datastores`, `vcenter_networks` |

**Flow:**
1. Authenticate with vCenter
2. Enumerate datacenters, clusters, hosts
3. Fetch VM inventory per host
4. Fetch datastore and network information
5. Upsert all records with timestamps

---

## Job Execution (Executor)

### Job Lifecycle

| Phase | Action |
|-------|--------|
| Creation | UI calls `create-job`, job inserted with `status='pending'` |
| Claim | Executor polls, atomically updates `status='running'` |
| Execution | Handler processes job, updates progress |
| Completion | Handler sets terminal status (`completed`/`failed`) |

### Executor Poll Loop

```python
while True:
    jobs = get_pending_jobs()  # status='pending', schedule_at <= now
    for job in jobs:
        if claim_job(job['id']):  # Atomic update to 'running'
            handler = get_handler(job['job_type'])
            handler.execute(job)
    sleep(poll_interval)
```

### Handler Dispatch

```python
HANDLERS = {
    'rolling_cluster_update': ClusterHandler,
    'firmware_update': FirmwareHandler,
    'power_operation': PowerHandler,
    'virtual_media_mount': VirtualMediaHandler,
    # ...
}

def get_handler(job_type):
    return HANDLERS.get(job_type)
```

### Progress Reporting

Handlers report progress via:
1. `update_job_status()` - Job-level status changes
2. `_log_workflow_step()` - Workflow step creation/updates
3. `update_job_details_field()` - Real-time progress in job.details
4. `_append_console_log()` - Console log entries for UI

---

## Rolling Cluster Update

### Workflow Steps Truth Table

| Step | Name | Success Condition | Failure Handling |
|------|------|-------------------|------------------|
| 1 | Pre-flight checks | All hosts reachable, catalog accessible | Fail job with connectivity errors |
| 2 | Disable HA | HA disabled successfully | Fail job |
| 3 | Blocker scan | Scan completes | If blockers found: pause job |
| 4-N | Host update | Host updated and reconnected | Fail host step, continue if partial |
| N+1 | Re-enable HA | HA enabled successfully | Warn but complete |

### Pre-flight Checks Detail

```
1. Fetch cluster hosts from database
2. For each host:
   a. Check ESXi HTTPS connectivity (port 443)
   b. Verify vCenter reports 'connected' state
3. Query Dell catalog for available updates
4. If no updates available for any host:
   → Early exit, job completes without changes
5. Record hosts needing updates in job.details
```

### Blocker Scan Detail

```
1. For each host in cluster:
   a. Connect to vCenter
   b. Enumerate running VMs
   c. For each VM, check for blockers:
      - USB passthrough devices
      - Fault Tolerance enabled
      - vGPU attached
      - Local storage dependencies
      - CD-ROM ISO mounts
   d. Classify blockers by severity:
      - Critical: Must power off or skip host
      - Warning: Recommend action but can proceed
2. If any critical blockers found:
   → Pause job with awaiting_blocker_resolution=true
   → Store blockers in job.details.current_blockers
3. Wait for user to complete BlockerResolutionWizard
4. Resume: Read resolutions from job.details.maintenance_blocker_resolutions
```

### Host Update Detail

```
1. Check if host needs updates (from pre-flight)
2. If resolutions exist for this host:
   a. Check for skip_host flag → skip if true
   b. Power off specified VMs
3. Create SCP backup (Server Configuration Profile)
4. Enter maintenance mode:
   a. Request maintenance mode via vCenter
   b. Wait for DRS to evacuate VMs
   c. Verify maintenance mode active
5. Apply firmware updates via iDRAC:
   a. Upload firmware package
   b. Create update job
   c. Monitor lifecycle controller progress
6. Reboot host:
   a. Initiate reboot via iDRAC
   b. Wait for host to become unreachable
   c. Wait for host to become reachable
   d. Verify vCenter shows 'connected'
7. Exit maintenance mode
8. Power on VMs that were powered off
```

---

## Maintenance Window Analysis/Execution

### Analysis

| Component | Implementation |
|-----------|----------------|
| Edge Function | `analyze-maintenance-windows` |
| Purpose | Determine which windows are ready to execute |

**Flow:**
1. Query maintenance_windows with status='scheduled'
2. Check planned_start <= now
3. Check approval status if requires_approval
4. Return list of ready windows

### Execution

| Component | Implementation |
|-----------|----------------|
| Edge Function | `execute-maintenance-windows` |
| Purpose | Create jobs for window execution |

**Flow:**
1. For each ready window:
   a. Determine job type based on maintenance_type
   b. Create job with window context
   c. Update window status to 'in_progress'
2. Jobs execute via normal executor flow

---

## Notifications

| Component | Implementation |
|-----------|----------------|
| Edge Function | `send-notification` |
| Tables | `notification_settings`, `notification_logs` |
| Channels | Microsoft Teams webhook, SMTP email |

**Flow:**
1. Event triggers notification (job complete, cluster unsafe, etc.)
2. Check notification_settings for enabled channels
3. Format message with event context
4. Send to configured channels
5. Log result to notification_logs

---

## Storage/Replication

### Protection Group Workflow

| Component | Implementation |
|-----------|----------------|
| Handler | `ReplicationHandler` |
| Tables | `protection_groups`, `protected_vms`, `replication_pairs` |

**Flow:**
1. Protection group defines:
   - Source vCenter and datastore
   - Target storage system (ZFS/other)
   - RPO schedule
   - VM membership
2. Scheduled sync job:
   a. Create ZFS snapshot on source
   b. Replicate to target
   c. Update replication status
3. Failover:
   a. Verify target has recent replica
   b. Power off source VMs (optional)
   c. Register VMs on target
   d. Power on target VMs

---

## Blocker Resolution Wizard Flow

### Step-by-Step Process

```
1. Job pauses with awaiting_blocker_resolution=true
2. UI detects paused state, shows "Open Resolution Wizard" button
3. User opens BlockerResolutionWizard
4. Wizard displays:
   a. List of hosts with blockers
   b. Per-host: list of VMs and blocker reasons
   c. Per-blocker: resolution options
5. User selects resolutions:
   a. Power off VM during maintenance
   b. Skip this host entirely
   c. Acknowledge and proceed anyway
6. User selects host update order:
   a. Drag-and-drop reordering
   b. vCSA host recommended last
7. User confirms resolutions
8. Wizard saves to job.details.maintenance_blocker_resolutions:
   {
     "[server_id]": { skip_host: false, vms_to_power_off: [...] },
     "[host_name]": { ... },  // Duplicate keys for lookup
     "[vcenter_host_id]": { ... }
   }
9. Wizard sets job status='pending' (to resume)
10. Executor picks up job, reads resolutions, continues
```

### Resolution Storage Format

```typescript
interface HostResolution {
  skip_host: boolean;
  vms_to_power_off: Array<{
    vm_name: string;
    reason: string;
    action: 'power_off' | 'migrate' | 'acknowledge';
  }>;
  update_order?: number;
}

// Stored under multiple keys for reliable lookup
maintenance_blocker_resolutions: {
  "server-uuid-123": HostResolution,
  "vcenter-host-uuid-456": HostResolution,
  "esxi-hostname.domain.com": HostResolution
}
```

---

## Scheduled Job Behavior

### Scheduling

1. UI sets `job.schedule_at` to future timestamp
2. Job created with `status='pending'`
3. UI shows "Scheduled for X" countdown

### Execution

1. Executor polls: `schedule_at <= NOW() AND status='pending'`
2. At scheduled time, job is picked up
3. Pre-flight checks run with current data (not scheduling-time data)
4. If pre-flight determines no action needed: early exit

### Key Principle

Scheduled jobs check conditions at execution time, not scheduling time. This ensures:
- Latest firmware catalog is checked
- Current cluster state is evaluated
- No outdated assumptions from scheduling time
