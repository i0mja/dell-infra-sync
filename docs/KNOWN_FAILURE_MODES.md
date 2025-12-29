# Known Failure Modes

This document describes how the system fails, what symptoms appear, and available recovery mechanisms.

## JSON Serialization Failures

### Symptom
- Job fails immediately after blocker scan completes
- Error message shows cryptic string like `'warning'` or `'KeyError'`
- Job status shows `failed` but step shows 100% progress

### Root Cause
The blocker scan collects data from vCenter that includes pyvmomi objects or other non-JSON-serializable types. When attempting to store this in `job.details`, the JSON serialization fails.

Common specific causes:
- Missing key in `FIELD_LIMITS` dictionary (e.g., `'warning'` key was missing)
- pyvmomi ManagedObject references not converted to strings
- datetime objects not converted to ISO strings

### Recovery
1. Fix the serialization code to handle the missing case
2. For affected jobs: use "Force Resume to Paused" button in UI
3. This populates blockers from `raw_blockers_backup` fallback field

### Prevention
- Use `_deep_sanitize_for_json()` on all data before storage
- Ensure `BLOCKER_FIELD_LIMITS` contains all possible field names
- Add try/catch with fallback storage around all DB writes

---

## Large Payload Storage Failures

### Symptom
- Job update fails silently or with 500 error
- Details field appears empty or missing expected data
- Workflow step shows data but job details do not

### Root Cause
Supabase/Postgres has practical limits on JSON field sizes. Payloads >100KB often fail, especially with complex nested structures.

### Recovery
1. The executor has fallback logic to store minimal payload if full payload fails
2. Blocker data is also stored in `raw_blockers_backup` as safety copy
3. UI checks multiple sources for blocker data

### Prevention
- Truncate string fields using `BLOCKER_FIELD_LIMITS`
- Limit blockers per host (`MAX_BLOCKERS_PER_HOST = 50`)
- Store large data in workflow step `step_details` instead of job `details`

---

## Blocker Resolution Lookup Failures

### Symptom
- Job resumes but doesn't apply resolutions
- VMs that should be powered off remain running
- Host fails to enter maintenance mode

### Root Cause
The BlockerResolutionWizard stores resolutions under one key (e.g., `host_name`), but the executor looks for a different key (e.g., `server_id`).

### Recovery
1. Current code stores resolutions under multiple keys
2. Executor tries all key variants during lookup
3. Debug logging shows which keys are available vs. searched

### Prevention
- Always store resolutions under all available identifiers:
  - `server_id`
  - `vcenter_host_id` (as string)
  - `host_name`
- Executor must try all variants in priority order

---

## Wizard "Trap" Scenarios

### Symptom
- User stuck in wizard/dialog with no visible actions
- Cannot proceed forward or cancel
- Page appears frozen

### Root Cause
- Long content pushes buttons off-screen
- Conditional rendering hides action buttons
- Loading state never resolves

### Recovery
1. Refresh page (loses unsaved wizard state)
2. Navigate away using browser

### Prevention
- All dialogs must use scrollable body with fixed footer
- Action buttons must always be rendered
- Loading states must have timeout fallbacks

---

## Job Stuck in "Running" State

### Symptom
- Job shows "running" indefinitely
- No progress updates
- Executor appears idle

### Root Cause
Several possibilities:
1. Executor crashed mid-job
2. Network partition between executor and Supabase
3. Job waiting for external condition that never arrives

### Detection
- Check `executor_heartbeats` table for executor last_seen_at
- Compare job `started_at` with `activity_settings.stale_running_hours`
- UI shows "Not Responding" badge for stale running jobs

### Recovery
1. Restart executor (job will be orphaned)
2. Manually set job status to `failed` or `cancelled`
3. Use UI "Force Fail" action if available

### Prevention
- Executor heartbeat monitoring
- Stale job detection in UI
- Auto-cancel stale jobs setting (optional)

---

## Database Connection Failures

### Symptom
- Edge Functions return 500 errors
- Executor logs show connection timeouts
- UI shows "Failed to load" errors

### Root Cause
- Supabase project quota exceeded
- Network issues between client and Supabase
- Database pool exhaustion

### Recovery
1. Check Supabase project health in Cloud dashboard
2. Retry operations after brief wait
3. Restart executor to reset connections

### Prevention
- Implement retry with exponential backoff
- Set appropriate timeouts on all requests
- Monitor database connection metrics

---

## Maintenance Mode Entry Failures

### Symptom
- Host fails to enter maintenance mode
- Error: "Cannot evacuate VMs" or similar
- Job fails at host update step

### Root Cause
- VMs with blockers (USB, FT, vGPU) not powered off
- Insufficient cluster capacity for evacuation
- DRS disabled or misconfigured

### Recovery
1. If blockers: use BlockerResolutionWizard
2. If capacity: free resources or skip host
3. If DRS: enable DRS manually then retry

### Prevention
- Pre-flight blocker scan
- Pause job for resolution instead of failing
- Check cluster capacity before starting

---

## ESXi Reboot Timeout

### Symptom
- Host shows "Waiting for reboot completion" indefinitely
- Job eventually times out
- Host may be stuck in boot process

### Root Cause
- Firmware update failed
- Hardware issue
- Boot configuration problem

### Recovery
1. Check iDRAC console for boot status
2. Access iDRAC directly to diagnose
3. May require manual intervention at data center

### Prevention
- Pre-flight health checks
- Monitor boot progress via iDRAC lifecycle controller
- Set appropriate timeout (default: 30 minutes for reboot)

---

## Credential Decryption Failures

### Symptom
- Error: "Cannot decrypt credentials - encryption key not configured"
- Jobs fail immediately when trying to connect to infrastructure

### Root Cause
- Encryption key not set in executor environment
- Encryption key changed since credentials were encrypted
- Database corruption of encrypted values

### Recovery
1. Verify `ENCRYPTION_KEY` environment variable
2. Re-encrypt credentials using original key
3. If key lost: re-enter all credentials

### Prevention
- Secure backup of encryption key
- Validate key on executor startup
- Test credential decryption before job execution

---

## Real-time Subscription Failures

### Symptom
- UI doesn't update automatically
- Progress appears frozen until page refresh
- Workflow steps don't appear

### Root Cause
- WebSocket connection dropped
- Supabase realtime quota exceeded
- Network instability

### Recovery
1. Refresh page to re-establish subscription
2. UI has periodic polling fallback (every 30s)
3. Check Supabase realtime status

### Prevention
- Implement subscription reconnection logic
- Fallback polling for critical data
- Show connection status indicator

---

## Recovery UI Components

### Force Resume to Paused Button
- Appears when: job is `failed` but has workflow blockers detected
- Action: Sets job to `pending`, populates `current_blockers` from available sources
- Enables: BlockerResolutionWizard to open

### Open Resolution Wizard Button
- Appears when: `awaiting_blocker_resolution = true` OR step has blockers
- Opens: BlockerResolutionWizard modal
- Requires: Blocker data in job or step details

### Resume Job Button
- Appears when: resolutions saved but job still paused
- Action: Sets `status = 'pending'`, clears pause flags
- Executor: Picks up job and continues with resolutions

### Cancel Job Button
- Always available for non-terminal jobs
- Action: Sets `status = 'cancelled'`
- Executor: Checks cancelled status periodically and stops
