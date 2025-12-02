# Dell Server Manager - Offline/Air-Gapped Installation Guide

This guide covers deploying Dell Server Manager in completely air-gapped environments with no internet connectivity.

## Overview

Dell Server Manager can run fully offline using a self-hosted Supabase instance. The offline package bundles:
- All Docker images for Supabase services
- Node.js dependencies
- Python packages for the job executor
- Complete application source code
- Installation scripts

## System Requirements

### Minimum Requirements
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB | 100 GB |
| OS | RHEL 9 | RHEL 9 / Rocky 9 |

### Software Prerequisites
- Docker CE or Podman with docker compatibility
- Docker Compose plugin
- Python 3.9+
- Node.js 18+ (can be installed from package)

## Creating the Offline Package

On an **internet-connected** machine:

```bash
# Clone the repository
git clone <repository-url>
cd dell-server-manager

# Create the offline package
chmod +x scripts/create-offline-package.sh
./scripts/create-offline-package.sh
```

This creates `offline-package/dell-server-manager-offline-YYYYMMDD_HHMMSS.tar.gz` (~4-5GB).

### What's Included

```
dell-server-manager-offline-*/
├── app/                      # Application source code
│   ├── src/                  # React frontend
│   ├── supabase/             # Edge functions & migrations
│   │   ├── docker/           # Docker Compose config
│   │   ├── functions/        # Edge functions
│   │   └── migrations/       # Database migrations
│   ├── job-executor.py       # Python job executor
│   └── ...
├── docker-images/
│   └── docker-images.tar.gz  # All Supabase Docker images
├── npm-packages/
│   └── node_modules.tar.gz   # Pre-built node_modules
├── python-packages/          # Python wheel files
├── docs/                     # Documentation
├── install-offline-rhel9.sh  # Installation script
├── MANIFEST.txt              # Package contents
└── README-OFFLINE.txt        # Quick start guide
```

## Installation on Air-Gapped System

### Step 1: Transfer the Package

Transfer the `.tar.gz` file to your air-gapped system using:
- USB drive
- Secure file transfer
- Network share (if available internally)

### Step 2: Pre-Install Docker

Docker must be installed before running the installer. In an air-gapped environment:

**Option A: Using RHEL Media**
```bash
# Mount RHEL 9 ISO
mount /dev/cdrom /mnt

# Configure local repo
cat > /etc/yum.repos.d/local.repo << EOF
[local]
name=Local Repository
baseurl=file:///mnt
enabled=1
gpgcheck=0
EOF

# Install Podman with Docker compatibility
dnf install -y podman-docker docker-compose
```

**Option B: Pre-download Docker RPMs**
On an internet-connected RHEL 9 system:
```bash
# Download Docker RPMs
dnf download --resolve docker-ce docker-ce-cli containerd.io docker-compose-plugin
```
Transfer RPMs to air-gapped system and install:
```bash
dnf install -y *.rpm
```

### Step 3: Run Installation

```bash
# Extract package
tar -xzf dell-server-manager-offline-*.tar.gz
cd dell-server-manager-offline-*/

# Make script executable
chmod +x install-offline-rhel9.sh

# Run installer as root
sudo ./install-offline-rhel9.sh
```

The installer will:
1. Verify package structure
2. Check Docker availability
3. Load all Docker images (~10-15 minutes)
4. Start Supabase services
5. Apply database migrations
6. Prompt for admin user creation
7. Build the application
8. Create systemd services
9. Configure firewall

### Step 4: Verify Installation

```bash
# Check application service
systemctl status dell-server-manager

# Check job executor
systemctl status dell-job-executor

# Check Supabase services
cd /opt/supabase && docker compose ps
```

## Post-Installation

### Access URLs

| Service | URL | Description |
|---------|-----|-------------|
| Application | http://SERVER_IP:3000 | Main web interface |
| Supabase Studio | http://SERVER_IP:3100 | Database admin |
| Supabase API | http://SERVER_IP:8000 | REST/Auth API |

### Credentials

Credentials are saved to `/opt/dell-server-manager/deployment-credentials.txt` (readable only by root).

### Service Management

```bash
# Application
systemctl start|stop|restart dell-server-manager
journalctl -u dell-server-manager -f

# Job Executor
systemctl start|stop|restart dell-job-executor
journalctl -u dell-job-executor -f

# Supabase
cd /opt/supabase
docker compose up -d      # Start
docker compose down       # Stop
docker compose logs -f    # View logs
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RHEL 9 Server                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Dell Server     │  │ Job Executor    │                  │
│  │ Manager (React) │  │ (Python)        │                  │
│  │ Port 3000       │  │ Background Jobs │                  │
│  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                            │
│           └────────┬───────────┘                            │
│                    │                                        │
│           ┌────────▼────────┐                              │
│           │   Kong Gateway  │                              │
│           │   Port 8000     │                              │
│           └────────┬────────┘                              │
│                    │                                        │
│  ┌─────────────────┼─────────────────────────────────────┐ │
│  │                 │    Docker Network                    │ │
│  │  ┌──────────────▼──────────────┐                      │ │
│  │  │      Supabase Services       │                      │ │
│  │  ├──────────────────────────────┤                      │ │
│  │  │ • PostgreSQL (db)            │                      │ │
│  │  │ • GoTrue (auth)              │                      │ │
│  │  │ • PostgREST (rest)           │                      │ │
│  │  │ • Realtime (realtime)        │                      │ │
│  │  │ • Storage (storage)          │                      │ │
│  │  │ • Edge Runtime (functions)   │                      │ │
│  │  │ • Studio (studio) - 3100     │                      │ │
│  │  └──────────────────────────────┘                      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Internal Network Only
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Dell Servers (iDRAC)  │  vCenter  │  ESXi Hosts           │
│  Port 443              │  Port 443 │  Port 443             │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Docker Images Won't Load

```bash
# Check disk space
df -h

# Check Docker status
systemctl status docker

# Manual load
cd /path/to/docker-images
tar -xzf docker-images.tar.gz
docker load -i supabase-postgres.tar
```

### Database Won't Start

```bash
# Check logs
docker logs supabase-db

# Check port availability
ss -tlnp | grep 5432

# Check disk space for volumes
docker system df
```

### Application Build Fails

```bash
# Check Node.js version
node --version  # Should be 18+

# Clear npm cache
cd /opt/dell-server-manager
rm -rf node_modules
tar -xzf /path/to/npm-packages/node_modules.tar.gz

# Rebuild
npm run build
```

### Can't Connect to iDRAC/vCenter

The job executor handles all iDRAC/vCenter connections. Verify:
```bash
# Check job executor is running
systemctl status dell-job-executor

# Check logs for connection errors
journalctl -u dell-job-executor | grep -i error

# Test network connectivity
curl -k https://IDRAC_IP/redfish/v1/
```

## Security Considerations

### Default Tokens

The installation uses demo JWT tokens that are:
- Safe for air-gapped/local use
- Pre-generated with long expiry (2033)
- Should be regenerated for production with external access

### Generating Production Keys

To generate your own JWT tokens:

```bash
# Generate new JWT secret
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

# Use jwt.io or a tool to generate tokens with:
# - Header: {"alg": "HS256", "typ": "JWT"}
# - Payload for anon: {"iss": "supabase", "role": "anon", "exp": <timestamp>}
# - Payload for service_role: {"iss": "supabase", "role": "service_role", "exp": <timestamp>}

# Update /opt/supabase/.env with new values
# Restart Supabase: cd /opt/supabase && docker compose restart
```

### File Permissions

```bash
# Secure credentials file
chmod 600 /opt/dell-server-manager/deployment-credentials.txt
chmod 600 /opt/supabase/.env
chmod 600 /opt/supabase/credentials.txt
```

### HTTPS/TLS

For production, configure a reverse proxy with TLS:

```bash
# Install nginx
dnf install nginx

# Configure SSL termination
# See docs/SELF_HOSTING.md for nginx configuration examples
```

## Updating

To update an air-gapped installation:

1. Create a new offline package on internet-connected machine
2. Transfer to air-gapped system
3. Stop services:
   ```bash
   systemctl stop dell-server-manager dell-job-executor
   ```
4. Backup database:
   ```bash
   docker exec supabase-db pg_dump -U postgres postgres > backup.sql
   ```
5. Extract new package and copy app files
6. Apply new migrations
7. Rebuild and restart services

## Support

- Documentation: See `docs/` folder in package
- Health Check: `bash /opt/dell-server-manager/scripts/health-check.sh`
- Logs: `journalctl -u dell-server-manager -u dell-job-executor -f`
