# Invariants

This document lists rules that must always hold true in the system.
Violating these invariants may cause data corruption, security issues, or undefined behavior.

## Job State Invariants

1. **Single executor per job**: A job in `running` state must be processed by exactly one executor instance. The executor uses claim-based locking (update status from `pending` to `running` atomically).

2. **Timestamp consistency**:
   - `started_at` must be set when `status = 'running'`
   - `completed_at` must be set when `status IN ('completed', 'failed', 'cancelled')`
   - `completed_at >= started_at` always

3. **Terminal states are final**: Once a job reaches `completed`, `failed`, or `cancelled`, it cannot transition to any other state.

4. **Pause requires reason**: A job in `paused` state must have either:
   - `details.awaiting_blocker_resolution = true`, OR
   - `details.pause_reason` set to a non-empty string

5. **Resume requires action**: Resuming from `paused` requires:
   - Setting `status = 'pending'`
   - Either saving resolutions in `details.maintenance_blocker_resolutions` OR setting `details.force_resumed = true`

## Workflow Step Invariants

1. **Step numbers are unique per job**: No two steps in the same job can have the same `step_number`.

2. **Step lifecycle order**:
   - `pending` → `running` → (`completed` | `failed` | `skipped`)
   - No skipping intermediate states (except `pending` → `skipped`)

3. **Parent job relationship**: Every workflow step must reference a valid `job_id`.

4. **Completion timestamps**: `step_completed_at` must be set when `step_status IN ('completed', 'failed', 'skipped')`.

## Database Invariants

1. **Foreign key integrity**: All foreign key relationships defined in migrations must be maintained.

2. **RLS enforcement**: Row Level Security is enabled on all user-facing tables. Direct database access without proper auth context is prohibited.

3. **UUID primary keys**: All primary keys are UUIDs, not sequential integers.

4. **Timezone consistency**: All timestamps are stored in UTC (TIMESTAMPTZ).

## Security Invariants

1. **No secrets in logs**: Passwords, tokens, private keys, and encrypted values must never appear in:
   - `console_log` arrays
   - `step_details`
   - `step_error`
   - Any log output

2. **Encrypted credential storage**: Passwords in `credential_sets`, `openmanage_settings`, etc. must be stored encrypted using the `password_encrypted` pattern.

3. **Service role isolation**: The `SERVICE_ROLE_KEY` must only be used by:
   - Edge Functions (server-side)
   - Job Executor (privileged on-prem component)
   - Never exposed to the browser/UI

4. **UI receives no secrets**: The React UI must never receive:
   - Service role keys
   - Decrypted passwords
   - Private keys

## Infrastructure Operation Invariants

1. **No silent power operations**: Power on/off/reset operations must be:
   - Explicitly requested via job
   - Logged with operator context
   - Confirmable in UI before execution

2. **No force by default**: Operations like force reboot, force media detach, force maintenance mode must require explicit opt-in, not be default behavior.

3. **Maintenance mode protocol**:
   - Check for blockers before entering maintenance mode
   - Pause for resolution if critical blockers detected
   - Never force maintenance mode without operator approval

4. **Reboot verification**: After initiating a reboot:
   - Wait for host to become unreachable
   - Then wait for host to become reachable again
   - Verify connection state via vCenter API

## UI/Wizard Invariants

1. **Visible action buttons**: Every wizard step and modal must have visible navigation actions (Back, Next, Cancel, Close). Users must never be trapped.

2. **Scrollable content**: Long content in dialogs must scroll within the body; action buttons must remain visible at all times.

3. **State persistence**: Wizard state must be persisted to the job record before critical operations so that:
   - Page refresh doesn't lose user decisions
   - Executor can read the decisions

4. **Error surfaces**: All errors must be surfaced to the user with:
   - Clear error message
   - Suggested remediation if available
   - Action to retry or close

## Blocker Resolution Invariants

1. **Multi-key storage**: Blocker resolutions must be stored under multiple host identifier keys:
   - `server_id`
   - `vcenter_host_id`
   - `host_name`
   
   This ensures the executor can find resolutions regardless of which identifier it has.

2. **Resolution lookup order**: Executor must try all key variants when looking up resolutions for a host.

3. **Power-off before maintenance**: If resolutions specify VMs to power off:
   - VMs must actually be powered off
   - Power-off must be verified before attempting maintenance mode

## JSON Serialization Invariants

1. **All job details must be JSON-serializable**: Before storing `details`, the executor must sanitize:
   - pyvmomi objects → string representations
   - datetime objects → ISO strings
   - Any non-primitive types → safe alternatives

2. **Blocker field limits**: Blocker data must be truncated to prevent storage failures:
   - `vm_name`: 255 chars
   - `reason`: 255 chars
   - `details`: 1024 chars
   - `remediation`: 1024 chars
   - Max blockers per host: 50

3. **Payload size limits**: Large payloads (>50KB) may fail to store. The executor must have fallback logic to store minimal payloads on failure.

## Audit Trail Invariants

1. **All significant actions logged**: The following must create audit records:
   - User authentication
   - Job creation
   - Job state changes
   - Credential access
   - Admin operations

2. **Audit logs are append-only**: Audit logs must not be modified or deleted by application code.

3. **Correlation IDs**: Operations must include identifiable context:
   - `job_id` for job-related operations
   - `user_id` for user-initiated actions
   - `server_id` / `host_id` for infrastructure operations
