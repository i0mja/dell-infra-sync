# Dell Server Manager - Complete Developer Reference

> For quick LLM lookups, see **AGENTS_SUMMARY.md** (optimized for AI parsing).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Job Executor Deep Dive](#job-executor-deep-dive)
4. [Handlers Reference](#handlers-reference)
5. [Mixins Reference](#mixins-reference)
6. [Dell Redfish API](#dell-redfish-api)
7. [Database Schema](#database-schema)
8. [Edge Functions](#edge-functions)
9. [Frontend Patterns](#frontend-patterns)
10. [Deployment](#deployment)
11. [Troubleshooting](#troubleshooting)

---

## Overview

### What is Dell Server Manager?

An enterprise-grade application for managing Dell PowerEdge servers via iDRAC Redfish API and VMware vCenter integration. Built for **offline-first, air-gapped environments**.

### Key Features
- Server lifecycle management (discovery, firmware, power, BIOS, SCP)
- VMware vCenter integration (host sync, cluster safety, ESXi upgrades)
- Maintenance window planning and execution
- FreeIPA/LDAP enterprise authentication

### Target Environment
- Private networks: `192.168.x.x`, `10.x.x.x`, `172.16.x.x`
- Air-gapped facilities (government, defense, finance)
- No external internet dependencies

---

## Architecture

### Critical Principle: Offline-First

**This application MUST function without internet connectivity.**

| ✅ DO | ❌ DON'T |
|-------|---------|
| Use local network HTTP/HTTPS | Assume cloud connectivity |
| Target private IPs | Suggest VPNs for basic ops |
| Work without external APIs | Call external services |

### Two-Component System

#### Job Executor (Python) - PRIMARY Backend

The Job Executor is a **system service** (systemd/Task Scheduler) that handles ALL iDRAC and vCenter operations.

**Capabilities:**
- Full local network access
- Long-running operations (firmware: 30+ min)
- SSH access for ESXi orchestration
- File system access (ISO mounting, media server)
- Job queue processing

**Location:** `job-executor.py` + `job_executor/` directory

#### Edge Functions (Supabase) - Supporting Services

Edge Functions handle database operations, authentication, and notifications.

**Used for:**
- Job orchestration (`create-job`, `update-job`)
- Database CRUD
- Authentication (`break-glass-authenticate`, `idm-authenticate`)
- Notifications

**NOT used for:** Direct iDRAC/vCenter API calls

### Execution Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Frontend   │────▶│  create-job      │────▶│   jobs      │
│  (React)    │     │  (Edge Function) │     │   (table)   │
└─────────────┘     └──────────────────┘     └──────┬──────┘
       ▲                                            │
       │                                            ▼
       │                                    ┌───────────────┐
       │                                    │ Job Executor  │
       │                                    │ (Python)      │
       │                                    └───────┬───────┘
       │                                            │
       │         ┌─────────────────────────────────┘
       │         ▼
┌──────┴─────────────────┐
│  Poll job status       │
│  + idrac_commands log  │
└────────────────────────┘
```

---

## Job Executor Deep Dive

### Class Structure

```python
class JobExecutor(
    DatabaseMixin,      # Job/task CRUD, pending job polling
    CredentialsMixin,   # Password decryption, credential resolution
    VCenterMixin,       # vCenter connection, maintenance mode
    IdracMixin,         # iDRAC info, discovery, health
    ScpMixin,           # SCP backup/restore
    ConnectivityMixin   # Network testing
):
    def __init__(self):
        # Initialize handlers
        self.discovery_handler = DiscoveryHandler(self)
        self.power_handler = PowerHandler(self)
        self.firmware_handler = FirmwareHandler(self)
        # ... 12 handlers total
        
        # Route jobs to handlers
        self.handler_map = {
            'discovery_scan': self.discovery_handler.execute_discovery_scan,
            'power_action': self.power_handler.execute_power_action,
            # ... 32 job types total
        }
    
    def run(self):
        while True:
            jobs = self.get_pending_jobs()
            for job in jobs:
                self.execute_job(job)
            time.sleep(10)
```

### Complete Job Type Mapping

| Job Type | Handler File | Handler Class | Method |
|----------|--------------|---------------|--------|
| **Discovery & Health** |
| `discovery_scan` | handlers/discovery.py | DiscoveryHandler | execute_discovery_scan |
| `health_check` | handlers/discovery.py | DiscoveryHandler | execute_health_check |
| `fetch_event_logs` | handlers/discovery.py | DiscoveryHandler | execute_fetch_event_logs |
| `test_credentials` | handlers/discovery.py | DiscoveryHandler | execute_test_credentials |
| **Power & Boot** |
| `power_action` | handlers/power.py | PowerHandler | execute_power_action |
| `boot_configuration` | handlers/boot.py | BootHandler | execute_boot_configuration |
| `bios_config_read` | handlers/boot.py | BootHandler | execute_bios_config_read |
| `bios_config_write` | handlers/boot.py | BootHandler | execute_bios_config_write |
| **Firmware** |
| `firmware_update` | handlers/firmware.py | FirmwareHandler | execute_firmware_update |
| `full_server_update` | handlers/firmware.py | FirmwareHandler | execute_full_server_update |
| **Virtual Media** |
| `virtual_media_mount` | handlers/virtual_media.py | VirtualMediaHandler | execute_virtual_media_mount |
| `virtual_media_unmount` | handlers/virtual_media.py | VirtualMediaHandler | execute_virtual_media_unmount |
| **SCP Backup/Restore** |
| `scp_export` | scp.py | ScpMixin | export_scp |
| `scp_import` | scp.py | ScpMixin | import_scp |
| **vCenter & Cluster** |
| `vcenter_sync` | handlers/vcenter_handlers.py | VCenterHandlers | execute_vcenter_sync |
| `openmanage_sync` | handlers/vcenter_handlers.py | VCenterHandlers | execute_openmanage_sync |
| `safety_check` | handlers/cluster.py | ClusterHandler | execute_safety_check |
| `prepare_host` | handlers/cluster.py | ClusterHandler | execute_prepare_host |
| `verify_host` | handlers/cluster.py | ClusterHandler | execute_verify_host |
| `rolling_update` | handlers/cluster.py | ClusterHandler | execute_rolling_update |
| **ESXi** |
| `esxi_upgrade` | handlers/esxi_handlers.py | ESXiHandler | execute_esxi_upgrade |
| `esxi_preflight` | handlers/esxi_handlers.py | ESXiHandler | execute_esxi_preflight |
| `esxi_then_firmware` | handlers/esxi_handlers.py | ESXiHandler | execute_esxi_then_firmware |
| `firmware_then_esxi` | handlers/esxi_handlers.py | ESXiHandler | execute_firmware_then_esxi |
| **Console & Media** |
| `console_launch` | handlers/console.py | ConsoleHandler | execute_console_launch |
| `browse_datastore` | handlers/datastore.py | DatastoreHandler | execute_browse_datastore |
| `iso_upload` | handlers/media_upload.py | MediaUploadHandler | execute_iso_upload |
| `scan_local_isos` | handlers/media_upload.py | MediaUploadHandler | execute_scan_local_isos |
| `register_iso_url` | handlers/media_upload.py | MediaUploadHandler | execute_register_iso_url |
| **Identity Management** |
| `idm_authenticate` | handlers/idm.py | IDMHandler | execute_idm_authenticate |
| `idm_test_connection` | handlers/idm.py | IDMHandler | execute_idm_test_connection |
| `idm_sync_users` | handlers/idm.py | IDMHandler | execute_idm_sync |

---

## Handlers Reference

### BaseHandler (handlers/base.py)

All handlers inherit from BaseHandler, which provides common utilities:

```python
class BaseHandler:
    def __init__(self, executor: JobExecutor):
        self.executor = executor
    
    # Logging
    def log(self, message: str): ...
    
    # Job status management
    def mark_job_running(self, job: Dict): ...
    def mark_job_completed(self, job: Dict, details: Dict = None): ...
    def mark_job_failed(self, job: Dict, error: str): ...
    
    # Task management
    def create_task(self, job_id: str, server_id: str = None) -> str: ...
    def update_task_status(self, task_id: str, status: str, progress: int = None): ...
    
    # Error handling
    def handle_error(self, job: Dict, error: Exception, task_id: str = None, context: str = None): ...
    
    # Utilities
    def get_server_by_id(self, server_id: str) -> Dict: ...
```

### Handler Implementation Pattern

```python
class MyHandler(BaseHandler):
    """Handler for my_operation jobs"""
    
    def execute_my_operation(self, job: Dict):
        """Execute my_operation job"""
        self.log(f"Starting my_operation for job {job['id']}")
        self.mark_job_running(job)
        
        try:
            # 1. Extract parameters
            server_id = job['target_scope']['server_ids'][0]
            params = job.get('details', {})
            
            # 2. Get server and credentials
            server = self.get_server_by_id(server_id)
            username, password = self.executor.get_credentials_for_server(server)
            
            # 3. Create task for progress tracking
            task_id = self.create_task(job['id'], server_id=server_id)
            self.update_task_status(task_id, 'running', progress=10)
            
            # 4. Perform operation (with activity logging)
            result = self._perform_operation(server, username, password, params)
            
            # 5. Complete
            self.update_task_status(task_id, 'completed', progress=100)
            self.mark_job_completed(job, details={'result': result})
            
        except Exception as e:
            self.handle_error(job, e, task_id=task_id, context="my_operation")
```

---

## Mixins Reference

### DatabaseMixin (mixins/database.py)

```python
# Job operations
get_pending_jobs() -> List[Dict]        # Poll for pending jobs
update_job_status(job_id, status, details=None)
get_job_by_id(job_id) -> Dict

# Task operations
create_task(job_id, server_id=None, vcenter_host_id=None) -> str
update_task_status(task_id, status, progress=None, log=None)
get_tasks_for_job(job_id) -> List[Dict]

# Activity logging
log_idrac_command(server_id, job_id, endpoint, command_type, ...)
```

### CredentialsMixin (mixins/credentials.py)

```python
# Credential resolution (order: explicit → discovered → IP range → default → env)
get_credentials_for_server(server: Dict) -> Tuple[str, str]
get_esxi_credentials_for_host(host: Dict) -> Tuple[str, str]

# Encryption
get_encryption_key() -> str
decrypt_password(encrypted: str) -> str
```

**Resolution Order:**
1. `servers.credential_set_id` (explicit assignment)
2. `servers.discovered_username` + `servers.discovered_password_encrypted`
3. `credential_ip_ranges` match (by priority)
4. `credential_sets` where `is_default=true` and `credential_type='idrac'`
5. Environment variables: `IDRAC_USER` / `IDRAC_PASSWORD`

### VCenterMixin (mixins/vcenter_ops.py)

```python
# Connection
connect_to_vcenter(vcenter_id: str) -> ServiceInstance
disconnect_vcenter()

# Host operations
get_host_by_name(name: str) -> HostSystem
enter_maintenance_mode(host: HostSystem, timeout: int = 300)
exit_maintenance_mode(host: HostSystem)

# VM operations
migrate_vms_from_host(host: HostSystem)
get_cluster_for_host(host: HostSystem) -> ClusterComputeResource
```

### IdracMixin (mixins/idrac_ops.py)

```python
# Discovery
discover_server(ip: str, username: str, password: str) -> Dict
test_idrac_connection(ip: str, username: str, password: str) -> bool

# Server info
get_server_info(ip: str, username: str, password: str) -> Dict
get_power_state(ip: str, username: str, password: str) -> str
get_health_status(ip: str, username: str, password: str) -> str
```

### ScpMixin (scp.py)

```python
# SCP Operations
export_scp(server_id: str, components: str = "ALL") -> Dict
import_scp(server_id: str, scp_content: str, shutdown_type: str = "Graceful") -> Dict
validate_scp_content(scp_content: str) -> Tuple[bool, str]
```

### ConnectivityMixin (connectivity.py)

```python
# Network testing
test_network_connectivity(ip: str, port: int = 443) -> bool
scan_port_range(ip: str, ports: List[int]) -> Dict[int, bool]
test_prerequisites(server_id: str) -> Dict
```

---

## Dell Redfish API

### DellOperations (dell_redfish/operations.py)

High-level operations for iDRAC management:

```python
from job_executor.dell_redfish.operations import DellOperations

ops = DellOperations(ip_address, username, password)

# Discovery & Health
info = ops.discover_server_info()
health = ops.get_system_health()

# Firmware
inventory = ops.get_firmware_inventory()
result = ops.update_firmware(package_url)

# Power
ops.power_on()
ops.power_off()
ops.power_cycle()
ops.graceful_shutdown()

# SCP
scp_xml = ops.export_scp(components="BIOS,IDRAC")
result = ops.import_scp(scp_content)

# Virtual Media
ops.mount_virtual_media(iso_url)
ops.unmount_virtual_media()
```

### DellRedfishAdapter (dell_redfish/adapter.py)

Lower-level Redfish operations:

```python
from job_executor.dell_redfish.adapter import DellRedfishAdapter

adapter = DellRedfishAdapter(ip_address, username, password)

# Generic operations
response = adapter.get("/redfish/v1/Systems/System.Embedded.1")
response = adapter.post("/redfish/v1/...", body={...})
response = adapter.patch("/redfish/v1/...", body={...})

# System operations
systems = adapter.get_systems()
power_state = adapter.get_power_state("System.Embedded.1")
```

### Canonical Endpoints (dell_redfish/endpoints.py)

```python
REDFISH_ENDPOINTS = {
    'base': '/redfish/v1',
    'systems': '/redfish/v1/Systems',
    'system': '/redfish/v1/Systems/System.Embedded.1',
    'bios': '/redfish/v1/Systems/System.Embedded.1/Bios',
    'boot_options': '/redfish/v1/Systems/System.Embedded.1/BootOptions',
    'firmware_inventory': '/redfish/v1/UpdateService/FirmwareInventory',
    'update_service': '/redfish/v1/UpdateService',
    'managers': '/redfish/v1/Managers',
    'idrac': '/redfish/v1/Managers/iDRAC.Embedded.1',
    'virtual_media': '/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia',
    'event_log': '/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Entries',
    # Dell OEM
    'scp_export': '/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
    'scp_import': '/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration',
}
```

---

## Database Schema

### Core Tables

#### servers
```sql
CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    hostname TEXT,
    ip_address TEXT NOT NULL,
    service_tag TEXT,              -- Dell serial number
    model TEXT,                    -- e.g., "PowerEdge R650"
    bios_version TEXT,
    idrac_version TEXT,
    power_state TEXT,              -- 'On', 'Off'
    health_status TEXT,            -- 'OK', 'Warning', 'Critical'
    connection_status TEXT,        -- 'online', 'offline', 'unknown'
    credential_set_id UUID REFERENCES credential_sets(id),
    discovered_username TEXT,
    discovered_password_encrypted TEXT,
    vcenter_host_id UUID REFERENCES vcenter_hosts(id),
    server_group_id UUID REFERENCES server_groups(id),
    last_discovered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

#### credential_sets
```sql
CREATE TABLE credential_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    credential_type TEXT NOT NULL,  -- 'idrac', 'esxi', 'vcenter'
    username TEXT NOT NULL,
    password_encrypted TEXT,        -- AES-256 encrypted
    is_default BOOLEAN DEFAULT false,
    priority INTEGER DEFAULT 0,
    vcenter_host_id UUID REFERENCES vcenter_hosts(id),
    created_at TIMESTAMP DEFAULT now()
);
```

#### credential_ip_ranges
```sql
CREATE TABLE credential_ip_ranges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_set_id UUID REFERENCES credential_sets(id),
    ip_range TEXT NOT NULL,         -- CIDR or hyphenated range
    priority INTEGER DEFAULT 0,
    description TEXT
);
```

#### jobs
```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    created_by UUID REFERENCES profiles(id),
    target_scope JSONB,             -- { server_ids: [...], cluster_ids: [...] }
    details JSONB,                  -- Job-specific parameters
    credential_set_ids TEXT[],
    firmware_source TEXT,           -- 'local', 'dell_catalog'
    dell_catalog_url TEXT,
    priority TEXT DEFAULT 'normal',
    notes TEXT,
    parent_job_id UUID REFERENCES jobs(id),
    schedule_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);
```

#### job_tasks
```sql
CREATE TABLE job_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id),
    server_id UUID REFERENCES servers(id),
    vcenter_host_id UUID REFERENCES vcenter_hosts(id),
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,     -- 0-100
    log TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);
```

#### idrac_commands
```sql
CREATE TABLE idrac_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES servers(id),
    job_id UUID REFERENCES jobs(id),
    task_id UUID REFERENCES job_tasks(id),
    command_type TEXT NOT NULL,     -- 'GET', 'POST', 'PATCH', 'DELETE'
    operation_type TEXT NOT NULL,   -- 'discovery', 'firmware_update', etc.
    endpoint TEXT NOT NULL,
    full_url TEXT,
    request_body JSONB,
    response_body JSONB,
    request_headers JSONB,
    status_code INTEGER,
    success BOOLEAN DEFAULT false,
    response_time_ms INTEGER,
    error_message TEXT,
    source TEXT,                    -- 'job_executor', 'edge_function'
    initiated_by UUID REFERENCES profiles(id),
    timestamp TIMESTAMP DEFAULT now(),
    created_at TIMESTAMP DEFAULT now()
);
```

#### vcenter_hosts
```sql
CREATE TABLE vcenter_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    ip_address TEXT,
    vcenter_id UUID,
    cluster_name TEXT,
    connection_state TEXT,          -- 'connected', 'disconnected', 'notResponding'
    power_state TEXT,
    in_maintenance_mode BOOLEAN DEFAULT false,
    esxi_version TEXT,
    serial_number TEXT,             -- For linking to servers
    server_id UUID REFERENCES servers(id),
    credential_set_id UUID REFERENCES credential_sets(id),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

---

## Edge Functions

### Key Functions

| Function | Purpose |
|----------|---------|
| `create-job` | Create new job in queue |
| `update-job` | Update job status (used by Job Executor) |
| `encrypt-credentials` | Encrypt passwords |
| `break-glass-authenticate` | Emergency authentication |
| `idm-authenticate` | FreeIPA/LDAP authentication |
| `send-notification` | Send Teams/email notifications |
| `cleanup-old-jobs` | Database maintenance |
| `cleanup-activity-logs` | Log retention |
| `network-diagnostics` | Network testing |
| `vcenter-sync` | vCenter sync orchestration |

### Edge Function Template

```typescript
// supabase/functions/my-function/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    // ... handle request

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

---

## Frontend Patterns

### Job Creation

```typescript
const { mutate: createJob } = useMutation({
  mutationFn: async (params: { serverIds: string[], details?: object }) => {
    const { data, error } = await supabase.functions.invoke('create-job', {
      body: {
        job_type: 'my_operation',
        target_scope: { server_ids: params.serverIds },
        details: params.details,
      },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: (data) => {
    toast.success('Job created');
    // Navigate to job details or poll for updates
  },
});
```

### Job Status Polling

```typescript
const { data: job } = useQuery({
  queryKey: ['job', jobId],
  queryFn: async () => {
    const { data } = await supabase
      .from('jobs')
      .select('*, job_tasks(*)')
      .eq('id', jobId)
      .single();
    return data;
  },
  refetchInterval: (data) => 
    data?.status === 'completed' || data?.status === 'failed' ? false : 3000,
});
```

---

## Deployment

### Job Executor (Linux)

```bash
# Install
sudo ./scripts/deploy-rhel9.sh

# Service management
sudo systemctl start job-executor
sudo systemctl status job-executor
journalctl -u job-executor -f

# Configuration
/etc/job-executor/.env
```

### Job Executor (Windows)

```powershell
# Install
.\scripts\deploy-windows.ps1

# Service management
.\scripts\manage-job-executor.ps1 -Action start
.\scripts\manage-job-executor.ps1 -Action status
```

### Environment Variables

```bash
# Required
DSM_URL=http://127.0.0.1:54321        # Lovable Cloud URL
SERVICE_ROLE_KEY=eyJh...               # Supabase service key

# Optional
IDRAC_USER=root                        # Default iDRAC username
IDRAC_PASSWORD=calvin                  # Default iDRAC password
ISO_DIRECTORY=/var/lib/idrac-manager/isos
FIRMWARE_DIRECTORY=/var/lib/idrac-manager/firmware
MEDIA_SERVER_PORT=8888
MEDIA_SERVER_ENABLED=true
```

---

## Troubleshooting

### Jobs Stuck in 'pending'

1. Check Job Executor is running:
   ```bash
   systemctl status job-executor
   ```

2. Check logs:
   ```bash
   journalctl -u job-executor -f
   ```

3. Verify environment:
   ```bash
   cat /etc/job-executor/.env
   ```

### Connection Failures

1. Test network connectivity:
   ```bash
   curl -k https://192.168.1.100/redfish/v1
   ```

2. Check firewall rules (port 443)

3. Run `test_credentials` job

### Credential Resolution Fails

1. Check credential_set priority ordering
2. Verify IP ranges in `credential_ip_ranges`
3. Check `discovered_password_encrypted` is populated
4. Verify encryption key in `activity_settings`

### Handler Not Found

1. Verify job type is in `handler_map` (job-executor.py)
2. Check handler is imported and instantiated
3. Confirm job type exists in database enum

---

## Technology Stack

### Frontend
- React 18, TypeScript, Tailwind CSS
- shadcn/ui components
- TanStack Query for server state
- React Router for navigation

### Backend
- PostgreSQL (Supabase)
- Edge Functions (Deno)
- Realtime subscriptions

### Job Executor
- Python 3.7+
- requests (HTTP client)
- pyVmomi (vCenter SDK)
- cryptography (AES-256)
- ldap3 (FreeIPA)
- paramiko (SSH)

---

*Document Version: 3.0 | Last Updated: 2025-01-30*
