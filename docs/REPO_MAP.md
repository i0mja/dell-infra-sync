# Repository Map

This map provides fast navigation for humans and automated agents.

## Directory Structure Overview

```
├── docs/                    # Documentation (you are here)
├── job_executor/            # Python job execution engine
├── scripts/                 # Utility and deployment scripts
├── src/                     # React/TypeScript web UI
├── supabase/                # Supabase configuration and functions
├── job-executor.py          # Python executor entrypoint
├── CODEX.md                 # Agent onboarding guide
└── requirements.txt         # Python dependencies
```

---

## Web UI (`src/`)

### Core Application

| File | Purpose |
|------|---------|
| `src/App.tsx` | Route definitions, layout wrapper |
| `src/main.tsx` | Application entry point |
| `src/index.css` | Global styles, Tailwind config |

### Pages (`src/pages/`)

| Page | Route | Purpose |
|------|-------|---------|
| `Dashboard.tsx` | `/` | Home dashboard with system overview |
| `Servers.tsx` | `/servers` | Server inventory management |
| `VCenterDashboard.tsx` | `/vcenter` | vCenter clusters, hosts, VMs |
| `ActivityMonitor.tsx` | `/activity` | Job monitoring and history |
| `MaintenancePlanner.tsx` | `/maintenance-planner` | Maintenance window scheduling |
| `Credentials.tsx` | `/credentials` | Credential set management |
| `Settings.tsx` | `/settings` | System configuration |
| `FirmwareManagement.tsx` | `/firmware` | Firmware package management |
| `IsoLibrary.tsx` | `/iso` | ISO image library |
| `ProtectionGroups.tsx` | `/protection-groups` | DR/replication groups |
| `UserManagement.tsx` | `/users` | User and role management |
| `Login.tsx` | `/login` | Authentication |

### Components (`src/components/`)

| Directory | Purpose |
|-----------|---------|
| `ui/` | Shadcn/Radix UI primitives |
| `jobs/` | Job monitoring, workflow viewers |
| `maintenance/` | Maintenance planning, blocker resolution |
| `cluster/` | Cluster safety, update wizards |
| `server/` | Server details, actions |
| `vcenter/` | vCenter tabs, host details |
| `firmware/` | Firmware upload, update workflows |
| `media/` | ISO/virtual media management |
| `credentials/` | Credential forms, assignment |
| `settings/` | Settings tabs and forms |
| `auth/` | Login, session management |

### Key UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `WorkflowExecutionViewer` | `jobs/WorkflowExecutionViewer.tsx` | Real-time workflow progress display |
| `BlockerResolutionWizard` | `maintenance/BlockerResolutionWizard.tsx` | Resolve maintenance blockers |
| `ServerUpdateWizard` | `cluster/wizards/ServerUpdateWizard.tsx` | Firmware update configuration |
| `MaintenanceBlockerAlert` | `maintenance/MaintenanceBlockerAlert.tsx` | Blocker notification UI |
| `JobDetailsDialog` | `jobs/JobDetailsDialog.tsx` | Job detail modal |

### Hooks (`src/hooks/`)

| Hook | Purpose |
|------|---------|
| `use-toast.ts` | Toast notification management |
| `use-mobile.ts` | Mobile viewport detection |
| `useVMHost.ts` | VM host data fetching |
| `useVMDatastores.ts` | VM datastore information |
| `useVMNetworks.ts` | VM network details |

### Services/Utilities (`src/lib/`, `src/services/`)

| File | Purpose |
|------|---------|
| `lib/job-executor-api.ts` | Executor API client |
| `lib/host-priority-calculator.ts` | Host update ordering logic |
| `lib/maintenance-blocker-resolutions.ts` | Build resolution payloads |
| `services/clusterUpdateService.ts` | Cluster update job creation |

### Integrations (`src/integrations/`)

| File | Purpose | Editable? |
|------|---------|-----------|
| `supabase/client.ts` | Supabase client instance | NO (auto-generated) |
| `supabase/types.ts` | Database type definitions | NO (auto-generated) |

---

## Supabase Control Plane (`supabase/`)

### Configuration

| File | Purpose |
|------|---------|
| `config.toml` | Supabase project configuration |
| `seed.sql` | Database seed data (if any) |

### Edge Functions (`supabase/functions/`)

| Function | Purpose | Auth Required |
|----------|---------|---------------|
| `create-job` | Create new job record | Yes |
| `update-job` | Update job status/details | Yes |
| `analyze-maintenance-windows` | Analyze maintenance windows | Yes |
| `execute-maintenance-windows` | Execute maintenance window | Yes |
| `openmanage-sync` | Sync OME inventory | Service role |
| `vcenter-sync` | Sync vCenter inventory | Service role |
| `sync-vcenter-direct` | Direct vCenter sync | Service role |
| `test-vcenter-connection` | Validate vCenter connectivity | Yes |
| `test-virtual-media-share` | Validate media share access | Yes |
| `validate-network-prerequisites` | Network validation | Yes |
| `network-diagnostics` | Network troubleshooting | Yes |
| `encrypt-credentials` | Encrypt credential values | Yes |
| `generate-ssh-keypair` | Generate SSH key pairs | Yes |
| `send-notification` | Send Teams/email notifications | Yes |
| `break-glass-authenticate` | Emergency admin access | No |
| `idm-authenticate` | IDM/LDAP authentication | No |
| `idm-provision` | IDM user provisioning | Yes |
| `cleanup-old-jobs` | Archive old jobs | Service role |
| `cleanup-activity-logs` | Clean activity logs | Service role |
| `get-service-key` | Retrieve service key (restricted) | Yes |
| `delete-user` | Delete user account | Yes |
| `delete-managed-user` | Delete managed user | Yes |

### Shared Utilities (`supabase/functions/_shared/`)

Common utilities used across Edge Functions:
- CORS handling
- Authentication helpers
- Database client initialization
- Error response formatting

### Migrations (`supabase/migrations/`)

SQL migrations defining database schema. Key tables:

| Table | Purpose |
|-------|---------|
| `jobs` | Job orchestration records |
| `job_tasks` | Per-server subtasks |
| `workflow_executions` | Workflow step tracking |
| `servers` | Dell server inventory |
| `vcenter_hosts` | vCenter host inventory |
| `vcenter_vms` | VM inventory |
| `vcenters` | vCenter instances |
| `maintenance_windows` | Scheduled maintenance |
| `maintenance_blocker_resolutions` | Blocker resolution records |
| `credential_sets` | Stored credentials |
| `firmware_packages` | Firmware inventory |
| `iso_images` | ISO image library |
| `protection_groups` | DR protection groups |
| `profiles` | User profiles |
| `audit_logs` | Audit trail |

---

## Python Executor (`job_executor/`)

### Module Structure

```
job_executor/
├── __init__.py           # Package init, executor class
├── config.py             # Environment configuration
├── utils.py              # Shared utilities
├── handlers/             # Job type handlers
│   ├── __init__.py
│   ├── base.py           # Base handler class
│   ├── cluster.py        # Cluster update workflows
│   ├── firmware.py       # Firmware update operations
│   ├── power.py          # Power operations
│   ├── virtual_media.py  # ISO mount/unmount
│   ├── replication.py    # Storage replication
│   ├── vcenter_handlers.py # vCenter operations
│   └── ...               # Other handlers
└── mixins/               # Shared functionality
    ├── database.py       # Database operations
    ├── credentials.py    # Credential resolution
    ├── idrac.py          # iDRAC API calls
    ├── vcenter.py        # vCenter API calls
    └── ...               # Other mixins
```

### Key Handler Classes

| Class | File | Purpose |
|-------|------|---------|
| `ClusterHandler` | `handlers/cluster.py` | Rolling cluster updates, blocker scanning |
| `FirmwareHandler` | `handlers/firmware.py` | Firmware upload/update |
| `PowerHandler` | `handlers/power.py` | Power on/off/reset |
| `VirtualMediaHandler` | `handlers/virtual_media.py` | ISO mount operations |
| `VCenterHandlers` | `handlers/vcenter_handlers.py` | vCenter sync, maintenance |
| `ReplicationHandler` | `handlers/replication.py` | Storage replication |

### Mixin Classes

| Class | File | Purpose |
|-------|------|---------|
| `DatabaseMixin` | `mixins/database.py` | Job/task CRUD, status updates |
| `CredentialsMixin` | `mixins/credentials.py` | Credential resolution, decryption |
| `IdracMixin` | `mixins/idrac.py` | iDRAC Redfish API calls |
| `VCenterMixin` | `mixins/vcenter.py` | vCenter/vSphere API calls |

### Entry Point

| File | Purpose |
|------|---------|
| `job-executor.py` | Main executor loop, job dispatch |

---

## Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `setup-local-supabase.sh` | Local Supabase setup |
| `backup-database.ts` | Database backup |
| `restore-database.ts` | Database restore |
| `create-offline-package.*` | Offline deployment packaging |
| `install-offline-*` | Offline installation |
| `collect-diagnostics.*` | Diagnostic bundle collection |
| `health-check.*` | System health verification |

---

## Sync Scripts (Root Level)

| Script | Purpose |
|--------|---------|
| `openmanage-sync-script.py` | OME inventory sync |
| `vcenter-sync-script.py` | vCenter inventory sync |
| `idrac_throttler.py` | iDRAC request rate limiting |

---

## Configuration Files

| File | Purpose | Editable? |
|------|---------|-----------|
| `package.json` | Node.js dependencies | NO (via tools) |
| `requirements.txt` | Python dependencies | Yes |
| `vite.config.ts` | Vite build configuration | Yes |
| `tailwind.config.ts` | Tailwind CSS configuration | Yes |
| `tsconfig.json` | TypeScript configuration | Yes |
| `components.json` | Shadcn UI configuration | Yes |
| `.env` | Environment variables | NO (secrets) |

---

## Key Contracts to Preserve

1. **Job type strings**: Must match across UI, Edge Functions, and executor
2. **Job payload shapes**: Structure expected by each handler
3. **Database columns**: Referenced by Edge Functions and executor
4. **Edge Function paths**: Called by UI and executor
5. **Workflow step names**: Used for UI display and progress tracking
