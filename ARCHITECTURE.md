# Dell Server Manager - Phase 1 Architecture

## Overview

Enterprise-grade full-stack web application for managing Dell server infrastructure with VMware vCenter integration. Built on Lovable Cloud with React frontend and PostgreSQL backend.

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Tailwind CSS** for styling with dark enterprise theme
- **shadcn/ui** component library
- **React Router** for navigation
- **TanStack Query** for data fetching

### Backend (Lovable Cloud)
- **PostgreSQL** database via Supabase
- **Row Level Security (RLS)** for data protection
- **Supabase Auth** for authentication
- **Edge Functions** (ready for Phase 2/3)

## Phase 1 Implementation ✅

### Database Schema

**Core Tables:**
- `profiles` - User profile data
- `user_roles` - RBAC with admin/operator/viewer roles
- `servers` - Dell server inventory (iDRAC data)
- `vcenter_hosts` - ESXi host data from vCenter
- `jobs` - Firmware update and scan jobs
- `job_tasks` - Granular task tracking per server
- `audit_logs` - Security audit trail

**Security:**
- All tables protected with Row Level Security
- Role-based access using `has_role()` security definer function
- Admins: full access
- Operators: can manage servers and run jobs
- Viewers: read-only access

### Authentication System
- Email/password authentication
- Auto-confirmed signups for development
- Secure session management with JWT
- Protected routes requiring authentication
- Ready for Red Hat IdM LDAP integration (Phase 4)

### User Interface

**Pages Implemented:**
1. **Authentication** - Login/signup with branded design
2. **Dashboard** - Real-time statistics and system overview
3. **Server Inventory** - View and manage Dell servers
   - Add servers manually
   - Search and filter capabilities
   - Link status indicators
4. **vCenter** - Placeholder for Phase 2
5. **Jobs** - Placeholder for Phase 3

**Design System:**
- Professional dark enterprise theme
- Blue primary color (Dell/tech aesthetic)
- Status colors (success, warning, error)
- Responsive mobile-first layout
- Sidebar navigation

## Data Model Relationships

```
auth.users (Supabase Auth)
    ↓
profiles (1:1)
    ↓
user_roles (1:many) → app_role enum

servers ←→ vcenter_hosts (bidirectional link)
    ↓
job_tasks ← jobs ← profiles (created_by)
```

## Security Implementation

### Role-Based Access Control (RBAC)
- **Admin**: Full system access, user management, all operations
- **Operator**: Server management, job creation, no user changes
- **Viewer**: Read-only access to inventory and jobs

### RLS Policies
All database operations go through RLS policies:
- Authentication required for all data access
- Role checks using `has_role()` function
- Prevents privilege escalation
- Audit logging for all significant actions

## Next Steps (Phase 2)

### vCenter Integration
- [ ] VMware vCenter API client (pyVmomi or REST)
- [ ] Edge function to sync ESXi hosts
- [ ] Auto-linking servers via Service Tag matching
- [ ] Cluster topology visualization
- [ ] Maintenance mode status tracking

### Features to Add
- [ ] Manual server-to-host linking UI
- [ ] vCenter credential management
- [ ] Real-time sync scheduling
- [ ] Cluster health monitoring

## Phase 3 Implementation ✅

### Job Orchestration
- ✅ Job creation UI with firmware update and discovery scan types
- ✅ Real-time job progress tracking with WebSocket updates
- ✅ Task-level status monitoring
- ✅ Job detail view with live progress bars
- ✅ Filter jobs by status (all, active, completed, failed)

### Edge Functions
- ✅ `create-job` - Creates jobs with proper validation
- ✅ `update-job` - Updates job/task status (public endpoint for executor)
- ✅ Job executor Python script for local network operations

### Job Executor Features
- ✅ Polls for pending jobs from cloud
- ✅ Executes firmware updates with vCenter integration
- ✅ Runs IP discovery scans concurrently
- ✅ Real-time progress reporting
- ✅ Can run as system service

## Next Steps (Phase 4)

### Enterprise Features
- [ ] Red Hat IdM LDAP integration
- [ ] Email notifications (SMTP)
- [ ] Microsoft Teams webhooks
- [ ] Scheduled job execution
- [ ] Advanced audit reporting

## Environment Setup

### Required Secrets (Phase 2+)
```
VCENTER_HOST=vcenter.example.com
VCENTER_USERNAME=svc_servermgr
VCENTER_PASSWORD=***
IDRAC_DEFAULT_USER=root
IDRAC_DEFAULT_PASSWORD=***
```

### Optional Secrets (Phase 4)
```
IDM_LDAP_URL=ldaps://idm.example.com
IDM_BIND_DN=uid=bind,cn=users,dc=example,dc=com
IDM_BIND_PASSWORD=***
SMTP_HOST=smtp.example.com
SMTP_USER=***
SMTP_PASSWORD=***
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
```

## Development Notes

### Database Migrations
All schema changes are version controlled via Supabase migrations. The initial migration includes:
- All table definitions
- RLS policies
- Security definer functions
- Indexes for performance

### Adding New Roles
To add a new role to the RBAC system:
1. Add to `app_role` enum via migration
2. Update RLS policies as needed
3. Update frontend role checks

### Testing Recommendations
1. Create test users with different roles
2. Verify RLS policies block unauthorized access
3. Test all CRUD operations per role
4. Validate audit log entries

## API Integration Points (Future)

### Dell iDRAC Redfish API
- Service Root: `https://<idrac-ip>/redfish/v1/`
- Systems: `/redfish/v1/Systems/System.Embedded.1`
- Managers: `/redfish/v1/Managers/iDRAC.Embedded.1`
- Update Service: `/redfish/v1/UpdateService`

### VMware vCenter API
- Session management via pyVmomi
- HostSystem objects for ESXi hosts
- ClusterComputeResource for clusters
- Maintenance mode operations

## Performance Considerations

### Database Indexes
Created indexes on:
- Server service tags and IPs (frequent lookups)
- vCenter host serial numbers (auto-linking)
- Job status (active job queries)
- Audit log timestamps (reporting)

### Future Optimizations
- Implement caching for vCenter data
- Rate limiting for discovery scans
- Batch operations for bulk updates
- WebSocket for real-time job updates

## Deployment

### Current State
- Frontend deployed via Lovable preview
- Backend (Lovable Cloud) automatically provisioned
- Database migrations applied automatically

### Production Readiness Checklist
- [ ] Environment secrets configured
- [ ] Backup strategy implemented
- [ ] Monitoring and alerting setup
- [ ] Red Hat IdM integration tested
- [ ] Load testing completed
- [ ] Security audit performed
- [ ] Documentation finalized

## Support and Maintenance

### Monitoring Points
- Authentication success/failure rates
- Job execution success rates
- Discovery scan completion times
- Database query performance
- RLS policy violations (audit logs)

### Backup Strategy
- Lovable Cloud handles database backups
- Export critical configurations to version control
- Document manual recovery procedures
