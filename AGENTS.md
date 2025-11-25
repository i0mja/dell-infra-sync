# AGENTS.MD - Dell Server Manager for AI Coding Assistants

## Table of Contents
1. [Application Overview](#application-overview)
2. [Critical Architecture Principles](#critical-architecture-principles)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Database Schema](#database-schema)
6. [Common Implementation Patterns](#common-implementation-patterns)
7. [Critical DO's and DON'Ts](#critical-dos-and-donts)
8. [Job Executor Architecture](#job-executor-architecture)
9. [Edge Functions](#edge-functions)
10. [Frontend Patterns](#frontend-patterns)
11. [Testing & Deployment](#testing--deployment)
12. [Common Troubleshooting](#common-troubleshooting)
13. [Key Environment Variables](#key-environment-variables)
14. [Security Considerations](#security-considerations)
15. [References](#references)

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

### Backend (Lovable Cloud/Supabase)
- **PostgreSQL** database with RLS (Row Level Security)
- **Supabase Auth** for authentication
- **Edge Functions** (Deno runtime) for serverless logic
- **Realtime** subscriptions for live updates
- **Storage** for file uploads

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
│   │   ├── maintenance/        # Maintenance planner components
│   │   ├── notifications/      # Live notifications and console
│   │   ├── servers/            # Server management (cards, dialogs)
│   │   ├── settings/           # Settings panels
│   │   ├── ui/                 # shadcn/ui base components
│   │   └── vcenter/            # vCenter integration components
│   ├── hooks/                  # Custom React hooks
│   │   ├── useAuth.tsx         # Authentication state
│   │   ├── useLiveConsole.ts   # Real-time job logs
│   │   └── useNotificationCenter.ts  # Live notifications
│   ├── integrations/           # External integrations
│   │   └── supabase/           # Supabase client (auto-generated)
│   │       ├── client.ts       # Supabase client instance
│   │       └── types.ts        # Database types (auto-generated)
│   ├── lib/                    # Utilities and helpers
│   │   ├── utils.ts            # Common utilities
│   │   ├── validations.ts      # Form validations
│   │   ├── diagnostics.ts      # System diagnostics
│   │   └── network-validator.ts # Network validation
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
│   │   ├── create-job/         # Create async jobs
│   │   ├── update-job/         # Update job status
│   │   ├── preview-server-info/ # Quick iDRAC preview
│   │   ├── refresh-server-info/ # Fetch server details
│   │   ├── test-vcenter-connection/ # Test vCenter creds
│   │   ├── vcenter-sync/       # Sync ESXi hosts
│   │   ├── encrypt-credentials/ # Encrypt passwords
│   │   ├── cleanup-activity-logs/ # Scheduled cleanup
│   │   └── cleanup-old-jobs/   # Remove old jobs
│   ├── migrations/             # Database migrations (timestamped)
│   └── config.toml             # Supabase configuration
│
├── job_executor/               # Job executor modules (NEW)
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
│   ├── SELF_HOSTING.md         # Self-hosting instructions
│   └── BACKUP_GUIDE.md         # Database backup guide
│
├── scripts/                    # Deployment and management scripts
│   ├── deploy-rhel9.sh         # RHEL deployment
│   ├── deploy-windows.ps1      # Windows deployment
│   ├── manage-job-executor.sh  # Linux service management
│   ├── manage-job-executor.ps1 # Windows service management
│   ├── health-check.sh         # System health check
│   └── backup-database.ts      # Database backup script
│
├── .env                        # Environment variables (auto-generated)
├── requirements.txt            # Python dependencies
├── package.json                # Node.js dependencies
├── tailwind.config.ts          # Tailwind CSS configuration
├── vite.config.ts              # Vite build configuration
└── README.md                   # Project overview
```

---

## Database Schema

### Core Tables

#### `servers` - Dell Server Inventory
Primary table for managing Dell servers (iDRAC endpoints).

**Key Columns:**
- `id` (UUID) - Primary key
- `ip_address` (TEXT, unique) - iDRAC IP address
- `hostname` (TEXT, nullable) - Server hostname
- `service_tag` (TEXT, nullable) - Dell service tag
- `model` (TEXT) - Server model (e.g., "PowerEdge R640")
- `idrac_username` (TEXT) - iDRAC username (deprecated, use credential sets)
- `idrac_password_encrypted` (TEXT) - Encrypted password
- `credential_set_id` (UUID, FK) - Linked credential set
- `vcenter_host_id` (UUID, FK, nullable) - Linked ESXi host
- `bios_version`, `idrac_firmware`, `power_state`, `overall_health` - Server details
- `connection_status` (TEXT) - "connected" / "failed" / "unknown"
- `credential_test_status` (TEXT) - Last credential test result
- `last_seen`, `last_connection_test`, `last_health_check` - Timestamps

**Important Relationships:**
- Many-to-many with `server_groups` via `server_group_members`
- One-to-one with `vcenter_hosts` (bidirectional)
- Many-to-one with `credential_sets`

#### `vcenter_hosts` - ESXi Hosts from vCenter
Synced from VMware vCenter Server.

**Key Columns:**
- `id` (UUID) - Primary key
- `name` (TEXT) - ESXi hostname
- `cluster` (TEXT, nullable) - vCenter cluster name
- `serial_number` (TEXT, nullable) - Hardware serial (used to link with servers)
- `server_id` (UUID, FK, nullable) - Linked Dell server
- `esxi_version`, `status`, `maintenance_mode` - ESXi details
- `last_sync` (TIMESTAMP) - Last vCenter sync

**Important Relationships:**
- One-to-one with `servers` (linked by serial number or manual)
- Used for auto-grouping servers by vCenter cluster

#### `server_groups` - Manual Server Grouping
Custom organizational groups for servers.

**Key Columns:**
- `id` (UUID) - Primary key
- `name` (TEXT, unique) - Group name
- `description` (TEXT, nullable) - Group description
- `group_type` (TEXT) - "manual" / "vcenter_cluster" (default: "manual")
- `color`, `icon` (TEXT) - UI customization
- `min_healthy_servers` (INTEGER) - Safety threshold
- `created_by` (UUID, FK) - User who created

**Important Notes:**
- "vcenter_cluster" type groups are auto-created from vCenter sync
- Servers can belong to MULTIPLE manual groups
- Used for maintenance window targeting

#### `server_group_members` - Many-to-Many Join Table
Links servers to groups.

**Key Columns:**
- `id` (UUID) - Primary key
- `server_group_id` (UUID, FK) - Group reference
- `server_id` (UUID, FK) - Server reference
- `role` (TEXT, nullable) - Server role in group (e.g., "primary", "backup")
- `priority` (INTEGER, nullable) - Update order priority
- `added_at` (TIMESTAMP) - When added to group

#### `credential_sets` - Shared iDRAC Credentials
Reusable credential sets with IP range mapping.

**Key Columns:**
- `id` (UUID) - Primary key
- `name` (TEXT, unique) - Credential set name
- `username` (TEXT) - iDRAC username
- `password_encrypted` (TEXT) - AES-encrypted password
- `description` (TEXT, nullable) - Usage notes
- `is_default` (BOOLEAN) - Default fallback credentials
- `priority` (INTEGER) - Resolution priority (lower = higher priority)

**Important Relationships:**
- One-to-many with `credential_ip_ranges` (IP mapping)
- Many-to-one with `servers` (via `credential_set_id`)

#### `credential_ip_ranges` - IP Range Mapping
Maps credential sets to IP ranges (CIDR notation).

**Key Columns:**
- `id` (UUID) - Primary key
- `credential_set_id` (UUID, FK) - Parent credential set
- `ip_range` (TEXT) - CIDR notation (e.g., "192.168.1.0/24")
- `description` (TEXT, nullable) - Range notes
- `priority` (INTEGER) - Range priority

**Credential Resolution Logic:**
1. Check server-specific credentials (`servers.idrac_username`)
2. Check credential sets with matching IP ranges (by priority)
3. Fall back to default credential set

#### `jobs` - Asynchronous Job Queue
Background jobs for long-running operations.

**Key Columns:**
- `id` (UUID) - Primary key
- `job_type` (ENUM) - Job type (see below)
- `status` (ENUM) - "pending" / "running" / "completed" / "failed" / "cancelled"
- `target_scope` (JSONB) - Target definition (servers, clusters, groups)
- `details` (JSONB) - Job-specific parameters
- `created_by` (UUID, FK) - User who created
- `created_at`, `started_at`, `completed_at` (TIMESTAMP) - Lifecycle
- `schedule_at` (TIMESTAMP, nullable) - Scheduled execution time
- `parent_job_id` (UUID, FK, nullable) - For job hierarchies
- `component_order` (INTEGER, nullable) - Firmware component update order
- `auto_select_latest` (BOOLEAN) - Auto-select latest firmware version
- `credential_set_ids` (UUID[]) - Credentials to use
- `firmware_source`, `dell_catalog_url` - Firmware-specific

**Job Types (ENUM `job_type`):**
- `firmware_update` - Update server firmware
- `discovery_scan` - Network discovery
- `vcenter_sync` - Sync ESXi hosts
- `full_server_update` - Orchestrated update with vCenter
- `test_credentials` - Test credential sets
- `power_action` - Power on/off/reboot
- `health_check` - Fetch health status
- `fetch_event_logs` - Retrieve iDRAC logs
- `boot_configuration` - Modify boot settings
- `virtual_media_mount` / `virtual_media_unmount` - ISO mounting
- `bios_config_read` / `bios_config_write` - BIOS settings
- `scp_export` / `scp_import` - SCP backup/restore
- `vcenter_connectivity_test` - Test vCenter connection
- `openmanage_sync` - Sync from OpenManage Enterprise
- `cluster_safety_check` - Pre-update safety validation
- `rolling_cluster_update` - Coordinated cluster update
- `server_group_safety_check` - Group safety validation
- `prepare_host_for_update` - Prepare ESXi host for update (enter maintenance mode, evacuate VMs)
- `verify_host_after_update` - Verify ESXi host after update (exit maintenance mode, health checks)

#### `job_tasks` - Individual Tasks Within Jobs
Sub-tasks for job tracking.

**Key Columns:**
- `id` (UUID) - Primary key
- `job_id` (UUID, FK) - Parent job
- `server_id` (UUID, FK, nullable) - Target server
- `vcenter_host_id` (UUID, FK, nullable) - Target ESXi host
- `status` (ENUM) - Task status
- `log` (TEXT) - Task execution log
- `started_at`, `completed_at` (TIMESTAMP)

#### `maintenance_windows` - Scheduled Maintenance
Planned maintenance windows with approval workflow.

**Key Columns:**
- `id` (UUID) - Primary key
- `title` (TEXT) - Window name
- `description` (TEXT, nullable) - Details
- `maintenance_type` (TEXT) - "firmware_update" / "patch" / "hardware"
- `planned_start`, `planned_end` (TIMESTAMP) - Schedule
- `status` (TEXT) - "planned" / "approved" / "in_progress" / "completed" / "cancelled"
- `started_at`, `completed_at` (TIMESTAMP, nullable) - Actual execution times
- `server_ids`, `cluster_ids`, `server_group_ids` (UUID[]) - Targets
- `job_ids` (UUID[]) - Associated jobs
- `details` (JSONB, nullable) - Additional configuration and metadata
- `last_executed_at` (TIMESTAMP, nullable) - Last execution time for recurring windows
- `requires_approval` (BOOLEAN) - Approval required
- `approved_by`, `approved_at` (UUID, FK / TIMESTAMP, nullable) - Approval tracking
- `auto_execute` (BOOLEAN) - Auto-execute at scheduled time
- `recurrence_enabled`, `recurrence_type`, `recurrence_pattern` - Recurring windows
- `notification_sent` (BOOLEAN) - Notification delivery status
- `notify_before_hours` (INTEGER) - Hours before start to send notification
- `safety_check_snapshot` (JSONB, nullable) - Pre-execution safety check results
- `credential_set_ids` (UUID[]) - Credentials to use
- `created_by` (UUID, FK) - Creator

#### `idrac_commands` - Activity Log
Unified activity log for ALL iDRAC, vCenter, and OpenManage API calls.

**Key Columns:**
- `id` (UUID) - Primary key
- `timestamp` (TIMESTAMP) - When command executed
- `server_id` (UUID, FK, nullable) - Target server
- `job_id` (UUID, FK, nullable) - Associated job
- `task_id` (UUID, FK, nullable) - Associated task
- `command_type` (TEXT) - HTTP method or operation type
- `operation_type` (ENUM) - "idrac_api" / "vcenter_api" / "openmanage_api"
- `endpoint` (TEXT) - API endpoint path
- `full_url` (TEXT) - Complete URL
- `request_headers`, `request_body` (JSONB) - Request details
- `response_body` (JSONB) - Response payload
- `status_code` (INTEGER, nullable) - HTTP status
- `response_time_ms` (INTEGER) - Latency
- `success` (BOOLEAN) - Success/failure
- `error_message` (TEXT, nullable) - Error details
- `source` (TEXT) - "edge_function" / "job_executor" / "manual"
- `initiated_by` (UUID, FK, nullable) - User who initiated

**Important Notes:**
- **Used by both Edge Functions AND Job Executor**
- Provides full audit trail of all operations
- Realtime subscriptions for live updates
- Filtered in Activity Monitor page

#### `activity_settings` - System Configuration
Global settings for activity logging and retention.

**Key Columns:**
- `id` (UUID) - Primary key (singleton table)
- `encryption_key` (TEXT) - AES encryption key for passwords
- `log_level` (TEXT) - "DEBUG" / "INFO" / "WARN" / "ERROR"
- `log_retention_days` (INTEGER) - Days to keep logs
- `auto_cleanup_enabled` (BOOLEAN) - Enable scheduled cleanup
- `keep_statistics` (BOOLEAN) - Keep aggregated stats
- `alert_on_failures`, `alert_on_slow_commands` (BOOLEAN) - Alerting
- `slow_command_threshold_ms` (INTEGER) - Latency threshold
- `idrac_max_concurrent`, `idrac_request_delay_ms` (INTEGER) - Throttling
- `use_job_executor_for_idrac` (BOOLEAN) - Force Job Executor mode

#### `profiles` - User Profiles
Extended user information (linked to `auth.users`).

**Key Columns:**
- `id` (UUID, PK) - Matches `auth.users.id`
- `email` (TEXT, unique) - User email
- `full_name` (TEXT, nullable) - Display name

**Important**: NEVER reference `auth.users` directly in queries. Always use `profiles`.

#### `user_roles` - Role-Based Access Control
User role assignments.

**Key Columns:**
- `id` (UUID) - Primary key
- `user_id` (UUID, FK) - User reference
- `role` (ENUM) - "admin" / "operator" / "viewer"

**Roles:**
- **admin** - Full access (CRUD on all tables)
- **operator** - Can create/update servers, jobs, maintenance
- **viewer** - Read-only access

#### `api_tokens` - API Token Management
Secure API tokens for programmatic access.

**Key Columns:**
- `id` (UUID) - Primary key
- `user_id` (UUID, FK) - Token owner
- `name` (TEXT) - Token description/label
- `token_hash` (TEXT) - SHA-256 hash of token
- `created_at`, `expires_at`, `last_used_at` (TIMESTAMP)

**Important**: Tokens are hashed (SHA-256) for security. Raw tokens only shown at creation.

#### `audit_logs` - User Action Audit Trail
Comprehensive audit trail for compliance and security.

**Key Columns:**
- `id` (UUID) - Primary key
- `user_id` (UUID, FK, nullable) - User who performed action
- `action` (TEXT) - Action type (e.g., "server.create", "job.delete")
- `details` (JSONB, nullable) - Action metadata
- `ip_address` (TEXT, nullable) - Source IP
- `timestamp` (TIMESTAMP) - When action occurred

#### `bios_configurations` - BIOS Snapshots
BIOS configuration snapshots and pending changes.

**Key Columns:**
- `id` (UUID) - Primary key
- `server_id` (UUID, FK) - Target server
- `snapshot_type` (TEXT) - "current" / "baseline" / "pending"
- `attributes` (JSONB) - BIOS attributes
- `pending_attributes` (JSONB, nullable) - Queued changes
- `bios_version` (TEXT, nullable) - BIOS version
- `job_id` (UUID, FK, nullable) - Associated job
- `captured_at` (TIMESTAMP) - Snapshot timestamp
- `created_by` (UUID, FK, nullable) - User who created

#### `cluster_safety_checks` - vCenter Cluster Safety Results
Safety check results for vCenter clusters before maintenance.

**Key Columns:**
- `id` (UUID) - Primary key
- `cluster_id` (TEXT) - vCenter cluster name
- `job_id` (UUID, FK, nullable) - Associated job
- `safe_to_proceed` (BOOLEAN) - Overall safety status
- `total_hosts`, `healthy_hosts`, `min_required_hosts` (INTEGER) - Host counts
- `details` (JSONB, nullable) - Check details (DRS, HA, alarms)
- `check_timestamp` (TIMESTAMP) - When check was performed
- `is_scheduled` (BOOLEAN) - Scheduled vs manual check
- `scheduled_check_id` (UUID, FK, nullable) - Parent scheduled check
- `previous_status` (TEXT, nullable) - Previous check status
- `status_changed` (BOOLEAN) - Status change indicator

#### `network_settings` - Network Configuration
Global network and API throttling settings.

**Key Columns:**
- `id` (UUID) - Primary key (singleton table)
- `connection_timeout_seconds`, `read_timeout_seconds`, `operation_timeout_seconds` (INTEGER) - Timeouts
- `max_retry_attempts`, `retry_delay_seconds` (INTEGER) - Retry policy
- `retry_backoff_type` (TEXT) - "linear" / "exponential"
- `max_concurrent_connections`, `max_requests_per_minute` (INTEGER) - Rate limiting
- `require_prereq_validation` (BOOLEAN) - Validate network prerequisites
- `monitor_latency` (BOOLEAN) - Track API latency
- `latency_alert_threshold_ms` (INTEGER) - Alert threshold

#### `notification_logs` - Notification Delivery Tracking
Log of all notifications sent via Teams, email, etc.

**Key Columns:**
- `id` (UUID) - Primary key
- `job_id` (UUID, FK, nullable) - Associated job
- `notification_type` (TEXT) - "teams" / "email" / "smtp"
- `status` (TEXT) - "sent" / "failed" / "pending"
- `severity` (TEXT, nullable) - "normal" / "warning" / "critical"
- `is_test` (BOOLEAN) - Test notification
- `delivery_details` (JSONB, nullable) - Delivery metadata
- `error_message` (TEXT, nullable) - Failure reason
- `created_at` (TIMESTAMP)

#### `notification_settings` - Notification Configuration
Teams webhook and SMTP configuration.

**Key Columns:**
- `id` (UUID) - Primary key (singleton table)
- `teams_webhook_url` (TEXT, nullable) - Microsoft Teams webhook
- `teams_mention_users` (TEXT, nullable) - Users to @mention
- `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`, `smtp_from_email` - SMTP config
- `notify_on_job_started`, `notify_on_job_complete`, `notify_on_job_failed` (BOOLEAN) - Job notifications
- `notify_on_cluster_status_change`, `notify_on_cluster_warning`, `notify_on_unsafe_cluster` (BOOLEAN) - Cluster notifications
- `mention_on_critical_failures` (BOOLEAN) - Auto-mention on critical failures
- `critical_job_types` (TEXT[]) - Job types considered critical

#### `openmanage_settings` - OpenManage Integration Config
Dell OpenManage Enterprise integration settings.

**Key Columns:**
- `id` (UUID) - Primary key (singleton table)
- `host` (TEXT) - OpenManage server hostname/IP
- `port` (INTEGER) - API port (default: 443)
- `username`, `password` (TEXT) - Authentication
- `verify_ssl` (BOOLEAN) - SSL certificate verification
- `sync_enabled` (BOOLEAN) - Auto-sync enabled
- `last_sync` (TIMESTAMP, nullable) - Last sync timestamp

#### `scheduled_safety_checks` - Scheduled Safety Check Config
Configuration for automated cluster safety checks.

**Key Columns:**
- `id` (UUID) - Primary key (singleton table)
- `enabled` (BOOLEAN) - Scheduled checks enabled
- `schedule_cron` (TEXT, nullable) - Cron expression (default: "0 */6 * * *")
- `check_all_clusters` (BOOLEAN) - Check all vs specific clusters
- `specific_clusters` (TEXT[], nullable) - Clusters to check
- `min_required_hosts` (INTEGER, nullable) - Minimum healthy hosts
- `notify_on_unsafe`, `notify_on_warnings`, `notify_on_safe_to_unsafe_change` (BOOLEAN) - Notification triggers
- `last_run_at` (TIMESTAMP, nullable) - Last execution
- `last_status` (TEXT, nullable) - Last run result

#### `scp_backups` - SCP Backup Storage
Server Configuration Profile (SCP) backups.

**Key Columns:**
- `id` (UUID) - Primary key
- `server_id` (UUID, FK) - Target server
- `backup_name` (TEXT) - Backup label
- `description` (TEXT, nullable) - Backup notes
- `scp_content` (JSONB, nullable) - SCP XML content (as JSON)
- `scp_file_path` (TEXT, nullable) - File path (if stored externally)
- `scp_file_size_bytes` (BIGINT, nullable) - File size
- `scp_checksum` (TEXT, nullable) - MD5/SHA checksum
- `components` (TEXT, nullable) - Included components (e.g., "BIOS,iDRAC,RAID")
- `include_bios`, `include_idrac`, `include_nic`, `include_raid` (BOOLEAN) - Component flags
- `is_valid` (BOOLEAN) - Validation status
- `validation_errors` (TEXT, nullable) - Validation error messages
- `export_job_id`, `import_job_id` (UUID, FK, nullable) - Associated jobs
- `exported_at`, `last_imported_at` (TIMESTAMP) - Timestamps
- `created_by` (UUID, FK, nullable) - User who created

#### `server_boot_config_history` - Boot Config Change History
Historical log of boot configuration changes.

**Key Columns:**
- `id` (UUID) - Primary key
- `server_id` (UUID, FK) - Target server
- `timestamp` (TIMESTAMP) - Change timestamp
- `boot_mode` (TEXT, nullable) - "Uefi" / "Bios"
- `boot_order` (JSONB, nullable) - Boot device order
- `boot_source_override_enabled`, `boot_source_override_target` (TEXT) - Override settings
- `job_id` (UUID, FK, nullable) - Associated job
- `changed_by` (UUID, FK, nullable) - User who made change

#### `server_event_logs` - Server Event Logs
iDRAC event logs (SEL - System Event Log).

**Key Columns:**
- `id` (UUID) - Primary key
- `server_id` (UUID, FK) - Source server
- `timestamp` (TIMESTAMP) - Event timestamp
- `event_id` (TEXT, nullable) - iDRAC event ID
- `severity` (TEXT, nullable) - "OK" / "Warning" / "Critical"
- `category` (TEXT, nullable) - Event category
- `message` (TEXT, nullable) - Human-readable message
- `sensor_type`, `sensor_number` (TEXT, nullable) - Sensor details
- `raw_data` (JSONB, nullable) - Raw Redfish response

#### `server_group_safety_checks` - Server Group Safety Results
Safety check results for manual server groups.

**Key Columns:**
- `id` (UUID) - Primary key
- `server_group_id` (UUID, FK, nullable) - Target group
- `job_id` (UUID, FK, nullable) - Associated job
- `safe_to_proceed` (BOOLEAN) - Overall safety status
- `total_servers`, `healthy_servers`, `min_required_servers` (INTEGER) - Server counts
- `details` (JSONB, nullable) - Check details
- `warnings` (TEXT[], nullable) - Warning messages
- `check_timestamp` (TIMESTAMP) - When check was performed
- `is_scheduled` (BOOLEAN) - Scheduled vs manual check
- `scheduled_check_id` (UUID, FK, nullable) - Parent scheduled check
- `previous_status` (TEXT, nullable) - Previous check status
- `status_changed` (BOOLEAN) - Status change indicator

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
    
    # Job handlers
    def execute_firmware_update(self, job_id)
    def execute_discovery_scan(self, job_id)
    def execute_full_server_update(self, job_id)
    def execute_test_credentials(self, job_id)
    def execute_power_action(self, job_id)
    def execute_health_check(self, job_id)
    def execute_boot_configuration(self, job_id)
    def execute_bios_config_read(self, job_id)
    def execute_bios_config_write(self, job_id)
    # ... more handlers
    
    # Utilities
    def update_job_status(self, job_id, status, details=None)
    def log_idrac_command(self, ...)
    def decrypt_password(self, encrypted_password) -> str
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
```

#### `job_executor/scp.py` - SCP Backup/Restore
```python
class ScpMixin:
    def execute_scp_export(self, job_id):
        """Export SCP configuration backup.
        
        Supports two export methods:
        1. Local Export (iDRAC 5.00.00+): Redfish /Actions/Oem/ExportSystemConfiguration
        2. HTTP Push Export (older firmware): HTTP POST to push SCP to HTTP server
        
        Method selection:
        - Checks iDRAC firmware version
        - Falls back to HTTP Push for versions < 5.00.00
        """
        
    def _export_via_http_push(self, server_ip, username, password, job_id, server_id):
        """Export SCP via HTTP Push method (for older iDRAC firmware).
        
        Flow:
        1. Start local HTTP server to receive SCP
        2. Trigger iDRAC export with ShareType=HTTP
        3. iDRAC pushes SCP to HTTP server
        4. Parse and store SCP content
        5. Shutdown HTTP server
        
        Used when Local export not supported (iDRAC < 5.00.00).
        """
        
    def execute_scp_import(self, job_id):
        """Import SCP configuration."""
        
    def validate_scp_file(self, scp_content) -> Tuple[bool, Optional[str]]:
        """Validate SCP XML content."""
```

#### `job_executor/utils.py` - Utilities
```python
def _safe_json_parse(text: str) -> Optional[Dict]:
    """Safely parse JSON with fallback."""
    
def decode_safe(data: Any, default: str = '') -> str:
    """Safely decode bytes to string with Unicode handling."""
```

### Execution Flow

1. **Poll for Jobs**: `run()` continuously polls `jobs` table for `status = 'pending'`
2. **Route to Handler**: `execute_job()` routes based on `job_type`
3. **Update Status**: Mark job as `running`
4. **Execute Operation**: Make iDRAC/vCenter API calls
5. **Log Commands**: Write to `idrac_commands` for every API call
6. **Update Status**: Mark job as `completed` or `failed`
7. **Repeat**: Loop back to step 1

### Deployment

**Linux (systemd service):**
```bash
sudo systemctl enable job-executor
sudo systemctl start job-executor
sudo systemctl status job-executor
```

**Windows (Task Scheduler):**
```powershell
.\scripts\manage-job-executor.ps1 -Action Install
.\scripts\manage-job-executor.ps1 -Action Start
.\scripts\manage-job-executor.ps1 -Action Status
```

---

## Edge Functions

### Key Functions

#### `create-job/index.ts` - Create Async Jobs
```typescript
// Creates jobs with validation
// Used by UI to queue operations
```

#### `update-job/index.ts` - Update Job Status
```typescript
// Called by Job Executor to update status
// Updates job and related tasks
```

#### `preview-server-info/index.ts` - Quick iDRAC Preview
```typescript
// Cloud mode only: instant server preview
// Falls back to job in local mode
```

#### `refresh-server-info/index.ts` - Fetch Server Details
```typescript
// Updates server record with latest info
// Used for health checks and inventory sync
```

#### `test-vcenter-connection/index.ts` - Test vCenter Credentials
```typescript
// Validates vCenter connectivity
// Returns cluster and host information
```

#### `vcenter-sync/index.ts` - Sync ESXi Hosts
```typescript
// Syncs ESXi hosts from vCenter
// Creates/updates vcenter_hosts records
// Links to servers by serial number
```

#### `encrypt-credentials/index.ts` - Encrypt Passwords
```typescript
// Encrypts passwords with AES
// Uses encryption key from activity_settings
```

#### `cleanup-activity-logs/index.ts` - Scheduled Cleanup
```typescript
// Removes old activity logs based on retention policy
// Triggered by pg_cron or external scheduler
```

#### `cleanup-old-jobs/index.ts` - Remove Old Jobs
```typescript
// Removes completed/failed jobs older than retention days
// Preserves active and recent jobs
```

#### `openmanage-sync/index.ts` - OpenManage Sync
```typescript
// Syncs servers from Dell OpenManage Enterprise
// Creates/updates servers with OpenManage device IDs
```

#### `analyze-maintenance-windows/index.ts` - Analyze Maintenance Windows
```typescript
// Analyzes optimal maintenance windows
// Considers cluster capacity, workload patterns, safety checks
```

#### `execute-maintenance-windows/index.ts` - Execute Maintenance Windows
```typescript
// Executes scheduled maintenance windows
// Triggered by scheduler at planned_start time
// Creates jobs for firmware updates, coordinates execution
```

#### `get-service-key/index.ts` - Get Service Key
```typescript
// Returns Supabase service role key for operations
// Used by Job Executor to authenticate with Supabase
```

#### `network-diagnostics/index.ts` - Network Diagnostics
```typescript
// Runs network diagnostics (ping, latency, connectivity tests)
// Returns detailed network health report
```

#### `send-notification/index.ts` - Send Notifications
```typescript
// Sends Teams webhook or SMTP email notifications
// Supports job status, cluster alerts, maintenance reminders
```

#### `sync-vcenter-direct/index.ts` - Direct vCenter Sync
```typescript
// Direct vCenter sync (alternative to vcenter-sync)
// Used for on-demand syncs without job queue
```

#### `test-virtual-media-share/index.ts` - Test Virtual Media Share
```typescript
// Tests virtual media share accessibility
// Validates NFS/CIFS share credentials and connectivity
```

#### `validate-network-prerequisites/index.ts` - Validate Network Prerequisites
```typescript
// Validates network prerequisites before operations
// Checks connectivity, latency, DNS resolution
```

### Best Practices

1. **Always use CORS headers** for browser requests
2. **Use Supabase client methods** (not raw SQL)
3. **Log operations** with `logIdracCommand()`
4. **Handle authentication** with JWT from request
5. **Support `OPTIONS` preflight** requests
6. **Return consistent JSON** responses
7. **Use service role key** for admin operations (carefully)
8. **Validate inputs** before processing
9. **Handle errors gracefully** with proper status codes
10. **Document function parameters** in comments

### Example Edge Function Structure

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIdracCommand } from "../_shared/idrac-logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from JWT
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseClient.auth.getUser(token);

    // Parse request
    const { server_id } = await req.json();

    // Fetch server
    const { data: server } = await supabaseClient
      .from('servers')
      .select('*')
      .eq('id', server_id)
      .single();

    if (!server) {
      throw new Error('Server not found');
    }

    // Make iDRAC API call
    const startTime = Date.now();
    const response = await fetch(`https://${server.ip_address}/redfish/v1/Systems/System.Embedded.1`, {
      headers: {
        'Authorization': `Basic ${btoa(`${server.idrac_username}:${decryptedPassword}`)}`,
      },
    });
    const responseTime = Date.now() - startTime;
    const responseData = await response.json();

    // Log the command
    await logIdracCommand(supabaseClient, {
      server_id,
      command_type: 'GET',
      operation_type: 'idrac_api',
      endpoint: '/redfish/v1/Systems/System.Embedded.1',
      full_url: response.url,
      response_body: responseData,
      status_code: response.status,
      response_time_ms: responseTime,
      success: response.ok,
      source: 'edge_function',
      initiated_by: user?.id,
    });

    // Return result
    return new Response(
      JSON.stringify({ success: true, data: responseData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

## Frontend Patterns

### Page Structure

#### Dashboard (`src/pages/Dashboard.tsx`)
- Overview statistics (server count, health, active jobs)
- Recent activity widget
- Quick actions (add server, create job)
- Cluster safety widget
- Next maintenance window

#### Servers (`src/pages/Servers.tsx`)
- Inventory management (flat list or grouped by clusters/groups)
- Server cards with health indicators
- Context menus for actions (power, update, configure)
- Add/edit server dialogs
- Credential assignment
- Uses edge-to-edge layout with stats bar

#### vCenter (`src/pages/VCenter.tsx`)
- ESXi host management
- Cluster view
- Sync status and controls
- Link servers to ESXi hosts
- vCenter settings
- Uses edge-to-edge layout with stats bar

#### Maintenance Planner (`src/pages/MaintenancePlanner.tsx`)
- Calendar view of maintenance windows
- Create/edit maintenance windows
- Approval workflow
- Cluster safety checks
- Optimal window recommendations
- Uses edge-to-edge layout (no default container padding)

#### Activity Monitor (`src/pages/ActivityMonitor.tsx`)
- Real-time activity feed
- Filters (server, type, status, time range)
- Detailed command logs
- Active jobs panel
- Live connection status indicator
- Uses edge-to-edge layout with stats bar

#### Settings (`src/pages/Settings.tsx`)
- Credential management
- Activity logging configuration
- Notification settings (Teams, email)
- Network settings
- User management (RBAC)
- Diagnostics (Job Executor status)

### Common Hooks

#### `useAuth()`
```typescript
import { useAuth } from "@/hooks/useAuth";

const { user, session, signIn, signOut, isLoading } = useAuth();
```

#### `useQuery()` (TanStack Query)
```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['servers'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('servers')
      .select('*')
      .order('hostname');
    if (error) throw error;
    return data;
  },
});
```

#### `useMutation()` (TanStack Query)
```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const queryClient = useQueryClient();

const updateServerMutation = useMutation({
  mutationFn: async ({ id, updates }) => {
    const { data, error } = await supabase
      .from('servers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries(['servers']);
    toast.success('Server updated');
  },
  onError: (error) => {
    toast.error(`Failed to update server: ${error.message}`);
  },
});
```

#### `useNotificationCenter()`
```typescript
import { useNotificationCenter } from "@/hooks/useNotificationCenter";

const { notifications, markAsRead, clearAll } = useNotificationCenter();
```

#### `useLiveConsole()`
```typescript
import { useLiveConsole } from "@/hooks/useLiveConsole";

const { logs, isConnected } = useLiveConsole(jobId);
```

### Layout Patterns

#### Edge-to-Edge Layout (`src/components/Layout.tsx`)

Pages with stats bars use an **edge-to-edge layout** to ensure proper alignment:

```typescript
// In Layout.tsx
const edgeToEdgeRoutes = ["/servers", "/vcenter", "/activity", "/maintenance-planner"];
const useEdgeToEdgeLayout = edgeToEdgeRoutes.some((path) =>
  location.pathname.startsWith(path)
);

const containerClasses = cn(
  "w-full",
  useEdgeToEdgeLayout
    ? "max-w-full px-0 pb-6 pt-0"  // No padding - page manages its own
    : "mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8"  // Standard padding
);
```

**When to Add a Route to `edgeToEdgeRoutes`:**
- Page has a stats bar component (ServerStatsBar, VCenterStatsBar, ActivityStatsBar, CompactStatsBar)
- Stats bar needs to align perfectly with the header border
- Page content manages its own padding

**Stats Bar Pattern:**
```tsx
// Stats bar with built-in padding
<div className="border-b bg-card">
  <div className="px-4 py-3 sm:px-6 lg:px-8">
    {/* Stats content */}
  </div>
</div>

// Main content with padding
<div className="flex-1 overflow-hidden px-4 pb-6 pt-4">
  {/* Page content */}
</div>
```

**Common Mistake:**
Adding a page with a stats bar but forgetting to add it to `edgeToEdgeRoutes` causes double padding and misalignment.

### UI Patterns

#### Server Cards
```tsx
<ServerCard
  server={server}
  onPowerControl={handlePowerControl}
  onEditServer={handleEdit}
  onDeleteServer={handleDelete}
  onViewHealth={handleViewHealth}
/>
```

#### Context Menus (Right-Click)
```tsx
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

<ContextMenu>
  <ContextMenuTrigger>
    <ServerCard server={server} />
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={() => handlePowerOn(server)}>
      Power On
    </ContextMenuItem>
    <ContextMenuItem onClick={() => handleUpdate(server)}>
      Update Firmware
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

#### Status Badges
```tsx
import { Badge } from "@/components/ui/badge";

<Badge variant={server.overall_health === 'OK' ? 'default' : 'destructive'}>
  {server.overall_health}
</Badge>
```

#### Dialogs
```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Server</DialogTitle>
    </DialogHeader>
    {/* Form content */}
  </DialogContent>
</Dialog>
```

#### Tables with Filters
```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

<div className="space-y-4">
  <div className="flex gap-2">
    <Input 
      placeholder="Search..." 
      value={searchTerm} 
      onChange={(e) => setSearchTerm(e.target.value)} 
    />
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger>
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="ok">OK</SelectItem>
        <SelectItem value="warning">Warning</SelectItem>
      </SelectContent>
    </Select>
  </div>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Hostname</TableHead>
        <TableHead>IP Address</TableHead>
        <TableHead>Status</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {filteredServers.map(server => (
        <TableRow key={server.id}>
          <TableCell>{server.hostname}</TableCell>
          <TableCell>{server.ip_address}</TableCell>
          <TableCell>
            <Badge>{server.overall_health}</Badge>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
```

---

## Testing & Deployment

### Local Development

**Start Frontend:**
```bash
npm run dev
# Runs on http://localhost:8080
```

**Start Local Supabase:**
```bash
supabase start
# Creates local instance with migrations applied
```

**Run Job Executor:**
```bash
python job-executor.py
# Polls local Supabase for jobs
```

**Environment Variables:**
Create `.env` file:
```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

Create `.env` for Job Executor:
```env
SUPABASE_URL=http://127.0.0.1:54321
SERVICE_ROLE_KEY=<service-role-key>
IDRAC_DEFAULT_USER=root
IDRAC_DEFAULT_PASSWORD=calvin
```

### Testing

**Run Tests:**
```bash
npm run test
# Runs Vitest tests
```

**Test Coverage:**
- Unit tests: Component logic
- Integration tests: Database queries
- End-to-end tests: Full workflows (optional)

### Production Deployment

**Frontend:**
- Auto-deployed to Lovable Cloud on git push
- Builds with Vite
- Served as static assets

**Edge Functions:**
- Auto-deployed on git push
- Deno runtime
- Serverless scaling

**Job Executor:**
- Manual deployment to on-premises server
- See `docs/SELF_HOSTING.md` for full guide

**Linux Deployment:**
```bash
# Deploy script handles everything
sudo ./scripts/deploy-rhel9.sh
```

**Windows Deployment:**
```powershell
# PowerShell deployment
.\scripts\deploy-windows.ps1
```

---

## Common Troubleshooting

### Issue: "Cannot connect to iDRAC in local mode"

**Symptom**: Edge functions fail to reach iDRAC in local deployment.

**Root Cause**: Docker networking isolation - edge functions run in containers that can't reach host's local network.

**Solution**: Use Job Executor instead.
1. Ensure Job Executor is running: Check Settings → Diagnostics
2. Create a job for the operation (don't use instant preview)
3. Poll job status for completion

**Code Change Needed**:
```typescript
if (isLocalMode) {
  // Don't use edge function
  // Show message: "Use Job Executor for this operation in local mode"
  return <LocalModeHelper />;
}
```

### Issue: "Server appears in Ungrouped despite vCenter link"

**Symptom**: Server linked to ESXi host but still shows in "Ungrouped Servers".

**Root Cause**: Grouping logic not checking vCenter cluster groups.

**Solution**: Update `organizeServersByGroup()` logic.

```typescript
const organizeServersByGroup = (servers, groups, memberships, vcenterHosts) => {
  const grouped = {};
  const ungrouped = [];

  servers.forEach(server => {
    // Check manual groups
    const serverGroups = memberships
      .filter(m => m.server_id === server.id)
      .map(m => groups.find(g => g.id === m.server_group_id));

    // Check vCenter cluster
    if (server.vcenter_host_id) {
      const vcenterHost = vcenterHosts.find(h => h.id === server.vcenter_host_id);
      if (vcenterHost?.cluster) {
        const clusterGroup = groups.find(
          g => g.group_type === 'vcenter_cluster' && g.name === vcenterHost.cluster
        );
        if (clusterGroup) {
          serverGroups.push(clusterGroup);
        }
      }
    }

    if (serverGroups.length === 0) {
      ungrouped.push(server);
    } else {
      serverGroups.forEach(group => {
        if (!grouped[group.id]) grouped[group.id] = [];
        grouped[group.id].push(server);
      });
    }
  });

  return { grouped, ungrouped };
};
```

### Issue: "Credentials not working"

**Symptom**: iDRAC authentication fails despite correct credentials.

**Possible Causes**:
1. Encryption key mismatch
2. IP range mapping incorrect
3. Credential priority misconfigured

**Solutions**:

**Check Encryption Key**:
```sql
SELECT encryption_key FROM activity_settings LIMIT 1;
```
Ensure Job Executor uses same key.

**Verify IP Range Mapping**:
```sql
SELECT 
  cs.name, 
  cir.ip_range, 
  cir.priority 
FROM credential_sets cs
JOIN credential_ip_ranges cir ON cir.credential_set_id = cs.id
WHERE '192.168.1.50'::inet << cir.ip_range::cidr
ORDER BY cir.priority;
```

**Test Credential Resolution**:
Create a `test_credentials` job and check logs:
```python
# In Job Executor
username, password = self.resolve_credentials_for_server(server)
print(f"Resolved credentials: {username} (password: {'*' * len(password)})")
```

### Issue: "Job stuck in pending"

**Symptom**: Job remains in `pending` status indefinitely.

**Possible Causes**:
1. Job Executor not running
2. Job Executor misconfigured
3. Database connectivity issue

**Solutions**:

**Check Job Executor Status**:
```bash
# Linux
sudo systemctl status job-executor

# Windows
.\scripts\manage-job-executor.ps1 -Action Status
```

**Check Job Executor Logs**:
```bash
# Linux
sudo journalctl -u job-executor -f

# Windows
Get-Content "C:\ProgramData\JobExecutor\logs\job-executor.log" -Tail 50 -Wait
```

**Manually Execute Job** (for testing):
```bash
# Stop service
sudo systemctl stop job-executor

# Run manually with debug
python job-executor.py --debug --job-id <job-id>
```

### Issue: "RLS policy denying access"

**Symptom**: Database queries return empty or fail with permission errors.

**Root Cause**: User lacks required role or RLS policy too restrictive.

**Solution**:

**Check User Role**:
```sql
SELECT role FROM user_roles WHERE user_id = '<user-id>';
```

**Check RLS Policy**:
```sql
-- Example: servers table policy
SELECT * FROM pg_policies WHERE tablename = 'servers';
```

**Grant Role** (if needed):
```sql
INSERT INTO user_roles (user_id, role) VALUES ('<user-id>', 'admin');
```

**Temporarily Disable RLS** (for debugging only):
```sql
ALTER TABLE servers DISABLE ROW LEVEL SECURITY;
-- TEST YOUR QUERY
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
```

### Issue: "Edge function timeout"

**Symptom**: Edge function exceeds execution time limit (e.g., 60s).

**Root Cause**: Operation too complex for edge function.

**Solution**: Convert to async job handled by Job Executor.

**Example**:
Instead of:
```typescript
// ❌ Direct execution in edge function (may timeout)
for (const server of servers) {
  await fetch(`https://${server.ip_address}/redfish/v1/...`);
}
```

Do:
```typescript
// ✅ Create job and let Job Executor handle it
await supabaseClient.from('jobs').insert({
  job_type: 'firmware_update',
  target_scope: { server_ids: serverIds },
  status: 'pending',
  created_by: user.id,
});
```

---

## Key Environment Variables

### Frontend (`.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | `http://127.0.0.1:54321` (local)<br>`https://ylwkczjqvymshktuuqkx.supabase.co` (cloud) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key | `eyJhbGciOiJIUzI1...` |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ID | `ylwkczjqvymshktuuqkx` |

### Job Executor (Python)

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `SUPABASE_URL` | Supabase project URL | ✅ | `http://127.0.0.1:54321` |
| `SERVICE_ROLE_KEY` | Supabase service role key (full access) | ✅ | `eyJhbGciOiJIUzI1...` |
| `IDRAC_DEFAULT_USER` | Default iDRAC username | ✅ | `root` |
| `IDRAC_DEFAULT_PASSWORD` | Default iDRAC password | ✅ | `calvin` |
| `VCENTER_HOST` | vCenter server address | ❌ | `vcenter.example.com` |
| `VCENTER_USER` | vCenter username | ❌ | `administrator@vsphere.local` |
| `VCENTER_PASSWORD` | vCenter password | ❌ | `SecurePassword123!` |
| `FIRMWARE_REPO_URL` | Firmware repository path | ❌ | `/mnt/firmware` or `http://repo.local/firmware` |
| `ENCRYPTION_KEY` | AES encryption key (optional, uses DB if not set) | ❌ | `<32-byte-hex-string>` |

### Edge Functions (Deno)

Edge functions automatically have access to:
- `Deno.env.get('SUPABASE_URL')`
- `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
- `Deno.env.get('SUPABASE_ANON_KEY')`

---

## Security Considerations

### 1. Row Level Security (RLS)

All tables have RLS policies enabled:

**Example (servers table):**
```sql
-- Admins can do anything
CREATE POLICY "Admins full access" ON servers
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- Operators can read/update
CREATE POLICY "Operators read/update" ON servers
  FOR SELECT, UPDATE
  USING (EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() AND role IN ('admin', 'operator')
  ));

-- Viewers can only read
CREATE POLICY "Viewers read only" ON servers
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() AND role IN ('admin', 'operator', 'viewer')
  ));
```

### 2. Credential Encryption

All passwords encrypted with AES-256:

**Encryption (Python):**
```python
from cryptography.fernet import Fernet

# Get encryption key from DB or env
key = self.get_encryption_key()
cipher = Fernet(key.encode())

# Encrypt
encrypted = cipher.encrypt(password.encode()).decode()

# Decrypt
decrypted = cipher.decrypt(encrypted.encode()).decode()
```

**Encryption (TypeScript/Deno):**
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Call edge function
const { data } = await supabaseClient.functions.invoke('encrypt-credentials', {
  body: { password: 'plain-text-password' }
});
```

### 3. Role-Based Access Control (RBAC)

Three roles:
- **admin**: Full CRUD access to all resources
- **operator**: Can create/update servers, jobs, maintenance windows
- **viewer**: Read-only access

**Check Role in Frontend:**
```typescript
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const { data: userRole } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', user.id)
  .single();

if (userRole.role === 'admin') {
  // Show admin controls
}
```

**Check Role in Edge Function:**
```typescript
const { data: userRole } = await supabaseClient
  .from('user_roles')
  .select('role')
  .eq('user_id', user.id)
  .single();

if (userRole.role !== 'admin') {
  return new Response(
    JSON.stringify({ error: 'Insufficient permissions' }),
    { status: 403 }
  );
}
```

### 4. JWT Token Authentication

All API requests require valid JWT token:

**Frontend:**
```typescript
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;

// Automatically included by Supabase client
const { data } = await supabase.from('servers').select();
```

**Edge Function:**
```typescript
const authHeader = req.headers.get('Authorization')!;
const token = authHeader.replace('Bearer ', '');
const { data: { user } } = await supabaseClient.auth.getUser(token);
```

### 5. Activity Logging for Audit Trail

Every operation logged to `idrac_commands`:
- Who initiated the action (`initiated_by`)
- What action was performed (`command_type`, `operation_type`)
- When it occurred (`timestamp`)
- Target resource (`server_id`, `job_id`)
- Result (`success`, `error_message`)

### 6. Network Security

- **HTTPS only** for iDRAC and vCenter communication
- **Certificate validation** (can be disabled for self-signed certs)
- **No plaintext credentials** in logs or database
- **Service role key** never exposed to frontend

### 7. Input Validation

**Example (IP address validation):**
```typescript
import { z } from "zod";

const serverSchema = z.object({
  ip_address: z.string().ip({ version: "v4" }),
  hostname: z.string().min(1).max(255).optional(),
  idrac_username: z.string().min(1).max(64),
});

const validated = serverSchema.parse(formData);
```

---

## References

### Documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - High-level architecture overview
- [docs/JOB_EXECUTOR_GUIDE.md](./docs/JOB_EXECUTOR_GUIDE.md) - Job Executor setup and management
- [docs/VCENTER_SYNC_GUIDE.md](./docs/VCENTER_SYNC_GUIDE.md) - vCenter integration guide
- [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md) - Self-hosting deployment guide
- [docs/BACKUP_GUIDE.md](./docs/BACKUP_GUIDE.md) - Database backup and restore
- [docs/OPENMANAGE_SYNC_GUIDE.md](./docs/OPENMANAGE_SYNC_GUIDE.md) - OpenManage Enterprise integration

### External APIs
- [Dell iDRAC Redfish API](https://www.dell.com/support/kbdoc/en-us/000177312/support-for-redfish-api-on-idrac) - Dell's implementation of Redfish standard
- [DMTF Redfish](https://www.dmtf.org/standards/redfish) - Industry standard for datacenter hardware management
- [VMware vCenter API](https://developer.vmware.com/apis/vsphere-automation/latest/) - VMware vSphere Automation SDK
- [pyVmomi](https://github.com/vmware/pyvmomi) - Python SDK for vCenter API

### Technologies
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/)
- [TanStack Query](https://tanstack.com/query/latest)
- [Supabase Documentation](https://supabase.com/docs)
- [Vite Documentation](https://vitejs.dev/)

---

## Glossary

- **iDRAC**: Integrated Dell Remote Access Controller - Dell's out-of-band management platform
- **Redfish**: DMTF standard for RESTful API-based hardware management
- **SCP**: Server Configuration Profile - Dell's XML-based configuration backup format
- **ESXi**: VMware's bare-metal hypervisor
- **vCenter**: VMware's centralized management platform for ESXi hosts
- **RLS**: Row Level Security - PostgreSQL feature for fine-grained access control
- **RBAC**: Role-Based Access Control - Authorization model based on user roles
- **Edge Function**: Serverless function running at the edge (Deno runtime)
- **Job Executor**: Python script that processes async jobs (local deployment component)
- **Service Role Key**: Supabase key with full database access (admin privileges)
- **Air-gapped**: Network isolated from the internet for security
- **CIDR**: Classless Inter-Domain Routing - IP address range notation (e.g., 192.168.1.0/24)

---

**Last Updated**: 2025-11-22  
**Version**: 1.0.1  
**Maintained By**: Dell Server Manager Development Team

---

## Quick Start for AI Agents

If you're an AI coding assistant reading this for the first time:

1. **Read Section 2 (Critical Architecture Principles) FIRST** ⚠️
2. Understand the offline-first design and two-component system
3. Always detect deployment mode before implementing features
4. Default to Job Executor for iDRAC operations
5. Log every API call to `idrac_commands`
6. Use RLS policies and RBAC for security
7. Never assume cloud connectivity

**Most Common Tasks:**
- Adding iDRAC operation: See Section 6.1
- Detecting mode: See Section 2.3
- Credential resolution: See Section 6.4
- Activity logging: See Section 6.5

**Remember**: If it's reachable in a browser, this app can manage it. No cloud required.
