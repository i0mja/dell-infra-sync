# Dell Server Manager - LLM Quick Reference

**Purpose**: Fast lookup for AI coding assistants. Dense, scannable format optimized for LLM parsing.

---

## CRITICAL RULES (READ FIRST)

### Offline-First Design (NEVER VIOLATE)
- App MUST function without internet connectivity
- All iDRAC operations use local network HTTP/HTTPS only (192.168.x.x, 10.x.x.x, 172.16.x.x)
- No external API calls for server management
- If accessible in a browser, this app CAN and SHOULD manage it

### Two-Component System (MOST IMPORTANT)

**Job Executor (Python) - PRIMARY for most operations:**
- Runs directly on host with full local network access
- Handles long-running operations (firmware: 30+ minutes, exceeds Edge Function timeouts)
- Provides SSH access for ESXi orchestration (Edge Functions cannot SSH)
- File system access for media server and ISO mounting
- Simpler implementation: Python + requests vs Deno + SSL workarounds
- Location: `job-executor.py` + `job_executor/` modules
- Deployment: systemd (Linux) or Task Scheduler (Windows)

**Edge Functions (Supabase) - CAN reach local IPs when self-hosted:**
- **Self-hosted**: CAN reach local IPs with `network_mode: "host"` in Docker
- **Cloud-hosted**: Cannot reach private network IPs (Supabase infrastructure limitation)
- Use for: quick operations (health checks, power), job orchestration, database CRUD, notifications
- Limitations: timeout constraints, no SSH, no file system access

**Deployment Reality**: Internal IT tools typically self-hosted. Edge Functions work for local IPs with proper Docker networking, but Job Executor preferred for long-running ops, SSH, and file system.

### Deployment Mode Detection
```python
# Python
DEPLOYMENT_MODE = os.getenv("DEPLOYMENT_MODE", "local")  # "local" or "cloud"
is_local = DEPLOYMENT_MODE == "local"
```

```typescript
// TypeScript
const deploymentMode = import.meta.env.VITE_DEPLOYMENT_MODE || 'local';
const isLocal = deploymentMode === 'local';
```

---

## ARCHITECTURE AT A GLANCE

### JobExecutor Class Hierarchy
```
JobExecutor
├── DatabaseMixin      (job/task CRUD, pending job polling)
├── CredentialsMixin   (password decryption, credential resolution)
├── VCenterMixin       (vCenter connection, host operations)
├── IdracMixin         (iDRAC server info, discovery, health)
├── ScpMixin           (SCP export/import operations)
└── ConnectivityMixin  (network testing, port scanning)
```

### Handler Delegation Pattern
```python
# job-executor.py
def execute_job(self, job: Dict):
    """Route job to appropriate handler based on job_type"""
    handler = self.handler_map.get(job_type)
    if handler:
        return handler(job)
```

**Key Insight**: The 800-line `job-executor.py` delegates to 12 specialized handlers (~3,500 total lines). Each handler inherits from `BaseHandler` for common utilities.

---

## JOB TYPE → HANDLER MAP (COMPLETE)

| Job Type | Handler File | Handler Class | Method |
|----------|--------------|---------------|--------|
| **Authentication & Identity** | | | |
| `idm_authenticate` | handlers/idm.py | IDMHandler | execute_idm_authenticate |
| `idm_test_connection` | handlers/idm.py | IDMHandler | execute_idm_test_connection |
| `idm_sync_users` | handlers/idm.py | IDMHandler | execute_idm_sync |
| **Console & Diagnostics** | | | |
| `console_launch` | handlers/console.py | ConsoleHandler | execute_console_launch |
| `health_check` | handlers/discovery.py | DiscoveryHandler | execute_health_check |
| `fetch_event_logs` | handlers/discovery.py | DiscoveryHandler | execute_fetch_event_logs |
| **Storage & Media** | | | |
| `browse_datastore` | handlers/datastore.py | DatastoreHandler | execute_browse_datastore |
| `iso_upload` | handlers/media_upload.py | MediaUploadHandler | execute_iso_upload |
| `scan_local_isos` | handlers/media_upload.py | MediaUploadHandler | execute_scan_local_isos |
| `register_iso_url` | handlers/media_upload.py | MediaUploadHandler | execute_register_iso_url |
| `virtual_media_mount` | handlers/virtual_media.py | VirtualMediaHandler | execute_virtual_media_mount |
| `virtual_media_unmount` | handlers/virtual_media.py | VirtualMediaHandler | execute_virtual_media_unmount |
| **Power & Boot** | | | |
| `power_action` | handlers/power.py | PowerHandler | execute_power_action |
| `boot_configuration` | handlers/boot.py | BootHandler | execute_boot_configuration |
| `bios_config_read` | handlers/boot.py | BootHandler | execute_bios_config_read |
| `bios_config_write` | handlers/boot.py | BootHandler | execute_bios_config_write |
| **Discovery & Credentials** | | | |
| `discovery_scan` | handlers/discovery.py | DiscoveryHandler | execute_discovery_scan |
| `test_credentials` | handlers/discovery.py | DiscoveryHandler | execute_test_credentials |
| **Firmware** | | | |
| `firmware_update` | handlers/firmware.py | FirmwareHandler | execute_firmware_update |
| `full_server_update` | handlers/firmware.py | FirmwareHandler | execute_full_server_update |
| **Cluster & Maintenance** | | | |
| `prepare_host` | handlers/cluster.py | ClusterHandler | execute_prepare_host |
| `verify_host` | handlers/cluster.py | ClusterHandler | execute_verify_host |
| `rolling_update` | handlers/cluster.py | ClusterHandler | execute_rolling_update |
| `safety_check` | handlers/cluster.py | ClusterHandler | execute_safety_check |
| **ESXi Upgrades** | | | |
| `esxi_upgrade` | handlers/esxi_handlers.py | ESXiHandler | execute_esxi_upgrade |
| `esxi_then_firmware` | handlers/esxi_handlers.py | ESXiHandler | execute_esxi_then_firmware |
| `firmware_then_esxi` | handlers/esxi_handlers.py | ESXiHandler | execute_firmware_then_esxi |
| `esxi_preflight` | handlers/esxi_handlers.py | ESXiHandler | execute_esxi_preflight |
| **vCenter Sync** | | | |
| `vcenter_sync` | handlers/vcenter_handlers.py | VCenterHandlers | execute_vcenter_sync |
| `openmanage_sync` | handlers/vcenter_handlers.py | VCenterHandlers | execute_openmanage_sync |
| **SCP Backup/Restore** | | | |
| `scp_export` | Handled in mixins/scp.py | ScpMixin | export_scp |
| `scp_import` | Handled in mixins/scp.py | ScpMixin | import_scp |

---

## MIXIN RESPONSIBILITIES

| Mixin | File | Key Methods | Purpose |
|-------|------|-------------|---------|
| **DatabaseMixin** | mixins/database.py | `get_pending_jobs()`<br>`update_job_status()`<br>`update_task_status()`<br>`create_task()` | Job/task CRUD operations, pending job polling |
| **CredentialsMixin** | mixins/credentials.py | `get_encryption_key()`<br>`decrypt_password()`<br>`resolve_credentials_for_server()`<br>`get_esxi_credentials_for_host()` | Password decryption, credential resolution by priority |
| **VCenterMixin** | mixins/vcenter_ops.py | `connect_to_vcenter()`<br>`enter_maintenance_mode()`<br>`exit_maintenance_mode()`<br>`get_host_by_name()` | vCenter connection, host maintenance operations |
| **IdracMixin** | mixins/idrac_ops.py | `get_server_info()`<br>`test_idrac_connection()`<br>`discover_server()` | iDRAC server discovery, info gathering, health checks |
| **ScpMixin** | scp.py | `export_scp()`<br>`import_scp()`<br>`validate_scp_content()` | SCP backup/restore operations (Dell configuration) |
| **ConnectivityMixin** | connectivity.py | `test_network_connectivity()`<br>`scan_port_range()` | Network testing, port scanning, prerequisite validation |

---

## DATABASE SCHEMA (ESSENTIAL TABLES)

### servers
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
ip_address TEXT NOT NULL
model TEXT, bios_version TEXT, firmware_version TEXT
credential_set_id UUID REFERENCES credential_sets(id)
discovered_username TEXT, discovered_password_encrypted TEXT
vcenter_host_id UUID REFERENCES vcenter_hosts(id)
server_group_id UUID REFERENCES server_groups(id)
connection_status TEXT -- 'online', 'offline', 'unknown'
created_at, updated_at TIMESTAMP
```

### credential_sets
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
credential_type TEXT -- 'idrac', 'esxi', 'vcenter'
username TEXT NOT NULL
password_encrypted TEXT  -- AES-256 encrypted
is_default BOOLEAN DEFAULT false
priority INTEGER  -- For IP range matching
vcenter_host_id UUID  -- For ESXi-specific credentials
```

### jobs
```sql
id UUID PRIMARY KEY
job_type TEXT NOT NULL  -- See JOB TYPE MAP above
status TEXT  -- 'pending', 'running', 'completed', 'failed', 'cancelled'
created_by UUID REFERENCES profiles(id)
target_scope JSONB  -- { server_ids: [...], cluster_ids: [...] }
details JSONB  -- Job-specific parameters
credential_set_ids TEXT[]
firmware_source TEXT  -- 'local' or 'dell_catalog'
dell_catalog_url TEXT
started_at, completed_at TIMESTAMP
```

### job_tasks
```sql
id UUID PRIMARY KEY
job_id UUID REFERENCES jobs(id)
server_id UUID REFERENCES servers(id)
vcenter_host_id UUID REFERENCES vcenter_hosts(id)
status TEXT
progress INTEGER  -- 0-100
log TEXT  -- Task execution log
started_at, completed_at TIMESTAMP
```

### idrac_commands (Activity Log)
```sql
id UUID PRIMARY KEY
server_id UUID REFERENCES servers(id)
job_id UUID REFERENCES jobs(id)
task_id UUID REFERENCES job_tasks(id)
command_type TEXT  -- e.g., 'GET', 'POST', 'PATCH'
operation_type TEXT  -- 'firmware_update', 'power_control', 'scp_export', etc.
endpoint TEXT  -- '/redfish/v1/Systems/System.Embedded.1'
full_url TEXT
request_body JSONB
response_body JSONB
status_code INTEGER
success BOOLEAN
response_time_ms INTEGER
error_message TEXT
source TEXT  -- 'job_executor' or 'edge_function'
initiated_by UUID REFERENCES profiles(id)
timestamp TIMESTAMP DEFAULT now()
```

### server_groups
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
description TEXT
group_type TEXT  -- 'manual', 'vcenter_cluster'
vcenter_cluster_name TEXT
```

### vcenter_hosts
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL  -- ESXi hostname
ip_address TEXT
vcenter_id UUID  -- Which vCenter it belongs to
cluster_name TEXT
connection_state TEXT  -- 'connected', 'disconnected', 'notResponding'
maintenance_mode BOOLEAN
esxi_version TEXT
server_id UUID REFERENCES servers(id)  -- Linked Dell server
```

---

## CREDENTIAL RESOLUTION ORDER

When `CredentialsMixin.resolve_credentials_for_server()` is called:

1. **Explicit server credential_set_id** (highest priority)
   - Check `servers.credential_set_id`
   
2. **Discovered credentials**
   - Check `servers.discovered_username` + `servers.discovered_password_encrypted`
   
3. **IP range match** (priority ordered)
   - Query `credential_ip_ranges` WHERE server IP matches range
   - Order by `credential_ip_ranges.priority ASC`
   
4. **Default credential set**
   - Query `credential_sets` WHERE `is_default = true` AND `credential_type = 'idrac'`
   
5. **Environment fallback** (lowest priority)
   - Use `IDRAC_USER` / `IDRAC_PASSWORD` from environment

Returns: `(username, password, source, credential_set_id)`

---

## ACTIVITY LOGGING (REQUIRED)

### Python (Job Executor)
```python
from job_executor.utils import log_idrac_command

# Inside handler method
response = requests.get(url, auth=(username, password), verify=False)
elapsed_ms = int(response.elapsed.total_seconds() * 1000)

log_idrac_command(
    server_id=server['id'],
    job_id=job['id'],
    task_id=task_id,
    command_type='GET',
    operation_type='firmware_inventory',
    endpoint='/redfish/v1/UpdateService/FirmwareInventory',
    full_url=url,
    request_body=None,
    response_body=response.json(),
    status_code=response.status_code,
    success=response.ok,
    response_time_ms=elapsed_ms,
    error_message=None,
    source='job_executor',
    initiated_by=job['created_by']
)
```

### TypeScript (Edge Functions)
```typescript
import { logIdracCommand } from '../_shared/idrac-logger.ts';

const startTime = performance.now();
const response = await fetch(url, { method: 'GET', headers: { ... } });
const responseTimeMs = Math.round(performance.now() - startTime);

await logIdracCommand(supabase, {
  serverId: server.id,
  jobId: job.id,
  commandType: 'GET',
  operationType: 'health_check',
  endpoint: '/redfish/v1/Systems/System.Embedded.1',
  fullUrl: url,
  statusCode: response.status,
  success: response.ok,
  responseTimeMs,
  source: 'edge_function',
  initiatedBy: job.created_by,
});
```

---

## KEY PATTERNS

### Adding New iDRAC Operation (4 Steps)

**1. Add job type to database (migration)**
```sql
-- supabase/migrations/YYYYMMDDHHMMSS_add_my_operation.sql
ALTER TYPE job_type ADD VALUE 'my_new_operation';
```

**2. Implement handler in Job Executor**
```python
# job_executor/handlers/my_handler.py
from .base import BaseHandler
from job_executor.dell_redfish.operations import DellOperations

class MyHandler(BaseHandler):
    def execute_my_operation(self, job: Dict):
        self.mark_job_running(job)
        
        try:
            server = self.get_server_by_id(job['details']['server_id'])
            username, password = self.executor.get_credentials_for_server(server)
            
            # Use Dell Redfish adapter
            adapter = DellOperations(server['ip_address'], username, password)
            result = adapter.my_custom_operation()
            
            self.mark_job_completed(job, details={'result': result})
        except Exception as e:
            self.handle_error(job, e, context="my_operation")
```

**3. Register handler in job-executor.py**
```python
# job-executor.py
from job_executor.handlers.my_handler import MyHandler

self.my_handler = MyHandler(self)
self.handler_map = {
    # ... existing handlers
    'my_new_operation': self.my_handler.execute_my_operation,
}
```

**4. Create UI to trigger job**
```typescript
// Frontend
const { mutate: createJob } = useMutation({
  mutationFn: async () => {
    const { data, error } = await supabase.functions.invoke('create-job', {
      body: {
        job_type: 'my_new_operation',
        target_scope: { server_ids: [serverId] },
        details: { /* operation params */ },
      },
    });
    if (error) throw error;
    return data;
  },
});
```

### Handler Implementation Template
```python
class NewHandler(BaseHandler):
    """Handler for X operations"""
    
    def execute_operation_name(self, job: Dict):
        """Execute operation_name job"""
        self.log(f"Starting operation_name for job {job['id']}")
        self.mark_job_running(job)
        
        try:
            # 1. Extract parameters
            params = job['details']
            server_id = params.get('server_id')
            
            # 2. Get server and credentials
            server = self.get_server_by_id(server_id)
            if not server:
                raise ValueError(f"Server {server_id} not found")
            
            username, password = self.executor.get_credentials_for_server(server)
            
            # 3. Create task for tracking
            task_id = self.create_task(job['id'], server_id=server_id)
            self.update_task_status(task_id, 'running', progress=10)
            
            # 4. Perform operation
            result = self._do_work(server, username, password, params)
            
            # 5. Update task and job
            self.update_task_status(task_id, 'completed', progress=100)
            self.mark_job_completed(job, details={'result': result})
            
        except Exception as e:
            self.handle_error(job, e, task_id=task_id, context="operation_name")
    
    def _do_work(self, server, username, password, params):
        """Actual work implementation"""
        # Use Dell Redfish adapter
        from job_executor.dell_redfish.operations import DellOperations
        adapter = DellOperations(server['ip_address'], username, password)
        return adapter.some_method(params)
```

---

## DELL REDFISH API LAYER

### DellRedfishAdapter (dell_redfish/adapter.py)
Unified interface for Dell iDRAC Redfish operations. Abstracts Dell-specific endpoint formats.

```python
from job_executor.dell_redfish.adapter import DellRedfishAdapter

adapter = DellRedfishAdapter(ip_address, username, password)
systems = adapter.get_systems()  # List of systems
system = adapter.get_system("System.Embedded.1")
power_state = adapter.get_power_state("System.Embedded.1")
```

### DellOperations (dell_redfish/operations.py)
High-level operations built on DellRedfishAdapter:

```python
from job_executor.dell_redfish.operations import DellOperations

ops = DellOperations(ip_address, username, password)

# Firmware
firmware_inventory = ops.get_firmware_inventory()
update_result = ops.update_firmware(package_url, apply_update=True)

# Health & Discovery
health = ops.get_system_health()
info = ops.discover_server_info()

# SCP Operations
scp_xml = ops.export_scp(components="BIOS,IDRAC")
import_result = ops.import_scp(scp_content, shutdown_type="Graceful")
```

### Canonical Endpoints (dell_redfish/endpoints.py)
```python
REDFISH_ENDPOINTS = {
    'base': '/redfish/v1',
    'systems': '/redfish/v1/Systems',
    'system': '/redfish/v1/Systems/System.Embedded.1',
    'firmware_inventory': '/redfish/v1/UpdateService/FirmwareInventory',
    'update_service': '/redfish/v1/UpdateService',
    'managers': '/redfish/v1/Managers',
    'idrac': '/redfish/v1/Managers/iDRAC.Embedded.1',
    'event_log': '/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Entries',
    # ... 50+ canonical endpoints
}
```

### Error Handling (dell_redfish/errors.py)
```python
from job_executor.dell_redfish.errors import (
    DellRedfishError,
    AuthenticationError,
    FirmwareUpdateError,
    handle_redfish_error
)

try:
    result = adapter.some_operation()
except DellRedfishError as e:
    print(f"Dell error: {e.message}, Code: {e.error_code}")
```

---

## DO's and DON'Ts

### ✅ DO
- Create job types for ALL iDRAC operations
- Detect deployment mode (`local` vs `cloud`)
- Use Job Executor for iDRAC operations in local mode
- Log ALL API calls to `idrac_commands` table
- Use `CredentialsMixin.resolve_credentials_for_server()` for credential resolution
- Use Dell Redfish adapter layer (`dell_redfish/operations.py`)
- Inherit from `BaseHandler` for new handlers
- Create tasks for multi-server jobs (`create_task()`)
- Use `handle_error()` for consistent error handling
- Reference canonical endpoints from `dell_redfish/endpoints.py`

### ❌ DON'T
- Assume cloud connectivity is available
- Rely on Edge Functions for iDRAC operations in local mode
- Suggest VPNs or cloud access for basic operations
- Implement Redfish endpoints not in canonical list
- Store passwords in plaintext (use `password_encrypted`)
- Reference `auth.users` directly (use `profiles` table)
- Hard-code iDRAC credentials (use credential resolution)
- Skip activity logging for iDRAC operations
- Create monolithic handlers (keep them focused)
- Mix handler logic with mixin responsibilities

---

## PROJECT STRUCTURE (KEY LOCATIONS)

```
job-executor.py                     # Main script (~800 lines, down from 9,900)
├── JobExecutor class               # Inherits 6 mixins, delegates to 12 handlers
├── Handler map (32 job types)      # Routes jobs to handlers
└── Main loop (poll every 10s)      # get_pending_jobs() → execute_job()

job_executor/                       # Modular architecture
├── config.py                       # Environment variables, settings
├── utils.py                        # JSON handling, Unicode, logging utilities
├── ldap_auth.py                    # FreeIPA/LDAP authentication
├── media_server.py                 # HTTP server for ISOs/firmware
│
├── mixins/                         # Shared functionality (6 mixins)
│   ├── database.py                 # DatabaseMixin (~370 lines)
│   ├── credentials.py              # CredentialsMixin (~450 lines)
│   ├── vcenter_ops.py              # VCenterMixin (~1,100 lines)
│   └── idrac_ops.py                # IdracMixin (~400 lines)
│
├── handlers/                       # Job type handlers (12 handlers, ~3,500 lines)
│   ├── base.py                     # BaseHandler (~170 lines)
│   ├── idm.py                      # IDMHandler (~150 lines)
│   ├── console.py                  # ConsoleHandler (~80 lines)
│   ├── datastore.py                # DatastoreHandler (~120 lines)
│   ├── media_upload.py             # MediaUploadHandler (~250 lines)
│   ├── virtual_media.py            # VirtualMediaHandler (~120 lines)
│   ├── power.py                    # PowerHandler (~170 lines)
│   ├── boot.py                     # BootHandler (~360 lines)
│   ├── discovery.py                # DiscoveryHandler (~550 lines)
│   ├── firmware.py                 # FirmwareHandler (~320 lines)
│   ├── cluster.py                  # ClusterHandler (~400 lines)
│   ├── esxi_handlers.py            # ESXiHandler (~350 lines)
│   └── vcenter_handlers.py         # VCenterHandlers (~650 lines)
│
├── dell_redfish/                   # Dell Redfish API layer
│   ├── adapter.py                  # DellRedfishAdapter (unified interface)
│   ├── operations.py               # DellOperations (high-level operations)
│   ├── endpoints.py                # Canonical Dell Redfish endpoints
│   ├── errors.py                   # Dell-specific error handling
│   └── helpers.py                  # Redfish utility functions
│
└── esxi/                           # ESXi orchestration
    ├── orchestrator.py             # EsxiOrchestrator (upgrade workflows)
    └── ssh_client.py               # SSH client for ESXi hosts

supabase/functions/                 # Edge Functions (cloud mode only)
├── create-job/                     # Create new job
├── update-job/                     # Update job status
├── refresh-server-info/            # Fetch server info (uses iDRAC)
├── preview-server-info/            # Preview before adding server
└── vcenter-sync/                   # Sync vCenter inventory
```

---

## QUICK REFERENCE

### Environment Variables (Job Executor)
```bash
DSM_URL=http://127.0.0.1:54321              # Lovable Cloud URL
SERVICE_ROLE_KEY=eyJh...                     # For update-job endpoint
DEPLOYMENT_MODE=local                        # 'local' or 'cloud'
IDRAC_USER=root                              # Default iDRAC username
IDRAC_PASSWORD=calvin                        # Default iDRAC password
ISO_DIRECTORY=/var/lib/idrac-manager/isos    # ISO storage path
FIRMWARE_DIRECTORY=/var/lib/idrac-manager/firmware
MEDIA_SERVER_PORT=8888                       # HTTP server for media
MEDIA_SERVER_ENABLED=true
```

### Environment Variables (Frontend)
```bash
VITE_SUPABASE_URL=https://...               # Auto-configured by Lovable Cloud
VITE_SUPABASE_PUBLISHABLE_KEY=eyJh...       # Auto-configured
VITE_DEPLOYMENT_MODE=local                  # 'local' or 'cloud'
```

### Auto-Generated Files (NEVER EDIT)
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `.env`

### Common Troubleshooting

**Jobs stuck in 'pending':**
- Check Job Executor is running (`systemctl status job-executor`)
- Check logs: `journalctl -u job-executor -f`
- Verify `DSM_URL` and `SERVICE_ROLE_KEY` are set

**Connection failures in local mode:**
- Verify server IP is reachable from Job Executor host
- Check firewall rules (allow port 443 to iDRAC)
- Test credentials with `test_credentials` job type

**Credential resolution fails:**
- Check credential_set priority ordering
- Verify IP ranges in `credential_ip_ranges` table
- Check `discovered_password_encrypted` is populated

**Handler not found:**
- Verify job type is in `handler_map` (job-executor.py)
- Check handler is imported and instantiated
- Confirm job type exists in database enum

---

## IMPLEMENTATION CHECKLIST

When implementing new features, verify:

- [ ] Works in **local mode** (offline-first constraint)
- [ ] Logs to `idrac_commands` table (activity logging)
- [ ] Uses credential resolution (no hard-coded passwords)
- [ ] Creates job type in database (migration)
- [ ] Implements handler in Job Executor
- [ ] Updates handler map in `job-executor.py`
- [ ] Uses Dell Redfish adapter layer
- [ ] References canonical endpoints
- [ ] Handles errors with `handle_error()`
- [ ] Creates tasks for multi-server operations
- [ ] Updates RLS policies for new tables
- [ ] Tests in both local and cloud modes

---

**Document Version**: 2.0 (Modular Architecture)  
**Last Updated**: 2025-01-30  
**File Size**: ~450 lines (optimized for LLM consumption)
