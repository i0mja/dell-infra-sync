# Dell Server Manager - LLM Instructions

> **Parse Priority**: Read sections in order. Stop when you have enough context.

---

## §1 CRITICAL CONSTRAINTS

```yaml
OFFLINE_FIRST: true  # App MUST work without internet
NETWORKS: [192.168.x.x, 10.x.x.x, 172.16.x.x]  # Private networks only
NEVER:
  - Assume cloud/internet connectivity
  - Suggest VPNs for basic operations
  - Call external APIs for server management
  - Implement non-canonical Redfish endpoints
  - Store passwords in plaintext
  - Reference auth.users (use profiles table)
```

---

## §2 ARCHITECTURE

### Backend Components

| Component | Role | Location | Handles |
|-----------|------|----------|---------|
| **Job Executor** | PRIMARY backend | `job-executor.py` + `job_executor/` | ALL iDRAC/vCenter operations |
| **Edge Functions** | Supporting services | `supabase/functions/` | DB CRUD, auth, notifications |

### Execution Flow
```
Frontend → create-job edge function → jobs table
                                          ↓
Job Executor polls → execute handler → update status
                                          ↓
Frontend polls ← job status ← idrac_commands log
```

### Class Hierarchy
```
JobExecutor
├── DatabaseMixin     # job/task CRUD, polling
├── CredentialsMixin  # password decryption, resolution
├── VCenterMixin      # vCenter connection, maintenance mode
├── IdracMixin        # iDRAC info, discovery, health
├── ScpMixin          # SCP backup/restore
└── ConnectivityMixin # network testing
    └── delegates to → 12 Handlers (BaseHandler subclasses)
```

---

## §3 JOB TYPE → HANDLER MAP

| Job Type | Handler | Method |
|----------|---------|--------|
| `discovery_scan` | DiscoveryHandler | execute_discovery_scan |
| `health_check` | DiscoveryHandler | execute_health_check |
| `fetch_event_logs` | DiscoveryHandler | execute_fetch_event_logs |
| `test_credentials` | DiscoveryHandler | execute_test_credentials |
| `power_action` | PowerHandler | execute_power_action |
| `boot_configuration` | BootHandler | execute_boot_configuration |
| `bios_config_read` | BootHandler | execute_bios_config_read |
| `bios_config_write` | BootHandler | execute_bios_config_write |
| `firmware_update` | FirmwareHandler | execute_firmware_update |
| `full_server_update` | FirmwareHandler | execute_full_server_update |
| `virtual_media_mount` | VirtualMediaHandler | execute_virtual_media_mount |
| `virtual_media_unmount` | VirtualMediaHandler | execute_virtual_media_unmount |
| `scp_export` | ScpMixin | export_scp |
| `scp_import` | ScpMixin | import_scp |
| `vcenter_sync` | VCenterHandlers | execute_vcenter_sync |
| `safety_check` | ClusterHandler | execute_safety_check |
| `prepare_host` | ClusterHandler | execute_prepare_host |
| `rolling_update` | ClusterHandler | execute_rolling_update |
| `esxi_upgrade` | ESXiHandler | execute_esxi_upgrade |
| `esxi_preflight` | ESXiHandler | execute_esxi_preflight |
| `console_launch` | ConsoleHandler | execute_console_launch |
| `browse_datastore` | DatastoreHandler | execute_browse_datastore |
| `iso_upload` | MediaUploadHandler | execute_iso_upload |
| `idm_authenticate` | IDMHandler | execute_idm_authenticate |

---

## §4 DATABASE SCHEMA (ESSENTIAL)

```sql
-- servers: Dell server inventory
servers(id, hostname, ip_address, service_tag, model, 
        credential_set_id, discovered_username, discovered_password_encrypted,
        vcenter_host_id, connection_status, health_status)

-- credential_sets: Authentication credentials
credential_sets(id, name, credential_type['idrac'|'esxi'|'vcenter'],
               username, password_encrypted, is_default, priority)

-- jobs: Job queue
jobs(id, job_type, status['pending'|'running'|'completed'|'failed'],
     target_scope JSONB, details JSONB, created_by)

-- job_tasks: Per-server task tracking
job_tasks(id, job_id, server_id, status, progress[0-100], log)

-- idrac_commands: Activity log (REQUIRED for all API calls)
idrac_commands(id, server_id, job_id, command_type, operation_type,
              endpoint, status_code, success, response_time_ms, source)
```

### Credential Resolution Order
```
1. servers.credential_set_id (explicit)
2. servers.discovered_* (from discovery)
3. credential_ip_ranges match (by priority)
4. credential_sets.is_default=true
5. ENV: IDRAC_USER/IDRAC_PASSWORD
```

---

## §5 IMPLEMENTATION PATTERN

### Adding New iDRAC Operation

**Step 1: Database migration**
```sql
ALTER TYPE job_type ADD VALUE 'my_operation';
```

**Step 2: Handler implementation**
```python
# job_executor/handlers/my_handler.py
from .base import BaseHandler

class MyHandler(BaseHandler):
    def execute_my_operation(self, job: Dict):
        self.mark_job_running(job)
        try:
            server = self.get_server_by_id(job['target_scope']['server_ids'][0])
            username, password = self.executor.get_credentials_for_server(server)
            
            # Perform operation with logging
            result = self._do_operation(server, username, password)
            self.mark_job_completed(job, details={'result': result})
        except Exception as e:
            self.handle_error(job, e, context="my_operation")
```

**Step 3: Register in job-executor.py**
```python
from job_executor.handlers.my_handler import MyHandler
self.my_handler = MyHandler(self)
self.handler_map['my_operation'] = self.my_handler.execute_my_operation
```

**Step 4: Frontend trigger**
```typescript
await supabase.functions.invoke('create-job', {
  body: { job_type: 'my_operation', target_scope: { server_ids: [id] } }
});
```

---

## §6 ACTIVITY LOGGING (REQUIRED)

```python
# Python - ALL iDRAC API calls must log
self.log_idrac_command(
    server_id=server['id'],
    job_id=job['id'],
    endpoint='/redfish/v1/Systems/System.Embedded.1',
    command_type='GET',
    operation_type='discovery',
    success=True,
    response_time_ms=245,
    source='job_executor'
)
```

---

## §7 FILE LOCATIONS

```
job-executor.py                 # Main (~800 lines), handler routing
job_executor/
├── mixins/
│   ├── database.py            # DatabaseMixin
│   ├── credentials.py         # CredentialsMixin  
│   ├── vcenter_ops.py         # VCenterMixin
│   └── idrac_ops.py           # IdracMixin
├── handlers/
│   ├── base.py                # BaseHandler (inherit this)
│   ├── discovery.py           # DiscoveryHandler
│   ├── power.py               # PowerHandler
│   ├── firmware.py            # FirmwareHandler
│   ├── boot.py                # BootHandler
│   ├── cluster.py             # ClusterHandler
│   └── ...                    # Other handlers
├── dell_redfish/
│   ├── operations.py          # DellOperations (use this)
│   ├── endpoints.py           # Canonical endpoints
│   └── errors.py              # Error handling
├── scp.py                     # ScpMixin
└── connectivity.py            # ConnectivityMixin
```

---

## §8 QUICK LOOKUPS

### Environment Variables
```bash
DSM_URL=http://127.0.0.1:54321      # Lovable Cloud URL
SERVICE_ROLE_KEY=eyJh...            # DB access
IDRAC_USER=root                     # Default credentials
IDRAC_PASSWORD=calvin
```

### Never Edit (Auto-generated)
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `.env`

### Troubleshooting
| Issue | Check |
|-------|-------|
| Jobs stuck pending | Job Executor running? `systemctl status job-executor` |
| Connection failed | IP reachable? Firewall port 443 open? |
| Credentials fail | Priority order? IP ranges configured? |
| Handler not found | In handler_map? Job type in DB enum? |

---

## §9 IMPLEMENTATION CHECKLIST

```
□ Works offline (no internet required)
□ Logs to idrac_commands table
□ Uses credential resolution (no hardcoded passwords)
□ Job type added to DB enum
□ Handler inherits BaseHandler
□ Registered in handler_map
□ Uses Dell Redfish operations layer
□ Handles errors with handle_error()
```
