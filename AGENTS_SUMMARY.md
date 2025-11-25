# AGENTS_SUMMARY.md - Dell Server Manager Quick Reference for AI Assistants

> **Condensed version of AGENTS.md (~500 lines) optimized for AI coding assistants**
> For full details, see AGENTS.md (1911 lines)

---

## 🎯 Application Overview

**Dell Server Manager** is an enterprise application for managing Dell servers via iDRAC Redfish API.

**CRITICAL CHARACTERISTICS:**
- **Offline-first**: Designed for air-gapped/secure networks WITHOUT internet access
- **Local network only**: Operates on 192.168.x.x, 10.x.x.x, 172.16.x.x networks
- **No cloud required**: If accessible in browser, this app CAN and SHOULD manage it
- **Target users**: Enterprise IT admins in secure/classified environments

---

## ⚠️ CRITICAL ARCHITECTURE (MUST READ)

### 1. Offline-First Design

**NEVER assume cloud connectivity is available.**
- All iDRAC operations use local HTTP/HTTPS
- No external API calls for core functionality
- Browser accessibility = app accessibility

### 2. Two-Component System (MOST IMPORTANT)

#### **Job Executor (Python) - PRIMARY METHOD**
- Runs on host machine with full local network access
- **Use for**: 95% of use cases (local deployments)
- Handles ALL iDRAC operations: firmware, discovery, power, BIOS, SCP, etc.
- **Why**: Docker networking limits edge function access to local IPs

#### **Edge Functions (Supabase) - SECONDARY, CLOUD ONLY**
- Runs in Docker with limited host network access
- **Use for**: Cloud deployments with public iDRAC IPs only
- Cannot reliably reach 192.168.x.x/10.x.x.x from Docker containers
- In local mode, defer to Job Executor

### 3. Deployment Mode Detection

**ALWAYS detect mode and adjust UI/features:**

```typescript
const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                   import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
```

- **Local Mode**: Job Executor handles all operations
- **Cloud Mode**: Edge Functions can work (public IPs only)

### 4. Feature Implementation Strategy

**Universal pattern - works in BOTH modes:**
1. Create job type (database migration)
2. Implement in Job Executor (job-executor.py)
3. Create UI to trigger job
4. Poll job status for completion

**For local mode** (ALWAYS IMPLEMENT FIRST):
- Disable instant preview/edge function features
- Show messages directing to Job Executor
- Create job types for all operations

**For cloud mode** (OPTIONAL):
- Enable instant features (test connection, preview)
- Edge functions work for quick queries

---

## 📦 Technology Stack

**Frontend:**
- React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query (React Query)
- Vite + React Router

**Backend (Lovable Cloud/Supabase):**
- PostgreSQL with RLS
- Supabase Auth
- Edge Functions (Deno)
- Realtime subscriptions

**Job Executor:**
- Python 3.7+
- requests (iDRAC Redfish API)
- pyVmomi (vCenter API)
- cryptography (password encryption)
- Runs as systemd service (Linux) or Task Scheduler (Windows)

---

## 🗂️ Project Structure (Key Locations)

```
src/
├── components/
│   ├── activity/          # Activity monitor
│   ├── jobs/              # Job management UI
│   ├── servers/           # Server management
│   └── ui/                # shadcn/ui components
├── integrations/supabase/
│   ├── client.ts          # Supabase client (auto-generated)
│   └── types.ts           # Database types (auto-generated)
├── pages/                 # Route pages
└── index.css              # Design tokens

supabase/
├── functions/             # Edge functions (Deno)
│   └── _shared/          # Shared utilities (idrac-logger, etc.)
├── migrations/           # Database migrations
└── config.toml           # Supabase config

job_executor/             # Job Executor modules (NEW)
├── config.py             # Environment config
├── connectivity.py       # Network testing/discovery
├── scp.py               # SCP backup/restore
└── utils.py             # Utilities

job-executor.py           # Main executor script
```

---

## 🗄️ Database Schema (Essential Tables)

### `servers` - Dell Server Inventory
- `ip_address` (unique) - iDRAC IP
- `credential_set_id` (FK) - Linked credentials
- `vcenter_host_id` (FK) - Linked ESXi host
- `connection_status` - "connected"/"failed"/"unknown"
- `credential_test_status` - Last credential test result
- `power_state`, `overall_health`, `bios_version`, `idrac_firmware`

### `credential_sets` - Shared iDRAC Credentials
- `username`, `password_encrypted` - Encrypted credentials
- `is_default` - Default fallback
- `priority` - Resolution priority (lower = higher)
- Related: `credential_ip_ranges` (CIDR mapping)

### `jobs` - Async Job Queue
- `job_type` (ENUM) - Job type (see below)
- `status` (ENUM) - "pending"/"running"/"completed"/"failed"
- `target_scope` (JSONB) - Target definition
- `details` (JSONB) - Job-specific parameters

**Job Types:**
- `firmware_update`, `discovery_scan`, `vcenter_sync`
- `power_action`, `health_check`, `fetch_event_logs`
- `boot_configuration`, `virtual_media_mount/unmount`
- `bios_config_read/write`, `scp_export/import`
- `full_server_update`, `rolling_cluster_update`

### `job_tasks` - Individual Tasks Within Jobs
- `job_id` (FK) - Parent job
- `server_id` (FK) - Target server
- `status`, `log` - Task tracking

### `idrac_commands` - Activity Log (CRITICAL)
- **Log ALL API calls** (iDRAC, vCenter, OpenManage)
- Used by **both Edge Functions AND Job Executor**
- `operation_type` - "idrac_api"/"vcenter_api"/"openmanage_api"
- `source` - "edge_function"/"job_executor"/"manual"
- `success`, `error_message`, `response_time_ms`
- Provides full audit trail

### `server_groups` - Server Organization
- `name`, `description`
- `group_type` - "manual" / "vcenter_cluster"
- `min_healthy_servers` - Safety threshold
- Related: `server_group_members` (many-to-many join)

### `vcenter_hosts` - ESXi Hosts
- `name`, `cluster` - vCenter data
- `serial_number` - Link to servers
- `server_id` (FK) - Bidirectional link
- Auto-synced from vCenter

### `maintenance_windows` - Scheduled Maintenance
- `planned_start/end` - Schedule
- `status` - "scheduled"/"in_progress"/"completed"
- `server_ids/cluster_ids/server_group_ids` - Targets
- `requires_approval`, `auto_execute` - Workflow
- `recurrence_enabled`, `recurrence_pattern` - Recurring

### `profiles` - User Profiles
- Linked to `auth.users`
- **NEVER reference auth.users directly** - use profiles

### `user_roles` - RBAC
- `role` (ENUM) - "admin"/"operator"/"viewer"

---

## 🔧 Common Implementation Patterns

### 1. Adding New iDRAC Operation

**Step 1: Migration**
```sql
ALTER TYPE job_type ADD VALUE 'new_operation';
```

**Step 2: Job Executor**
```python
def execute_new_operation(self, job_id):
    job = self.get_job_by_id(job_id)
    self.update_job_status(job_id, 'running')
    
    for server_id in job['target_scope']['server_ids']:
        server = self.get_server_by_id(server_id)
        username, password = self.get_credentials_for_server(server)
        
        # Make iDRAC API call
        response = requests.get(f"https://{server['ip_address']}/redfish/v1/...", ...)
        
        # Log command
        self.log_idrac_command(server_id, job_id, 'GET', endpoint, ...)
    
    self.update_job_status(job_id, 'completed')
```

**Step 3: UI**
```tsx
<CreateJobDialog jobType="new_operation" targetScope={{ server_ids: [...] }} />
```

**Step 4: Poll Status**
```tsx
const { data: job } = useQuery({
  queryKey: ['jobs', jobId],
  refetchInterval: (data) => 
    data?.status === 'pending' || data?.status === 'running' ? 3000 : false
});
```

### 2. Credential Resolution Priority
1. Server-specific credentials (`servers.idrac_username`)
2. Credential sets with matching IP range (by priority)
3. Default credential set (`is_default = true`)
4. Environment variables (fallback)

### 3. Activity Logging (REQUIRED)

**Log ALL API calls to `idrac_commands`:**

```python
# Job Executor
self.log_idrac_command(
    server_id=server_id,
    job_id=job_id,
    command_type='GET',
    operation_type='idrac_api',
    endpoint='/redfish/v1/...',
    full_url=response.url,
    response_body=response.json(),
    status_code=response.status_code,
    response_time_ms=int(response.elapsed.total_seconds() * 1000),
    success=response.ok,
    source='job_executor'
)
```

```typescript
// Edge Functions
import { logIdracCommand } from "../_shared/idrac-logger.ts";

await logIdracCommand(supabase, {
  server_id, job_id, command_type: 'GET',
  operation_type: 'idrac_api', endpoint, full_url,
  response_body, status_code, response_time_ms,
  success: true, source: 'edge_function', initiated_by: userId
});
```

### 4. Realtime Updates

```sql
-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.idrac_commands;
```

```typescript
// Subscribe
const channel = supabase
  .channel('realtime-channel')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'idrac_commands' },
      (payload) => console.log('New command:', payload.new))
  .subscribe();
```

### 5. Server Grouping Logic

**Two types:**
- **Manual groups**: User-created via `server_groups`
- **vCenter cluster groups**: Auto-created, `group_type = 'vcenter_cluster'`

**"Ungrouped Servers"**: Not in any manual group AND not in vCenter cluster group

---

## ✅ Critical DO's

1. **Create job types** for iDRAC operations in local deployments
2. **Detect local vs cloud mode** and adjust UI
3. **Use Job Executor** for all iDRAC operations in local mode
4. **Assume private networks** (192.168.x.x, 10.x.x.x)
5. **Store credentials encrypted** with proper key management
6. **Support credential sets** with IP range mapping
7. **Implement error handling** for network timeouts
8. **Log ALL API calls** to `idrac_commands`
9. **Use RLS policies** for database security
10. **Poll job status** for completion (don't rely on edge functions in local mode)
11. **Show helpful local mode messages** when features won't work

## ❌ Critical DON'Ts

1. **Assume cloud connectivity** is available
2. **Rely on edge functions** for iDRAC operations in local mode
3. **Suggest VPNs** or cloud access for basic operations
4. **Create cloud-only features** without local alternatives
5. **Store passwords in plaintext**
6. **Try to modify Docker networking** (Job Executor is the solution)
7. **Reference `auth.users` directly** (use `profiles` instead)
8. **Hardcode URLs or credentials**
9. **Forget to log API calls**
10. **Ignore deployment mode** detection

---

## 🐍 Job Executor Architecture

**Main Script**: `job-executor.py`

**Execution Flow:**
1. Poll `jobs` table for `status = 'pending'`
2. Route to handler based on `job_type`
3. Update status to `running`
4. Make API calls (iDRAC/vCenter)
5. Log every command to `idrac_commands`
6. Update status to `completed` or `failed`
7. Loop back to step 1

**Key Modules:**
- `job_executor/config.py` - Environment config
- `job_executor/connectivity.py` - Network operations (discovery, ping, connection test)
- `job_executor/scp.py` - SCP backup/restore operations
- `job_executor/utils.py` - JSON parsing, Unicode handling

**Key Methods:**
```python
class JobExecutor(ScpMixin, ConnectivityMixin):
    def run(self):                              # Main loop
    def execute_job(self, job_id):              # Route to handler
    def get_server_by_id(self, server_id):      # Fetch server
    def get_credentials_for_server(self, server): # Resolve credentials
    def update_job_status(self, job_id, status): # Update status
    def log_idrac_command(self, ...):           # Activity logging
    def decrypt_password(self, encrypted):      # Decrypt credentials
    
    # Job handlers
    def execute_firmware_update(self, job_id)
    def execute_discovery_scan(self, job_id)
    def execute_power_action(self, job_id)
    def execute_scp_export(self, job_id)
    # ... more handlers
```

**Deployment:**
- Linux: systemd service (`job-executor.service`)
- Windows: Task Scheduler (`scripts/manage-job-executor.ps1`)

---

## ⚡ Edge Functions (Cloud Mode Only)

**Key Functions:**
- `create-job/` - Create async jobs
- `update-job/` - Update job status (called by Job Executor)
- `preview-server-info/` - Quick iDRAC preview (cloud only)
- `refresh-server-info/` - Fetch server details
- `vcenter-sync/` - Sync ESXi hosts
- `test-vcenter-connection/` - Test vCenter credentials
- `encrypt-credentials/` - Encrypt passwords
- `cleanup-activity-logs/` - Scheduled cleanup
- `cleanup-old-jobs/` - Remove old jobs

**Best Practices:**
- Include CORS headers
- Validate input
- Use Supabase client methods (not raw SQL)
- Log to `idrac_commands`
- Handle timeouts gracefully

---

## 🎨 Frontend Patterns

### Page Structure (Edge-to-Edge Layout)

```tsx
<div className="flex flex-col h-screen">
  <Layout>
    <div className="flex-1 overflow-hidden">
      {/* Stats bar */}
      <StatsBar />
      
      {/* Filter toolbar */}
      <FilterToolbar />
      
      <div className="flex-1 overflow-auto">
        {/* Main content */}
      </div>
    </div>
  </Layout>
</div>
```

### Common Hooks
- `useAuth()` - Authentication state
- `useLiveConsole()` - Real-time job logs
- `useNotificationCenter()` - Live notifications
- `useActiveJobs()` - Active job monitoring
- `useSafetyStatus()` - Cluster safety checks
- `useMaintenanceData()` - Maintenance window data

### Common UI Patterns
- **Server Cards**: Visual server representation with health indicators
- **Context Menus**: Right-click actions on servers/jobs
- **Status Badges**: Color-coded status indicators
- **Dialogs**: Modal forms for actions
- **Tables with Filters**: Data tables with search/filter
- **Real-time Updates**: Live console views, notifications

---

## 🚨 Common Troubleshooting

### Connection Failures in Local Mode
**Symptom**: "Cannot reach iDRAC" but browser can access it
**Cause**: Edge function trying to reach local IP (Docker networking issue)
**Solution**: Use Job Executor for iDRAC operations in local mode

### Server Grouping Issues
**Symptom**: Servers not showing in correct groups
**Cause**: vCenter sync creates cluster groups, manual groups use join table
**Check**: `server_group_members` table for memberships

### Credential Problems
**Symptom**: Authentication failures
**Cause**: Wrong credential resolution or decryption issues
**Check**: 
1. Encryption key in `activity_settings`
2. Credential set priorities
3. IP range mappings in `credential_ip_ranges`

### Jobs Stuck in "pending"
**Symptom**: Jobs never start
**Cause**: Job Executor not running
**Check**: 
- Linux: `sudo systemctl status job-executor`
- Windows: Task Scheduler status
- Settings → Diagnostics → Job Executor status

### RLS Policy Errors
**Symptom**: "permission denied" on database operations
**Cause**: Row Level Security blocking query
**Solution**: Check user role in `user_roles`, verify RLS policies

---

## 🔐 Security Considerations

**Credential Encryption:**
- AES encryption with key in `activity_settings.encryption_key`
- Never store plaintext passwords
- Use `encrypt-credentials` edge function

**RLS (Row Level Security):**
- All tables have RLS policies
- Admin role: full access
- Operator: CRUD on servers/jobs/maintenance
- Viewer: read-only

**RBAC (Role-Based Access Control):**
- Roles defined in `user_roles` table
- Enforced via RLS policies
- JWT token-based authentication

**Activity Logging:**
- ALL API calls logged to `idrac_commands`
- Full audit trail for compliance
- Retention managed by `activity_settings`

---

## 🔑 Key Environment Variables

**Frontend (.env - auto-generated):**
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

**Job Executor:**
```
SUPABASE_URL=...
SERVICE_ROLE_KEY=...
IDRAC_DEFAULT_USER=root
IDRAC_DEFAULT_PASSWORD=calvin
VCENTER_HOST=vcenter.example.com
VCENTER_USER=administrator@vsphere.local
VCENTER_PASSWORD=...
FIRMWARE_REPO_URL=https://downloads.dell.com/...
```

---

## 📚 Quick Reference

**Auto-Generated Files (NEVER EDIT):**
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `.env`
- `supabase/config.toml`

**iDRAC Redfish API:**
- Base URL: `https://{ip}/redfish/v1/`
- Auth: Basic Auth (username/password)
- No cloud service involvement

**vCenter API:**
- Uses pyVmomi (Python SDK)
- Direct HTTPS connection
- Also local network only

**Network Access Patterns:**
- iDRAC: HTTP/HTTPS to local IPs
- vCenter: HTTPS to local vCenter server
- All purely local network - no cloud

---

## 🎯 Implementation Checklist for New Features

When adding features, verify:

- [ ] Works in local mode (Job Executor)
- [ ] Detects deployment mode correctly
- [ ] Logs all API calls to `idrac_commands`
- [ ] Uses credential resolution properly
- [ ] Implements proper error handling
- [ ] Shows helpful messages in local mode
- [ ] Uses job types (not just edge functions)
- [ ] Follows RLS security patterns
- [ ] Polls job status appropriately
- [ ] Handles private network IPs correctly

---

**For full details, code examples, and extended troubleshooting, see [AGENTS.md](./AGENTS.md) (1911 lines)**
