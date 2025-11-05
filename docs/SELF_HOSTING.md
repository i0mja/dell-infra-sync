# Self-Hosting Guide

Complete guide for deploying Dell Server Manager on your own infrastructure.

## Quick Start

### RHEL 9 / CentOS 9 / Rocky Linux 9

```bash
# 1. Clone repository
git clone <your-repo-url> ~/dell-server-manager
cd ~/dell-server-manager

# 2. Run deployment script
sudo bash scripts/deploy-rhel9.sh
```

**That's it!** The script will:
- ✅ Install Docker and Node.js
- ✅ Setup and configure Supabase
- ✅ Build and deploy the application
- ✅ Create systemd service
- ✅ Configure firewall

**Total time: ~5 minutes**

### Windows Server 2022

```powershell
# 1. Clone repository (run as Administrator)
git clone <your-repo-url> C:\dell-server-manager
cd C:\dell-server-manager

# 2. Run deployment script
.\scripts\deploy-windows.ps1
```

**That's it!** The script will:
- ✅ Install Docker Desktop, Node.js, and dependencies
- ✅ Setup and configure Supabase
- ✅ Build and deploy the application
- ✅ Create Windows service
- ✅ Configure firewall

**Total time: ~10 minutes** (includes Docker Desktop installation)

## What You Get

Both deployment scripts provide a complete, production-ready setup:

| Component | Description | Port |
|-----------|-------------|------|
| **Dell Server Manager** | Main application | 3000 |
| **Supabase Studio** | Database admin UI | 8000 |
| **PostgreSQL** | Database server | 5432 |
| **PostgREST API** | RESTful API | 3000* |
| **GoTrue Auth** | Authentication | 9999* |
| **Realtime** | WebSocket server | 4000* |
| **Storage API** | File storage | 5000* |

*Internal services (accessed via Kong gateway on port 8000)

## After Deployment

### 1. Access Your Services

The deployment script will display:
```
📊 Supabase Studio: http://192.168.1.100:8000
   Username: supabase
   Password: [generated-password]

🌐 Dell Server Manager: http://192.168.1.100:3000
```

### 2. Import Your Data

If you have an existing deployment, restore your backup:

```bash
# Run backup on old system (Lovable Cloud)
npm run backup

# Copy the backup directory to new server
scp -r backups/backup-2025-01-05T12-30-00 user@new-server:~/dell-server-manager/backups/

# Restore on new server
cd ~/dell-server-manager
npm run restore -- --backup-dir=./backups/backup-2025-01-05T12-30-00
```

### 3. Create First User

```bash
# Option A: Via Supabase Studio
# 1. Open http://your-server:8000
# 2. Go to Authentication → Users
# 3. Click "Add User"

# Option B: Via SQL
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

### 4. Grant Admin Access

```sql
-- Find your user ID
SELECT id, email FROM auth.users;

-- Grant admin role
INSERT INTO user_roles (user_id, role) 
VALUES ('<your-user-id>', 'admin');
```

## Production Hardening

### SSL/TLS with Let's Encrypt

#### RHEL 9

```bash
# Install Nginx and Certbot
sudo dnf install -y nginx certbot python3-certbot-nginx

# Configure Nginx reverse proxy
sudo tee /etc/nginx/conf.d/dell-server-manager.conf > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location /api/ {
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
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically by certbot
```

#### Windows Server 2022

Use IIS with SSL:

1. Install IIS with URL Rewrite and ARR
```powershell
Install-WindowsFeature -name Web-Server -IncludeManagementTools
Install-WindowsFeature -name Web-App-Dev
```

2. Install [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
3. Install [Application Request Routing](https://www.iis.net/downloads/microsoft/application-request-routing)
4. Configure reverse proxy in IIS Manager
5. Add SSL certificate via IIS Manager → Server Certificates

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
$BackupDir = "C:\Backups\dell-server-manager"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = "$BackupDir\backup_$Timestamp.sql"

docker exec supabase-db pg_dump -U postgres postgres | Out-File -FilePath $BackupFile

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

Configure resource limits in Docker Desktop:
1. Settings → Resources
2. Set CPU limit: 4 cores
3. Set Memory limit: 8 GB

## Service Management

### RHEL 9

```bash
# Application service
sudo systemctl status dell-server-manager
sudo systemctl restart dell-server-manager
sudo systemctl stop dell-server-manager
sudo journalctl -u dell-server-manager -f

# Supabase services
cd /opt/supabase/docker
docker compose ps
docker compose logs -f
docker compose restart
docker compose stop
```

### Windows Server 2022

```powershell
# Application service
nssm status DellServerManager
nssm restart DellServerManager
nssm stop DellServerManager

# Supabase services
cd C:\supabase\docker
docker compose ps
docker compose logs -f
docker compose restart
docker compose stop
```

## Troubleshooting

### Check if services are running

```bash
# RHEL
sudo systemctl status dell-server-manager
docker ps

# Windows
nssm status DellServerManager
docker ps
```

### Check application logs

```bash
# RHEL
sudo journalctl -u dell-server-manager -n 100

# Windows
# Logs are in Windows Event Viewer → Application
```

### Database connection issues

```bash
# Test database connection
docker exec -it supabase-db psql -U postgres -d postgres

# If can't connect, restart Supabase
cd /opt/supabase/docker  # or C:\supabase\docker on Windows
docker compose restart
```

### Port already in use

```bash
# RHEL - Find what's using the port
sudo lsof -i :3000
sudo lsof -i :8000

# Windows - Find what's using the port
netstat -ano | findstr :3000
netstat -ano | findstr :8000

# Kill the process or change ports in docker-compose.yml
```

### Reset everything and start fresh

```bash
# RHEL
sudo systemctl stop dell-server-manager
cd /opt/supabase/docker
docker compose down -v
sudo rm -rf /opt/supabase
# Run deploy script again

# Windows
nssm stop DellServerManager
cd C:\supabase\docker
docker compose down -v
Remove-Item -Recurse -Force C:\supabase
# Run deploy script again
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
cd C:\dell-server-manager
git pull
npm install
npm run build
nssm restart DellServerManager
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

# Remove Supabase
cd C:\supabase\docker
docker compose down -v
Remove-Item -Recurse -Force C:\supabase

# Remove application
Remove-Item -Recurse -Force C:\dell-server-manager

# Remove firewall rules
Remove-NetFirewallRule -DisplayName "Dell Server Manager"
Remove-NetFirewallRule -DisplayName "Supabase API"
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
