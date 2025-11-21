# AGENTS.MD - Dell Server Manager for AI Coding Assistants

**Last Updated:** 2025-01-21

## Table of Contents
1. [Application Overview](#application-overview)
2. [Critical Architecture Principles](#critical-architecture-principles)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Database Schema](#database-schema)
6. [Common Implementation Patterns](#common-implementation-patterns)
7. [Workflow Orchestration System](#workflow-orchestration-system)
8. [Maintenance Window Automation](#maintenance-window-automation)
9. [Safety Check System](#safety-check-system)
10. [Critical DO's and DON'Ts](#critical-dos-and-donts)
11. [Job Executor Architecture](#job-executor-architecture)
12. [Edge Functions](#edge-functions)
13. [Frontend Patterns](#frontend-patterns)
14. [Testing & Deployment](#testing--deployment)
15. [Common Troubleshooting](#common-troubleshooting)
16. [Key Environment Variables](#key-environment-variables)
17. [Security Considerations](#security-considerations)
18. [References](#references)

---

## Application Overview

**Dell Server Manager** is an enterprise-grade application for managing Dell servers via iDRAC Redfish API and VMware vCenter integration.

### Key Characteristics
- **Primary use case**: Offline-first, air-gapped/secure network environments
- **Target users**: Enterprise IT administrators in secure/classified networks
- **Core capability**: Manages Dell servers without cloud connectivity
- **Network requirement**: Local network access only (no internet required)

### What Makes This Different
Unlike typical SaaS applications, this tool is designed to run **completely offline** in environments where:
- Internet access is restricted or prohibited
- Servers are on private networks (192.168.x.x, 10.x.x.x)
- Security requirements mandate air-gapped operations
- If a browser can reach it, this app can manage it

---

## Critical Architecture Principles

> **⚠️ MOST IMPORTANT SECTION** - Read this first before making any changes

### 1. Offline-First Design

**Core Principle**: This application MUST function without internet connectivity.

- All iDRAC operations use local network HTTP/HTTPS
- No cloud services required for core functionality
- No external API calls for server management
- If accessible in a browser, this app CAN and SHOULD access it

### 2. Two-Component System for iDRAC Operations

This is the **MOST CRITICAL** architectural decision to understand:

#### Job Executor (Python) - PRIMARY METHOD
**Use for**: Local/offline deployments (95% of use cases)

- Runs directly on the host machine with full network access
- Has unrestricted access to all local network IPs
- Handles ALL iDRAC operations in local mode:
  - Firmware updates
  - Discovery scans
  - Credential testing
  - Server information fetching
  - Power control
  - BIOS configuration
  - SCP backup/restore
  - Virtual media mounting
  - Event log retrieval
  - Boot configuration
  - Health monitoring
  - vCenter host preparation
  - Rolling cluster updates

**Why**: Docker containers (where Edge Functions run) have limited network access to the host's local network due to Docker networking isolation.

#### Edge Functions (Supabase) - SECONDARY, CLOUD ONLY
**Use for**: Cloud deployments where iDRACs have public IPs

- Run in Docker containers with limited network access
- Docker networking may block access to local IPs (192.168.x.x, 10.x.x.x)
- Only reliable when iDRAC devices have public IP addresses
- In local mode, edge functions should defer to Job Executor

**Why**: Docker bridge networking cannot reliably reach the host's local network.

### 3. Deployment Mode Detection

**Always detect deployment mode to adjust UI and features accordingly:**

```typescript
const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                   import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
```

- **Local Mode** (`localhost` or `127.0.0.1`): Job Executor handles everything
- **Cloud Mode** (production URL): Edge Functions can be used

### 4. Feature Implementation Strategy

When implementing new iDRAC-related features:

#### For Local Mode (ALWAYS IMPLEMENT FIRST):
✅ Create a job type that Job Executor can handle
✅ Disable or hide instant preview/edge function features
✅ Show helpful messages directing users to Job Executor
✅ Poll job status for completion

#### For Cloud Mode (OPTIONAL):
✅ Edge functions can work normally (public IPs only)
✅ Enable instant preview and direct connection testing
✅ Faster response times for simple queries

#### Universal Pattern:
**Always create job types - they work in BOTH modes!**

```python
# 1. Add job type to database (migration)
ALTER TYPE job_type ADD VALUE 'new_operation';

# 2. Implement in job-executor.py
def execute_new_operation(self, job_id):
    # iDRAC Redfish API calls here
    
# 3. Create UI to trigger job
<CreateJobDialog jobType="new_operation" />

# 4. Poll job status in UI
useQuery(['jobs', jobId], () => fetchJob(jobId))
```

---

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Tailwind CSS** + shadcn/ui components
- **React Router** for navigation
- **TanStack Query** (React Query) for data fetching and caching
- **Vite** as build tool
- **Supabase Client** for database and realtime
- **Recharts** for data visualization
- **date-fns** for date manipulation

### Backend (Lovable Cloud/Supabase)
- **PostgreSQL** database with RLS (Row Level Security)
- **Supabase Auth** for authentication
- **Edge Functions** (Deno runtime) for serverless logic
- **Realtime** subscriptions for live updates
- **pg_cron** for scheduled jobs

### Job Executor (Python)
- **Python 3.7+** runtime
- **requests** library for HTTP calls (iDRAC Redfish API)
- **pyVmomi** for VMware vCenter API
- **cryptography** for password encryption/decryption
- Runs as **systemd service** (Linux) or **Task Scheduler** (Windows)

### Development Tools
- **ESLint** for code linting
- **TypeScript** for type safety
- **Vitest** for testing

---

## Project Structure

```
dell-server-manager/
├── src/                          # Frontend React application
│   ├── components/              # React components
│   │   ├── activity/           # Activity monitor components
│   │   ├── dashboard/          # Dashboard widgets (stats, charts)
│   │   ├── jobs/               # Job management UI (dialogs, panels)
│   │   │   ├── ClusterUpdateWizard.tsx  # Multi-step cluster update wizard
│   │   │   ├── CreateJobDialog.tsx      # Create job dialog
│   │   │   ├── JobDetailDialog.tsx      # Job details view
│   │   │   ├── JobsPanel.tsx            # Jobs list panel
│   │   │   ├── PreFlightCheckDialog.tsx # Pre-update validation
│   │   │   ├── WorkflowJobDialog.tsx    # Workflow job creation
│   │   │   └── WorkflowExecutionViewer.tsx  # Real-time workflow tracking
│   │   ├── maintenance/        # Maintenance planner components
│   │   │   ├── ClusterSafetyTrendChart.tsx  # Safety trends visualization
│   │   │   ├── CompactStatsBar.tsx          # Stats for planner page
│   │   │   ├── CreateMaintenanceWindowDialog.tsx  # Create window
│   │   │   ├── MaintenanceCalendarView.tsx  # Calendar interface
│   │   │   ├── OptimalWindowsSidebar.tsx    # Recommended windows
│   │   │   ├── SafetyCalendar.tsx           # Safety status calendar
│   │   │   ├── SafetyStatusTable.tsx        # Tabular safety view
│   │   │   └── dialogs/
│   │   │       └── ScheduleMaintenanceDialog.tsx  # Schedule UI
│   │   ├── notifications/      # Live notifications and console
│   │   ├── servers/            # Server management (cards, dialogs)
│   │   ├── settings/           # Settings panels
│   │   ├── ui/                 # shadcn/ui base components
│   │   └── vcenter/            # vCenter integration components
│   ├── hooks/                  # Custom React hooks
│   │   ├── useAuth.tsx         # Authentication state
│   │   ├── useActiveJobs.ts    # Active jobs tracking
│   │   ├── useLiveConsole.ts   # Real-time job logs
│   │   ├── useMaintenanceData.ts  # Maintenance windows data
│   │   ├── useNotificationCenter.ts  # Live notifications
│   │   ├── useOptimalWindows.ts  # Optimal maintenance windows
│   │   └── useSafetyStatus.ts    # Safety check status
│   ├── integrations/           # External integrations
│   │   └── supabase/           # Supabase client (auto-generated)
│   │       ├── client.ts       # Supabase client instance
│   │       └── types.ts        # Database types (auto-generated)
│   ├── lib/                    # Utilities and helpers
│   │   ├── utils.ts            # Common utilities
│   │   ├── validations.ts      # Form validations
│   │   ├── diagnostics.ts      # System diagnostics
│   │   ├── network-validator.ts # Network validation
│   │   └── cron-utils.ts       # Cron pattern utilities
│   ├── pages/                  # Route page components
│   │   ├── Dashboard.tsx       # Main dashboard
│   │   ├── Servers.tsx         # Server inventory
│   │   ├── VCenter.tsx         # vCenter management
│   │   ├── MaintenancePlanner.tsx  # Maintenance scheduling
│   │   ├── ActivityMonitor.tsx # Activity logs & jobs
│   │   ├── Settings.tsx        # Application settings
│   │   └── Auth.tsx            # Login/signup
│   ├── index.css               # Global styles & design tokens
│   ├── App.tsx                 # Root application component
│   └── main.tsx                # Application entry point
│
├── supabase/                    # Supabase backend
│   ├── functions/              # Edge functions (Deno)
│   │   ├── _shared/            # Shared utilities
│   │   │   ├── idrac-logger.ts # Activity logging
│   │   │   └── idrac-session.ts # iDRAC session management
│   │   ├── analyze-maintenance-windows/  # Analyze optimal windows
│   │   ├── cleanup-activity-logs/        # Scheduled cleanup
│   │   ├── cleanup-old-jobs/             # Remove old jobs
│   │   ├── create-job/                   # Create async jobs
│   │   ├── encrypt-credentials/          # Encrypt passwords
│   │   ├── execute-maintenance-windows/  # Scheduled execution
│   │   ├── get-service-key/              # Retrieve service key
│   │   ├── network-diagnostics/          # Network troubleshooting
│   │   ├── openmanage-sync/              # OpenManage sync
│   │   ├── preview-server-info/          # Quick iDRAC preview
│   │   ├── refresh-server-info/          # Fetch server details
│   │   ├── send-notification/            # Notification delivery
│   │   ├── sync-vcenter-direct/          # Direct vCenter sync
│   │   ├── test-vcenter-connection/      # Test vCenter creds
│   │   ├── test-virtual-media-share/     # Test SMB/NFS shares
│   │   ├── update-job/                   # Update job status
│   │   ├── validate-network-prerequisites/  # Network validation
│   │   └── vcenter-sync/                 # vCenter sync handler
│   ├── migrations/             # Database migrations (timestamped)
│   └── config.toml             # Supabase configuration
│
├── job_executor/               # Job executor modules
│   ├── __init__.py             # Module initialization
│   ├── config.py               # Configuration and environment
│   ├── connectivity.py         # Network testing and discovery
│   ├── scp.py                  # SCP backup/restore operations
│   └── utils.py                # Utilities (JSON, Unicode, etc.)
│
├── job-executor.py             # Main job executor script
├── vcenter-sync-script.py      # Standalone vCenter sync script
├── openmanage-sync-script.py   # Standalone OpenManage sync
├── idrac_throttler.py          # Rate limiting for iDRAC API
│
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md         # High-level architecture
│   ├── JOB_EXECUTOR_GUIDE.md   # Job Executor setup guide
│   ├── VCENTER_SYNC_GUIDE.md   # vCenter integration guide
│   ├── OPENMANAGE_SYNC_GUIDE.md  # OpenManage integration
│   ├── SELF_HOSTING.md         # Self-hosting instructions
│   ├── BACKUP_GUIDE.md         # Database backup guide
│   └── REDFISH_ADVANCED_FEATURES_PLAN.md  # Advanced features
│
├── scripts/                    # Deployment and management scripts
│   ├── deploy-rhel9.sh         # RHEL deployment
│   ├── deploy-windows.ps1      # Windows deployment
│   ├── manage-job-executor.sh  # Linux service management
│   ├── manage-job-executor.ps1 # Windows service management
│   ├── health-check.sh         # System health check
│   ├── health-check.ps1        # Windows health check
│   ├── backup-database.ts      # Database backup script
│   └── verify-database.sh      # Database verification
│
├── .env                        # Environment variables (auto-generated)
├── requirements.txt            # Python dependencies
├── package.json                # Node.js dependencies
├── tailwind.config.ts          # Tailwind CSS configuration
├── vite.config.ts              # Vite build configuration
├── AGENTS.md                   # This file
└── README.md                   # Project overview
```

---

## Database Schema

### Core Tables

#### `servers` - Dell Server Inventory
Primary table for managing Dell servers (iDRAC endpoints).

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `ip_address` (TEXT, unique, NOT NULL) - iDRAC IP address
- `hostname` (TEXT, nullable) - Server hostname
- `service_tag` (TEXT, nullable) - Dell service tag
- `model` (TEXT, nullable) - Server model (e.g., "PowerEdge R640")
- `manufacturer` (TEXT, default: 'Dell') - Manufacturer name
- `product_name` (TEXT, nullable) - Product name from iDRAC
- `idrac_username` (TEXT, nullable) - iDRAC username (deprecated, use credential sets)
- `idrac_password_encrypted` (TEXT, nullable) - Encrypted password
- `credential_set_id` (UUID, FK, nullable) - Linked credential set
- `discovered_by_credential_set_id` (UUID, FK, nullable) - Discovery credential
- `vcenter_host_id` (UUID, FK, nullable) - Linked ESXi host
- `bios_version`, `idrac_firmware`, `redfish_version` - Firmware versions
- `power_state`, `overall_health` - Current state
- `cpu_count`, `memory_gb` - Hardware specs
- `manager_mac_address` (TEXT, nullable) - iDRAC MAC address
- `connection_status` (TEXT, nullable) - "connected" / "failed" / "unknown"
- `connection_error` (TEXT, nullable) - Last connection error
- `credential_test_status` (TEXT, nullable) - Last credential test result
- `last_seen`, `last_connection_test`, `last_health_check` (TIMESTAMP) - Activity timestamps
- `last_boot_config_check`, `credential_last_tested` (TIMESTAMP) - Configuration checks
- `boot_mode`, `boot_source_override_enabled`, `boot_source_override_target` - Boot config
- `boot_order` (JSONB, nullable) - Boot device order
- `supported_endpoints` (JSONB, nullable) - Supported Redfish endpoints
- `discovery_job_id` (UUID, FK, nullable) - Discovery job reference
- `openmanage_device_id` (TEXT, nullable) - OpenManage Enterprise device ID
- `last_openmanage_sync` (TIMESTAMP, nullable) - Last OME sync
- `notes` (TEXT, nullable) - Admin notes
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

**Important Relationships:**
- Many-to-many with `server_groups` via `server_group_members`
- One-to-one with `vcenter_hosts` (bidirectional)
- Many-to-one with `credential_sets`
- One-to-many with `server_health` (health snapshots)
- One-to-many with `server_event_logs` (event history)
- One-to-many with `bios_configurations` (BIOS snapshots)
- One-to-many with `scp_backups` (SCP backups)
- One-to-many with `virtual_media_sessions` (virtual media mounts)

#### `vcenter_hosts` - ESXi Hosts from vCenter
Synced from VMware vCenter Server.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `name` (TEXT, NOT NULL) - ESXi hostname
- `vcenter_id` (TEXT, nullable) - vCenter managed object ID
- `cluster` (TEXT, nullable) - vCenter cluster name
- `serial_number` (TEXT, nullable) - Hardware serial (used to link with servers)
- `server_id` (UUID, FK, nullable) - Linked Dell server
- `esxi_version` (TEXT, nullable) - ESXi version
- `status` (TEXT, nullable, default: 'unknown') - Host status
- `maintenance_mode` (BOOLEAN, nullable, default: false) - Maintenance mode status
- `last_sync` (TIMESTAMP, nullable) - Last vCenter sync
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

**Important Relationships:**
- One-to-one with `servers` (linked by serial number or manual)
- Used for auto-grouping servers by vCenter cluster
- Referenced in workflow orchestration for cluster updates

#### `server_groups` - Manual Server Grouping
Custom organizational groups for servers.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `name` (TEXT, unique, NOT NULL) - Group name
- `description` (TEXT, nullable) - Group description
- `group_type` (TEXT, NOT NULL, default: 'application') - "manual" / "vcenter_cluster" / "application" / "rack"
- `color` (TEXT, nullable, default: '#3b82f6') - UI color (hex)
- `icon` (TEXT, nullable, default: 'Server') - Lucide icon name
- `min_healthy_servers` (INTEGER, nullable, default: 1) - Safety threshold for checks
- `created_by` (UUID, FK, nullable) - User who created
- `created_at`, `updated_at` (TIMESTAMP, default: now()) - Timestamps

**Important Notes:**
- "vcenter_cluster" type groups are auto-created from vCenter sync
- Servers can belong to MULTIPLE manual groups
- Used for maintenance window targeting
- Safety checks validate minimum healthy servers before operations

**Important Relationships:**
- Many-to-many with `servers` via `server_group_members`
- One-to-many with `server_group_safety_checks` (safety validations)

#### `server_group_members` - Many-to-Many Join Table
Links servers to groups.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_group_id` (UUID, FK, nullable) - Group reference
- `server_id` (UUID, FK, nullable) - Server reference
- `role` (TEXT, nullable) - Server role in group (e.g., "primary", "backup")
- `priority` (INTEGER, nullable, default: 100) - Update order priority (lower = first)
- `added_at` (TIMESTAMP, default: now()) - When added to group

#### `credential_sets` - Shared iDRAC Credentials
Reusable credential sets with IP range mapping.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `name` (TEXT, unique, NOT NULL) - Credential set name
- `username` (TEXT, NOT NULL) - iDRAC username
- `password_encrypted` (TEXT, nullable) - AES-encrypted password
- `description` (TEXT, nullable) - Usage notes
- `is_default` (BOOLEAN, nullable, default: false) - Default fallback credentials
- `priority` (INTEGER, nullable, default: 100) - Resolution priority (lower = higher priority)
- `created_at`, `updated_at` (TIMESTAMP, default: now()) - Timestamps

**Important Relationships:**
- One-to-many with `credential_ip_ranges` (IP mapping)
- Many-to-one with `servers` (via `credential_set_id`)

#### `credential_ip_ranges` - IP Range Mapping
Maps credential sets to IP ranges (CIDR notation).

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `credential_set_id` (UUID, FK, NOT NULL) - Parent credential set
- `ip_range` (TEXT, NOT NULL) - CIDR notation (e.g., "192.168.1.0/24")
- `description` (TEXT, nullable) - Range notes
- `priority` (INTEGER, nullable, default: 100) - Range priority (lower = higher)
- `created_at`, `updated_at` (TIMESTAMP, default: now()) - Timestamps

**Credential Resolution Logic:**
1. Check server-specific credentials (`servers.idrac_username`)
2. Check credential sets with matching IP ranges (by priority)
3. Fall back to default credential set

#### `jobs` - Asynchronous Job Queue
Background jobs for long-running operations.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `job_type` (ENUM `job_type`, NOT NULL) - Job type (see below)
- `status` (ENUM `job_status`, NOT NULL, default: 'pending') - "pending" / "running" / "completed" / "failed" / "cancelled"
- `target_scope` (JSONB, nullable) - Target definition (servers, clusters, groups)
- `details` (JSONB, nullable) - Job-specific parameters
- `created_by` (UUID, FK, NOT NULL) - User who created
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp
- `started_at`, `completed_at` (TIMESTAMP, nullable) - Lifecycle timestamps
- `schedule_at` (TIMESTAMP, nullable) - Scheduled execution time
- `parent_job_id` (UUID, FK, nullable) - For job hierarchies (sub-jobs)
- `component_order` (INTEGER, nullable) - Component update order in workflows
- `credential_set_ids` (UUID[], nullable) - Credentials to use
- `firmware_source` (TEXT, nullable, default: 'manual_repository') - Firmware source type
- `dell_catalog_url` (TEXT, nullable, default: 'https://downloads.dell.com/catalog/Catalog.xml') - Dell catalog
- `auto_select_latest` (BOOLEAN, nullable, default: true) - Auto-select latest firmware

**Job Types (ENUM `job_type`):**
- `firmware_update` - Update server firmware
- `discovery_scan` - Network discovery
- `vcenter_sync` - Sync ESXi hosts
- `full_server_update` - Orchestrated update with vCenter
- `test_credentials` - Test credential sets
- `power_action` - Power on/off/reboot
- `health_check` - Fetch health status
- `fetch_event_logs` - Retrieve iDRAC event logs
- `boot_configuration` - Modify boot settings
- `virtual_media_mount` / `virtual_media_unmount` - ISO mounting
- `bios_config_read` / `bios_config_write` - BIOS settings
- `scp_export` / `scp_import` - SCP backup/restore
- `vcenter_connectivity_test` - Test vCenter connection
- `openmanage_sync` - Sync from OpenManage Enterprise
- `cluster_safety_check` - Pre-update safety validation for clusters
- `server_group_safety_check` - Safety validation for server groups
- `rolling_cluster_update` - Coordinated cluster-wide update (workflow orchestration)
- `prepare_host_for_update` - Workflow step: prepare ESXi host for update
- `verify_host_after_update` - Workflow step: verify ESXi host after update

**Important Notes:**
- Jobs can have parent-child relationships via `parent_job_id`
- Rolling updates create multiple child jobs for workflow steps
- Realtime subscriptions enabled for live status updates

#### `job_tasks` - Individual Tasks Within Jobs
Sub-tasks for job tracking.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `job_id` (UUID, FK, NOT NULL) - Parent job
- `server_id` (UUID, FK, nullable) - Target server
- `vcenter_host_id` (UUID, FK, nullable) - Target ESXi host
- `status` (ENUM `job_status`, NOT NULL, default: 'pending') - Task status
- `log` (TEXT, nullable) - Task execution log
- `started_at`, `completed_at` (TIMESTAMP, nullable) - Execution timestamps
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

#### `workflow_executions` - Workflow Orchestration Steps
Tracks individual steps in multi-step workflows (e.g., rolling cluster updates).

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `job_id` (UUID, FK, NOT NULL) - Parent job
- `workflow_type` (TEXT, NOT NULL) - Workflow type (e.g., "rolling_cluster_update")
- `step_number` (INTEGER, NOT NULL) - Step sequence number
- `step_name` (TEXT, NOT NULL) - Step name (e.g., "enter_maintenance_mode")
- `step_status` (TEXT, NOT NULL) - "pending" / "running" / "completed" / "failed" / "skipped"
- `step_details` (JSONB, nullable) - Step-specific data
- `step_error` (TEXT, nullable) - Error message if failed
- `server_id` (UUID, FK, nullable) - Target server
- `host_id` (UUID, FK, nullable) - Target vCenter host
- `cluster_id` (TEXT, nullable) - Target cluster
- `step_started_at`, `step_completed_at` (TIMESTAMP, nullable) - Step execution timestamps
- `created_at` (TIMESTAMP, default: now()) - Creation timestamp

**Important Notes:**
- Used for rolling cluster updates with coordinated multi-step workflows
- Enables real-time tracking of workflow progress
- Realtime subscriptions for live step updates

**Workflow Types:**
- `rolling_cluster_update` - Cluster-wide coordinated updates
- `prepare_host_for_update` - ESXi host preparation
- `verify_host_after_update` - Post-update verification

**Typical Workflow Steps for Rolling Cluster Update:**
1. `safety_check` - Verify cluster safety
2. `enter_maintenance_mode` - Put ESXi host in maintenance mode
3. `firmware_update` - Update server firmware
4. `reboot_server` - Reboot server
5. `wait_for_online` - Wait for server to come online
6. `verify_health` - Verify server health
7. `exit_maintenance_mode` - Exit maintenance mode
8. `verify_cluster_health` - Final cluster health check

#### `maintenance_windows` - Scheduled Maintenance
Planned maintenance windows with approval workflow and automation.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `title` (TEXT, NOT NULL) - Window name
- `description` (TEXT, nullable) - Details
- `maintenance_type` (TEXT, NOT NULL) - "firmware_update" / "rolling_cluster_update" / "patch" / "hardware" / "bios_update"
- `planned_start`, `planned_end` (TIMESTAMP, NOT NULL) - Schedule
- `status` (TEXT, NOT NULL, default: 'planned') - "planned" / "in_progress" / "completed" / "cancelled" / "failed"
- `server_ids` (UUID[], nullable) - Direct server targeting
- `cluster_ids` (TEXT[], nullable) - vCenter cluster targeting
- `server_group_ids` (UUID[], nullable) - Server group targeting
- `job_ids` (UUID[], nullable) - Associated jobs
- `requires_approval` (BOOLEAN, nullable, default: false) - Approval required
- `approved_by` (UUID, FK, nullable) - Approver user ID
- `approved_at` (TIMESTAMP, nullable) - Approval timestamp
- `auto_execute` (BOOLEAN, nullable, default: true) - Auto-execute at scheduled time
- `details` (JSONB, nullable, default: '{}') - Job-specific configuration (firmware URIs, etc.)
- `credential_set_ids` (UUID[], nullable, default: '{}') - Credentials to use
- `recurrence_enabled` (BOOLEAN, nullable, default: false) - Enable recurring schedule
- `recurrence_type` (TEXT, nullable) - "one_time" / "recurring"
- `recurrence_pattern` (TEXT, nullable) - Cron pattern (e.g., "0 0 * * 0" for weekly Sunday midnight)
- `last_executed_at` (TIMESTAMP, nullable) - Last execution for recurring windows
- `notify_before_hours` (INTEGER, nullable, default: 24) - Notification lead time
- `notification_sent` (BOOLEAN, nullable, default: false) - Notification sent flag
- `safety_check_snapshot` (JSONB, nullable) - Safety check results at scheduling time
- `started_at`, `completed_at` (TIMESTAMP, nullable) - Actual execution timestamps
- `created_by` (UUID, FK, nullable) - Creator user ID
- `created_at`, `updated_at` (TIMESTAMP, default: now()) - Timestamps

**Important Features:**
- **Flexible Targeting**: Support for servers, clusters, or server groups
- **Auto-Execution**: Scheduled execution via `execute-maintenance-windows` edge function
- **Recurring Windows**: Cron-based recurring maintenance schedules
- **Approval Workflow**: Optional approval requirement before execution
- **Safety Checks**: Pre-execution safety validation snapshots
- **Notifications**: Teams/email notifications before maintenance

**Recurrence Pattern Examples:**
- `"0 2 * * 0"` - Every Sunday at 2:00 AM
- `"0 0 1 * *"` - First day of every month at midnight
- `"0 */6 * * *"` - Every 6 hours

#### `cluster_safety_checks` - vCenter Cluster Safety Validation
Tracks cluster safety checks before updates.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `cluster_id` (TEXT, NOT NULL) - vCenter cluster name
- `job_id` (UUID, FK, nullable) - Associated job
- `check_timestamp` (TIMESTAMP, default: now()) - When check was performed
- `total_hosts` (INTEGER, NOT NULL) - Total hosts in cluster
- `healthy_hosts` (INTEGER, NOT NULL) - Healthy hosts count
- `min_required_hosts` (INTEGER, NOT NULL) - Minimum required for safety
- `safe_to_proceed` (BOOLEAN, NOT NULL) - Whether safe to update
- `details` (JSONB, nullable) - Detailed check results (DRS, HA, host statuses)
- `is_scheduled` (BOOLEAN, nullable, default: false) - Part of scheduled checks
- `scheduled_check_id` (UUID, FK, nullable) - Scheduled check config reference
- `status_changed` (BOOLEAN, nullable, default: false) - Status changed from previous
- `previous_status` (TEXT, nullable) - Previous safe_to_proceed status
- `created_at` (TIMESTAMP, default: now()) - Creation timestamp

**Important Notes:**
- Used before rolling cluster updates to ensure cluster health
- Validates DRS (Distributed Resource Scheduler) is enabled
- Validates HA (High Availability) is configured
- Ensures minimum healthy hosts before allowing updates
- Realtime subscriptions for live safety status

#### `server_group_safety_checks` - Server Group Safety Validation
Tracks safety checks for custom server groups.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_group_id` (UUID, FK, nullable) - Server group reference
- `job_id` (UUID, FK, nullable) - Associated job
- `check_timestamp` (TIMESTAMP, default: now()) - When check was performed
- `total_servers` (INTEGER, NOT NULL) - Total servers in group
- `healthy_servers` (INTEGER, NOT NULL) - Healthy servers count
- `min_required_servers` (INTEGER, NOT NULL) - Minimum required for safety
- `safe_to_proceed` (BOOLEAN, NOT NULL) - Whether safe to update
- `details` (JSONB, nullable) - Detailed check results
- `warnings` (TEXT[], nullable) - Warning messages
- `is_scheduled` (BOOLEAN, nullable, default: false) - Part of scheduled checks
- `scheduled_check_id` (UUID, FK, nullable) - Scheduled check config reference
- `status_changed` (BOOLEAN, nullable, default: false) - Status changed from previous
- `previous_status` (TEXT, nullable) - Previous safe_to_proceed status
- `created_at` (TIMESTAMP, default: now()) - Creation timestamp

**Important Notes:**
- Similar to cluster safety checks but for custom server groups
- Used for application-specific server groupings
- Validates minimum healthy servers before operations

#### `scheduled_safety_checks` - Recurring Safety Check Configuration
Configuration for automated recurring safety checks.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `enabled` (BOOLEAN, nullable, default: false) - Enable scheduled checks
- `schedule_cron` (TEXT, nullable, default: '0 */6 * * *') - Cron pattern (every 6 hours default)
- `check_all_clusters` (BOOLEAN, nullable, default: true) - Check all clusters
- `specific_clusters` (TEXT[], nullable) - Specific clusters to check
- `min_required_hosts` (INTEGER, nullable, default: 2) - Minimum required hosts
- `notify_on_unsafe` (BOOLEAN, nullable, default: true) - Notify when unsafe
- `notify_on_warnings` (BOOLEAN, nullable, default: false) - Notify on warnings
- `notify_on_safe_to_unsafe_change` (BOOLEAN, nullable, default: true) - Notify on status change
- `last_status` (TEXT, nullable) - Last overall status
- `last_run_at` (TIMESTAMP, nullable) - Last execution time
- `created_at`, `updated_at` (TIMESTAMP, default: now()) - Timestamps

**Important Notes:**
- Triggered by `pg_cron` scheduled jobs
- Creates cluster safety check records on each run
- Sends notifications via Teams/email on status changes

#### `server_health` - Server Health Snapshots
Detailed server health metrics over time.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_id` (UUID, FK, NOT NULL) - Server reference
- `timestamp` (TIMESTAMP, NOT NULL, default: now()) - Snapshot timestamp
- `overall_health` (TEXT, nullable) - Overall health status
- `power_state` (TEXT, nullable) - Power state
- `cpu_health` (TEXT, nullable) - CPU health status
- `memory_health` (TEXT, nullable) - Memory health status
- `storage_health` (TEXT, nullable) - Storage health status
- `fan_health` (TEXT, nullable) - Fan health status
- `psu_health` (TEXT, nullable) - PSU (Power Supply Unit) health status
- `network_health` (TEXT, nullable) - Network health status
- `temperature_celsius` (NUMERIC, nullable) - Ambient temperature
- `sensors` (JSONB, nullable) - Detailed sensor data
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

**Important Notes:**
- Historical health tracking for trend analysis
- Retrieved from iDRAC Redfish API
- Used for health monitoring and alerting

#### `server_event_logs` - iDRAC Event Log History
System Event Log (SEL) entries from iDRAC.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_id` (UUID, FK, NOT NULL) - Server reference
- `timestamp` (TIMESTAMP, NOT NULL, default: now()) - Event timestamp
- `event_id` (TEXT, nullable) - iDRAC event ID
- `severity` (TEXT, nullable) - Event severity (OK, Warning, Critical)
- `message` (TEXT, nullable) - Event message
- `category` (TEXT, nullable) - Event category
- `sensor_type` (TEXT, nullable) - Sensor type
- `sensor_number` (TEXT, nullable) - Sensor number
- `raw_data` (JSONB, nullable) - Raw event data from iDRAC
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

**Important Notes:**
- Retrieved from iDRAC `/redfish/v1/Systems/System.Embedded.1/LogServices/EventLog/Entries`
- Used for troubleshooting hardware issues
- Filterable by severity and category

#### `server_boot_config_history` - Boot Configuration Change Tracking
Historical boot configuration changes.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_id` (UUID, FK, NOT NULL) - Server reference
- `timestamp` (TIMESTAMP, NOT NULL, default: now()) - Change timestamp
- `boot_mode` (TEXT, nullable) - Boot mode (UEFI, Legacy)
- `boot_source_override_enabled` (TEXT, nullable) - Override enabled state
- `boot_source_override_target` (TEXT, nullable) - Override target
- `boot_order` (JSONB, nullable) - Boot device order
- `changed_by` (UUID, FK, nullable) - User who made change
- `job_id` (UUID, FK, nullable) - Associated job
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

**Important Notes:**
- Tracks all boot configuration changes
- Audit trail for compliance
- Used to revert configuration if needed

#### `bios_configurations` - BIOS Settings Snapshots
BIOS configuration snapshots and pending changes.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_id` (UUID, FK, NOT NULL) - Server reference
- `snapshot_type` (TEXT, NOT NULL) - "current" / "pending" / "baseline"
- `bios_version` (TEXT, nullable) - BIOS version
- `attributes` (JSONB, NOT NULL) - BIOS attributes
- `pending_attributes` (JSONB, nullable) - Pending attribute changes
- `job_id` (UUID, FK, nullable) - Associated job
- `captured_at` (TIMESTAMP, default: now()) - Capture timestamp
- `notes` (TEXT, nullable) - Admin notes
- `created_by` (UUID, FK, nullable) - User who created
- `created_at` (TIMESTAMP, default: now()) - Creation timestamp

**Important Notes:**
- Retrieved from iDRAC `/redfish/v1/Systems/System.Embedded.1/Bios`
- Used for BIOS configuration management
- Baseline snapshots for compliance verification

#### `scp_backups` - Server Configuration Profile Backups
SCP (Server Configuration Profile) XML backups.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_id` (UUID, FK, NOT NULL) - Server reference
- `backup_name` (TEXT, NOT NULL) - Backup name
- `description` (TEXT, nullable) - Backup description
- `scp_content` (JSONB, nullable) - SCP XML content (parsed)
- `scp_file_path` (TEXT, nullable) - File path if stored externally
- `scp_file_size_bytes` (BIGINT, nullable) - File size
- `checksum` (TEXT, nullable) - MD5 checksum
- `include_bios` (BOOLEAN, nullable, default: true) - Include BIOS settings
- `include_idrac` (BOOLEAN, nullable, default: true) - Include iDRAC settings
- `include_nic` (BOOLEAN, nullable, default: true) - Include NIC settings
- `include_raid` (BOOLEAN, nullable, default: true) - Include RAID settings
- `is_valid` (BOOLEAN, nullable, default: true) - Validation status
- `validation_errors` (TEXT, nullable) - Validation error messages
- `exported_at` (TIMESTAMP, nullable) - Export timestamp
- `export_job_id` (UUID, FK, nullable) - Export job reference
- `last_imported_at` (TIMESTAMP, nullable) - Last import timestamp
- `import_job_id` (UUID, FK, nullable) - Import job reference
- `created_by` (UUID, FK, nullable) - User who created
- `created_at` (TIMESTAMP, default: now()) - Creation timestamp

**Important Notes:**
- SCP includes BIOS, iDRAC, NIC, RAID configuration
- Used for disaster recovery and cloning
- Export/import via job executor

#### `virtual_media_sessions` - Virtual Media Mount Sessions
Active and historical virtual media mounts.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `server_id` (UUID, FK, NOT NULL) - Server reference
- `media_type` (TEXT, NOT NULL) - "CD" / "DVD" / "Floppy" / "USBStick"
- `image_name` (TEXT, NOT NULL) - Image filename
- `remote_image_url` (TEXT, NOT NULL) - Full image URL (NFS/CIFS/HTTP)
- `is_mounted` (BOOLEAN, nullable, default: false) - Currently mounted
- `inserted` (BOOLEAN, nullable, default: false) - Media inserted
- `write_protected` (BOOLEAN, nullable, default: true) - Write protection
- `share_username` (TEXT, nullable) - Share username (CIFS)
- `share_password_encrypted` (TEXT, nullable) - Encrypted share password
- `mount_job_id` (UUID, FK, nullable) - Mount job reference
- `unmount_job_id` (UUID, FK, nullable) - Unmount job reference
- `mounted_at` (TIMESTAMP, nullable) - Mount timestamp
- `unmounted_at` (TIMESTAMP, nullable) - Unmount timestamp
- `created_at`, `updated_at` (TIMESTAMP, default: now()) - Timestamps

**Important Notes:**
- Used for ISO mounting for OS installation
- Supports NFS, CIFS, HTTP/HTTPS shares
- Mount/unmount via iDRAC Redfish API

#### `virtual_media_settings` - Virtual Media Global Settings
Global settings for virtual media shares.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `share_type` (TEXT, NOT NULL, default: 'nfs') - "nfs" / "cifs" / "http" / "https"
- `host` (TEXT, NOT NULL) - Share server hostname/IP
- `export_path` (TEXT, nullable) - NFS export path
- `iso_path` (TEXT, nullable) - ISO directory path
- `use_auth` (BOOLEAN, NOT NULL, default: false) - Require authentication
- `username` (TEXT, nullable) - Share username
- `password` (TEXT, nullable) - Share password (encrypted)
- `notes` (TEXT, nullable) - Admin notes
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

**Important Notes:**
- Singleton table (one row)
- Used as default share config for virtual media operations
- Test share connectivity before mounting

#### `idrac_commands` - Activity Log
Unified activity log for ALL iDRAC, vCenter, and OpenManage API calls.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `timestamp` (TIMESTAMP, NOT NULL, default: now()) - When command executed
- `server_id` (UUID, FK, nullable) - Target server
- `job_id` (UUID, FK, nullable) - Associated job
- `task_id` (UUID, FK, nullable) - Associated task
- `command_type` (TEXT, NOT NULL) - HTTP method (GET, POST, PATCH, DELETE)
- `operation_type` (ENUM `operation_type`, NOT NULL) - "idrac_api" / "vcenter_api" / "openmanage_api"
- `endpoint` (TEXT, NOT NULL) - API endpoint path
- `full_url` (TEXT, NOT NULL) - Complete URL
- `request_headers` (JSONB, nullable) - Request headers (truncated)
- `request_body` (JSONB, nullable) - Request payload (truncated)
- `response_body` (JSONB, nullable) - Response payload (truncated)
- `status_code` (INTEGER, nullable) - HTTP status code
- `response_time_ms` (INTEGER, nullable) - Latency in milliseconds
- `success` (BOOLEAN, NOT NULL, default: true) - Success/failure
- `error_message` (TEXT, nullable) - Error details
- `source` (TEXT, nullable) - "edge_function" / "job_executor" / "manual"
- `initiated_by` (UUID, FK, nullable) - User who initiated
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

**Important Notes:**
- **Used by both Edge Functions AND Job Executor**
- Provides full audit trail of all operations
- Realtime subscriptions for live updates
- Filtered in Activity Monitor page
- Request/response bodies truncated to `max_request_body_kb` / `max_response_body_kb` settings

#### `activity_settings` - System Configuration
Global settings for activity logging, retention, and throttling.

**Key Columns:**
- `id` (UUID, PK) - Primary key (singleton table)
- `encryption_key` (TEXT, nullable) - AES encryption key for passwords (base64)
- `log_level` (TEXT, NOT NULL, default: 'all') - "all" / "errors_only" / "none"
- `log_retention_days` (INTEGER, NOT NULL, default: 30) - Days to keep activity logs
- `job_retention_days` (INTEGER, nullable, default: 90) - Days to keep completed jobs
- `auto_cleanup_enabled` (BOOLEAN, NOT NULL, default: true) - Enable scheduled cleanup
- `last_cleanup_at` (TIMESTAMP, nullable) - Last cleanup execution
- `job_auto_cleanup_enabled` (BOOLEAN, nullable, default: true) - Enable job cleanup
- `job_last_cleanup_at` (TIMESTAMP, nullable) - Last job cleanup
- `auto_cancel_stale_jobs` (BOOLEAN, nullable, default: true) - Auto-cancel stuck jobs
- `stale_pending_hours` (INTEGER, nullable, default: 24) - Hours before pending job is stale
- `stale_running_hours` (INTEGER, nullable, default: 48) - Hours before running job is stale
- `keep_statistics` (BOOLEAN, NOT NULL, default: true) - Keep aggregated stats
- `statistics_retention_days` (INTEGER, NOT NULL, default: 365) - Days to keep stats
- `alert_on_failures` (BOOLEAN, NOT NULL, default: true) - Alert on API failures
- `alert_on_slow_commands` (BOOLEAN, NOT NULL, default: false) - Alert on slow commands
- `slow_command_threshold_ms` (INTEGER, NOT NULL, default: 5000) - Slow command threshold
- `max_request_body_kb` (INTEGER, NOT NULL, default: 100) - Max request body size to log
- `max_response_body_kb` (INTEGER, NOT NULL, default: 100) - Max response body size to log
- `idrac_max_concurrent` (INTEGER, nullable, default: 4) - Max concurrent iDRAC connections
- `idrac_request_delay_ms` (INTEGER, nullable, default: 500) - Delay between iDRAC requests
- `discovery_max_threads` (INTEGER, nullable, default: 5) - Max discovery threads
- `use_job_executor_for_idrac` (BOOLEAN, nullable, default: true) - Force Job Executor mode
- `pause_idrac_operations` (BOOLEAN, nullable, default: false) - Emergency pause
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

**Important Notes:**
- Singleton table (one row only)
- Controls all throttling and rate limiting
- Automatic cleanup via `cleanup-activity-logs` and `cleanup-old-jobs` functions

#### `network_settings` - Network Configuration
Network timeouts and retry settings.

**Key Columns:**
- `id` (UUID, PK) - Primary key (singleton)
- `connection_timeout_seconds` (INTEGER, NOT NULL, default: 30) - Connection timeout
- `read_timeout_seconds` (INTEGER, NOT NULL, default: 60) - Read timeout
- `operation_timeout_seconds` (INTEGER, NOT NULL, default: 300) - Long operation timeout
- `max_retry_attempts` (INTEGER, NOT NULL, default: 3) - Max retries
- `retry_delay_seconds` (INTEGER, NOT NULL, default: 2) - Delay between retries
- `retry_backoff_type` (TEXT, NOT NULL, default: 'exponential') - "linear" / "exponential"
- `max_concurrent_connections` (INTEGER, NOT NULL, default: 5) - Max concurrent connections
- `max_requests_per_minute` (INTEGER, NOT NULL, default: 60) - Rate limit
- `require_prereq_validation` (BOOLEAN, NOT NULL, default: true) - Validate network prerequisites
- `monitor_latency` (BOOLEAN, NOT NULL, default: true) - Monitor API latency
- `latency_alert_threshold_ms` (INTEGER, NOT NULL, default: 1000) - Latency alert threshold
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

#### `notification_settings` - Notification Configuration
Email and Teams notification settings.

**Key Columns:**
- `id` (UUID, PK) - Primary key (singleton)
- `smtp_host` (TEXT, nullable) - SMTP server
- `smtp_port` (INTEGER, nullable, default: 587) - SMTP port
- `smtp_user` (TEXT, nullable) - SMTP username
- `smtp_password` (TEXT, nullable) - SMTP password
- `smtp_from_email` (TEXT, nullable) - From email address
- `teams_webhook_url` (TEXT, nullable) - Microsoft Teams webhook URL
- `teams_mention_users` (TEXT, nullable) - Users to @mention (comma-separated)
- `notify_on_job_started` (BOOLEAN, nullable, default: false) - Notify on job start
- `notify_on_job_complete` (BOOLEAN, nullable, default: true) - Notify on job completion
- `notify_on_job_failed` (BOOLEAN, nullable, default: true) - Notify on job failure
- `critical_job_types` (TEXT[], nullable, default: '{firmware_update,full_server_update}') - Critical job types
- `mention_on_critical_failures` (BOOLEAN, nullable, default: true) - @mention on critical failures
- `notify_on_unsafe_cluster` (BOOLEAN, nullable, default: true) - Notify when cluster unsafe
- `notify_on_cluster_warning` (BOOLEAN, nullable, default: false) - Notify on warnings
- `notify_on_cluster_status_change` (BOOLEAN, nullable, default: true) - Notify on status change
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

#### `notification_logs` - Notification History
Log of all sent notifications.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `notification_type` (TEXT, NOT NULL) - Notification type
- `job_id` (UUID, FK, nullable) - Associated job
- `status` (TEXT, NOT NULL) - "sent" / "failed"
- `delivery_details` (JSONB, nullable) - Delivery metadata
- `error_message` (TEXT, nullable) - Error if failed
- `severity` (TEXT, nullable, default: 'normal') - "normal" / "warning" / "critical"
- `is_test` (BOOLEAN, NOT NULL, default: false) - Test notification
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

#### `vcenter_settings` - vCenter Configuration
VMware vCenter connection settings.

**Key Columns:**
- `id` (UUID, PK) - Primary key (singleton)
- `host` (TEXT, NOT NULL) - vCenter hostname/IP
- `port` (INTEGER, NOT NULL, default: 443) - vCenter port
- `username` (TEXT, NOT NULL) - vCenter username
- `password` (TEXT, nullable) - vCenter password
- `verify_ssl` (BOOLEAN, NOT NULL, default: true) - Verify SSL certificate
- `sync_enabled` (BOOLEAN, NOT NULL, default: false) - Enable automatic sync
- `last_sync` (TIMESTAMP, nullable) - Last sync timestamp
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

#### `openmanage_settings` - OpenManage Enterprise Configuration
Dell OpenManage Enterprise connection settings.

**Key Columns:**
- `id` (UUID, PK) - Primary key (singleton)
- `host` (TEXT, NOT NULL) - OME hostname/IP
- `port` (INTEGER, NOT NULL, default: 443) - OME port
- `username` (TEXT, NOT NULL) - OME username
- `password` (TEXT, nullable) - OME password
- `verify_ssl` (BOOLEAN, NOT NULL, default: true) - Verify SSL certificate
- `sync_enabled` (BOOLEAN, NOT NULL, default: false) - Enable automatic sync
- `last_sync` (TIMESTAMP, nullable) - Last sync timestamp
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

#### `profiles` - User Profiles
Extended user information (linked to `auth.users`).

**Key Columns:**
- `id` (UUID, PK) - Matches `auth.users.id`
- `email` (TEXT, unique, NOT NULL) - User email
- `full_name` (TEXT, nullable) - Display name
- `created_at`, `updated_at` (TIMESTAMP, NOT NULL, default: now()) - Timestamps

**Important**: NEVER reference `auth.users` directly in queries. Always use `profiles`.

#### `user_roles` - Role-Based Access Control
User role assignments.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `user_id` (UUID, FK, NOT NULL) - User reference
- `role` (ENUM `app_role`, NOT NULL, default: 'viewer') - "admin" / "operator" / "viewer"
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

**Roles:**
- **admin** - Full access (CRUD on all tables, manage users, settings)
- **operator** - Can create/update servers, jobs, maintenance windows
- **viewer** - Read-only access

#### `audit_logs` - Audit Trail
System-wide audit logging.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `user_id` (UUID, FK, nullable) - User who performed action
- `action` (TEXT, NOT NULL) - Action performed
- `details` (JSONB, nullable) - Action details
- `ip_address` (TEXT, nullable) - Client IP address
- `timestamp` (TIMESTAMP, NOT NULL, default: now()) - Action timestamp
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

#### `api_tokens` - API Token Management
API tokens for programmatic access.

**Key Columns:**
- `id` (UUID, PK) - Primary key
- `user_id` (UUID, FK, NOT NULL) - Token owner
- `name` (TEXT, NOT NULL) - Token name
- `token_hash` (TEXT, NOT NULL) - SHA-256 hash of token
- `expires_at` (TIMESTAMP, nullable) - Expiration timestamp
- `last_used_at` (TIMESTAMP, nullable) - Last usage timestamp
- `created_at` (TIMESTAMP, NOT NULL, default: now()) - Creation timestamp

---

## Common Implementation Patterns

### 1. Adding a New iDRAC Operation

**Step 1: Add Job Type (Database Migration)**
```sql
-- Add new job type to enum
ALTER TYPE job_type ADD VALUE 'new_operation';
```

**Step 2: Implement in Job Executor (job-executor.py)**
```python
def execute_new_operation(self, job_id):
    """Execute new iDRAC operation."""
    job = self.get_job_by_id(job_id)
    if not job:
        return
    
    # Extract target servers from job details
    target_scope = job.get('target_scope', {})
    server_ids = target_scope.get('server_ids', [])
    
    self.update_job_status(job_id, 'running')
    
    for server_id in server_ids:
        try:
            server = self.get_server_by_id(server_id)
            username, password = self.get_credentials_for_server(server)
            
            # Make iDRAC API call
            response = requests.get(
                f"https://{server['ip_address']}/redfish/v1/Systems/System.Embedded.1",
                auth=(username, password),
                verify=False,
                timeout=30
            )
            
            # Log the command
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=response.url,
                request_body=None,
                response_body=response.json(),
                status_code=response.status_code,
                response_time_ms=int(response.elapsed.total_seconds() * 1000),
                success=response.ok,
                error_message=None if response.ok else response.text
            )
            
            if response.ok:
                # Process response
                pass
            else:
                raise Exception(f"API call failed: {response.text}")
                
        except Exception as e:
            self.update_job_status(job_id, 'failed', details={'error': str(e)})
            return
    
    self.update_job_status(job_id, 'completed')
```

**Step 3: Create UI Component (React)**
```tsx
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";

// In your component
<CreateJobDialog 
  jobType="new_operation" 
  targetScope={{ server_ids: selectedServerIds }}
/>
```

**Step 4: Poll Job Status**
```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const { data: job } = useQuery({
  queryKey: ['jobs', jobId],
  queryFn: async () => {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    return data;
  },
  refetchInterval: (data) => 
    data?.status === 'pending' || data?.status === 'running' ? 3000 : false
});
```

### 2. Detecting Deployment Mode

**Always detect mode to adjust UI/features:**

```typescript
// In your React component
const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                   import.meta.env.VITE_SUPABASE_URL?.includes('localhost');

if (isLocalMode) {
  // Local mode: Hide edge function features
  return (
    <Alert>
      <AlertDescription>
        Local Mode: Use Job Executor for iDRAC operations.
        Check Settings → Diagnostics for Job Executor status.
      </AlertDescription>
    </Alert>
  );
} else {
  // Cloud mode: Show instant preview option
  return (
    <Button onClick={testConnection}>
      Test Connection
    </Button>
  );
}
```

### 3. Server Grouping Logic

Servers can be grouped in two ways:

**Manual Groups:**
- User-created via `server_groups` table
- Many-to-many relationship via `server_group_members`

**vCenter Cluster Groups:**
- Auto-created during vCenter sync
- Based on ESXi host cluster membership
- `group_type = 'vcenter_cluster'`

**"Ungrouped Servers" Logic:**
```typescript
const isServerUngrouped = (server: Server, groups: ServerGroup[], memberships: ServerGroupMember[]) => {
  // Check manual groups
  const hasManualGroup = memberships.some(m => m.server_id === server.id);
  
  // Check vCenter cluster group
  const hasVcenterGroup = server.vcenter_host_id && 
    groups.some(g => g.group_type === 'vcenter_cluster' && 
                     memberships.some(m => m.server_id === server.id && m.server_group_id === g.id));
  
  return !hasManualGroup && !hasVcenterGroup;
};
```

### 4. Credential Resolution

**Priority Order:**
1. Server-specific credentials (`servers.idrac_username` and `idrac_password_encrypted`)
2. Credential sets with matching IP range (by `priority`, lower = higher)
3. Default credential set (`is_default = true`)

**Implementation (Job Executor):**
```python
def resolve_credentials_for_server(self, server: Dict) -> Tuple[Optional[str], Optional[str]]:
    """Resolve credentials for a server."""
    # 1. Check server-specific credentials
    if server.get('idrac_username') and server.get('idrac_password_encrypted'):
        password = self.decrypt_password(server['idrac_password_encrypted'])
        return server['idrac_username'], password
    
    # 2. Check linked credential set
    if server.get('credential_set_id'):
        cred_set = self.get_credential_set(server['credential_set_id'])
        if cred_set:
            password = self.decrypt_password(cred_set['password_encrypted'])
            return cred_set['username'], password
    
    # 3. Check IP range mapping
    server_ip = server['ip_address']
    matching_sets = self.find_credential_sets_for_ip(server_ip)
    if matching_sets:
        # Use highest priority (lowest number)
        cred_set = min(matching_sets, key=lambda x: x['priority'] or 999)
        password = self.decrypt_password(cred_set['password_encrypted'])
        return cred_set['username'], password
    
    # 4. Fall back to default
    default_set = self.get_default_credential_set()
    if default_set:
        password = self.decrypt_password(default_set['password_encrypted'])
        return default_set['username'], password
    
    # 5. Last resort: environment variables
    return os.getenv('IDRAC_DEFAULT_USER'), os.getenv('IDRAC_DEFAULT_PASSWORD')
```

### 5. Activity Logging

**Log ALL API calls (iDRAC, vCenter, OpenManage) to `idrac_commands` table:**

**From Job Executor:**
```python
def log_idrac_command(self, server_id, job_id, command_type, endpoint, full_url, 
                      request_body, response_body, status_code, response_time_ms, 
                      success, error_message=None):
    """Log an iDRAC command to activity log."""
    payload = {
        'server_id': server_id,
        'job_id': job_id,
        'command_type': command_type,
        'operation_type': 'idrac_api',
        'endpoint': endpoint,
        'full_url': full_url,
        'request_body': request_body,
        'response_body': response_body,
        'status_code': status_code,
        'response_time_ms': response_time_ms,
        'success': success,
        'error_message': error_message,
        'source': 'job_executor',
        'timestamp': datetime.utcnow().isoformat()
    }
    
    response = requests.post(
        f"{self.supabase_url}/rest/v1/idrac_commands",
        headers={
            'apikey': self.service_role_key,
            'Authorization': f'Bearer {self.service_role_key}',
            'Content-Type': 'application/json'
        },
        json=payload
    )
```

**From Edge Functions:**
```typescript
import { logIdracCommand } from "../_shared/idrac-logger.ts";

// After making iDRAC API call
await logIdracCommand(supabase, {
  server_id: serverId,
  job_id: null, // or job ID if part of a job
  command_type: 'GET',
  operation_type: 'idrac_api',
  endpoint: '/redfish/v1/Systems/System.Embedded.1',
  full_url: `https://${server.ip_address}/redfish/v1/Systems/System.Embedded.1`,
  request_body: null,
  response_body: responseData,
  status_code: 200,
  response_time_ms: elapsed,
  success: true,
  error_message: null,
  source: 'edge_function',
  initiated_by: userId
});
```

### 6. Realtime Updates

**Tables with realtime enabled:**
- `idrac_commands` - Activity logging
- `jobs` - Job status updates
- `job_tasks` - Task progress
- `workflow_executions` - Workflow step progress
- `maintenance_windows` - Maintenance window status
- `cluster_safety_checks` - Safety check results
- `server_group_safety_checks` - Group safety results

**Enable realtime for a table:**
```sql
-- In migration
ALTER PUBLICATION supabase_realtime ADD TABLE public.idrac_commands;
```

**Subscribe in React:**
```typescript
useEffect(() => {
  const channel = supabase
    .channel('idrac-commands-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'idrac_commands'
      },
      (payload) => {
        console.log('New command:', payload.new);
        // Update UI
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}, []);
```

---

## Workflow Orchestration System

### Overview

The workflow orchestration system enables **coordinated multi-step operations** across servers and clusters, particularly for rolling cluster updates that require precise sequencing.

### Key Components

1. **`workflow_executions` table** - Tracks individual workflow steps
2. **Job hierarchy** - Parent jobs with child workflow jobs
3. **Real-time tracking** - Live step-by-step progress
4. **Error handling** - Graceful failure and rollback

### Rolling Cluster Update Workflow

A rolling cluster update coordinates firmware updates across a vCenter cluster while maintaining cluster health and availability.

**Workflow Steps:**

1. **Cluster Safety Check** (`safety_check`)
   - Verify cluster has DRS and HA enabled
   - Ensure minimum healthy hosts available
   - Check no hosts already in maintenance mode

2. **Enter Maintenance Mode** (`enter_maintenance_mode`)
   - Put ESXi host in maintenance mode via vCenter API
   - Evacuate VMs using DRS
   - Wait for VM migration completion

3. **Firmware Update** (`firmware_update`)
   - Update server firmware via iDRAC
   - Apply BIOS, iDRAC, network, storage updates
   - Schedule firmware jobs

4. **Reboot Server** (`reboot_server`)
   - Graceful reboot via iDRAC
   - Apply pending firmware updates

5. **Wait for Online** (`wait_for_online`)
   - Poll iDRAC until server comes back online
   - Verify power state and connectivity

6. **Verify Health** (`verify_health`)
   - Check server health status
   - Verify firmware versions applied
   - Validate hardware sensors

7. **Exit Maintenance Mode** (`exit_maintenance_mode`)
   - Exit maintenance mode in vCenter
   - Restore normal operations

8. **Verify Cluster Health** (`verify_cluster_health`)
   - Final cluster health check
   - Ensure DRS and HA still functional
   - Validate all hosts online

**Job Hierarchy:**
```
rolling_cluster_update (parent job)
├── prepare_host_for_update (child job, host 1)
│   └── workflow_executions (steps 1-2)
├── firmware_update (child job, host 1)
│   └── workflow_executions (steps 3-4)
├── verify_host_after_update (child job, host 1)
│   └── workflow_executions (steps 5-8)
├── prepare_host_for_update (child job, host 2)
│   └── workflow_executions (steps 1-2)
└── ... (repeat for each host)
```

### Implementation Example

**Create Rolling Cluster Update Job:**
```typescript
const { data: job } = await supabase.functions.invoke('create-job', {
  body: {
    job_type: 'rolling_cluster_update',
    target_scope: {
      cluster_ids: ['Production-Cluster-01']
    },
    details: {
      firmware_source: 'dell_catalog',
      auto_select_latest: true,
      min_required_hosts: 2,
      sequential: true,  // Update one host at a time
      max_concurrent: 1
    }
  }
});
```

**Track Workflow Progress:**
```tsx
const { data: steps } = useQuery({
  queryKey: ['workflow-executions', jobId],
  queryFn: async () => {
    const { data } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('job_id', jobId)
      .order('step_number', { ascending: true });
    return data;
  },
  refetchInterval: 3000  // Poll every 3 seconds
});

// Real-time subscription
useEffect(() => {
  const channel = supabase
    .channel(`workflow-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'workflow_executions',
        filter: `job_id=eq.${jobId}`
      },
      (payload) => {
        // Update UI with new step status
        queryClient.invalidateQueries(['workflow-executions', jobId]);
      }
    )
    .subscribe();

  return () => channel.unsubscribe();
}, [jobId]);
```

### Safety Mechanisms

**Pre-Update Validation:**
- Cluster has DRS enabled (for VM migration)
- Cluster has HA configured (for fault tolerance)
- Minimum required hosts available (`min_required_hosts`)
- No hosts already in maintenance mode

**During Update:**
- Sequential processing (one host at a time by default)
- Wait for VM evacuation before updating
- Monitor server health after update
- Verify firmware applied successfully

**Error Handling:**
- If any step fails, workflow stops
- Host remains in last known safe state
- Admin can retry failed step or cancel workflow
- All workflow steps logged to `workflow_executions`

---

## Maintenance Window Automation

### Overview

The maintenance window system provides **scheduled, automated execution** of maintenance operations with approval workflows, recurring schedules, and safety validations.

### Key Features

1. **Auto-Execution** - Automatic job creation at scheduled time
2. **Recurring Windows** - Cron-based recurring schedules
3. **Approval Workflow** - Optional approval before execution
4. **Safety Snapshots** - Pre-execution safety validation
5. **Notifications** - Teams/email notifications before maintenance
6. **Flexible Targeting** - Servers, clusters, or server groups

### Maintenance Window Types

- `firmware_update` - Standard firmware updates
- `rolling_cluster_update` - Coordinated cluster updates
- `patch` - OS/software patching
- `hardware` - Hardware maintenance
- `bios_update` - BIOS configuration changes

### Creating a Maintenance Window

**One-Time Window:**
```tsx
const { data } = await supabase
  .from('maintenance_windows')
  .insert({
    title: 'Q1 2025 Firmware Update',
    description: 'Update all production servers to latest firmware',
    maintenance_type: 'rolling_cluster_update',
    planned_start: '2025-03-01T02:00:00Z',
    planned_end: '2025-03-01T06:00:00Z',
    cluster_ids: ['Production-Cluster-01'],
    auto_execute: true,
    requires_approval: true,
    notify_before_hours: 48,
    details: {
      firmware_source: 'dell_catalog',
      auto_select_latest: true,
      sequential: true
    },
    credential_set_ids: [defaultCredSetId]
  });
```

**Recurring Window:**
```tsx
const { data } = await supabase
  .from('maintenance_windows')
  .insert({
    title: 'Weekly Server Health Check',
    description: 'Automated weekly health validation',
    maintenance_type: 'health_check',
    planned_start: '2025-01-26T02:00:00Z',
    planned_end: '2025-01-26T03:00:00Z',
    recurrence_enabled: true,
    recurrence_type: 'recurring',
    recurrence_pattern: '0 2 * * 0',  // Every Sunday at 2 AM
    server_group_ids: [productionGroupId],
    auto_execute: true,
    requires_approval: false
  });
```

### Execution Flow

**Scheduled Execution (via `execute-maintenance-windows` edge function):**

1. **Fetch Planned Windows** - Query for windows where `planned_start <= NOW()` and `status = 'planned'`
2. **Process Recurring Windows** - For recurring windows, calculate next execution and create new instance
3. **Resolve Targets** - Resolve servers from `server_ids`, `cluster_ids`, or `server_group_ids`
4. **Safety Check** - Run pre-execution safety validation and store snapshot
5. **Create Jobs** - Create job(s) based on `maintenance_type`
6. **Update Status** - Set window status to `in_progress`
7. **Send Notification** - Notify via Teams/email
8. **Monitor Jobs** - Track job completion and update window status

**Cron Trigger:**
```sql
-- Runs every 5 minutes via pg_cron
SELECT cron.schedule(
  'execute-maintenance-windows',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/execute-maintenance-windows',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

### Approval Workflow

**Request Approval:**
```tsx
// Window requires approval
const window = {
  requires_approval: true,
  approved_by: null,
  approved_at: null
};

// Admin approves
await supabase
  .from('maintenance_windows')
  .update({
    approved_by: userId,
    approved_at: new Date().toISOString()
  })
  .eq('id', windowId);
```

**Execution Check:**
- If `requires_approval = true` and `approved_by IS NULL`, window will not execute
- Notification sent to request approval before `planned_start`

### Recurring Patterns

**Cron Pattern Examples:**
```
0 2 * * 0      # Every Sunday at 2:00 AM
0 0 1 * *      # First day of every month at midnight
0 */6 * * *    # Every 6 hours
0 2 * * 1-5    # Every weekday at 2:00 AM
0 0 1 */3 *    # Every 3 months on the 1st
```

**Next Execution Calculation:**
```typescript
// In execute-maintenance-windows function
function calculateNextExecution(cronPattern: string, lastExecution: string): Date {
  // Parse cron pattern (minute hour day month weekday)
  // Calculate next matching timestamp after lastExecution
  // Return next execution date
}
```

### Optimal Window Analysis

**Analyze Optimal Maintenance Windows:**
```tsx
const { data } = await supabase.functions.invoke('analyze-maintenance-windows', {
  body: {
    clusters: ['Production-Cluster-01'],
    start_date: '2025-01-21T00:00:00Z',
    end_date: '2025-04-21T00:00:00Z',
    min_window_duration_hours: 4
  }
});

// Returns optimal windows based on:
// - Historical cluster health data
// - Scheduled maintenance windows
// - Safety check trends
// - Minimum required hosts availability
```

**Optimal Window Response:**
```json
{
  "optimal_windows": [
    {
      "start": "2025-02-09T02:00:00Z",
      "end": "2025-02-09T06:00:00Z",
      "duration_hours": 4,
      "confidence": "high",
      "affected_clusters": ["Production-Cluster-01"],
      "all_clusters_safe": true,
      "avg_healthy_hosts": 8,
      "avg_total_hosts": 8,
      "reason": "High cluster health, no conflicts"
    }
  ]
}
```

---

## Safety Check System

### Overview

The safety check system provides **automated validation** of cluster and server group health before maintenance operations, preventing unsafe updates.

### Key Components

1. **Cluster Safety Checks** (`cluster_safety_checks`) - vCenter cluster validation
2. **Server Group Safety Checks** (`server_group_safety_checks`) - Custom group validation
3. **Scheduled Safety Checks** (`scheduled_safety_checks`) - Recurring automated checks
4. **Notifications** - Alerts on status changes

### Cluster Safety Checks

**What's Validated:**
- **DRS Enabled** - Distributed Resource Scheduler for VM migration
- **HA Configured** - High Availability for fault tolerance
- **Healthy Hosts** - Minimum number of healthy hosts available
- **No Maintenance Mode** - No hosts currently in maintenance
- **Host Connectivity** - All hosts reachable and responsive

**Run Safety Check:**
```tsx
const { data: job } = await supabase.functions.invoke('create-job', {
  body: {
    job_type: 'cluster_safety_check',
    target_scope: {
      cluster_ids: ['Production-Cluster-01']
    },
    details: {
      min_required_hosts: 2,
      check_drs: true,
      check_ha: true
    }
  }
});

// Job Executor performs check and creates cluster_safety_checks record
```

**Safety Check Record:**
```json
{
  "id": "uuid",
  "cluster_id": "Production-Cluster-01",
  "total_hosts": 8,
  "healthy_hosts": 8,
  "min_required_hosts": 2,
  "safe_to_proceed": true,
  "details": {
    "drs_enabled": true,
    "ha_enabled": true,
    "hosts_in_maintenance": 0,
    "host_statuses": [
      { "name": "esxi01", "status": "connected", "health": "green" },
      { "name": "esxi02", "status": "connected", "health": "green" }
    ]
  },
  "check_timestamp": "2025-01-21T10:00:00Z"
}
```

### Server Group Safety Checks

**What's Validated:**
- **Healthy Servers** - Minimum number of healthy servers in group
- **Server Connectivity** - All servers reachable via iDRAC
- **Health Status** - Overall health from iDRAC
- **Power State** - Servers powered on

**Run Group Safety Check:**
```tsx
const { data: job } = await supabase.functions.invoke('create-job', {
  body: {
    job_type: 'server_group_safety_check',
    target_scope: {
      server_group_ids: [groupId]
    },
    details: {
      min_required_servers: 2
    }
  }
});
```

### Scheduled Safety Checks

**Configuration:**
```tsx
await supabase
  .from('scheduled_safety_checks')
  .update({
    enabled: true,
    schedule_cron: '0 */6 * * *',  // Every 6 hours
    check_all_clusters: true,
    min_required_hosts: 2,
    notify_on_unsafe: true,
    notify_on_safe_to_unsafe_change: true
  })
  .eq('id', configId);
```

**Execution (via pg_cron):**
```sql
-- Runs every 6 hours
SELECT cron.schedule(
  'run-scheduled-safety-checks',
  '0 */6 * * *',
  $$
  SELECT public.run_scheduled_cluster_safety_checks();
  $$
);
```

**Database Function:**
```sql
CREATE OR REPLACE FUNCTION public.run_scheduled_cluster_safety_checks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  config_record RECORD;
  cluster_record RECORD;
  job_id uuid;
  system_user_id uuid;
BEGIN
  -- Get config
  SELECT * INTO config_record 
  FROM scheduled_safety_checks 
  WHERE enabled = true LIMIT 1;
  
  IF NOT FOUND THEN RETURN; END IF;
  
  -- Get admin user
  SELECT id INTO system_user_id 
  FROM profiles 
  WHERE id IN (SELECT user_id FROM user_roles WHERE role = 'admin') 
  LIMIT 1;
  
  -- Create jobs for each cluster
  FOR cluster_record IN 
    SELECT DISTINCT cluster 
    FROM vcenter_hosts 
    WHERE cluster IS NOT NULL 
      AND (config_record.check_all_clusters = true 
           OR cluster = ANY(config_record.specific_clusters))
  LOOP
    INSERT INTO jobs (job_type, created_by, status, details, target_scope) 
    VALUES (
      'cluster_safety_check',
      system_user_id,
      'pending',
      jsonb_build_object(
        'cluster_name', cluster_record.cluster,
        'min_required_hosts', config_record.min_required_hosts,
        'is_scheduled', true,
        'scheduled_check_id', config_record.id
      ),
      '{}'::jsonb
    );
  END LOOP;
  
  -- Update last run timestamp
  UPDATE scheduled_safety_checks 
  SET last_run_at = NOW() 
  WHERE id = config_record.id;
END;
$$;
```

### Safety Status Tracking

**Fetch Safety Status for Date Range:**
```tsx
const { data: clusterChecks } = await supabase
  .from('cluster_safety_checks')
  .select('*')
  .gte('check_timestamp', startDate)
  .lte('check_timestamp', endDate)
  .order('check_timestamp', { ascending: true });

const { data: groupChecks } = await supabase
  .from('server_group_safety_checks')
  .select('*')
  .gte('check_timestamp', startDate)
  .lte('check_timestamp', endDate)
  .order('check_timestamp', { ascending: true });
```

**Aggregate Daily Status:**
```tsx
// In useSafetyStatus.ts hook
const dailyStatus = useMemo(() => {
  const statusMap = new Map<string, ClusterSafetyDay>();
  
  clusterChecks?.forEach(check => {
    const date = format(new Date(check.check_timestamp), 'yyyy-MM-dd');
    if (!statusMap.has(date)) {
      statusMap.set(date, {
        date,
        clusters: [],
        serverGroups: [],
        maintenanceWindows: [],
        allTargetsChecked: false,
        allTargetsSafe: true,
        hasWarnings: false
      });
    }
    
    const day = statusMap.get(date)!;
    day.clusters.push({
      cluster_id: check.cluster_id,
      safe: check.safe_to_proceed,
      healthy_hosts: check.healthy_hosts,
      total_hosts: check.total_hosts
    });
  });
  
  // Calculate daily aggregates
  statusMap.forEach(day => {
    const totalTargets = day.clusters.length + day.serverGroups.length;
    day.allTargetsChecked = totalTargets > 0;
    day.allTargetsSafe = 
      day.clusters.every(c => c.safe) &&
      day.serverGroups.every(g => g.safe);
    day.hasWarnings = !day.allTargetsSafe;
  });
  
  return Array.from(statusMap.values());
}, [clusterChecks, groupChecks]);
```

### Safety Calendar Visualization

**Components:**
- `SafetyCalendar.tsx` - Calendar view with color-coded safety status
- `ClusterSafetyTrendChart.tsx` - Historical safety trends
- `SafetyStatusTable.tsx` - Tabular view of current status

**Status Colors:**
- 🟢 **Green** - All targets safe (`allTargetsSafe = true`)
- 🟡 **Yellow** - Some warnings (`hasWarnings = true`)
- 🔴 **Red** - Unsafe to proceed (`allTargetsSafe = false`)
- ⚪ **Gray** - No checks performed

---

## Critical DO's and DON'Ts

### ✅ DO

1. **Create job types for iDRAC operations** in local deployments
2. **Detect local vs cloud mode** and adjust UI accordingly
3. **Use Job Executor** for all iDRAC operations in local mode
4. **Assume iDRAC devices are on private networks** (192.168.x.x, 10.x.x.x)
5. **Store credentials encrypted** in database with proper encryption
6. **Support credential sets** with IP range mapping
7. **Implement proper error handling** for network timeouts
8. **Add activity logging** for all iDRAC commands
9. **Support both auto-discovery and manual server entry**
10. **Use RLS policies** for database security
11. **Implement RBAC** with admin/operator/viewer roles
12. **Poll job status** for completion (don't rely on edge functions in local mode)
13. **Show helpful local mode messages** when edge functions won't work
14. **Test in both local and cloud modes** when possible
15. **Log workflow execution steps** to `workflow_executions`
16. **Validate cluster safety** before rolling updates
17. **Use realtime subscriptions** for live updates
18. **Create maintenance windows** for scheduled operations
19. **Implement safety checks** before risky operations
20. **Send notifications** for critical events

### ❌ DON'T

1. **Assume cloud connectivity is available**
2. **Rely on edge functions** for iDRAC operations in local mode
3. **Suggest users need VPNs** or cloud access for basic iDRAC operations
4. **Create cloud-only features** without local alternatives
5. **Store passwords in plaintext**
6. **Try to modify Docker networking** (Job Executor is the solution)
7. **Execute raw SQL in edge functions** (use Supabase client methods)
8. **Reference `auth.users` table directly** (use `profiles` instead)
9. **Hardcode URLs or credentials** (use environment variables)
10. **Forget to log API calls** (always log to `idrac_commands`)
11. **Ignore deployment mode** (always detect and adapt UI)
12. **Make assumptions about network architecture** (support all private ranges)
13. **Create monolithic edge functions** (Job Executor handles complex logic)
14. **Skip credential testing** before operations
15. **Update firmware without safety checks** (validate cluster health first)
16. **Ignore workflow step failures** (implement proper error handling)
17. **Hard-delete audit logs** (use soft deletes or archiving)
18. **Skip notifications** for critical operations

---

## Job Executor Architecture

### Main Script: `job-executor.py`

**Entry Point:**
- Called by external tools/services (cron, systemd, Task Scheduler)
- Polls Supabase for pending jobs
- Executes jobs and updates status
- Modular design with mixins

**Key Methods:**
```python
class JobExecutor(ScpMixin, ConnectivityMixin):
    def run(self):
        """Main execution loop - poll for pending jobs."""
        
    def execute_job(self, job_id):
        """Route job to appropriate handler based on job_type."""
        
    # Server management
    def get_server_by_id(self, server_id) -> Optional[Dict]
    def get_credentials_for_server(self, server) -> Tuple[str, str]
    def resolve_credentials_for_server(self, server) -> Tuple[Optional[str], Optional[str]]
    
    # Job handlers - iDRAC Operations
    def execute_firmware_update(self, job_id)
    def execute_discovery_scan(self, job_id)
    def execute_test_credentials(self, job_id)
    def execute_power_action(self, job_id)
    def execute_health_check(self, job_id)
    def execute_boot_configuration(self, job_id)
    def execute_bios_config_read(self, job_id)
    def execute_bios_config_write(self, job_id)
    def execute_fetch_event_logs(self, job_id)
    def execute_virtual_media_mount(self, job_id)
    def execute_virtual_media_unmount(self, job_id)
    
    # Job handlers - vCenter Operations
    def execute_vcenter_sync(self, job_id)
    def execute_vcenter_connectivity_test(self, job_id)
    def execute_full_server_update(self, job_id)  # Orchestrated update with vCenter
    
    # Job handlers - Workflow Orchestration
    def execute_rolling_cluster_update(self, job_id)
    def execute_prepare_host_for_update(self, job_id)
    def execute_verify_host_after_update(self, job_id)
    
    # Job handlers - Safety Checks
    def execute_cluster_safety_check(self, job_id)
    def execute_server_group_safety_check(self, job_id)
    
    # Job handlers - OpenManage
    def execute_openmanage_sync(self, job_id)
    
    # Utilities
    def update_job_status(self, job_id, status, details=None)
    def create_workflow_step(self, job_id, workflow_type, step_number, step_name, **kwargs)
    def update_workflow_step(self, step_id, status, error=None, details=None)
    def log_idrac_command(self, ...)
    def decrypt_password(self, encrypted_password) -> str
    def get_vcenter_connection(self) -> vim.ServiceInstance
```

### Modules

#### `job_executor/config.py` - Configuration
```python
# Environment variable loading
SUPABASE_URL = os.getenv('SUPABASE_URL')
SERVICE_ROLE_KEY = os.getenv('SERVICE_ROLE_KEY')
IDRAC_DEFAULT_USER = os.getenv('IDRAC_DEFAULT_USER')
IDRAC_DEFAULT_PASSWORD = os.getenv('IDRAC_DEFAULT_PASSWORD')
VCENTER_HOST = os.getenv('VCENTER_HOST')
VCENTER_USER = os.getenv('VCENTER_USER')
VCENTER_PASSWORD = os.getenv('VCENTER_PASSWORD')
FIRMWARE_REPO_URL = os.getenv('FIRMWARE_REPO_URL')
ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY')  # Optional, can use DB key
DSM_URL = os.getenv('DSM_URL')  # Dell Server Manager URL for notifications
```

#### `job_executor/connectivity.py` - Network Operations
```python
class ConnectivityMixin:
    def test_server_connection(self, server_ip, username, password) -> bool:
        """Test iDRAC connectivity."""
        
    def discover_servers_in_range(self, ip_range, credential_sets) -> List[Dict]:
        """Network discovery scan."""
        
    def ping_host(self, ip_address) -> bool:
        """ICMP ping check."""
        
    def validate_network_prerequisites(self, server) -> Tuple[bool, str]:
        """Validate network requirements before operations."""
```

#### `job_executor/scp.py` - SCP Backup/Restore
```python
class ScpMixin:
    def execute_scp_export(self, job_id):
        """Export SCP configuration backup."""
        
    def execute_scp_import(self, job_id):
        """Import SCP configuration."""
        
    def validate_scp_file(self, scp_content) -> Tuple[bool, Optional[str]]:
        """Validate SCP XML content."""
        
    def parse_scp_xml(self, xml_content) -> Dict:
        """Parse SCP XML into structured data."""
```

#### `job_executor/utils.py` - Utilities
```python
def _safe_json_parse(text: str) -> Optional[Dict]:
    """Safely parse JSON with fallback."""
    
def decode_safe(data: Any, default: str = '') -> str:
    """Safely decode bytes to string with Unicode handling."""
    
def truncate_json_body(data: Dict, max_kb: int) -> Dict:
    """Truncate JSON for logging."""
```

### Execution Flow

1. **Poll for Jobs**: `run()` continuously polls `jobs` table for `status = 'pending'`
2. **Route to Handler**: `execute_job()` routes based on `job_type`
3. **Update Status**: Mark job as `running`
4. **Execute Operation**: Make iDRAC/vCenter API calls
5. **Log Commands**: Write to `idrac_commands` for every API call
6. **Create Workflow Steps**: For orchestrated workflows, create `workflow_executions` records
7. **Update Status**: Mark job as `completed` or `failed`
8. **Repeat**: Loop back to step 1

### Workflow Orchestration Example

**Rolling Cluster Update Implementation:**
```python
def execute_rolling_cluster_update(self, job_id):
    """Orchestrate cluster-wide rolling update."""
    job = self.get_job_by_id(job_id)
    cluster_ids = job['target_scope'].get('cluster_ids', [])
    
    for cluster_id in cluster_ids:
        # Step 1: Safety check
        step = self.create_workflow_step(
            job_id, 'rolling_cluster_update', 1, 'safety_check',
            cluster_id=cluster_id
        )
        
        safe = self.check_cluster_safety(cluster_id, min_hosts=2)
        if not safe:
            self.update_workflow_step(step['id'], 'failed', 
                error='Cluster safety check failed')
            self.update_job_status(job_id, 'failed')
            return
        
        self.update_workflow_step(step['id'], 'completed')
        
        # Get hosts in cluster
        hosts = self.get_cluster_hosts(cluster_id)
        
        # Update each host sequentially
        for host in hosts:
            # Create child jobs for host update workflow
            self.execute_host_update_workflow(job_id, host, cluster_id)
    
    self.update_job_status(job_id, 'completed')

def execute_host_update_workflow(self, parent_job_id, host, cluster_id):
    """Execute update workflow for single host."""
    # Create prepare job
    prepare_job = self.create_child_job(
        parent_job_id, 'prepare_host_for_update',
        target_scope={'host_id': host['id']}
    )
    self.execute_prepare_host_for_update(prepare_job['id'])
    
    # Create firmware update job
    firmware_job = self.create_child_job(
        parent_job_id, 'firmware_update',
        target_scope={'server_ids': [host['server_id']]}
    )
    self.execute_firmware_update(firmware_job['id'])
    
    # Create verify job
    verify_job = self.create_child_job(
        parent_job_id, 'verify_host_after_update',
        target_scope={'host_id': host['id']}
    )
    self.execute_verify_host_after_update(verify_job['id'])
```

### Deployment

**Linux (systemd service):**
```bash
sudo systemctl enable job-executor
sudo systemctl start job-executor
sudo systemctl status job-executor

# View logs
sudo journalctl -u job-executor -f
```

**Windows (Task Scheduler):**
```powershell
.\scripts\manage-job-executor.ps1 -Action Install
.\scripts\manage-job-executor.ps1 -Action Start
.\scripts\manage-job-executor.ps1 -Action Status

# View logs
Get-Content "C:\ProgramData\DellServerManager\job-executor.log" -Wait
```

---

## Edge Functions

### Key Functions

#### `create-job/index.ts` - Create Async Jobs
```typescript
// Creates jobs with validation
// Used by UI to queue operations
// Validates target_scope and details
// Returns job ID for tracking
```

#### `update-job/index.ts` - Update Job Status
```typescript
// Called by Job Executor to update status
// Updates job and related tasks
// Sends notifications on completion/failure
```

#### `preview-server-info/index.ts` - Quick iDRAC Preview
```typescript
// Cloud mode only: instant server preview
// Falls back to job in local mode
// Fetches basic server info without creating job
```

#### `refresh-server-info/index.ts` - Fetch Server Details
```typescript
// Cloud mode: update server details in database
// Fetches model, firmware, health, etc.
// Creates job in local mode
```

#### `test-vcenter-connection/index.ts` - Test vCenter Credentials
```typescript
// Tests vCenter connectivity and credentials
// Returns vCenter version and cluster list
// Used in settings validation
```

#### `vcenter-sync/index.ts` - Sync ESXi Hosts
```typescript
// Syncs ESXi hosts from vCenter
// Creates/updates vcenter_hosts records
// Links to servers by serial number
```

#### `sync-vcenter-direct/index.ts` - Direct vCenter Sync
```typescript
// Direct sync without job (for testing)
// Immediate execution
// Returns sync results
```

#### `encrypt-credentials/index.ts` - Encrypt Passwords
```typescript
// Encrypts passwords using activity_settings.encryption_key
// Returns encrypted string (base64)
// Uses AES encryption
```

#### `analyze-maintenance-windows/index.ts` - Analyze Optimal Windows
```typescript
// Analyzes optimal maintenance windows
// Based on historical safety check data
// Returns recommended time slots with confidence scores
```

#### `execute-maintenance-windows/index.ts` - Scheduled Execution
```typescript
// Triggered by pg_cron every 5 minutes
// Executes planned maintenance windows
// Creates jobs and updates window status
// Handles recurring window creation
```

#### `send-notification/index.ts` - Notification Delivery
```typescript
// Sends Teams and email notifications
// Supports job notifications, safety alerts, maintenance reminders
// Creates notification_logs records
```

#### `cleanup-activity-logs/index.ts` - Scheduled Cleanup
```typescript
// Triggered by pg_cron
// Deletes old idrac_commands based on retention settings
// Updates activity_settings.last_cleanup_at
```

#### `cleanup-old-jobs/index.ts` - Remove Old Jobs
```typescript
// Triggered by pg_cron
// Deletes completed jobs older than retention period
// Auto-cancels stale jobs (stuck in pending/running)
// Updates activity_settings.job_last_cleanup_at
```

#### `network-diagnostics/index.ts` - Network Troubleshooting
```typescript
// Runs network diagnostics
// Tests connectivity to iDRAC, vCenter
// Validates DNS, routing, firewall
```

#### `validate-network-prerequisites/index.ts` - Network Validation
```typescript
// Validates network prerequisites before operations
// Checks connectivity, latency, bandwidth
// Returns validation results
```

#### `test-virtual-media-share/index.ts` - Test SMB/NFS Shares
```typescript
// Tests virtual media share connectivity
// Validates share path and credentials
// Returns test results
```

#### `openmanage-sync/index.ts` - OpenManage Sync
```typescript
// Syncs servers from OpenManage Enterprise
// Creates/updates servers records
// Maps OME device IDs
```

#### `get-service-key/index.ts` - Retrieve Service Key
```typescript
// Returns Supabase service role key
// For Job Executor authentication
// Restricted to admin users
```

### Best Practices

**CORS Headers (for web access):**
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Handle CORS preflight
if (req.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}
```

**Supabase Client Usage:**
```typescript
// ✅ CORRECT: Use client methods
const { data, error } = await supabase.from('table').select();

// ❌ NEVER: Direct HTTP calls
// fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/table`)
```

**Activity Logging:**
```typescript
import { logIdracCommand } from "../_shared/idrac-logger.ts";

await logIdracCommand(supabase, {
  server_id: serverId,
  command_type: 'GET',
  operation_type: 'idrac_api',
  endpoint: '/redfish/v1/Systems/System.Embedded.1',
  full_url: `https://${ip}/redfish/v1/Systems/System.Embedded.1`,
  response_body: data,
  status_code: 200,
  success: true,
  source: 'edge_function'
});
```

### Example Function Structure

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { param1, param2 } = await req.json();
    
    // Function logic here
    const result = await performOperation(param1, param2);
    
    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
```

---

## Frontend Patterns

### Page Structure

All pages follow a consistent structure:

```tsx
// src/pages/PageName.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { PageStatsBar } from "@/components/page/PageStatsBar";
import { PageContent } from "@/components/page/PageContent";

export default function PageName() {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  
  const { data: items, isLoading } = useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      const { data } = await supabase.from('table').select('*');
      return data;
    }
  });

  return (
    <div className="flex flex-col h-full">
      <PageStatsBar data={items} />
      <PageContent 
        items={items} 
        isLoading={isLoading}
        onSelect={setSelectedItem}
      />
    </div>
  );
}
```

### Common Hooks

#### `useAuth.tsx` - Authentication
```tsx
const { user, session, signIn, signOut, isLoading } = useAuth();

// Check user role
const { data: role } = useQuery({
  queryKey: ['user-role', user?.id],
  queryFn: async () => {
    const { data } = await supabase.rpc('get_user_role', { _user_id: user.id });
    return data;
  },
  enabled: !!user
});
```

#### `useQuery` - Data Fetching
```tsx
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['servers'],
  queryFn: async () => {
    const { data, error } = await supabase.from('servers').select('*');
    if (error) throw error;
    return data;
  },
  refetchInterval: 30000,  // Auto-refetch every 30 seconds
  staleTime: 10000  // Consider data stale after 10 seconds
});
```

#### `useMutation` - Data Updates
```tsx
const createServerMutation = useMutation({
  mutationFn: async (server: NewServer) => {
    const { data, error } = await supabase.from('servers').insert(server).select().single();
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries(['servers']);
    toast.success('Server created successfully');
  },
  onError: (error) => {
    toast.error(`Failed to create server: ${error.message}`);
  }
});
```

#### `useMaintenanceData.ts` - Maintenance Windows
```tsx
const { windows, clusters, serverGroups, isLoading, refetch } = useMaintenanceData();

// Returns:
// - windows: maintenance_windows[]
// - clusters: unique cluster names from vcenter_hosts
// - serverGroups: server_groups[]
```

#### `useOptimalWindows.ts` - Optimal Maintenance Windows
```tsx
const { windows, loading } = useOptimalWindows(['Production-Cluster-01']);

// Calls analyze-maintenance-windows function
// Returns optimal windows with confidence scores
```

#### `useSafetyStatus.ts` - Safety Check Data
```tsx
const { dailyStatus, chartData, isLoading, refetch } = useSafetyStatus(startDate, endDate);

// Aggregates cluster and group safety checks by date
// Provides daily safety status and chart-ready data
```

#### `useActiveJobs.ts` - Active Jobs Tracking
```tsx
const { activeJobs, completedJobs, allJobs, loading, refetch } = useActiveJobs();

// Real-time subscription to jobs table
// Auto-updates when jobs change status
```

#### `useLiveConsole.ts` - Real-time Job Logs
```tsx
const { logs, isLoading } = useLiveConsole(jobId);

// Streams workflow_executions for real-time step updates
// Used in WorkflowExecutionViewer
```

### UI Patterns

#### Server Cards (Grid View)
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {servers.map(server => (
    <ServerCard 
      key={server.id} 
      server={server}
      onClick={() => setSelectedServer(server.id)}
    />
  ))}
</div>
```

#### Context Menus (Right-Click Actions)
```tsx
<ContextMenu>
  <ContextMenuTrigger>
    <ServerCard server={server} />
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={() => powerOn(server)}>
      Power On
    </ContextMenuItem>
    <ContextMenuItem onClick={() => openHealthDialog(server)}>
      View Health
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

#### Dialogs (Modal Forms)
```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Add Server</DialogTitle>
      <DialogDescription>
        Enter server details to add to inventory
      </DialogDescription>
    </DialogHeader>
    <Form onSubmit={handleSubmit}>
      {/* Form fields */}
    </Form>
    <DialogFooter>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
      <Button type="submit">Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

#### Tables with Filters
```tsx
<div className="space-y-4">
  <ServerFilterToolbar 
    onFilterChange={setFilters}
    onSearch={setSearchTerm}
  />
  <ServersTable 
    servers={filteredServers}
    onRowClick={handleRowClick}
  />
</div>
```

#### Realtime Subscriptions
```tsx
useEffect(() => {
  const channel = supabase
    .channel('jobs-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'jobs' },
      (payload) => {
        queryClient.invalidateQueries(['jobs']);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);
```

### Key Components

**Jobs & Workflows:**
- `ClusterUpdateWizard.tsx` - Multi-step wizard for cluster updates
- `WorkflowExecutionViewer.tsx` - Real-time workflow step tracking
- `CreateJobDialog.tsx` - Job creation dialog
- `JobDetailDialog.tsx` - Job details view
- `PreFlightCheckDialog.tsx` - Pre-update validation

**Maintenance Planning:**
- `MaintenanceCalendarView.tsx` - Calendar interface for maintenance windows
- `CreateMaintenanceWindowDialog.tsx` - Create maintenance window
- `ScheduleMaintenanceDialog.tsx` - Schedule maintenance
- `SafetyCalendar.tsx` - Safety status calendar
- `ClusterSafetyTrendChart.tsx` - Safety trends chart
- `OptimalWindowsSidebar.tsx` - Recommended maintenance windows
- `CompactStatsBar.tsx` - Stats bar for planner page

**Server Management:**
- `ServerCard.tsx` - Server card display
- `ServersTable.tsx` - Tabular server list
- `AddServerDialog.tsx` - Add server dialog
- `ServerDetailsSidebar.tsx` - Server details panel
- `BiosConfigDialog.tsx` - BIOS configuration
- `BootConfigDialog.tsx` - Boot configuration
- `EventLogDialog.tsx` - Event log viewer
- `ServerHealthDialog.tsx` - Health details
- `VirtualMediaDialog.tsx` - Virtual media management

**Activity Monitoring:**
- `CommandsTable.tsx` - Activity log table
- `FilterToolbar.tsx` - Activity log filters
- `CommandDetailDialog.tsx` - Command details
- `ActiveJobsBanner.tsx` - Active jobs notification

---

## Testing & Deployment

### Local Development

**Prerequisites:**
```bash
# Node.js 18+
node --version

# Python 3.7+
python --version

# Supabase CLI
supabase --version
```

**Setup:**
```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Start Supabase locally
supabase start

# Start dev server
npm run dev

# Start Job Executor (separate terminal)
python job-executor.py
```

### Testing

**Frontend Tests (Vitest):**
```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

**Test Structure:**
```tsx
// src/test/integration/servers.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../helpers/test-utils';

describe('Server Management', () => {
  beforeEach(async () => {
    // Clean test data
    await supabase.from('servers').delete().neq('id', '');
  });

  it('should create server', async () => {
    const { result } = renderHook(() => useCreateServer(), {
      wrapper: createWrapper()
    });
    
    await waitFor(() => {
      result.current.mutate({
        ip_address: '192.168.1.100',
        hostname: 'test-server'
      });
    });
    
    expect(result.current.isSuccess).toBe(true);
  });
});
```

### Production Deployment

**Frontend Deployment:**
```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

**Job Executor Deployment (Linux):**
```bash
# Copy files
sudo mkdir -p /opt/dell-server-manager
sudo cp job-executor.py /opt/dell-server-manager/
sudo cp -r job_executor /opt/dell-server-manager/
sudo cp requirements.txt /opt/dell-server-manager/

# Install dependencies
cd /opt/dell-server-manager
sudo python3 -m pip install -r requirements.txt

# Configure environment
sudo nano /opt/dell-server-manager/.env

# Install systemd service
sudo cp scripts/job-executor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable job-executor
sudo systemctl start job-executor
```

**Job Executor Deployment (Windows):**
```powershell
# Run as Administrator
.\scripts\deploy-windows.ps1

# Or manually:
.\scripts\manage-job-executor.ps1 -Action Install
.\scripts\manage-job-executor.ps1 -Action Start
```

**Edge Functions Deployment:**
```bash
# Lovable Cloud auto-deploys edge functions
# No manual deployment needed

# For self-hosted:
supabase functions deploy
```

**Database Migrations:**
```bash
# Lovable Cloud auto-applies migrations
# No manual migration needed

# For self-hosted:
supabase db push
```

---

## Common Troubleshooting

### Connection Issues in Local Mode

**Problem:** Edge functions can't reach iDRAC devices on local network

**Solution:** Use Job Executor instead
```tsx
const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1');

if (isLocalMode) {
  // Create job instead of direct call
  const { data: job } = await supabase.functions.invoke('create-job', {
    body: { job_type: 'health_check', target_scope: { server_ids: [serverId] }}
  });
  
  // Poll job status
  const interval = setInterval(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('id', job.id).single();
    if (data.status === 'completed' || data.status === 'failed') {
      clearInterval(interval);
      // Handle result
    }
  }, 3000);
}
```

### Server Grouping Discrepancies

**Problem:** Server shows in "Ungrouped" despite being in vCenter cluster

**Cause:** `vcenter_host_id` is set but no `server_group_members` entry exists for the vCenter cluster group

**Solution:** Re-sync vCenter to create cluster groups and memberships
```tsx
await supabase.functions.invoke('vcenter-sync');
```

### Credential Resolution Failures

**Problem:** Job fails with "No credentials found for server"

**Diagnosis:**
1. Check server-specific credentials: `servers.idrac_username`
2. Check linked credential set: `servers.credential_set_id`
3. Check IP range mappings: `credential_ip_ranges`
4. Check default credential set: `credential_sets.is_default = true`

**Solution:**
```tsx
// Link server to credential set
await supabase
  .from('servers')
  .update({ credential_set_id: credSetId })
  .eq('id', serverId);

// Or add IP range mapping
await supabase
  .from('credential_ip_ranges')
  .insert({
    credential_set_id: credSetId,
    ip_range: '192.168.1.0/24',
    priority: 10
  });
```

### Jobs Stuck in Pending

**Problem:** Jobs remain in `pending` status indefinitely

**Diagnosis:**
1. Check Job Executor is running: `systemctl status job-executor` (Linux) or Task Scheduler (Windows)
2. Check Job Executor logs for errors
3. Check `activity_settings.pause_idrac_operations` is `false`

**Solution:**
```bash
# Linux
sudo systemctl start job-executor
sudo journalctl -u job-executor -f

# Windows
.\scripts\manage-job-executor.ps1 -Action Start
Get-Content "C:\ProgramData\DellServerManager\job-executor.log" -Wait
```

**Auto-Cancel Stale Jobs:**
```sql
-- Enable auto-cancellation
UPDATE activity_settings 
SET auto_cancel_stale_jobs = true,
    stale_pending_hours = 24,
    stale_running_hours = 48;

-- Manually cancel stale jobs
UPDATE jobs 
SET status = 'cancelled', 
    completed_at = NOW(),
    details = details || '{"cancellation_reason": "Manually cancelled - stuck in pending"}'::jsonb
WHERE status = 'pending' 
  AND created_at < NOW() - INTERVAL '24 hours';
```

### RLS Policy Errors

**Problem:** "Row level security policy violation" errors

**Diagnosis:**
- Check user is authenticated: `auth.uid() IS NOT NULL`
- Check user role: `SELECT role FROM user_roles WHERE user_id = auth.uid()`
- Review RLS policies on affected table

**Solution:**
```sql
-- Grant operator role
INSERT INTO user_roles (user_id, role)
VALUES (auth.uid(), 'operator')
ON CONFLICT (user_id) DO UPDATE SET role = 'operator';

-- Or make user admin
UPDATE user_roles SET role = 'admin' WHERE user_id = auth.uid();
```

### Edge Function Timeouts

**Problem:** Edge function times out after 60 seconds

**Solution:** Use jobs for long-running operations
```tsx
// ❌ Don't call long operations directly
await supabase.functions.invoke('firmware-update', { serverId });

// ✅ Create job instead
const { data: job } = await supabase.functions.invoke('create-job', {
  body: { 
    job_type: 'firmware_update',
    target_scope: { server_ids: [serverId] }
  }
});

// Poll job status
const { data } = await supabase
  .from('jobs')
  .select('*')
  .eq('id', job.id)
  .single();
```

### Workflow Step Failures

**Problem:** Workflow fails at specific step

**Diagnosis:**
```tsx
const { data: steps } = await supabase
  .from('workflow_executions')
  .select('*')
  .eq('job_id', jobId)
  .order('step_number', { ascending: true });

// Find failed step
const failedStep = steps.find(s => s.step_status === 'failed');
console.log('Failed step:', failedStep.step_name);
console.log('Error:', failedStep.step_error);
console.log('Details:', failedStep.step_details);
```

**Solution:** Retry workflow from failed step or cancel and restart
```python
# In Job Executor
def retry_workflow_from_step(self, job_id, step_number):
    """Retry workflow from specific step."""
    # Mark subsequent steps as pending
    # Re-execute from step_number onwards
```

### Maintenance Window Not Executing

**Problem:** Auto-execute maintenance window doesn't create job

**Diagnosis:**
1. Check `auto_execute = true`
2. Check `planned_start <= NOW()`
3. Check `requires_approval = false` OR `approved_by IS NOT NULL`
4. Check pg_cron is running

**Solution:**
```sql
-- Check pg_cron jobs
SELECT * FROM cron.job;

-- Manually trigger execution
SELECT net.http_post(
  url := current_setting('app.settings.supabase_url') || '/functions/v1/execute-maintenance-windows',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
  )
);
```

### Safety Check False Negatives

**Problem:** Safety check shows unsafe when cluster is healthy

**Diagnosis:**
```tsx
const { data: check } = await supabase
  .from('cluster_safety_checks')
  .select('*')
  .eq('cluster_id', clusterId)
  .order('check_timestamp', { ascending: false })
  .limit(1)
  .single();

console.log('Check details:', check.details);
// Review: DRS enabled, HA configured, host statuses
```

**Solution:** Verify vCenter connection and cluster configuration
```tsx
await supabase.functions.invoke('test-vcenter-connection');
await supabase.functions.invoke('vcenter-sync');
```

---

## Key Environment Variables

### Frontend (.env)

**Auto-generated by Lovable Cloud:**
```bash
VITE_SUPABASE_URL=https://project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
VITE_SUPABASE_PROJECT_ID=project-id
```

**Optional:**
```bash
# Custom environment detection
VITE_ENVIRONMENT=production  # 'development' | 'staging' | 'production'
```

### Job Executor (.env or system environment)

**Required:**
```bash
# Supabase Connection
SUPABASE_URL=https://project.supabase.co
SERVICE_ROLE_KEY=eyJ...  # Service role key (bypasses RLS)

# Default iDRAC Credentials (fallback)
IDRAC_DEFAULT_USER=root
IDRAC_DEFAULT_PASSWORD=calvin

# Encryption (optional - can use DB key)
ENCRYPTION_KEY=base64-encoded-aes-key
```

**Optional:**
```bash
# vCenter Connection
VCENTER_HOST=vcenter.example.com
VCENTER_USER=administrator@vsphere.local
VCENTER_PASSWORD=password
VCENTER_PORT=443
VCENTER_VERIFY_SSL=false

# OpenManage Enterprise
OPENMANAGE_HOST=ome.example.com
OPENMANAGE_USER=admin
OPENMANAGE_PASSWORD=password
OPENMANAGE_PORT=443

# Firmware Repository
FIRMWARE_REPO_URL=http://firmware-repo.local/dell
DELL_CATALOG_URL=https://downloads.dell.com/catalog/Catalog.xml

# Notifications
DSM_URL=https://dsm.example.com  # Dell Server Manager URL for links in notifications

# Logging
LOG_LEVEL=INFO  # DEBUG | INFO | WARN | ERROR
LOG_FILE=/var/log/job-executor.log

# Performance
POLL_INTERVAL_SECONDS=10  # Job polling interval
MAX_CONCURRENT_JOBS=5  # Max jobs to process simultaneously
```

### Edge Functions (Deno.env)

**Auto-available:**
```typescript
Deno.env.get('SUPABASE_URL')
Deno.env.get('SUPABASE_ANON_KEY')
Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
```

**Custom Secrets (via Lovable Cloud UI):**
```typescript
Deno.env.get('TEAMS_WEBHOOK_URL')
Deno.env.get('SMTP_HOST')
Deno.env.get('SMTP_USER')
Deno.env.get('SMTP_PASSWORD')
```

---

## Security Considerations

### Row Level Security (RLS)

**All tables have RLS enabled** with role-based policies:

```sql
-- Admin: Full access
CREATE POLICY "Admins can manage X" ON table_name
  FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Operator: Create/Update
CREATE POLICY "Operators can modify X" ON table_name
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));

-- Viewer: Read-only
CREATE POLICY "All users can view X" ON table_name
  FOR SELECT USING (auth.uid() IS NOT NULL);
```

### Credential Encryption

**All passwords encrypted using AES-256:**

```sql
-- Encryption key stored in activity_settings table
SELECT encryption_key FROM activity_settings LIMIT 1;

-- Encrypt password (via edge function or database function)
SELECT encrypt_password('password', (SELECT encryption_key FROM activity_settings LIMIT 1));

-- Decrypt password (Job Executor only)
SELECT decrypt_password(encrypted_password, encryption_key);
```

**Important:**
- Encryption key generated on first setup
- Stored in `activity_settings.encryption_key` (base64)
- Can optionally use environment variable `ENCRYPTION_KEY`
- Job Executor decrypts passwords using service role key (bypasses RLS)

### Role-Based Access Control (RBAC)

**Three roles:**
- **admin** - Full access (manage users, settings, all operations)
- **operator** - Create/update servers, jobs, maintenance windows
- **viewer** - Read-only access

**Helper Functions:**
```sql
-- Check if user has role
SELECT has_role(auth.uid(), 'admin'::app_role);

-- Get user's highest role
SELECT get_user_role(auth.uid());
```

**Assign Role:**
```sql
INSERT INTO user_roles (user_id, role) VALUES (user_id, 'operator');
```

### JWT Authentication

**Supabase JWT tokens:**
- Issued on login/signup
- Stored in browser (localStorage)
- Auto-refreshed by Supabase client
- Validated by RLS policies using `auth.uid()`

**Custom API Tokens:**
- SHA-256 hashed in `api_tokens` table
- Validated using `validate_api_token(token)` function
- Used for programmatic access

### Activity Logging (Audit Trail)

**All operations logged to `idrac_commands`:**
- Who initiated the operation (`initiated_by`)
- When it occurred (`timestamp`)
- What was executed (`command_type`, `endpoint`)
- Result (`success`, `error_message`)
- Source (`edge_function`, `job_executor`, `manual`)

**Audit logs in `audit_logs` table:**
- User actions (create, update, delete)
- IP addresses
- Action details (JSONB)

### Network Security

**Best Practices:**
- iDRAC API calls use HTTPS (self-signed certs accepted)
- vCenter API uses HTTPS
- Database connections encrypted (TLS)
- Service role key kept secret (Job Executor only)
- No passwords in logs (only encrypted values)

**Firewall Rules:**
```bash
# Allow Job Executor to reach iDRAC (HTTPS)
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

# Allow Job Executor to reach vCenter (HTTPS)
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

# Allow Job Executor to reach Supabase (HTTPS)
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
```

### Input Validation

**Frontend Validation:**
```tsx
// IP address validation
const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;

// CIDR validation
const cidrRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/;

// Hostname validation
const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
```

**Backend Validation:**
```python
# Validate IP address before iDRAC calls
def validate_ip_address(ip: str) -> bool:
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False
```

### Secrets Management

**Service Role Key:**
- Never exposed to frontend
- Used by Job Executor only
- Stored securely in environment variables
- Bypasses RLS for system operations

**Virtual Media Credentials:**
- Share passwords encrypted in `virtual_media_sessions.share_password_encrypted`
- Decrypted by Job Executor when mounting media
- Never logged in plaintext

**OpenManage Credentials:**
- Stored in `openmanage_settings.password`
- Encrypted at rest
- Decrypted by Job Executor/Edge Functions when syncing

**Teams Webhook URL:**
- Stored in `notification_settings.teams_webhook_url`
- Accessible only to admin users
- Never exposed in logs

### Security Checklist

✅ **Do:**
- Enable RLS on all tables
- Use service role key only in Job Executor
- Encrypt all passwords with `activity_settings.encryption_key`
- Validate all user inputs
- Log all API calls for audit trail
- Use HTTPS for all API calls
- Implement role-based access control
- Auto-cancel stale jobs to prevent resource leaks
- Regularly backup database

❌ **Don't:**
- Store passwords in plaintext
- Expose service role key in frontend
- Log decrypted passwords
- Trust user input without validation
- Skip RLS policies for "admin-only" tables
- Hardcode credentials in code
- Execute raw SQL from edge functions

---

## References

### Internal Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - High-level architecture overview
- [JOB_EXECUTOR_GUIDE.md](./docs/JOB_EXECUTOR_GUIDE.md) - Job Executor setup and usage
- [VCENTER_SYNC_GUIDE.md](./docs/VCENTER_SYNC_GUIDE.md) - vCenter integration guide
- [OPENMANAGE_SYNC_GUIDE.md](./docs/OPENMANAGE_SYNC_GUIDE.md) - OpenManage integration
- [SELF_HOSTING.md](./docs/SELF_HOSTING.md) - Self-hosting instructions
- [BACKUP_GUIDE.md](./docs/BACKUP_GUIDE.md) - Database backup procedures
- [REDFISH_ADVANCED_FEATURES_PLAN.md](./docs/REDFISH_ADVANCED_FEATURES_PLAN.md) - Advanced features roadmap

### External APIs

- [iDRAC Redfish API](https://developer.dell.com/apis/2978/versions/6.xx/docs/Introduction.md) - Dell iDRAC Redfish API documentation
- [VMware vCenter API](https://developer.vmware.com/apis/vsphere-automation/latest/) - VMware vCenter REST API
- [pyVmomi Documentation](https://github.com/vmware/pyvmomi) - VMware vSphere Python SDK
- [OpenManage Enterprise API](https://developer.dell.com/apis/4000/versions/3.10.0/docs/GettingStarted.md) - Dell OME API

### Technologies

- [React Documentation](https://react.dev/) - React 18 official docs
- [Supabase Documentation](https://supabase.com/docs) - Supabase platform docs
- [TanStack Query](https://tanstack.com/query/latest) - React Query data fetching
- [Tailwind CSS](https://tailwindcss.com/docs) - Utility-first CSS framework
- [shadcn/ui](https://ui.shadcn.com/) - Re-usable components built with Radix UI and Tailwind CSS
- [Vitest](https://vitest.dev/) - Vite-native testing framework

### Glossary

- **iDRAC** - Integrated Dell Remote Access Controller (out-of-band management)
- **Redfish** - DMTF standard for REST API server management
- **SCP** - Server Configuration Profile (XML backup of server config)
- **DRS** - Distributed Resource Scheduler (VMware)
- **HA** - High Availability (VMware)
- **RLS** - Row Level Security (PostgreSQL/Supabase)
- **RBAC** - Role-Based Access Control
- **OME** - OpenManage Enterprise (Dell management platform)
- **SEL** - System Event Log (hardware event log)

---

**End of AGENTS.MD**
