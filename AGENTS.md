# Dell Server Manager - Agent Instructions

> **Last Updated**: Post-Refactoring (Modular Architecture)  
> **Architecture Version**: 2.0 (Handlers + Mixins Pattern)

This document provides comprehensive guidance for AI agents working on the Dell Server Manager project. It covers architecture, principles, patterns, and implementation details.

---

## Table of Contents

1. [Application Overview](#application-overview)
2. [Critical Architecture Principles](#critical-architecture-principles)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Database Schema](#database-schema)
6. [Job Executor Architecture](#job-executor-architecture)
7. [Handlers Documentation](#handlers-documentation)
8. [Mixins Documentation](#mixins-documentation)
9. [Dell Redfish Layer](#dell-redfish-layer)
10. [ESXi Orchestration](#esxi-orchestration)
11. [Edge Functions](#edge-functions)
12. [Frontend Patterns](#frontend-patterns)
13. [Common Implementation Patterns](#common-implementation-patterns)
14. [Testing & Deployment](#testing--deployment)
15. [Security Considerations](#security-considerations)
16. [Troubleshooting](#troubleshooting)

---

## Application Overview

### What is Dell Server Manager?

Dell Server Manager is an **enterprise-grade application** designed for managing Dell PowerEdge servers via iDRAC Redfish API and VMware vCenter integration. Built specifically for **offline-first, air-gapped environments**.

**Primary Use Case**: Enterprise IT administrators managing Dell infrastructure in secure networks **without internet access**.

**Key Features**:
- Server lifecycle management (discovery, firmware, power, BIOS)
- VMware vCenter integration (host synchronization, cluster safety)
- Maintenance window planning and execution
- SCP backup/restore (Server Configuration Profile)
- ESXi upgrade orchestration
- FreeIPA/LDAP integration for enterprise authentication

**Target Environment**:
- Private networks: `192.168.x.x`, `10.x.x.x`, `172.16.x.x`
- Air-gapped/secure facilities (government, defense, finance)
- No external internet dependencies for core operations

---

## Critical Architecture Principles

### 1. Offline-First Design (NEVER VIOLATE)

**Core Principle**: This application MUST function without internet connectivity.

- ✅ All iDRAC operations use local network HTTP/HTTPS only
- ✅ No external API calls for server management
- ✅ If accessible in a browser, this app CAN and SHOULD manage it
- ❌ NEVER assume cloud connectivity is available
- ❌ NEVER suggest VPNs or cloud access for basic operations

**Network Scope**:
- Local network IPs: `192.168.x.x`, `10.x.x.x`, `172.16.x.x`
- iDRAC endpoints: `https://192.168.1.100/redfish/v1/...`
- vCenter: `vcenter.local.domain` or private IP

---

### 2. Two-Component System (MOST IMPORTANT)

**Job Executor (Python) - PRIMARY for 95% of use cases:**

- ✅ Runs directly on host with full local network access
- ✅ Handles ALL iDRAC operations (firmware, discovery, power, BIOS, SCP)
- ✅ Use job types: `discovery_scan`, `firmware_update`, `power_action`, etc.
- ✅ **Always prefer Job Executor for local/offline deployments**

**Edge Functions (Supabase) - SECONDARY, cloud deployments only:**

- ❌ Cannot reliably reach local IPs from Docker containers
- ❌ Network limitations: Docker NAT prevents local subnet access
- ✅ Used only for: job orchestration, database operations, notifications
- ⚠️ In local mode, defer all iDRAC operations to Job Executor

**When to Use What**:

| Operation Type | Job Executor | Edge Functions |
|----------------|--------------|----------------|
| iDRAC operations (firmware, power, BIOS) | ✅ PRIMARY | ❌ Not reliable |
| vCenter operations (sync, cluster checks) | ✅ PRIMARY | ❌ Not reliable |
| Job orchestration (create jobs, tasks) | ⚠️ Optional | ✅ Yes |
| Database CRUD | ⚠️ Via Supabase client | ✅ Yes |
| Notifications | ❌ No | ✅ Yes |
| Authentication | ✅ FreeIPA/LDAP | ✅ Supabase Auth |

---

### 3. Dell Redfish API Implementation

**ALWAYS follow Dell's official iDRAC-Redfish-Scripting patterns:**

- **Reference**: https://github.com/dell/iDRAC-Redfish-Scripting
- **Reference**: https://developer.dell.com/apis/2978/
- **Canonical endpoints** defined in `job_executor/dell_redfish/endpoints.py`
- **Adapter layer** in `job_executor/dell_redfish/adapter.py`
- **Operations** in `job_executor/dell_redfish/operations.py`
- **Error handling** in `job_executor/dell_redfish/errors.py`
- **OEM actions** use Dell EID_674 schema (SCP export/import)

**Critical Rules**:
- ❌ NEVER implement Redfish endpoints not in the canonical list
- ✅ ALWAYS use `DellRedfishAdapter` for iDRAC operations
- ✅ Log ALL API calls to `idrac_commands` table
- ✅ Handle Dell-specific error codes (see `errors.py`)

---

### 4. Feature Implementation Pattern

**Standard workflow for adding new features:**

1. **Add job type** to database enum (migration)
2. **Implement handler** in `job_executor/handlers/`
3. **Add Dell Redfish operations** in `job_executor/dell_redfish/operations.py`
4. **Add endpoint** to `job_executor/dell_redfish/endpoints.py`
5. **Create UI** to trigger job (React component)
6. **Poll job status** for completion (realtime updates)

**Example: Adding "Clear SEL" feature**

```sql
-- Step 1: Migration
ALTER TYPE job_type ADD VALUE 'clear_sel';
```

```python
# Step 2: Handler (job_executor/handlers/sel.py)
class SELHandler(BaseHandler):
    def execute_clear_sel(self, job: Dict):
        server = self.get_server_by_id(job['target_scope']['server_ids'][0])
        username, password = self.get_server_credentials(server['id'])
        
        # Use Dell Redfish adapter
        response = dell_operations.clear_system_event_log(
            server['ip_address'], username, password
        )
        
        if response['success']:
            self.mark_job_completed(job, {'cleared': True})
        else:
            self.mark_job_failed(job, response['error'])
```

```python
# Step 3: Add to endpoints.py
ENDPOINTS = {
    'clear_sel': '/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Actions/LogService.ClearLog'
}
```

```typescript
// Step 4: UI (React)
const { mutate: clearSEL } = useMutation({
  mutationFn: async (serverId: string) => {
    const { data } = await supabase.functions.invoke('create-job', {
      body: { job_type: 'clear_sel', target_scope: { server_ids: [serverId] } }
    });
    return data;
  }
});
```

---

### 5. Activity Logging (REQUIRED)

**ALL API calls MUST be logged to `idrac_commands` table.**

**Both Edge Functions and Job Executor must log:**

```python
# Python (Job Executor)
self.log_idrac_command(
    server_id=server['id'],
    job_id=job['id'],
    endpoint='/redfish/v1/Systems/System.Embedded.1',
    command_type='GET',
    success=True,
    response_time_ms=245,
    operation_type='discovery'
)
```

```typescript
// TypeScript (Edge Functions)
await logIdracCommand({
  server_id: serverId,
  job_id: jobId,
  endpoint: '/redfish/v1/Systems/System.Embedded.1',
  command_type: 'GET',
  success: true,
  response_time_ms: 245,
  operation_type: 'discovery'
});
```

**Logged Data**:
- Endpoint URL
- Request/response bodies (truncated per settings)
- Response time (ms)
- Success/failure status
- Initiated by (user_id)
- Source (edge_function or job_executor)

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.x | UI framework |
| **TypeScript** | 5.x | Type safety |
| **Tailwind CSS** | 3.x | Styling |
| **shadcn/ui** | Latest | Component library |
| **React Router** | 6.x | Client-side routing |
| **TanStack Query** | 5.x | Server state management |
| **Vite** | 5.x | Build tool |
| **Supabase Client** | 2.x | Backend integration |

### Backend (Supabase)

| Technology | Purpose |
|------------|---------|
| **PostgreSQL** | Relational database |
| **Supabase Auth** | User authentication (optional) |
| **Edge Functions** | Serverless logic (Deno) |
| **Realtime** | WebSocket subscriptions |
| **Storage** | File storage (SCP backups, ISOs) |

### Job Executor

| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.7+ | Core runtime |
| **requests** | 2.x | HTTP client (Redfish API) |
| **pyVmomi** | 8.x | vCenter SDK |
| **cryptography** | Latest | Password encryption |
| **ldap3** | 2.x | FreeIPA/LDAP authentication |

---

## Project Structure

```
dell-server-manager/
├── src/                        # Frontend (React + TypeScript)
│   ├── components/             # React components
│   │   ├── dashboard/          # Dashboard widgets
│   │   ├── servers/            # Server management UI
│   │   ├── vcenter/            # vCenter integration UI
│   │   ├── activity/           # Activity monitoring
│   │   ├── maintenance/        # Maintenance planner
│   │   ├── jobs/               # Job execution UI
│   │   ├── settings/           # Settings panels
│   │   └── ui/                 # shadcn/ui components
│   ├── hooks/                  # Custom React hooks
│   ├── pages/                  # Page components
│   ├── lib/                    # Utilities
│   └── integrations/           # Supabase integration
│
├── supabase/                   # Backend (Supabase)
│   ├── functions/              # Edge Functions (Deno)
│   │   ├── _shared/            # Shared utilities
│   │   ├── create-job/         # Job creation
│   │   ├── vcenter-sync/       # vCenter synchronization
│   │   ├── encrypt-credentials/ # Password encryption
│   │   └── ...                 # Other functions
│   └── migrations/             # Database migrations
│
├── job_executor/               # Job Executor (Python) - MODULAR ARCHITECTURE
│   ├── __init__.py             # Package initialization
│   ├── config.py               # Configuration and environment variables
│   ├── connectivity.py         # ConnectivityMixin - network testing
│   ├── scp.py                  # ScpMixin - SCP backup/restore
│   ├── utils.py                # Utilities (JSON, Unicode handling)
│   ├── ldap_auth.py            # FreeIPA/LDAP authentication
│   ├── media_server.py         # HTTP server for ISOs and firmware
│   │
│   ├── mixins/                 # Shared functionality mixins (6 mixins)
│   │   ├── __init__.py
│   │   ├── database.py         # DatabaseMixin - job/task CRUD
│   │   ├── credentials.py      # CredentialsMixin - password decryption
│   │   ├── vcenter_ops.py      # VCenterMixin - vCenter operations
│   │   └── idrac_ops.py        # IdracMixin - iDRAC server info
│   │
│   ├── handlers/               # Job type handlers (12 specialized handlers)
│   │   ├── __init__.py
│   │   ├── base.py             # BaseHandler - common utilities
│   │   ├── idm.py              # IDMHandler - FreeIPA authentication
│   │   ├── console.py          # ConsoleHandler - console launch
│   │   ├── datastore.py        # DatastoreHandler - datastore browsing
│   │   ├── media_upload.py     # MediaUploadHandler - ISO/firmware upload
│   │   ├── virtual_media.py    # VirtualMediaHandler - ISO mounting
│   │   ├── power.py            # PowerHandler - power control
│   │   ├── boot.py             # BootHandler - BIOS/boot config
│   │   ├── discovery.py        # DiscoveryHandler - network discovery
│   │   ├── firmware.py         # FirmwareHandler - firmware updates
│   │   ├── cluster.py          # ClusterHandler - cluster safety
│   │   ├── esxi_handlers.py    # ESXiHandler - ESXi upgrades
│   │   └── vcenter_handlers.py # VCenterHandlers - vCenter sync
│   │
│   ├── dell_redfish/           # Dell Redfish API layer (Phase 1 implementation)
│   │   ├── __init__.py
│   │   ├── adapter.py          # DellRedfishAdapter - unified interface
│   │   ├── operations.py       # DellOperations - high-level operations
│   │   ├── endpoints.py        # Canonical Dell Redfish endpoints
│   │   ├── errors.py           # Dell-specific error handling
│   │   ├── helpers.py          # Redfish utility functions
│   │   └── lib/                # Future Dell library vendoring (placeholders)
│   │
│   └── esxi/                   # ESXi orchestration
│       ├── __init__.py
│       ├── orchestrator.py     # EsxiOrchestrator - upgrade workflows
│       └── ssh_client.py       # SSH client for ESXi hosts
│
├── scripts/                    # Deployment and utility scripts
│   ├── deploy-rhel9.sh         # RHEL/CentOS deployment
│   ├── deploy-windows.ps1      # Windows deployment
│   ├── manage-job-executor.sh  # systemd service management
│   └── ...                     # Other scripts
│
├── docs/                       # Documentation
│   ├── REDFISH_AUDIT.md        # Dell API compliance tracking
│   ├── BACKUP_GUIDE.md         # SCP backup/restore guide
│   ├── VCENTER_SYNC_GUIDE.md   # vCenter integration guide
│   └── ...                     # Other docs
│
├── job-executor.py             # Main Job Executor script (~800 lines)
├── requirements.txt            # Python dependencies
├── package.json                # Node.js dependencies
├── vite.config.ts              # Vite configuration
└── tailwind.config.ts          # Tailwind CSS configuration
```

---

## Database Schema

### Core Tables

#### `servers`
**Purpose**: Dell server inventory

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `hostname` | TEXT | Server hostname |
| `ip_address` | TEXT | iDRAC IP address |
| `service_tag` | TEXT | Dell service tag (serial number) |
| `model` | TEXT | Server model (e.g., R650) |
| `bios_version` | TEXT | Current BIOS version |
| `idrac_version` | TEXT | Current iDRAC firmware version |
| `power_state` | TEXT | Current power state (On, Off) |
| `health_status` | TEXT | Overall health (OK, Warning, Critical) |
| `vcenter_host_id` | UUID | Linked vCenter host (optional) |
| `credential_set_id` | UUID | Credential set for authentication |
| `discovered_username` | TEXT | Username from discovery scan |
| `discovered_password_encrypted` | TEXT | Encrypted password from discovery |
| `last_discovered_at` | TIMESTAMP | Last discovery scan timestamp |
| `created_at` | TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Important Notes**:
- Service tag auto-links to `vcenter_hosts` when matched
- Credentials resolved in order: explicit → discovered → IP range → default
- Health status updated via `health_check` job type

---

#### `vcenter_hosts`
**Purpose**: VMware ESXi hosts from vCenter

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vcenter_id` | UUID | Parent vCenter connection |
| `name` | TEXT | ESXi hostname |
| `ip_address` | TEXT | ESXi management IP |
| `serial_number` | TEXT | Hardware serial number (for linking) |
| `esxi_version` | TEXT | ESXi version (e.g., 8.0.2) |
| `cluster` | TEXT | vCenter cluster name |
| `connection_state` | TEXT | Connected, Disconnected, NotResponding |
| `power_state` | TEXT | PoweredOn, PoweredOff, Standby |
| `in_maintenance_mode` | BOOLEAN | Maintenance mode status |
| `server_id` | UUID | Linked Dell server (optional) |
| `credential_set_id` | UUID | SSH credentials for ESXi |
| `created_at` | TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMP | Last sync timestamp |

**Important Notes**:
- Auto-linked to `servers` via `serial_number` = `service_tag`
- Credential resolution: explicit → vCenter-specific → IP range → default ESXi
- Updated via `vcenter_sync` job type

---

#### `credential_sets`
**Purpose**: Authentication credentials for servers and ESXi hosts

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Credential set name |
| `credential_type` | ENUM | `idrac`, `esxi`, `vcenter` |
| `username` | TEXT | Username (plaintext) |
| `password_encrypted` | TEXT | AES-256 encrypted password |
| `is_default` | BOOLEAN | Default for credential type |
| `priority` | INTEGER | Resolution priority (higher = preferred) |
| `vcenter_host_id` | UUID | Specific vCenter host (optional) |
| `created_at` | TIMESTAMP | Record creation timestamp |

**Important Notes**:
- Passwords encrypted using AES-256 (key in `activity_settings.encryption_key`)
- Decryption via `decrypt_password()` RPC function
- See "Credential Resolution" pattern below

---

#### `credential_ip_ranges`
**Purpose**: Map credential sets to IP ranges (CIDR or hyphenated)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `credential_set_id` | UUID | Parent credential set |
| `ip_range` | TEXT | IP range (e.g., `192.168.1.0/24`, `10.0.0.10-10.0.0.20`) |
| `priority` | INTEGER | Resolution priority within range |
| `description` | TEXT | Human-readable description |

**Important Notes**:
- Supports CIDR notation: `192.168.1.0/24`
- Supports hyphenated ranges: `192.168.1.100-192.168.1.200`
- Used when no explicit credential set assigned

---

#### `jobs`
**Purpose**: Asynchronous operations (firmware updates, power actions, etc.)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `job_type` | ENUM | Type of job (see Job Types below) |
| `status` | ENUM | `pending`, `running`, `completed`, `failed`, `cancelled` |
| `created_by` | UUID | User who created job |
| `target_scope` | JSONB | Target servers, clusters, groups |
| `details` | JSONB | Job-specific configuration and results |
| `parent_job_id` | UUID | Parent job for sub-jobs (optional) |
| `firmware_source` | TEXT | `local`, `dell_catalog`, `url` |
| `credential_set_ids` | UUID[] | Credential sets to try |
| `schedule_at` | TIMESTAMP | Scheduled execution time (optional) |
| `created_at` | TIMESTAMP | Job creation timestamp |
| `started_at` | TIMESTAMP | Job start timestamp |
| `completed_at` | TIMESTAMP | Job completion timestamp |

**Important Notes**:
- Job Executor polls `status = 'pending'` every 10 seconds
- `target_scope` structure: `{ server_ids: [...], server_group_ids: [...], cluster_ids: [...] }`
- Parent-child jobs for complex workflows (e.g., rolling cluster updates)

---

#### `job_tasks`
**Purpose**: Individual tasks within a job (one per server/host)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `job_id` | UUID | Parent job |
| `server_id` | UUID | Target Dell server (optional) |
| `vcenter_host_id` | UUID | Target ESXi host (optional) |
| `status` | ENUM | `pending`, `running`, `completed`, `failed` |
| `progress` | INTEGER | Progress percentage (0-100) |
| `log` | TEXT | Task execution log |
| `started_at` | TIMESTAMP | Task start timestamp |
| `completed_at` | TIMESTAMP | Task completion timestamp |

**Important Notes**:
- Created automatically by Job Executor for multi-server jobs
- Progress updated in real-time for UI
- Logs streamed to `idrac_commands` table

---

#### `idrac_commands`
**Purpose**: Activity log for all iDRAC API calls

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `server_id` | UUID | Target server |
| `job_id` | UUID | Related job (optional) |
| `task_id` | UUID | Related task (optional) |
| `endpoint` | TEXT | Redfish endpoint path |
| `command_type` | TEXT | HTTP method (GET, POST, PATCH, DELETE) |
| `operation_type` | ENUM | `discovery`, `firmware`, `power`, `bios`, etc. |
| `full_url` | TEXT | Complete URL |
| `request_body` | JSONB | Request payload (truncated per settings) |
| `response_body` | JSONB | Response payload (truncated per settings) |
| `success` | BOOLEAN | Operation success status |
| `status_code` | INTEGER | HTTP status code |
| `response_time_ms` | INTEGER | Response time in milliseconds |
| `error_message` | TEXT | Error details (if failed) |
| `source` | TEXT | `edge_function` or `job_executor` |
| `initiated_by` | UUID | User who initiated operation |
| `timestamp` | TIMESTAMP | Command execution timestamp |

**Important Notes**:
- REQUIRED for ALL iDRAC operations
- Auto-cleanup per `activity_settings.log_retention_days`
- Used for auditing and troubleshooting

---

#### `maintenance_windows`
**Purpose**: Scheduled maintenance operations

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `title` | TEXT | Maintenance window title |
| `maintenance_type` | TEXT | `firmware`, `esxi_upgrade`, `patch`, `reboot` |
| `planned_start` | TIMESTAMP | Start time |
| `planned_end` | TIMESTAMP | End time |
| `status` | TEXT | `planned`, `in_progress`, `completed`, `failed` |
| `server_ids` | UUID[] | Target servers |
| `cluster_ids` | TEXT[] | Target vCenter clusters |
| `credential_set_ids` | UUID[] | Credentials to use |
| `auto_execute` | BOOLEAN | Auto-execute at scheduled time |
| `recurrence_enabled` | BOOLEAN | Enable recurrence |
| `recurrence_pattern` | TEXT | Cron expression |
| `created_by` | UUID | User who created window |
| `created_at` | TIMESTAMP | Record creation timestamp |

**Important Notes**:
- Executes via `execute-maintenance-windows` edge function (cron trigger)
- Cluster safety checks before execution
- Supports recurrence patterns (daily, weekly, monthly)

---

### Job Types (ENUM)

**32 total job types supported**:

| Job Type | Handler | Description |
|----------|---------|-------------|
| `discovery_scan` | DiscoveryHandler | Scan IP ranges for iDRAC servers |
| `test_credentials` | DiscoveryHandler | Test credential sets on servers |
| `health_check` | DiscoveryHandler | Fetch server health status |
| `fetch_event_logs` | DiscoveryHandler | Retrieve System Event Logs (SEL) |
| `firmware_update` | FirmwareHandler | Update single firmware component |
| `full_server_update` | FirmwareHandler | Update all server firmware |
| `power_action` | PowerHandler | Power on/off/reset servers |
| `boot_configuration` | BootHandler | Configure boot order |
| `bios_config_read` | BootHandler | Read BIOS configuration |
| `bios_config_write` | BootHandler | Write BIOS configuration |
| `scp_export` | BaseHandler | Export Server Configuration Profile |
| `scp_import` | BaseHandler | Import Server Configuration Profile |
| `virtual_media_mount` | VirtualMediaHandler | Mount ISO via virtual media |
| `virtual_media_unmount` | VirtualMediaHandler | Unmount virtual media |
| `iso_upload` | MediaUploadHandler | Upload ISO to local media server |
| `scan_local_isos` | MediaUploadHandler | Scan for ISOs in configured directory |
| `register_iso_url` | MediaUploadHandler | Register ISO from URL |
| `console_launch` | ConsoleHandler | Launch iDRAC KVM console |
| `vcenter_sync` | VCenterHandlers | Sync ESXi hosts from vCenter |
| `openmanage_sync` | VCenterHandlers | Sync from Dell OpenManage |
| `browse_datastore` | DatastoreHandler | Browse vCenter datastore files |
| `esxi_upgrade` | ESXiHandler | Upgrade ESXi version |
| `esxi_then_firmware` | ESXiHandler | ESXi upgrade → firmware update |
| `firmware_then_esxi` | ESXiHandler | Firmware update → ESXi upgrade |
| `esxi_preflight` | ESXiHandler | Pre-flight checks for ESXi upgrade |
| `prepare_host` | ClusterHandler | Prepare host for maintenance |
| `verify_host` | ClusterHandler | Verify host post-maintenance |
| `rolling_update` | ClusterHandler | Rolling cluster firmware update |
| `cluster_safety_check` | ClusterHandler | Check cluster health/safety |
| `idm_authenticate` | IDMHandler | FreeIPA/LDAP authentication |
| `idm_test_connection` | IDMHandler | Test IDM connectivity |
| `idm_sync_users` | IDMHandler | Sync IDM users to profiles |

---

## Job Executor Architecture

### Overview

The Job Executor is a **Python daemon** that runs on the local network with access to iDRAC and vCenter. It polls the Supabase database for pending jobs and executes them using specialized handlers.

**Refactoring Achievement**:
- **Before**: Monolithic `job-executor.py` (~9,900 lines)
- **After**: Modular architecture (~800 lines main script + handlers + mixins)
- **Reduction**: 92% smaller main script
- **Maintainability**: 12 specialized handlers, 6 reusable mixins

---

### Class Structure

```python
class JobExecutor(
    DatabaseMixin,      # Job/task CRUD operations
    CredentialsMixin,   # Password decryption, credential resolution
    VCenterMixin,       # vCenter connection and host operations
    ScpMixin,           # SCP export/import
    ConnectivityMixin,  # Network testing, port scanning
    IdracMixin          # iDRAC server info, discovery, health
):
    """Main Job Executor with handler delegation."""
    
    def __init__(self):
        self.handlers = {
            'idm': IDMHandler(self),
            'console': ConsoleHandler(self),
            'datastore': DatastoreHandler(self),
            'media_upload': MediaUploadHandler(self),
            'virtual_media': VirtualMediaHandler(self),
            'power': PowerHandler(self),
            'boot': BootHandler(self),
            'discovery': DiscoveryHandler(self),
            'firmware': FirmwareHandler(self),
            'cluster': ClusterHandler(self),
            'esxi': ESXiHandler(self),
            'vcenter': VCenterHandlers(self)
        }
    
    def execute_job(self, job: Dict):
        """Route job to appropriate handler based on job_type."""
        job_type = job['job_type']
        
        # Handler routing map
        handler_map = {
            'idm_authenticate': self.handlers['idm'].execute_idm_authenticate,
            'console_launch': self.handlers['console'].execute_console_launch,
            'discovery_scan': self.handlers['discovery'].execute_discovery_scan,
            'firmware_update': self.handlers['firmware'].execute_firmware_update,
            # ... 32 job types total
        }
        
        handler_func = handler_map.get(job_type)
        if handler_func:
            handler_func(job)
        else:
            self.mark_job_failed(job, f"Unknown job type: {job_type}")
```

---

### Execution Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Job Executor Main Loop                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Poll every 10 seconds
                              ▼
                  ┌──────────────────────┐
                  │  get_pending_jobs()  │ ◄─── DatabaseMixin
                  └──────────────────────┘
                              │
                              │ Jobs found?
                              ▼
                  ┌──────────────────────┐
                  │   execute_job()      │
                  └──────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │   Route by job_type   │
                  └───────────┬───────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐      ┌──────────────┐
│   Handler A  │    │   Handler B  │      │   Handler C  │
│ (Discovery)  │    │ (Firmware)   │ ...  │  (Cluster)   │
└──────────────┘    └──────────────┘      └──────────────┘
        │                     │                     │
        │    Use mixins for common operations:     │
        │    - DatabaseMixin: update_job_status()   │
        │    - CredentialsMixin: get_credentials()  │
        │    - IdracMixin: get_server_info()        │
        │    - VCenterMixin: connect_vcenter()      │
        └─────────────────────┬─────────────────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │  Dell Redfish Layer  │
                  │  (DellRedfishAdapter)│
                  └──────────────────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │   iDRAC Redfish API  │
                  │ (HTTP/HTTPS requests)│
                  └──────────────────────┘
```

---

### Handler Delegation Pattern

**Core Concept**: Each handler is a specialized class that handles a specific category of operations.

```python
# Base handler provides common utilities
class BaseHandler:
    def __init__(self, executor):
        self.executor = executor  # Access to all mixins
    
    def mark_job_running(self, job: Dict):
        """Mark job as running."""
        self.executor.update_job_status(job['id'], 'running')
    
    def mark_job_completed(self, job: Dict, details: Dict = None):
        """Mark job as completed with results."""
        self.executor.update_job_status(job['id'], 'completed', details=details)
    
    def mark_job_failed(self, job: Dict, error: str):
        """Mark job as failed with error message."""
        self.executor.update_job_status(job['id'], 'failed', error=error)

# Specialized handler example
class FirmwareHandler(BaseHandler):
    def execute_firmware_update(self, job: Dict):
        """Execute firmware update job."""
        self.mark_job_running(job)
        
        try:
            # Get server and credentials
            server_id = job['target_scope']['server_ids'][0]
            server = self.executor.get_server_by_id(server_id)
            username, password = self.executor.get_server_credentials(server_id)
            
            # Use Dell Redfish adapter
            from job_executor.dell_redfish.operations import dell_operations
            
            result = dell_operations.update_firmware(
                ip_address=server['ip_address'],
                username=username,
                password=password,
                firmware_file_path=job['details']['firmware_file_path']
            )
            
            if result['success']:
                self.mark_job_completed(job, details=result)
            else:
                self.mark_job_failed(job, result['error'])
        
        except Exception as e:
            self.mark_job_failed(job, str(e))
```

---

### Handler Map (Complete Reference)

| Job Type | Handler File | Handler Method | Lines |
|----------|--------------|----------------|-------|
| `idm_authenticate` | `handlers/idm.py` | `execute_idm_authenticate` | ~150 |
| `idm_test_connection` | `handlers/idm.py` | `execute_idm_test_connection` | ~150 |
| `idm_sync_users` | `handlers/idm.py` | `execute_idm_sync_users` | ~150 |
| `console_launch` | `handlers/console.py` | `execute_console_launch` | ~80 |
| `browse_datastore` | `handlers/datastore.py` | `execute_browse_datastore` | ~120 |
| `iso_upload` | `handlers/media_upload.py` | `execute_iso_upload` | ~250 |
| `scan_local_isos` | `handlers/media_upload.py` | `execute_scan_local_isos` | ~250 |
| `register_iso_url` | `handlers/media_upload.py` | `execute_register_iso_url` | ~250 |
| `virtual_media_mount` | `handlers/virtual_media.py` | `execute_virtual_media_mount` | ~120 |
| `virtual_media_unmount` | `handlers/virtual_media.py` | `execute_virtual_media_unmount` | ~120 |
| `power_action` | `handlers/power.py` | `execute_power_action` | ~170 |
| `boot_configuration` | `handlers/boot.py` | `execute_boot_configuration` | ~360 |
| `bios_config_read` | `handlers/boot.py` | `execute_bios_config_read` | ~360 |
| `bios_config_write` | `handlers/boot.py` | `execute_bios_config_write` | ~360 |
| `discovery_scan` | `handlers/discovery.py` | `execute_discovery_scan` | ~550 |
| `test_credentials` | `handlers/discovery.py` | `execute_test_credentials` | ~550 |
| `health_check` | `handlers/discovery.py` | `execute_health_check` | ~550 |
| `fetch_event_logs` | `handlers/discovery.py` | `execute_fetch_event_logs` | ~550 |
| `firmware_update` | `handlers/firmware.py` | `execute_firmware_update` | ~320 |
| `full_server_update` | `handlers/firmware.py` | `execute_full_server_update` | ~320 |
| `prepare_host` | `handlers/cluster.py` | `execute_prepare_host` | ~400 |
| `verify_host` | `handlers/cluster.py` | `execute_verify_host` | ~400 |
| `rolling_update` | `handlers/cluster.py` | `execute_rolling_update` | ~400 |
| `cluster_safety_check` | `handlers/cluster.py` | `execute_cluster_safety_check` | ~400 |
| `esxi_upgrade` | `handlers/esxi_handlers.py` | `execute_esxi_upgrade` | ~350 |
| `esxi_then_firmware` | `handlers/esxi_handlers.py` | `execute_esxi_then_firmware` | ~350 |
| `firmware_then_esxi` | `handlers/esxi_handlers.py` | `execute_firmware_then_esxi` | ~350 |
| `esxi_preflight` | `handlers/esxi_handlers.py` | `execute_esxi_preflight` | ~350 |
| `vcenter_sync` | `handlers/vcenter_handlers.py` | `execute_vcenter_sync` | ~650 |
| `openmanage_sync` | `handlers/vcenter_handlers.py` | `execute_openmanage_sync` | ~650 |
| `scp_export` | `job-executor.py` (legacy) | `execute_scp_export` | ~100 |
| `scp_import` | `job-executor.py` (legacy) | `execute_scp_import` | ~100 |

**Note**: SCP operations still in main script, will be moved to `handlers/scp.py` in future refactor.

---

## Handlers Documentation

### 1. IDMHandler (`handlers/idm.py`)

**Purpose**: FreeIPA/LDAP authentication and user synchronization.

**Job Types**:
- `idm_authenticate` - Authenticate user against FreeIPA/LDAP
- `idm_test_connection` - Test IDM connectivity and bind credentials
- `idm_sync_users` - Sync IDM users to `profiles` table

**Key Methods**:
```python
class IDMHandler(BaseHandler):
    def execute_idm_authenticate(self, job: Dict):
        """Authenticate user against FreeIPA/LDAP."""
        # Get IDM settings from database
        # Connect to LDAP server
        # Authenticate user with provided credentials
        # Map user groups to application roles
        # Create/update profile and auth session
        
    def execute_idm_test_connection(self, job: Dict):
        """Test IDM connectivity."""
        # Get IDM settings
        # Test LDAP connection with bind credentials
        # Return connection status and diagnostics
        
    def execute_idm_sync_users(self, job: Dict):
        """Sync users from IDM to profiles table."""
        # Connect to LDAP
        # Search for users in configured base DN
        # Create/update profiles with IDM attributes
        # Map groups to roles
```

**Dependencies**:
- `ldap3` library for LDAP operations
- `idm_settings` table for configuration
- `idm_auth_sessions` table for session management

**Example Usage**:
```python
# Job creation (Edge Function or UI)
job = {
    'job_type': 'idm_authenticate',
    'details': {
        'username': 'jdoe',
        'password': 'SecurePassword123',
        'ip_address': '192.168.1.100'
    }
}
```

---

### 2. ConsoleHandler (`handlers/console.py`)

**Purpose**: Launch iDRAC KVM console sessions.

**Job Types**:
- `console_launch` - Generate KVM console URL

**Key Methods**:
```python
class ConsoleHandler(BaseHandler):
    def execute_console_launch(self, job: Dict):
        """Launch iDRAC console session."""
        # Get server and credentials
        # Call Dell Redfish API to get KVM launch info
        # Return console URL and connection details
```

**Dell Redfish Endpoint**:
- `GET /redfish/v1/Managers/iDRAC.Embedded.1`
- Extract `GraphicalConsole` link

**Example Usage**:
```typescript
// React component
const { mutate: launchConsole } = useMutation({
  mutationFn: async (serverId: string) => {
    const { data } = await supabase.functions.invoke('create-job', {
      body: { job_type: 'console_launch', target_scope: { server_ids: [serverId] } }
    });
    return data;
  }
});
```

---

### 3. DatastoreHandler (`handlers/datastore.py`)

**Purpose**: Browse VMware datastore files (for ESXi upgrade bundles).

**Job Types**:
- `browse_datastore` - List files in vCenter datastore

**Key Methods**:
```python
class DatastoreHandler(BaseHandler):
    def execute_browse_datastore(self, job: Dict):
        """Browse vCenter datastore for files."""
        # Connect to vCenter (VCenterMixin)
        # Get datastore object
        # Search for files matching pattern (e.g., *.zip, *.iso)
        # Return file list with paths and sizes
```

**VCenterMixin Usage**:
```python
vcenter_conn = self.executor.connect_vcenter(vcenter_id)
content = vcenter_conn.RetrieveContent()
datastore = self._find_datastore(content, datastore_name)
files = self._search_datastore(datastore, file_pattern)
```

---

### 4. MediaUploadHandler (`handlers/media_upload.py`)

**Purpose**: Manage ISO images and firmware packages for local media server.

**Job Types**:
- `iso_upload` - Upload ISO to local media server
- `scan_local_isos` - Scan configured directory for ISOs
- `register_iso_url` - Register ISO from external URL

**Key Methods**:
```python
class MediaUploadHandler(BaseHandler):
    def execute_iso_upload(self, job: Dict):
        """Upload ISO to media server."""
        # Get file from job details (base64 or file path)
        # Save to ISO_DIRECTORY (from config.py)
        # Calculate checksum (SHA256)
        # Create iso_images record
        # Generate served_url (http://media-server:8888/isos/filename.iso)
        
    def execute_scan_local_isos(self, job: Dict):
        """Scan ISO directory and register found ISOs."""
        # Read ISO_DIRECTORY
        # Get file sizes and checksums
        # Create iso_images records for new files
        # Update served_url for all
        
    def execute_register_iso_url(self, job: Dict):
        """Register ISO from external URL."""
        # Validate URL accessibility
        # Get file size via HEAD request
        # Create iso_images record with source_url
        # Set source_type = 'url'
```

**Configuration** (`config.py`):
```python
ISO_DIRECTORY = os.getenv("ISO_DIRECTORY", "/var/lib/idrac-manager/isos")
MEDIA_SERVER_PORT = int(os.getenv("MEDIA_SERVER_PORT", "8888"))
ISO_MAX_STORAGE_GB = int(os.getenv("ISO_MAX_STORAGE_GB", "100"))
```

---

### 5. VirtualMediaHandler (`handlers/virtual_media.py`)

**Purpose**: Mount/unmount ISO images via iDRAC virtual media.

**Job Types**:
- `virtual_media_mount` - Mount ISO to server
- `virtual_media_unmount` - Unmount virtual media

**Key Methods**:
```python
class VirtualMediaHandler(BaseHandler):
    def execute_virtual_media_mount(self, job: Dict):
        """Mount ISO via iDRAC virtual media."""
        # Get server and ISO details
        # Get credentials
        # Call Dell Redfish API to insert media
        # Endpoint: POST /redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.InsertMedia
        # Payload: { "Image": "http://media-server:8888/isos/esxi.iso" }
        
    def execute_virtual_media_unmount(self, job: Dict):
        """Unmount virtual media."""
        # Call Dell Redfish API to eject media
        # Endpoint: POST /redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.EjectMedia
```

**Dell Redfish Operations**:
```python
# Mount
response = dell_operations.insert_virtual_media(
    ip_address, username, password,
    image_url="http://192.168.1.50:8888/isos/esxi-8.0.iso"
)

# Unmount
response = dell_operations.eject_virtual_media(
    ip_address, username, password
)
```

---

### 6. PowerHandler (`handlers/power.py`)

**Purpose**: Control server power state (on, off, reset, graceful shutdown).

**Job Types**:
- `power_action` - Power on/off/reset/graceful shutdown

**Key Methods**:
```python
class PowerHandler(BaseHandler):
    def execute_power_action(self, job: Dict):
        """Execute power action on server."""
        # Get server and credentials
        # Determine action: On, ForceOff, GracefulShutdown, ForceRestart
        # Call Dell Redfish API
        # Endpoint: POST /redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset
        # Payload: { "ResetType": "On" }
```

**Supported Actions**:
| Action | Dell Redfish ResetType | Description |
|--------|------------------------|-------------|
| `on` | `On` | Power on server |
| `off` | `ForceOff` | Immediate power off |
| `graceful_shutdown` | `GracefulShutdown` | Graceful OS shutdown |
| `reset` | `ForceRestart` | Hard reset |
| `nmi` | `Nmi` | Non-maskable interrupt |

---

### 7. BootHandler (`handlers/boot.py`)

**Purpose**: Configure boot order and BIOS settings.

**Job Types**:
- `boot_configuration` - Set boot order (one-time or persistent)
- `bios_config_read` - Read current BIOS settings
- `bios_config_write` - Write BIOS settings

**Key Methods**:
```python
class BootHandler(BaseHandler):
    def execute_boot_configuration(self, job: Dict):
        """Configure boot order."""
        # Get server and boot settings from job details
        # Call Dell Redfish API
        # Endpoint: PATCH /redfish/v1/Systems/System.Embedded.1
        # Payload: { "Boot": { "BootSourceOverrideTarget": "Pxe" } }
        
    def execute_bios_config_read(self, job: Dict):
        """Read BIOS configuration."""
        # Call Dell Redfish API
        # Endpoint: GET /redfish/v1/Systems/System.Embedded.1/Bios
        # Store in bios_configurations table
        
    def execute_bios_config_write(self, job: Dict):
        """Write BIOS configuration."""
        # Get desired BIOS attributes from job details
        # Call Dell Redfish API
        # Endpoint: PATCH /redfish/v1/Systems/System.Embedded.1/Bios/Settings
        # Create configuration job
        # Reboot server to apply
```

**Boot Options**:
- `Pxe` - Network boot (PXE)
- `Hdd` - Hard drive
- `Cd` - Virtual CD/DVD
- `UefiTarget` - UEFI boot target

---

### 8. DiscoveryHandler (`handlers/discovery.py`)

**Purpose**: Network discovery, credential testing, health checks, event logs.

**Job Types**:
- `discovery_scan` - Scan IP ranges for iDRAC servers
- `test_credentials` - Test credential sets on servers
- `health_check` - Fetch server health status
- `fetch_event_logs` - Retrieve System Event Logs (SEL)

**Key Methods**:
```python
class DiscoveryHandler(BaseHandler):
    def execute_discovery_scan(self, job: Dict):
        """Scan IP ranges for iDRAC servers."""
        # Parse IP ranges from job details
        # For each IP:
        #   - Test port 443 connectivity
        #   - Try credential sets in priority order
        #   - Call /redfish/v1/Systems/System.Embedded.1
        #   - Extract service tag, model, versions
        #   - Create/update servers record
        
    def execute_test_credentials(self, job: Dict):
        """Test credential sets on existing servers."""
        # For each server:
        #   - Try each credential set
        #   - Attempt Redfish authentication
        #   - Log success/failure
        #   - Update server with working credentials
        
    def execute_health_check(self, job: Dict):
        """Fetch server health status."""
        # Call Dell Redfish API
        # Endpoint: GET /redfish/v1/Systems/System.Embedded.1
        # Extract: PowerState, Health, HealthRollup
        # Update servers.health_status, power_state
        
    def execute_fetch_event_logs(self, job: Dict):
        """Retrieve System Event Logs."""
        # Call Dell Redfish API
        # Endpoint: GET /redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Entries
        # Parse log entries
        # Store in job details
```

**Discovery Flow**:
```
IP Range: 192.168.1.100-192.168.1.150
    │
    ├─ Test port 443 (HTTPS)
    │   ├─ Reachable? → Try credentials
    │   └─ Unreachable? → Skip
    │
    ├─ Try credential sets (priority order)
    │   ├─ Credential Set A (priority 10)
    │   ├─ Credential Set B (priority 5)
    │   └─ Default credentials
    │
    ├─ Fetch server info
    │   ├─ GET /redfish/v1/Systems/System.Embedded.1
    │   ├─ Extract: service_tag, model, bios_version, idrac_version
    │   └─ Store discovered credentials
    │
    └─ Create/update servers record
        └─ Auto-link to vcenter_hosts if service_tag matches
```

---

### 9. FirmwareHandler (`handlers/firmware.py`)

**Purpose**: Firmware updates (single component or full server).

**Job Types**:
- `firmware_update` - Update single firmware component
- `full_server_update` - Update all server firmware

**Key Methods**:
```python
class FirmwareHandler(BaseHandler):
    def execute_firmware_update(self, job: Dict):
        """Update single firmware component."""
        # Get server and firmware package details
        # Determine firmware source (local, dell_catalog, url)
        # Call Dell Redfish API for firmware upload
        # Endpoint: POST /redfish/v1/UpdateService/MultipartUpload
        # Monitor job status via JobService
        # Reboot if required
        
    def execute_full_server_update(self, job: Dict):
        """Update all server firmware."""
        # Get current firmware inventory
        # Compare with available updates
        # Create sub-jobs for each component
        # Update in order: iDRAC → BIOS → RAID → NIC → Drives
```

**Firmware Update Flow**:
```
1. Upload firmware file (multipart/form-data)
   POST /redfish/v1/UpdateService/MultipartUpload
   
2. Create update job
   Response: { "JobId": "JID_123456789" }
   
3. Monitor job status
   GET /redfish/v1/Managers/iDRAC.Embedded.1/Jobs/JID_123456789
   
4. Reboot if required
   POST /redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset
   
5. Wait for completion
   Poll job status until "Completed"
```

---

### 10. ClusterHandler (`handlers/cluster.py`)

**Purpose**: Cluster-aware operations (rolling updates, safety checks).

**Job Types**:
- `prepare_host` - Enter maintenance mode, evacuate VMs
- `verify_host` - Exit maintenance mode, verify health
- `rolling_update` - Rolling firmware update across cluster
- `cluster_safety_check` - Check cluster health and capacity

**Key Methods**:
```python
class ClusterHandler(BaseHandler):
    def execute_prepare_host(self, job: Dict):
        """Prepare host for maintenance."""
        # Connect to vCenter
        # Put host in maintenance mode
        # Wait for VMs to evacuate (DRS)
        # Verify host is in maintenance mode
        
    def execute_verify_host(self, job: Dict):
        """Verify host after maintenance."""
        # Exit maintenance mode
        # Wait for host to reconnect
        # Verify health status
        # Check VM distribution
        
    def execute_rolling_update(self, job: Dict):
        """Rolling firmware update across cluster."""
        # Get cluster hosts
        # For each host (sequential):
        #   1. Safety check (ensure N-1 healthy hosts)
        #   2. Prepare host (maintenance mode)
        #   3. Firmware update
        #   4. Verify host
        #   5. Wait for cluster rebalance
        
    def execute_cluster_safety_check(self, job: Dict):
        """Check cluster safety before operations."""
        # Get cluster hosts from vCenter
        # Count healthy hosts
        # Calculate minimum required (N-1 for HA)
        # Check DRS status
        # Store results in cluster_safety_checks table
```

**Cluster Safety Logic**:
```python
# Example: 5-host cluster
total_hosts = 5
healthy_hosts = 4  # One host in maintenance mode
min_required = total_hosts - 1  # 4 (HA requires N-1)

safe_to_proceed = (healthy_hosts >= min_required)
# Result: True (4 >= 4)
```

---

### 11. ESXiHandler (`handlers/esxi_handlers.py`)

**Purpose**: ESXi upgrade orchestration via SSH.

**Job Types**:
- `esxi_upgrade` - Upgrade ESXi version
- `esxi_then_firmware` - ESXi upgrade → firmware update
- `firmware_then_esxi` - Firmware update → ESXi upgrade
- `esxi_preflight` - Pre-flight checks for ESXi upgrade

**Key Methods**:
```python
class ESXiHandler(BaseHandler):
    def execute_esxi_upgrade(self, job: Dict):
        """Execute ESXi upgrade via SSH."""
        # Get ESXi host and credentials
        # Get upgrade profile (bundle path, target version)
        # Connect via SSH (ESXiOrchestrator)
        # Put host in maintenance mode
        # Execute upgrade command:
        #   esxcli software profile update -p ESXi-8.0.2 -d /vmfs/volumes/datastore1/esxi-bundle.zip
        # Reboot host
        # Wait for host to come back online
        # Verify new version
        # Exit maintenance mode
        
    def execute_esxi_preflight(self, job: Dict):
        """Pre-flight checks for ESXi upgrade."""
        # Check current version
        # Check bundle compatibility
        # Check free space on datastore
        # Check VIB acceptance level
        # Check hardware compatibility
```

**ESXi Upgrade Workflow**:
```
1. Pre-flight checks
   - Current version: 7.0.3
   - Target version: 8.0.2
   - Bundle path: /vmfs/volumes/datastore1/VMware-ESXi-8.0.2-bundle.zip
   
2. Prepare host
   - Put in maintenance mode
   - Evacuate VMs (DRS/vMotion)
   
3. Execute upgrade
   SSH: esxcli software profile update -p ESXi-8.0.2-standard -d /vmfs/volumes/datastore1/VMware-ESXi-8.0.2-bundle.zip
   
4. Reboot
   SSH: reboot
   
5. Verify
   - Wait for SSH connectivity
   - Check version: esxcli system version get
   - Verify health
   
6. Exit maintenance mode
   - vCenter API: ExitMaintenanceMode()
```

---

### 12. VCenterHandlers (`handlers/vcenter_handlers.py`)

**Purpose**: Synchronize ESXi hosts from vCenter and Dell OpenManage.

**Job Types**:
- `vcenter_sync` - Sync ESXi hosts from vCenter
- `openmanage_sync` - Sync servers from Dell OpenManage

**Key Methods**:
```python
class VCenterHandlers(BaseHandler):
    def execute_vcenter_sync(self, job: Dict):
        """Sync ESXi hosts from vCenter."""
        # Get vCenter connection details
        # Connect via pyVmomi
        # Retrieve all ESXi hosts
        # For each host:
        #   - Extract: name, IP, serial, version, cluster, state
        #   - Create/update vcenter_hosts record
        #   - Auto-link to servers via serial_number
        
    def execute_openmanage_sync(self, job: Dict):
        """Sync servers from Dell OpenManage."""
        # Get OpenManage settings
        # Call OpenManage REST API
        # Endpoint: /api/DeviceService/Devices
        # For each device:
        #   - Extract: service_tag, model, IP, versions
        #   - Create/update servers record
```

---

## Mixins Documentation

### 1. DatabaseMixin (`mixins/database.py`)

**Purpose**: Database operations for jobs and tasks.

**Key Methods**:

```python
class DatabaseMixin:
    def get_pending_jobs(self, instant_only=False, exclude_instant=False) -> List[Dict]:
        """Fetch pending jobs from database."""
        # Query: SELECT * FROM jobs WHERE status = 'pending'
        # Filter by instant job types if requested
        # Order by: schedule_at, created_at
        
    def get_job_tasks(self, job_id: str) -> List[Dict]:
        """Get all tasks for a job."""
        # Query: SELECT * FROM job_tasks WHERE job_id = ?
        
    def get_server_by_id(self, server_id: str) -> Optional[Dict]:
        """Get server record by ID."""
        # Query: SELECT * FROM servers WHERE id = ?
        
    def update_job_status(self, job_id: str, status: str, details: Optional[Dict] = None, error: Optional[str] = None) -> bool:
        """Update job status and details."""
        # Query: UPDATE jobs SET status = ?, details = ?, completed_at = ? WHERE id = ?
        # Also updates: started_at (if running), completed_at (if completed/failed)
        
    def update_task_status(self, task_id: str, status: str, progress: Optional[int] = None, log_message: Optional[str] = None) -> bool:
        """Update task status and progress."""
        # Query: UPDATE job_tasks SET status = ?, progress = ?, log = ? WHERE id = ?
        
    def create_task(self, job_id: str, server_id: Optional[str] = None, vcenter_host_id: Optional[str] = None) -> Optional[str]:
        """Create a new task for a job."""
        # Query: INSERT INTO job_tasks (job_id, server_id, vcenter_host_id) VALUES (?, ?, ?)
```

**Usage Example**:
```python
# In a handler
jobs = self.executor.get_pending_jobs()
for job in jobs:
    self.executor.update_job_status(job['id'], 'running')
    # ... execute job logic
    self.executor.update_job_status(job['id'], 'completed', details={'result': 'success'})
```

---

### 2. CredentialsMixin (`mixins/credentials.py`)

**Purpose**: Credential resolution and password decryption.

**Key Methods**:

```python
class CredentialsMixin:
    def get_encryption_key(self) -> str:
        """Fetch encryption key from database."""
        # Query: SELECT encryption_key FROM activity_settings
        # Cache result for session
        
    def decrypt_password(self, encrypted_password: str) -> str:
        """Decrypt AES-256 encrypted password."""
        # Call: SELECT decrypt_password(?, ?) FROM public
        # Uses Supabase RPC function
        
    def ip_in_range(self, ip_address: str, ip_range: str) -> bool:
        """Check if IP is in range (CIDR or hyphenated)."""
        # Supports: 192.168.1.0/24, 192.168.1.100-192.168.1.200
        
    def get_credential_sets_for_ip(self, ip_address: str) -> List[Dict]:
        """Get credential sets matching IP address."""
        # Query: SELECT * FROM credential_sets cs
        #        JOIN credential_ip_ranges cir ON cs.id = cir.credential_set_id
        #        WHERE ip_in_range(?, cir.ip_range)
        #        ORDER BY cir.priority DESC
        
    def resolve_credentials_for_server(self, server: Dict) -> Tuple[str, str, str, Optional[str]]:
        """Resolve credentials for a server (comprehensive)."""
        # Resolution order:
        # 1. Explicit credential_set_id
        # 2. Server-specific discovered credentials
        # 3. IP range matches
        # 4. Environment default credentials
        # Returns: (username, password, source, credential_set_id)
        
    def get_server_credentials(self, server_id: str) -> Tuple[str, str]:
        """Get username and password for a server (simplified)."""
        # Wrapper around resolve_credentials_for_server
        # Returns: (username, password)
```

**Credential Resolution Flow**:
```
Server: 192.168.1.100
    │
    ├─ Check explicit credential_set_id
    │   └─ server.credential_set_id = "abc-123"? → Use it
    │
    ├─ Check discovered credentials
    │   └─ server.discovered_username? → Use it
    │
    ├─ Check IP range matches
    │   ├─ credential_ip_ranges: 192.168.1.0/24 → Set A (priority 10)
    │   ├─ credential_ip_ranges: 192.168.1.100-192.168.1.110 → Set B (priority 20)
    │   └─ Use Set B (higher priority)
    │
    └─ Check environment defaults
        └─ IDRAC_DEFAULT_USER / IDRAC_DEFAULT_PASSWORD
```

---

### 3. VCenterMixin (`mixins/vcenter_ops.py`)

**Purpose**: vCenter connection and host operations.

**Key Methods**:

```python
class VCenterMixin:
    def connect_vcenter(self, vcenter_id: str):
        """Connect to vCenter and return service instance."""
        # Get vCenter credentials from database
        # Connect via pyVmomi: SmartConnect(host, user, pwd)
        # Cache connection for session
        # Returns: vim.ServiceInstance
        
    def get_all_esxi_hosts(self, vcenter_conn):
        """Get all ESXi hosts from vCenter."""
        # content = vcenter_conn.RetrieveContent()
        # container = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        # Returns: List[vim.HostSystem]
        
    def enter_maintenance_mode(self, host, timeout=3600):
        """Put ESXi host in maintenance mode."""
        # host.EnterMaintenanceMode(timeout, evacuatePoweredOffVms=True)
        # Wait for maintenance mode to be active
        
    def exit_maintenance_mode(self, host, timeout=300):
        """Exit maintenance mode."""
        # host.ExitMaintenanceMode(timeout)
        # Wait for host to reconnect
        
    def get_cluster_hosts(self, vcenter_conn, cluster_name: str):
        """Get all hosts in a vCenter cluster."""
        # Find cluster object
        # Return list of hosts in cluster
```

**Usage Example**:
```python
# In ClusterHandler
vcenter_conn = self.executor.connect_vcenter(vcenter_id)
hosts = self.executor.get_cluster_hosts(vcenter_conn, "Production-Cluster")

for host in hosts:
    # Prepare host
    self.executor.enter_maintenance_mode(host)
    
    # ... firmware update logic
    
    # Verify host
    self.executor.exit_maintenance_mode(host)
```

---

### 4. IdracMixin (`mixins/idrac_ops.py`)

**Purpose**: iDRAC server information retrieval.

**Key Methods**:

```python
class IdracMixin:
    def get_server_info(self, ip_address: str, username: str, password: str) -> Dict:
        """Get server information from iDRAC."""
        # Call: GET /redfish/v1/Systems/System.Embedded.1
        # Extract: ServiceTag, Model, BiosVersion, PowerState, Health
        # Returns: Dict with server details
        
    def get_idrac_version(self, ip_address: str, username: str, password: str) -> str:
        """Get iDRAC firmware version."""
        # Call: GET /redfish/v1/Managers/iDRAC.Embedded.1
        # Extract: FirmwareVersion
        
    def get_firmware_inventory(self, ip_address: str, username: str, password: str) -> List[Dict]:
        """Get firmware inventory from iDRAC."""
        # Call: GET /redfish/v1/UpdateService/FirmwareInventory
        # Returns: List of installed firmware components
```

---

### 5. ScpMixin (`scp.py`)

**Purpose**: Server Configuration Profile (SCP) export/import.

**Key Methods**:

```python
class ScpMixin:
    def export_scp(self, ip_address: str, username: str, password: str, target: str = "ALL", share_type: str = "Local") -> Dict:
        """Export Server Configuration Profile."""
        # Call: POST /redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration
        # Payload: { "ShareParameters": { "Target": "ALL" } }
        # Returns: SCP content as JSON/XML
        
    def import_scp(self, ip_address: str, username: str, password: str, scp_content: str, shutdown_type: str = "Graceful") -> Dict:
        """Import Server Configuration Profile."""
        # Call: POST /redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration
        # Payload: { "ImportBuffer": base64(scp_content), "ShutdownType": "Graceful" }
        # Returns: Job ID for tracking
```

**SCP Components**:
- `IDRAC` - iDRAC settings
- `BIOS` - BIOS configuration
- `NIC` - Network interface settings
- `RAID` - RAID controller configuration
- `ALL` - All components

---

### 6. ConnectivityMixin (`connectivity.py`)

**Purpose**: Network testing and port scanning.

**Key Methods**:

```python
class ConnectivityMixin:
    def test_port(self, ip_address: str, port: int, timeout: int = 5) -> bool:
        """Test if a port is open."""
        # socket.connect_ex((ip_address, port))
        # Returns: True if reachable
        
    def test_https_connectivity(self, ip_address: str) -> bool:
        """Test HTTPS connectivity to iDRAC."""
        # Test port 443
        # Optionally: GET /redfish/v1
        
    def scan_ip_range(self, start_ip: str, end_ip: str, port: int = 443) -> List[str]:
        """Scan IP range for open ports."""
        # For each IP in range:
        #   Test port
        #   Return list of reachable IPs
```

---

## Dell Redfish Layer

### Overview

The Dell Redfish layer provides a unified interface for interacting with iDRAC Redfish API. It abstracts Dell-specific quirks and provides high-level operations.

**Architecture**:
```
Handlers (firmware.py, discovery.py, etc.)
    │
    ├─ DellRedfishAdapter (adapter.py)
    │   └─ Unified session management, error handling
    │
    ├─ DellOperations (operations.py)
    │   └─ High-level operations: firmware, health, discovery
    │
    ├─ Endpoints (endpoints.py)
    │   └─ Canonical Dell Redfish endpoint definitions
    │
    └─ DellRedfishError (errors.py)
        └─ Dell-specific error codes and handling
```

---

### DellRedfishAdapter (`adapter.py`)

**Purpose**: Unified interface for Dell Redfish API calls with session management and error handling.

**Key Features**:
- Session pooling (reuse HTTPS connections)
- Automatic retry with exponential backoff
- Dell-specific error code handling
- Request/response logging to `idrac_commands` table

**Methods**:

```python
class DellRedfishAdapter:
    def __init__(self, ip_address: str, username: str, password: str):
        self.base_url = f"https://{ip_address}"
        self.auth = (username, password)
        self.session = requests.Session()
        self.session.verify = False  # Self-signed certs
        
    def get(self, endpoint: str) -> Dict:
        """Execute GET request."""
        url = f"{self.base_url}{endpoint}"
        response = self.session.get(url, auth=self.auth, timeout=30)
        self._log_request('GET', endpoint, response)
        return self._handle_response(response)
        
    def post(self, endpoint: str, payload: Dict) -> Dict:
        """Execute POST request."""
        url = f"{self.base_url}{endpoint}"
        response = self.session.post(url, auth=self.auth, json=payload, timeout=30)
        self._log_request('POST', endpoint, response, request_body=payload)
        return self._handle_response(response)
        
    def _handle_response(self, response: requests.Response) -> Dict:
        """Handle response and errors."""
        if response.ok:
            return response.json()
        else:
            raise DellRedfishError(response.status_code, response.text)
```

---

### DellOperations (`operations.py`)

**Purpose**: High-level Dell Redfish operations (building on DellRedfishAdapter).

**Methods**:

```python
class DellOperations:
    @staticmethod
    def get_system_info(ip_address: str, username: str, password: str) -> Dict:
        """Get system information."""
        adapter = DellRedfishAdapter(ip_address, username, password)
        return adapter.get(ENDPOINTS['system'])
        
    @staticmethod
    def update_firmware(ip_address: str, username: str, password: str, firmware_file_path: str) -> Dict:
        """Upload and install firmware."""
        adapter = DellRedfishAdapter(ip_address, username, password)
        
        # Step 1: Upload firmware file (multipart)
        with open(firmware_file_path, 'rb') as f:
            response = adapter.post_multipart(ENDPOINTS['firmware_upload'], files={'file': f})
        
        # Step 2: Create update job
        job_id = response['JobId']
        
        # Step 3: Monitor job
        while True:
            job_status = adapter.get(f"{ENDPOINTS['jobs']}/{job_id}")
            if job_status['JobState'] in ['Completed', 'Failed']:
                break
            time.sleep(10)
        
        return {'success': job_status['JobState'] == 'Completed', 'job_id': job_id}
        
    @staticmethod
    def power_action(ip_address: str, username: str, password: str, action: str) -> Dict:
        """Execute power action."""
        adapter = DellRedfishAdapter(ip_address, username, password)
        payload = {'ResetType': action}
        return adapter.post(ENDPOINTS['power_action'], payload)
```

**Instance for Global Use**:
```python
# Singleton instance
dell_operations = DellOperations()

# Usage in handlers
from job_executor.dell_redfish.operations import dell_operations

result = dell_operations.get_system_info(ip_address, username, password)
```

---

### Endpoints (`endpoints.py`)

**Purpose**: Canonical Dell Redfish endpoint definitions.

```python
ENDPOINTS = {
    # System information
    'system': '/redfish/v1/Systems/System.Embedded.1',
    'bios': '/redfish/v1/Systems/System.Embedded.1/Bios',
    'bios_settings': '/redfish/v1/Systems/System.Embedded.1/Bios/Settings',
    
    # Manager (iDRAC)
    'manager': '/redfish/v1/Managers/iDRAC.Embedded.1',
    'sel': '/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Sel/Entries',
    
    # Firmware
    'firmware_inventory': '/redfish/v1/UpdateService/FirmwareInventory',
    'firmware_upload': '/redfish/v1/UpdateService/MultipartUpload',
    
    # Power
    'power_action': '/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset',
    
    # Virtual media
    'virtual_media': '/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia',
    'virtual_media_cd': '/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD',
    'virtual_media_insert': '/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.InsertMedia',
    'virtual_media_eject': '/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.EjectMedia',
    
    # OEM actions (Dell-specific)
    'scp_export': '/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
    'scp_import': '/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration',
    
    # Jobs
    'jobs': '/redfish/v1/Managers/iDRAC.Embedded.1/Jobs',
}
```

---

### DellRedfishError (`errors.py`)

**Purpose**: Dell-specific error handling.

```python
class DellRedfishError(Exception):
    """Dell Redfish API error."""
    
    ERROR_CODES = {
        'Base.1.0.GeneralError': 'General error occurred',
        'Base.1.0.InternalError': 'Internal server error',
        'Base.1.0.PropertyValueNotInList': 'Invalid property value',
        'iDRAC.2.8.SYS413': 'Unable to complete operation due to system state',
        'iDRAC.2.8.SYS414': 'System is currently in use',
        # ... more error codes
    }
    
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        self.error_code = self._extract_error_code(message)
        super().__init__(self._format_error())
    
    def _extract_error_code(self, message: str) -> Optional[str]:
        """Extract Dell error code from message."""
        # Parse JSON response for MessageId
        try:
            data = json.loads(message)
            return data.get('error', {}).get('@Message.ExtendedInfo', [{}])[0].get('MessageId')
        except:
            return None
    
    def _format_error(self) -> str:
        """Format error message."""
        if self.error_code in self.ERROR_CODES:
            return f"{self.error_code}: {self.ERROR_CODES[self.error_code]}"
        return f"HTTP {self.status_code}: {self.message}"
```

---

## ESXi Orchestration

### EsxiOrchestrator (`esxi/orchestrator.py`)

**Purpose**: Orchestrate ESXi upgrade workflows via SSH.

**Key Methods**:

```python
class EsxiOrchestrator:
    def __init__(self, host_ip: str, username: str, password: str):
        self.ssh_client = ESXiSSHClient(host_ip, username, password)
        
    def upgrade_esxi(self, bundle_path: str, profile_name: str) -> Dict:
        """Execute ESXi upgrade."""
        # 1. Pre-flight checks
        self._check_current_version()
        self._check_bundle_exists(bundle_path)
        self._check_free_space()
        
        # 2. Execute upgrade
        cmd = f"esxcli software profile update -p {profile_name} -d {bundle_path}"
        result = self.ssh_client.execute(cmd)
        
        # 3. Reboot
        self.ssh_client.execute("reboot")
        
        # 4. Wait for host to come back
        self._wait_for_ssh()
        
        # 5. Verify
        new_version = self._get_esxi_version()
        
        return {'success': True, 'version': new_version}
```

---

### ESXiSSHClient (`esxi/ssh_client.py`)

**Purpose**: SSH client for ESXi hosts (using Paramiko).

```python
import paramiko

class ESXiSSHClient:
    def __init__(self, host: str, username: str, password: str):
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.client.connect(host, username=username, password=password)
        
    def execute(self, command: str) -> str:
        """Execute SSH command."""
        stdin, stdout, stderr = self.client.exec_command(command)
        return stdout.read().decode('utf-8')
        
    def close(self):
        """Close SSH connection."""
        self.client.close()
```

---

## Edge Functions

### Key Edge Functions

| Function | Purpose | Primary Use |
|----------|---------|-------------|
| `create-job` | Create new jobs | UI job creation |
| `update-job` | Update job status | Job Executor status updates |
| `vcenter-sync` | Trigger vCenter sync | Manual sync from UI |
| `encrypt-credentials` | Encrypt passwords | Credential set creation |
| `send-notification` | Send Teams/email notifications | Job completion alerts |
| `cleanup-old-jobs` | Clean up old jobs | Cron trigger (daily) |
| `execute-maintenance-windows` | Execute scheduled windows | Cron trigger (every minute) |

---

### Edge Function Structure

```typescript
// supabase/functions/my-function/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    // 1. Parse request
    const { param1, param2 } = await req.json();
    
    // 2. Create Supabase client (with service role)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // 3. Execute logic
    const { data, error } = await supabase
      .from('table')
      .select('*')
      .eq('id', param1);
    
    if (error) throw error;
    
    // 4. Return response
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
```

---

## Frontend Patterns

### Page Structure

**Standard page layout**:

```typescript
// src/pages/MyPage.tsx
import { Layout } from "@/components/Layout";
import { MyComponent } from "@/components/MyComponent";

export default function MyPage() {
  return (
    <Layout>
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-bold">Page Title</h1>
          <p className="text-muted-foreground">Page description</p>
        </header>
        
        <MyComponent />
      </div>
    </Layout>
  );
}
```

---

### Common Hooks

**TanStack Query for server state**:

```typescript
// Fetch data
const { data: servers, isLoading } = useQuery({
  queryKey: ['servers'],
  queryFn: async () => {
    const { data, error } = await supabase.from('servers').select('*');
    if (error) throw error;
    return data;
  }
});

// Mutate data
const { mutate: updateServer } = useMutation({
  mutationFn: async (updates: ServerUpdate) => {
    const { data, error } = await supabase
      .from('servers')
      .update(updates)
      .eq('id', updates.id);
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['servers'] });
    toast.success('Server updated');
  }
});
```

---

## Common Implementation Patterns

### Adding a New iDRAC Operation

**Step-by-step guide**:

1. **Add job type to database**:
```sql
-- Migration
ALTER TYPE job_type ADD VALUE 'my_new_operation';
```

2. **Create handler method**:
```python
# job_executor/handlers/my_handler.py
class MyHandler(BaseHandler):
    def execute_my_new_operation(self, job: Dict):
        self.mark_job_running(job)
        
        # Get server and credentials
        server = self.executor.get_server_by_id(job['target_scope']['server_ids'][0])
        username, password = self.executor.get_server_credentials(server['id'])
        
        # Call Dell Redfish API
        from job_executor.dell_redfish.operations import dell_operations
        result = dell_operations.my_operation(server['ip_address'], username, password)
        
        if result['success']:
            self.mark_job_completed(job, details=result)
        else:
            self.mark_job_failed(job, result['error'])
```

3. **Add to job executor routing**:
```python
# job-executor.py
def execute_job(self, job: Dict):
    handler_map = {
        # ... existing mappings
        'my_new_operation': self.handlers['my_handler'].execute_my_new_operation,
    }
```

4. **Create UI component**:
```typescript
// React component
const { mutate: triggerOperation } = useMutation({
  mutationFn: async (serverId: string) => {
    const { data } = await supabase.functions.invoke('create-job', {
      body: { 
        job_type: 'my_new_operation', 
        target_scope: { server_ids: [serverId] } 
      }
    });
    return data;
  },
  onSuccess: () => {
    toast.success('Operation started');
  }
});
```

---

### Credential Resolution

**How credentials are resolved for a server**:

```python
# In CredentialsMixin
def resolve_credentials_for_server(self, server: Dict) -> Tuple[str, str, str, Optional[str]]:
    """
    Resolution order:
    1. Explicit credential_set_id (server.credential_set_id)
    2. Discovered credentials (server.discovered_username)
    3. IP range matches (credential_ip_ranges)
    4. Environment defaults (IDRAC_DEFAULT_USER)
    """
    
    # 1. Explicit
    if server.get('credential_set_id'):
        cred_set = self.get_credential_set(server['credential_set_id'])
        password = self.decrypt_password(cred_set['password_encrypted'])
        return (cred_set['username'], password, 'explicit', cred_set['id'])
    
    # 2. Discovered
    if server.get('discovered_username') and server.get('discovered_password_encrypted'):
        password = self.decrypt_password(server['discovered_password_encrypted'])
        return (server['discovered_username'], password, 'discovered', None)
    
    # 3. IP range
    cred_sets = self.get_credential_sets_for_ip(server['ip_address'])
    if cred_sets:
        cred_set = cred_sets[0]  # Highest priority
        password = self.decrypt_password(cred_set['password_encrypted'])
        return (cred_set['username'], password, 'ip_range', cred_set['id'])
    
    # 4. Environment default
    return (
        os.getenv('IDRAC_DEFAULT_USER', 'root'),
        os.getenv('IDRAC_DEFAULT_PASSWORD', 'calvin'),
        'default',
        None
    )
```

---

### Activity Logging

**How to log iDRAC commands**:

```python
# Python (Job Executor)
def log_idrac_command(
    self,
    server_id: str,
    job_id: str,
    endpoint: str,
    command_type: str,
    success: bool,
    response_time_ms: int,
    operation_type: str,
    request_body: Optional[Dict] = None,
    response_body: Optional[Dict] = None,
    error_message: Optional[str] = None
):
    """Log iDRAC command to database."""
    data = {
        'server_id': server_id,
        'job_id': job_id,
        'endpoint': endpoint,
        'command_type': command_type,
        'success': success,
        'response_time_ms': response_time_ms,
        'operation_type': operation_type,
        'request_body': request_body,
        'response_body': response_body,
        'error_message': error_message,
        'source': 'job_executor',
        'full_url': f"https://{server_ip}{endpoint}"
    }
    
    self.supabase.table('idrac_commands').insert(data).execute()
```

---

## Testing & Deployment

### Local Development

**Frontend**:
```bash
npm install
npm run dev
# Opens http://localhost:5173
```

**Supabase**:
```bash
npx supabase start
# Local Supabase at http://127.0.0.1:54321
```

**Job Executor**:
```bash
pip install -r requirements.txt
python job-executor.py
```

---

### Production Deployment

**Frontend** (via Lovable):
- Click "Publish" button
- Frontend deployed to Lovable CDN

**Edge Functions** (automatic):
- Functions deployed automatically on push to `main`

**Job Executor** (Linux):
```bash
# Deploy as systemd service
./scripts/deploy-rhel9.sh

# Manual management
systemctl start job-executor
systemctl status job-executor
systemctl stop job-executor
```

**Job Executor** (Windows):
```powershell
# Deploy as Task Scheduler task
.\scripts\deploy-windows.ps1

# Manual management
.\scripts\manage-job-executor.ps1 -Action start
.\scripts\manage-job-executor.ps1 -Action status
.\scripts\manage-job-executor.ps1 -Action stop
```

---

## Security Considerations

### 1. Row Level Security (RLS)

**All tables have RLS policies**:

```sql
-- Example: servers table
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

-- Users can view all servers
CREATE POLICY "Users can view servers"
ON servers FOR SELECT
USING (true);

-- Only admins can modify servers
CREATE POLICY "Admins can modify servers"
ON servers FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);
```

---

### 2. Credential Encryption

**All passwords encrypted with AES-256**:

```sql
-- Encrypt password
SELECT encrypt_password('myPassword', encryption_key) FROM activity_settings;

-- Decrypt password
SELECT decrypt_password(encrypted_value, encryption_key) FROM activity_settings;
```

**Encryption key** stored in `activity_settings.encryption_key` (base64-encoded 256-bit key).

---

### 3. Activity Logging

**ALL iDRAC operations logged**:

```sql
-- Query recent activity
SELECT 
  ic.timestamp,
  s.hostname,
  ic.operation_type,
  ic.success,
  ic.response_time_ms
FROM idrac_commands ic
JOIN servers s ON ic.server_id = s.id
ORDER BY ic.timestamp DESC
LIMIT 100;
```

---

## Troubleshooting

### Common Issues

#### 1. Job Stuck in Pending

**Symptom**: Job status never changes from `pending`.

**Causes**:
- Job Executor not running
- Database connection failure
- Invalid job type

**Solution**:
```bash
# Check Job Executor status
systemctl status job-executor

# Check logs
journalctl -u job-executor -f

# Restart Job Executor
systemctl restart job-executor
```

---

#### 2. Credential Resolution Failure

**Symptom**: "Unable to authenticate to iDRAC" errors.

**Causes**:
- No matching credential sets
- Decryption failure
- IP range misconfiguration

**Solution**:
```python
# Test credential resolution
python3 << EOF
from job_executor.mixins.credentials import CredentialsMixin

mixin = CredentialsMixin()
server = {'ip_address': '192.168.1.100', 'credential_set_id': None}
username, password, source, cred_id = mixin.resolve_credentials_for_server(server)

print(f"Username: {username}")
print(f"Source: {source}")
print(f"Credential Set ID: {cred_id}")
EOF
```

---

#### 3. vCenter Sync Failure

**Symptom**: ESXi hosts not syncing from vCenter.

**Causes**:
- vCenter credentials invalid
- Network connectivity issues
- SSL certificate validation failure

**Solution**:
```bash
# Test vCenter connectivity
python3 << EOF
from pyVim.connect import SmartConnect
import ssl

context = ssl._create_unverified_context()
si = SmartConnect(
    host='vcenter.local',
    user='administrator@vsphere.local',
    pwd='password',
    sslContext=context
)
print("Connected successfully!")
EOF
```

---

## References

### Documentation
- [Dell iDRAC Redfish API](https://developer.dell.com/apis/2978/)
- [Dell Redfish Scripting (GitHub)](https://github.com/dell/iDRAC-Redfish-Scripting)
- [VMware vSphere API](https://developer.vmware.com/apis/1508/vsphere)
- [Supabase Documentation](https://supabase.com/docs)

### Internal Documentation
- `docs/REDFISH_AUDIT.md` - Dell API compliance tracking
- `docs/BACKUP_GUIDE.md` - SCP backup/restore procedures
- `docs/VCENTER_SYNC_GUIDE.md` - vCenter integration details
- `docs/SELF_HOSTING.md` - Offline deployment guide

---

## Glossary

| Term | Definition |
|------|------------|
| **iDRAC** | Integrated Dell Remote Access Controller - out-of-band management |
| **Redfish** | DMTF standard for RESTful management of servers |
| **SCP** | Server Configuration Profile - Dell backup format (XML/JSON) |
| **SEL** | System Event Log - hardware event history |
| **DRS** | Distributed Resource Scheduler - VMware load balancing |
| **HA** | High Availability - VMware cluster failover |
| **vMotion** | VMware live VM migration |
| **ESXi** | VMware hypervisor |
| **vCenter** | VMware management platform |
| **Job Executor** | Python daemon for local network operations |
| **Edge Functions** | Supabase serverless functions (Deno) |

---

**End of Document**

For questions or clarifications, consult the [Dell Server Manager Discord](#) or open a GitHub issue.
