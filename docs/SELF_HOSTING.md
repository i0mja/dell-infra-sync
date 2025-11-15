# Self-Hosting Guide

Complete guide for deploying Dell Server Manager on your own infrastructure.

## Quick Start

### RHEL 9 / CentOS 9 / Rocky Linux 9

```bash
# 1. Clone repository
git clone https://github.com/i0mja/dell-infra-sync ~/dell-server-manager
cd ~/dell-server-manager

# 2. Run deployment script
sudo bash scripts/deploy-rhel9.sh
```

**That's it!** The script will:
- ✅ Install Docker and Node.js
- ✅ Setup and configure Supabase
- ✅ Create your admin user account
- ✅ Build and deploy the application
- ✅ Create systemd services (frontend + Job Executor)
- ✅ **Optionally setup SSL/TLS with Let's Encrypt** (if you have a domain)
- ✅ Configure firewall

**Total time: ~5 minutes**

### Windows Server 2022

```powershell
# 1. Clone repository (run as Administrator)
git clone https://github.com/i0mja/dell-infra-sync C:\dell-server-manager
cd C:\dell-server-manager

# 2. Run deployment script
.\scripts\deploy-windows.ps1
```

**That's it!** The script will:
- ✅ Install Docker Desktop, Node.js, and dependencies
- ✅ Install Supabase CLI (handles all configuration automatically)
- ✅ Initialize and start Supabase services
- ✅ Create your admin user account
- ✅ Build and deploy the application
- ✅ Create Windows services (frontend + Job Executor)
- ✅ **Optionally setup SSL/TLS with Let's Encrypt** (if you have a domain)
- ✅ Configure firewall

**Total time: ~10 minutes** (includes Docker Desktop and Supabase CLI installation)

---

## Environment Configuration

Dell Server Manager uses Vite's environment file hierarchy for configuration:

- **`.env`** - Contains Lovable Cloud credentials (managed automatically, do not edit)
- **`.env.local`** - Local overrides for offline/self-hosted deployments (created by installers)
- **`.env.offline.template`** - Template for offline installations (committed to repository)

### How It Works

1. **Lovable Cloud Development**: Uses `.env` with cloud credentials
2. **Local/Offline Deployments**: Installer scripts create `.env.local` from `.env.offline.template`
3. **Priority**: Vite loads `.env.local` first, then falls back to `.env`

This approach allows:
- ✅ Lovable Cloud to manage `.env` without conflicts
- ✅ Local deployments to override with `.env.local`
- ✅ No manual `.env` editing required

**Note**: If you're developing locally and want to use local Supabase, simply copy `.env.offline.template` to `.env.local`:

```bash
cp .env.offline.template .env.local
# Then update VITE_SUPABASE_URL if needed
```

---

## Deployment Modes: Local vs Cloud-Connected

Dell Server Manager supports two deployment modes to accommodate different infrastructure requirements:

### 🔒 Local/Air-Gapped Mode

**What it is:** Fully self-contained deployment with a local Supabase instance. No internet connectivity required after initial installation.

**Best for:**
- **Air-gapped environments** (secure networks with no internet access)
- **Compliance requirements** mandating on-premises data storage
- **Maximum data sovereignty** - all data stays within your infrastructure
- **High-security environments** (government, defense, healthcare)
- **Remote sites** with unreliable or no internet connectivity

**How it works:**
- Deploys complete Supabase stack locally via Docker
- Database, authentication, and storage all run on your server
- Data never leaves your infrastructure
- Requires local Supabase maintenance and backups

**Trade-offs:**
- ✅ **Pros:**
  - Complete data isolation
  - No internet dependency after deployment
  - Full control over all components
  - Compliance-friendly for regulated industries
  - Predictable performance (no external API calls)

- ❌ **Cons:**
  - Requires more local resources (CPU, RAM, disk for database)
  - You manage Supabase updates and maintenance
  - Need to configure local backups
  - More complex troubleshooting (multiple services to monitor)
  - Initial setup is more involved

**Resource Requirements:**
- **Minimum:** 4 CPU cores, 8GB RAM, 50GB disk
- **Recommended:** 8 CPU cores, 16GB RAM, 100GB SSD

---

### ☁️ Cloud-Connected Mode

**What it is:** Application connects to Lovable Cloud's managed Supabase backend. Only the frontend runs locally.

**Best for:**
- **Connected environments** with reliable internet access
- **Simplified operations** - no database maintenance
- **Reduced local resource usage** - only runs the frontend
- **Centralized management** - access backend from anywhere
- **Quick deployments** - faster setup, fewer services to manage

**How it works:**
- Only the React application runs on your server
- Database, authentication, and storage hosted on Lovable Cloud
- Data synchronized via secure HTTPS APIs
- Automatic backend updates and maintenance

**Trade-offs:**
- ✅ **Pros:**
  - Minimal local resource requirements
  - No database maintenance required
  - Automatic backend updates and scaling
  - Built-in redundancy and backups
  - Easier troubleshooting (fewer moving parts)
  - Centralized backend management via web UI

- ❌ **Cons:**
  - Requires internet connectivity for operation
  - Data stored in cloud infrastructure
  - Dependent on Lovable Cloud availability
  - API latency (minimal but present)
  - May not meet air-gap compliance requirements

**Resource Requirements:**
- **Minimum:** 2 CPU cores, 4GB RAM, 10GB disk
- **Recommended:** 4 CPU cores, 8GB RAM, 20GB SSD

---

### Choosing the Right Mode

| Requirement | Local/Air-Gapped | Cloud-Connected |
|-------------|------------------|-----------------|
| No internet required | ✅ Yes | ❌ No |
| Data stays on-premises | ✅ Yes | ❌ No (cloud-hosted) |
| Minimal resource usage | ❌ No (runs DB locally) | ✅ Yes |
| Zero backend maintenance | ❌ No (you maintain) | ✅ Yes |
| Air-gap compliance | ✅ Yes | ❌ No |
| Simplest operation | ❌ No (more services) | ✅ Yes |
| Works in secure enclaves | ✅ Yes | ❌ No |

**During deployment**, both Windows and RHEL scripts will prompt you to choose your deployment mode. Select based on your specific infrastructure and compliance requirements.

**Migration:** You can migrate data between modes using the backup/restore tools. See [docs/BACKUP_GUIDE.md](BACKUP_GUIDE.md) for details.

## Database Migrations

For **air-gapped deployments**, the deployment scripts automatically apply every SQL migration from `supabase/migrations/`. This keeps your local schema in lockstep with the Lovable Cloud backend so new features (credential pools, activity monitor, job automation, etc.) work immediately after an update.

### What Gets Created

**Tables:**
- `profiles` / `user_roles` - User metadata and RBAC
- `servers` / `vcenter_hosts` - Inventory sources
- `jobs` / `job_tasks` / `idrac_commands` - Job engine with detailed execution history
- `notification_settings` / `activity_settings` - Notification and activity monitor configuration
- `credential_sets` / `credential_ip_ranges` - Credential pooling for automated discovery
- `openmanage_settings` / `vcenter_settings` - External integrations
- `api_tokens` - Personal access tokens for automation

**Critical Functions:**
- `handle_new_user()` - Automatically creates user profiles and assigns default viewer role
- `has_role()` - Security definer function for RLS policy evaluation
- `get_user_role()` - Retrieves user's highest privilege role
- `update_updated_at_column()` - Maintains timestamp consistency
- `validate_api_token()` - Secures API authentication

**Triggers:**
- `on_auth_user_created` - Fires on user signup to create profile and role
- Auto-update triggers for `updated_at` timestamps on all mutable tables

### Verifying Database Schema

After deployment, verify the complete schema was created:

**Windows:**
```powershell
cd C:\dell-supabase
.\scripts\verify-database.ps1
```

**RHEL:**
```bash
cd /opt/supabase
./scripts/verify-database.sh
```

The verification script validates:
- ✓ Database connectivity
- ✓ Custom enum types (app_role, job_status, job_type)
- ✓ Core tables (servers, jobs, credential_sets, activity_settings, etc.)
- ✓ Required functions and triggers
- ✓ Row Level Security and policies on every user-facing table

### Troubleshooting Login Issues

**Symptom: 500 Internal Server Error on login**
```
POST http://127.0.0.1:54321/auth/v1/token?grant_type=password 500
```

**Root Cause:** Database schema was not created. Tables, functions, or the critical `on_auth_user_created` trigger are missing.

**Solution:**

1. **Verify current schema:**
   ```bash
   docker exec supabase-db psql -U postgres -d postgres -c "\dt public.*"
   ```
   
   Should show the core tables (servers, jobs, credential_sets, etc.). If empty or incomplete:

2. **Reapply migrations manually:**
   ```bash
   # Navigate to project directory
   cd /opt/supabase  # RHEL
   cd C:\dell-supabase  # Windows

   # Apply each migration in order
   for file in supabase/migrations/*.sql; do
     echo "Applying ${file}"
     docker exec -i supabase-db psql -U postgres -d postgres < "$file"
   done
   ```

3. **Verify trigger exists:**
   ```bash
   docker exec supabase-db psql -U postgres -d postgres -c "
   SELECT tgname FROM pg_trigger t 
   JOIN pg_class c ON t.tgrelid = c.oid 
   WHERE c.relname = 'users' AND tgname = 'on_auth_user_created';
   "
   ```
   
   Must return `on_auth_user_created`. Without this trigger, user signups fail.

4. **Run verification:**
   ```bash
   ./scripts/verify-database.sh  # RHEL
   .\scripts\verify-database.ps1  # Windows
   ```
   
   All checks must pass (0 failures).

5. **Retry login** after schema is confirmed complete.

### Migration Logs

If migrations fail during deployment, logs are saved to:
- **Windows:** `C:\dell-supabase\logs\supabase-start-output.txt`
- **RHEL:** Check console output during deployment

Common migration errors:
- **"relation already exists"** - Safe to ignore, migrations are idempotent
- **"type already exists"** - Safe to ignore, migrations use `CREATE TYPE IF NOT EXISTS`
- **"permission denied for schema auth"** - Indicates trigger creation on `auth.users` failed; requires manual fix

## Health Checks and Monitoring

After deployment, you can validate your installation and monitor ongoing health using the provided health check scripts.

### Running Health Checks

**Windows:**
```powershell
# Basic health check
.\scripts\health-check.ps1

# Detailed output
.\scripts\health-check.ps1 -Detailed

# Export results to JSON
.\scripts\health-check.ps1 -ExportJson health-report.json

# Quiet mode (exit codes only, for automation)
.\scripts\health-check.ps1 -Quiet
```

**RHEL/CentOS/Rocky Linux:**
```bash
# Basic health check
sudo ./scripts/health-check.sh

# Detailed output
sudo ./scripts/health-check.sh --detailed

# Export results to JSON
sudo ./scripts/health-check.sh --json health-report.json

# Quiet mode (for automation)
sudo ./scripts/health-check.sh --quiet
```

### What Gets Checked

The health check script validates:

1. **Configuration**
   - ✅ Deployment mode detection (Local/Cloud)
   - ✅ .env file exists and contains required variables
   - ✅ Supabase URL, API keys, and project ID are set

2. **Services**
   - ✅ Application service is running (DellServerManager/dell-server-manager)
   - ✅ Application is listening on port 3000
   - ✅ **Local mode only:** Docker is running
   - ✅ **Local mode only:** Supabase containers are healthy

3. **Network Connectivity**
   - ✅ Application responds to HTTP requests
   - ✅ Backend REST API is accessible
   - ✅ Authentication API is accessible
   - ✅ Response time measurements

4. **Database (Local mode only)**
   - ✅ PostgreSQL container is running
   - ✅ Database connection is working
   - ✅ Required tables exist (profiles, user_roles, servers, jobs, job_tasks)
   - ✅ Row-Level Security policies are enabled

### Understanding Health Check Output

**Success Example:**
```
🏥 Dell Server Manager - Health Check
=====================================

[CONFIG] Deployment Mode: Local/Air-gapped
✅ [CONFIG] Configuration File: Found
✅ [SERVICE] DellServerManager: Running
✅ [SERVICE] Application Port 3000: Listening
✅ [NETWORK] Application (port 3000): Responding (45ms)
✅ [DATABASE] PostgreSQL Container: Running

Overall Health: ✅ HEALTHY (100%)
Checks: 15/15 passed
```

**Failure Example with Remediation:**
```
❌ [SERVICE] DellServerManager: Not running (Status: stopped)
    💡 Fix: Start service: Start-Service DellServerManager

❌ [DATABASE] PostgreSQL Container: Not running
    💡 Fix: Start Supabase: cd C:\dell-supabase; supabase start

Overall Health: ❌ UNHEALTHY (60%)
```

### Automated Monitoring

You can schedule health checks to run automatically:

**Windows (Task Scheduler):**
```powershell
# Create scheduled task to run every hour
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-File C:\dell-server-manager\scripts\health-check.ps1 -Quiet -ExportJson C:\logs\health-check.json"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "DellServerManagerHealthCheck" -Action $action -Trigger $trigger -RunLevel Highest
```

**RHEL (Cron):**
```bash
# Add to crontab - run every hour
sudo crontab -e

# Add this line:
0 * * * * /opt/dell-server-manager/scripts/health-check.sh --quiet --json /var/log/dell-health-check.json
```

### Troubleshooting with Health Checks

The health check script provides specific remediation steps for common issues:

| Issue | Remediation |
|-------|-------------|
| Service not running | Start service: `Start-Service DellServerManager` (Windows) or `sudo systemctl start dell-server-manager` (RHEL) |
| Docker not running | Start Docker Desktop (Windows) or `sudo systemctl start docker` (RHEL) |
| Supabase containers down | `cd C:\dell-supabase && supabase start` (Windows) or `cd /opt/dell-supabase && supabase start` (RHEL) |
| Configuration missing | Re-run deployment script to regenerate .env |
| Database connection failed | Check PostgreSQL logs: `docker logs supabase-db` |
| Port 3000 not listening | Check application logs and verify service is running |

### Health Check Exit Codes

The scripts return exit codes suitable for automation:
- `0` - Healthy (≥70% checks passed)
- `1` - Unhealthy (<70% checks passed)

Use in monitoring tools:
```bash
# Example monitoring script
if ! ./scripts/health-check.sh --quiet; then
    echo "Health check failed!" | mail -s "Dell Server Manager Alert" admin@company.com
fi
```

### Performance Monitoring

Health checks measure response times for:
- Application response time (port 3000)
- Backend API response time
- Database query execution time (local mode)

Track these metrics over time to identify performance degradation trends.

## What You Get

Both deployment scripts provide a complete, production-ready setup:

| Component | Description | Port (RHEL) | Port (Windows CLI) |
|-----------|-------------|-------------|---------------------|
| **Dell Server Manager** | Main application (frontend) | 3000 | 3000 |
| **Job Executor** | Background job processor (iDRAC/vCenter) | - | - |
| **Supabase Studio** | Database admin UI | 8000 | 54323 |
| **PostgreSQL** | Database server | 5432 | 54322 |
| **PostgREST API** | RESTful API | 3000* | 54321* |
| **GoTrue Auth** | Authentication | 9999* | 54324* |
| **Realtime** | WebSocket server | 4000* | 54325* |
| **Storage API** | File storage | 5000* | 54326* |

*Internal services (accessed via Kong gateway)

**Note:** Windows deployments using Supabase CLI use different default ports to avoid conflicts. All services are managed through the `supabase` CLI command.

## After Deployment

### 1. Access Your Services

**RHEL Deployment:**
```
📊 Supabase Studio: http://192.168.1.100:8000
   Username: supabase
   Password: [generated-password]

🌐 Dell Server Manager: http://192.168.1.100:3000
```

**Windows Deployment (Supabase CLI):**
```
📊 Supabase Studio: http://localhost:54323
   (Managed via Supabase CLI)

🌐 Dell Server Manager: http://192.168.1.100:3000

💡 Tip: Run 'supabase status' to view all service URLs and credentials
💡 Tip: Run 'supabase db studio' to open Studio in your browser
```

### 2. Import Your Data (Optional)

If you have an existing deployment, you can restore your backup:

```bash
# Run backup on old system (Lovable Cloud)
npm run backup

# Copy the backup directory to new server
scp -r backups/backup-2025-01-05T12-30-00 user@new-server:~/dell-server-manager/backups/

# Restore on new server
cd ~/dell-server-manager
npm run restore -- --backup-dir=./backups/backup-2025-01-05T12-30-00
```

**Note:** An admin user is created automatically during deployment, so you can skip the "Create First User" and "Grant Admin Access" sections below unless you need additional users.

### 3. Create Additional Users (Optional)

If you need to create additional users:

**Option A: Via Supabase Studio**
```bash
# RHEL: Open http://your-server:8000
# Windows: Run 'supabase db studio' to open in browser
# Then: Go to Authentication → Users → Click "Add User"
```

**Option B: Via SQL (RHEL)**
```bash
docker exec -i supabase-db psql -U postgres -d postgres <<EOF
INSERT INTO auth.users (
  instance_id, id, aud, role, email, 
  encrypted_password, email_confirmed_at, 
  created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'admin@example.com',
  crypt('your-password', gen_salt('bf')),
  now(),
  now(),
  now()
);
EOF
```

**Option B: Via SQL (Windows with Supabase CLI)**
```powershell
supabase db execute --sql "INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'admin@example.com', crypt('your-password', gen_salt('bf')), now(), now(), now());"
```

### 4. Grant Additional Admin Access (Optional)

To grant admin access to additional users:

**RHEL:**
```bash
docker exec -i supabase-db psql -U postgres -d postgres <<EOF
-- Find your user ID
SELECT id, email FROM auth.users;

-- Grant admin role
INSERT INTO user_roles (user_id, role) 
VALUES ('<your-user-id>', 'admin');
EOF
```

**Windows (Supabase CLI):**
```powershell
supabase db execute --sql "SELECT id, email FROM auth.users;"
supabase db execute --sql "INSERT INTO user_roles (user_id, role) VALUES ('<your-user-id>', 'admin');"
```

## Production Hardening

### SSL/TLS with Let's Encrypt

**SSL/TLS is automatically configured during deployment** if you provide a domain name when prompted. The deployment scripts will:
- Install and configure reverse proxy (nginx for RHEL, IIS for Windows)
- Obtain SSL certificates from Let's Encrypt automatically
- Setup automatic certificate renewal
- Configure HTTPS redirects

#### Manual Setup (if skipped during deployment)

**RHEL 9:**

```bash
# Install Nginx and Certbot
sudo dnf install -y nginx certbot python3-certbot-nginx

# Configure Nginx reverse proxy
sudo tee /etc/nginx/conf.d/dell-server-manager.conf > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /supabase/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Start Nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com --email your-email@example.com --agree-tos --redirect

# Auto-renewal is configured automatically by certbot
sudo systemctl enable certbot-renew.timer
```

**Windows Server 2022:**

```powershell
# Install IIS and URL Rewrite
Install-WindowsFeature -name Web-Server -IncludeManagementTools
choco install urlrewrite -y

# Install Win-ACME for Let's Encrypt
choco install win-acme -y

# Run Win-ACME to obtain certificate
wacs.exe --target manual --host your-domain.com --emailaddress your-email@example.com --accepttos --installation iis
```

Win-ACME will:
- Automatically configure IIS bindings
- Obtain SSL certificate from Let's Encrypt
- Setup automatic renewal task

### Database Backups

#### Automated Daily Backups (RHEL)

```bash
# Create backup script
sudo tee /usr/local/bin/backup-dell-db.sh > /dev/null <<'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/dell-server-manager"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

docker exec supabase-db pg_dump -U postgres postgres | \
  gzip > $BACKUP_DIR/backup_$TIMESTAMP.sql.gz

# Keep only last 30 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete
EOF

sudo chmod +x /usr/local/bin/backup-dell-db.sh

# Add to crontab (runs daily at 2 AM)
sudo crontab -l | { cat; echo "0 2 * * * /usr/local/bin/backup-dell-db.sh"; } | sudo crontab -
```

#### Automated Daily Backups (Windows)

```powershell
# Create backup script
$ScriptPath = "C:\Scripts\backup-dell-db.ps1"
New-Item -ItemType Directory -Force -Path "C:\Scripts"
New-Item -ItemType Directory -Force -Path "C:\Backups\dell-server-manager"

@'
Set-Location "C:\dell-supabase"
$BackupDir = "C:\Backups\dell-server-manager"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = "$BackupDir\backup_$Timestamp.sql"

# Use Supabase CLI to dump database
supabase db dump -f $BackupFile

# Compress
Compress-Archive -Path $BackupFile -DestinationPath "$BackupFile.zip"
Remove-Item $BackupFile

# Keep only last 30 days
Get-ChildItem $BackupDir -Filter "backup_*.zip" | 
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | 
  Remove-Item
'@ | Out-File -FilePath $ScriptPath

# Create scheduled task (runs daily at 2 AM)
$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-File $ScriptPath"
$Trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "Dell Server Manager Backup" -Action $Action -Trigger $Trigger -RunLevel Highest
```

### Monitoring

#### System Health Monitoring (RHEL)

```bash
# Install Prometheus and Grafana
docker run -d --name prometheus \
  -p 9090:9090 \
  -v /opt/prometheus:/etc/prometheus \
  prom/prometheus

docker run -d --name grafana \
  -p 3001:3000 \
  grafana/grafana

# Access Grafana at http://your-server:3001
# Default credentials: admin/admin
```

#### Windows Server Monitoring

Use built-in Performance Monitor or install:
- [Prometheus Windows Exporter](https://github.com/prometheus-community/windows_exporter)
- [Grafana](https://grafana.com/grafana/download?platform=windows)

### Resource Limits

#### RHEL 9

Edit `/opt/supabase/docker/docker-compose.yml`:

```yaml
services:
  db:
    # ... keep existing code
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
```

#### Windows Server 2022

The Supabase CLI manages Docker configuration automatically. To customize resource limits:

1. **Docker Desktop Settings:**
   - Settings → Resources
   - Set CPU limit: 4 cores
   - Set Memory limit: 8 GB

2. **Advanced Configuration (Optional):**
   ```powershell
   # Edit the generated docker-compose.yml
   cd C:\dell-supabase\supabase\docker
   # Modify resource limits in docker-compose.yml as needed
   supabase stop
   supabase start
   ```

## Service Management

### RHEL 9

```bash
# Application service (frontend)
sudo systemctl status dell-server-manager
sudo systemctl restart dell-server-manager
sudo systemctl stop dell-server-manager
sudo journalctl -u dell-server-manager -f

# Job Executor service (background jobs)
sudo systemctl status dell-job-executor
sudo systemctl restart dell-job-executor
sudo systemctl stop dell-job-executor
sudo journalctl -u dell-job-executor -f

# Supabase services
cd /opt/supabase/docker
docker compose ps
docker compose logs -f
docker compose restart
docker compose stop
```

### Windows Server 2022

```powershell
# Application service (frontend)
nssm status DellServerManager
nssm restart DellServerManager
nssm stop DellServerManager

# Job Executor service (background jobs)
nssm status DellServerManagerJobExecutor
nssm restart DellServerManagerJobExecutor
nssm stop DellServerManagerJobExecutor

# View service logs
Get-Content C:\dell-server-manager\service-output.log -Tail 50
Get-Content C:\dell-server-manager\job-executor-output.log -Tail 50

# Supabase services (via CLI)
cd C:\dell-supabase
supabase status                    # Check all services
supabase stop                      # Stop all services
supabase start                     # Start all services
supabase db studio                 # Open Studio in browser
supabase db execute --sql "..."   # Execute SQL query

# View logs
docker compose logs -f             # All service logs
docker logs supabase-db -f         # Database logs only
```

## Troubleshooting

### Check if services are running

```bash
# RHEL
sudo systemctl status dell-server-manager
sudo systemctl status dell-job-executor
docker ps

# Windows
nssm status DellServerManager
nssm status DellServerManagerJobExecutor
docker ps
```

### Check application logs

```bash
# RHEL - Frontend logs
sudo journalctl -u dell-server-manager -n 100

# RHEL - Job Executor logs
sudo journalctl -u dell-job-executor -n 100

# Windows - Frontend logs
Get-Content C:\dell-server-manager\service-output.log -Tail 100

# Windows - Job Executor logs
Get-Content C:\dell-server-manager\job-executor-output.log -Tail 100
```

### Database connection issues

**RHEL:**
```bash
# Test database connection
docker exec -it supabase-db psql -U postgres -d postgres

# If can't connect, restart Supabase
cd /opt/supabase/docker
docker compose restart
```

**Windows (Supabase CLI):**
```powershell
# Check Supabase status
cd C:\dell-supabase
supabase status

# Test database connection
supabase db execute --sql "SELECT version();"

# If can't connect, restart Supabase
supabase stop
supabase start
```

### Port already in use

**RHEL:**
```bash
# Find what's using the port
sudo lsof -i :3000
sudo lsof -i :8000

# Kill the process or change ports in docker-compose.yml
```

**Windows:**
```powershell
# Find what's using the port
netstat -ano | findstr :3000
netstat -ano | findstr :54323  # Supabase Studio (CLI default)

# Kill the process if needed
# taskkill /PID <process-id> /F

# Or change Supabase CLI ports in config
cd C:\dell-supabase
# Edit supabase/config.toml to change ports
supabase stop
supabase start
```

### Job Executor not processing jobs

If iDRAC operations (discovery, firmware updates, credential tests) are not working:

**Check Job Executor status:**

```bash
# RHEL
sudo systemctl status dell-job-executor
sudo journalctl -u dell-job-executor -n 100

# Windows
nssm status DellServerManagerJobExecutor
Get-Content C:\dell-server-manager\job-executor-output.log -Tail 100
```

**Common issues:**

1. **Service not running:**
   ```bash
   # RHEL
   sudo systemctl start dell-job-executor
   
   # Windows
   nssm start DellServerManagerJobExecutor
   ```

2. **Python dependencies missing:**
   ```bash
   # RHEL
   cd /opt/dell-server-manager
   pip3 install -r requirements.txt
   
   # Windows
   cd C:\dell-server-manager
   pip install -r requirements.txt
   ```

3. **Environment variables not set:**
   ```bash
   # RHEL - check service file
   sudo cat /etc/systemd/system/dell-job-executor.service
   # Should have SERVICE_ROLE_KEY and DSM_URL
   
   # Windows - check NSSM config
   nssm get DellServerManagerJobExecutor AppEnvironmentExtra
   ```

4. **Network connectivity issues:**
   - Job Executor must be able to reach iDRAC IPs
   - Test connectivity: `ping <idrac-ip>` or `curl -k https://<idrac-ip>`
   - Check firewall rules on the host running Job Executor

**Test Job Executor:**

Use the diagnostics tool in Settings → Network Connectivity → Job Executor Diagnostics to verify:
- Job Executor is online and processing jobs
- Credentials are accessible
- iDRAC devices are reachable

### Reset everything and start fresh

**RHEL:**
```bash
sudo systemctl stop dell-server-manager
sudo systemctl stop dell-job-executor
cd /opt/supabase/docker
docker compose down -v
sudo rm -rf /opt/supabase
sudo rm -rf /opt/dell-server-manager
# Run deploy script again
cd ~/dell-server-manager
sudo bash scripts/deploy-rhel9.sh
```

**Windows (Supabase CLI):**
```powershell
# Use the automated cleanup script
cd C:\dell-server-manager
.\scripts\cleanup-windows.ps1

# Then run deployment script
.\scripts\deploy-windows.ps1
```

## Recovery & Reset

### Windows - Complete Cleanup and Redeploy

If you encounter issues with your Windows deployment (locked files, docker errors, incomplete installation), follow these steps for a clean recovery:

#### Quick Recovery (Automated)

```powershell
# Run as Administrator in PowerShell
cd C:\dell-server-manager
.\scripts\cleanup-windows.ps1
```

The cleanup script will:
- ✅ Stop and remove the Dell Server Manager Windows service
- ✅ Stop and remove the Job Executor Windows service
- ✅ Stop and remove all Docker containers and volumes
- ✅ Prune Docker images
- ✅ Remove all installation directories (C:\supabase, C:\dell-supabase, C:\dell-server-manager)
- ✅ Remove firewall rules
- ✅ Handle locked files gracefully

After cleanup completes, run the deployment script:

```powershell
# Clone repository (if removed by cleanup)
git clone https://github.com/i0mja/dell-infra-sync C:\dell-server-manager
cd C:\dell-server-manager

# Run deployment
.\scripts\deploy-windows.ps1
```

#### Manual Recovery (If Cleanup Script Fails)

If the automated script fails, use these manual steps:

**1. Leave target directories and ensure Docker is ready:**
```powershell
# Navigate away from any Supabase/app folders
Set-Location $env:TEMP

# Start Docker Desktop and wait for it to be ready
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
& "C:\Program Files\Docker\Docker\DockerCli.exe" -SwitchLinuxEngine

# Wait for Docker engine (max 3 minutes)
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  if ((Get-Date) -gt $deadline) { 
    Write-Host "Docker not ready. Please start Docker Desktop manually."
    break
  }
  Start-Sleep 3
}
```

**2. Clean up Docker containers and volumes:**
```powershell
# Stop/remove all containers
$ids = docker ps -aq
if ($ids) { docker stop $ids; docker rm -f $ids }

# Remove all volumes
$vols = docker volume ls -q
if ($vols) { docker volume rm -f $vols }

# Prune images
docker image prune -a -f
```

**3. Remove directories:**
```powershell
# Stop Docker processes if folders are locked
Stop-Process -Name "com.docker.backend","Docker Desktop" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

# Remove directories
Remove-Item -Recurse -Force C:\supabase -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force C:\dell-supabase -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force C:\dell-server-manager -ErrorAction SilentlyContinue
```

**4. Fresh deployment:**
```powershell
# Re-clone the application
git clone https://github.com/i0mja/dell-infra-sync C:\dell-server-manager
Set-Location C:\dell-server-manager

# Run deployment script
.\scripts\deploy-windows.ps1
```

### Common Recovery Scenarios

#### Scenario 1: "Cannot find file specified" Docker errors

**Cause:** Docker Desktop is not running or not in Linux containers mode.

**Solution:**
```powershell
# The deploy script now includes automatic Docker preflight checks
# It will start Docker Desktop and switch to Linux containers automatically
.\scripts\deploy-windows.ps1
```

#### Scenario 2: "Cannot remove the item at 'C:\supabase' because it is in use"

**Cause:** PowerShell terminal is inside the directory being deleted, or Docker has file locks.

**Solution:**
```powershell
# Use the cleanup script (it handles this automatically)
cd C:\dell-server-manager
.\scripts\cleanup-windows.ps1
```

#### Scenario 3: Empty Supabase credentials after deployment

**Cause:** Supabase services failed to start, usually due to Docker not being ready.

**Solution:**
```powershell
# The deploy script now validates credentials and provides clear error messages
# If this occurs, ensure Docker Desktop is running and retry:
cd C:\dell-supabase
supabase stop
supabase start
supabase status  # Should show all services running
```

### RHEL - Recovery

For RHEL systems, recovery is simpler:
```

**Windows:**
```powershell
# Stop services
nssm stop DellServerManager
cd C:\dell-supabase
supabase stop

# Clean up
docker system prune -a -f --volumes
Remove-Item -Recurse -Force C:\dell-supabase

# Run deploy script again
cd C:\dell-server-manager
.\scripts\deploy-windows.ps1
```

## Updating the Application

### RHEL 9

```bash
cd ~/dell-server-manager
git pull
npm install
npm run build
sudo systemctl restart dell-server-manager
```

### Windows Server 2022

```powershell
# Update application code
cd C:\dell-server-manager
git pull
npm install
npm run build
nssm restart DellServerManager

# Update Supabase (if needed)
cd C:\dell-supabase
supabase stop
supabase start
# Run any database migrations if needed
supabase db push
```

## Uninstall

### RHEL 9

```bash
# Stop services
sudo systemctl stop dell-server-manager
sudo systemctl disable dell-server-manager

# Remove Supabase
cd /opt/supabase/docker
docker compose down -v
sudo rm -rf /opt/supabase

# Remove application
sudo rm /etc/systemd/system/dell-server-manager.service
sudo systemctl daemon-reload
rm -rf ~/dell-server-manager

# Remove firewall rules
sudo firewall-cmd --permanent --remove-port=3000/tcp
sudo firewall-cmd --permanent --remove-port=8000/tcp
sudo firewall-cmd --reload
```

### Windows Server 2022

```powershell
# Stop and remove service
nssm stop DellServerManager
nssm remove DellServerManager confirm

# Stop and remove Supabase (CLI)
cd C:\dell-supabase
supabase stop
docker system prune -a -f --volumes

# Remove Supabase project directory
Remove-Item -Recurse -Force C:\dell-supabase

# Remove application
Remove-Item -Recurse -Force C:\dell-server-manager

# Remove firewall rules
Remove-NetFirewallRule -DisplayName "Dell Server Manager"
Remove-NetFirewallRule -DisplayName "Supabase API" -ErrorAction SilentlyContinue

# Uninstall Supabase CLI (optional)
npm uninstall -g supabase
```

## Architecture Diagram

```
                                 Internet
                                    │
                                    ▼
                             ┌─────────────┐
                             │   Firewall  │
                             └──────┬──────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
              ┌─────────┐    ┌─────────┐    ┌─────────┐
              │  :3000  │    │  :8000  │    │  :5432  │
              │  React  │    │ Supabase│    │Postgres │
              │   App   │    │   API   │    │   DB    │
              └────┬────┘    └────┬────┘    └────┬────┘
                   │              │              │
                   └──────────────┴──────────────┘
                            Same Server
```

## Support

- **Documentation**: See `/docs` directory
- **Issues**: Check application logs and Supabase logs
- **Backup Guide**: [docs/BACKUP_GUIDE.md](BACKUP_GUIDE.md)
- **Supabase Docs**: https://supabase.com/docs/guides/self-hosting

---

**Deployment Time Comparison:**

| Platform | Manual Setup | Automated Script |
|----------|--------------|------------------|
| RHEL 9 | 2-3 hours | **5 minutes** |
| Windows Server 2022 | 2-3 hours | **10 minutes** |

**Ready to deploy? Just run one command and you're live! 🚀**
