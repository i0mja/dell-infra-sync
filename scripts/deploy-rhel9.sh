#!/bin/bash
# Dell Server Manager - RHEL 9 Deployment Script
# Automates complete self-hosted setup on RHEL 9
# Includes comprehensive OS hardening and pre-flight checks

set -e

echo "🚀 Dell Server Manager - RHEL 9 Self-Hosted Deployment"
echo "========================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "❌ Please run as root (sudo ./deploy-rhel9.sh)"
   exit 1
fi

# ============================================
# RHEL 9 HARDENING FUNCTIONS
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# ============================================
# Pre-flight Checks
# ============================================
preflight_checks() {
    echo ""
    echo "🔍 Running RHEL 9 Pre-flight Checks..."
    echo "========================================"
    local errors=0
    local warnings=0

    # 1. Check OS Version
    log_step "Checking OS version..."
    if [ -f /etc/redhat-release ]; then
        OS_VERSION=$(cat /etc/redhat-release)
        echo "   Detected: $OS_VERSION"
        if ! grep -q "release 9" /etc/redhat-release && ! grep -q "release 8" /etc/redhat-release; then
            log_warn "This script is optimized for RHEL 9. Some features may not work correctly."
            warnings=$((warnings + 1))
        fi
    else
        log_warn "Not a Red Hat based system. Proceeding with caution."
        warnings=$((warnings + 1))
    fi

    # 2. Check for Port Conflicts
    log_step "Checking for port conflicts..."
    local ports=(5432 3000 8000 8443 3100 4000 6543)
    for port in "${ports[@]}"; do
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            log_error "Port $port is already in use!"
            local process_info=$(ss -tulnp 2>/dev/null | grep ":$port " | head -1)
            echo "   $process_info"
            errors=$((errors + 1))
        fi
    done
    if [ $errors -eq 0 ]; then
        log_info "All required ports are available"
    fi

    # 3. Check for Conflicting Services
    log_step "Checking for conflicting services..."
    
    # Check Podman (common on RHEL 9, conflicts with Docker)
    if systemctl is-active --quiet podman.socket 2>/dev/null; then
        log_warn "Podman socket is active - may conflict with Docker"
        echo "   Podman and Docker can coexist but may cause issues"
        warnings=$((warnings + 1))
    fi
    
    if systemctl is-active --quiet podman.service 2>/dev/null; then
        log_warn "Podman service is active"
        warnings=$((warnings + 1))
    fi

    # Check native PostgreSQL
    if systemctl is-active --quiet postgresql 2>/dev/null; then
        log_error "Native PostgreSQL is running - will conflict with Supabase (port 5432)"
        errors=$((errors + 1))
    fi

    # Check nginx/httpd
    if systemctl is-active --quiet nginx 2>/dev/null; then
        log_warn "nginx is running - may conflict if using same ports"
        warnings=$((warnings + 1))
    fi
    
    if systemctl is-active --quiet httpd 2>/dev/null; then
        log_warn "httpd/Apache is running - may conflict if using same ports"
        warnings=$((warnings + 1))
    fi

    # 4. Check System Resources
    log_step "Checking system resources..."
    
    # Disk space
    local free_disk=$(df -BG /opt 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
    if [ -n "$free_disk" ] && [ "$free_disk" -lt 20 ] 2>/dev/null; then
        log_warn "Low disk space: ${free_disk}GB free in /opt (recommend 20GB+)"
        warnings=$((warnings + 1))
    else
        log_info "Disk space: ${free_disk}GB available"
    fi
    
    # RAM
    local total_ram=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}')
    if [ -n "$total_ram" ] && [ "$total_ram" -lt 4 ] 2>/dev/null; then
        log_warn "Low RAM: ${total_ram}GB (recommend 4GB+)"
        warnings=$((warnings + 1))
    else
        log_info "RAM: ${total_ram}GB available"
    fi
    
    # CPU cores
    local cpu_cores=$(nproc 2>/dev/null || echo "unknown")
    if [ "$cpu_cores" != "unknown" ] && [ "$cpu_cores" -lt 2 ] 2>/dev/null; then
        log_warn "Low CPU cores: $cpu_cores (recommend 2+)"
        warnings=$((warnings + 1))
    else
        log_info "CPU cores: $cpu_cores"
    fi

    # 5. Check SELinux Status
    log_step "Checking SELinux status..."
    if command -v getenforce &> /dev/null; then
        local selinux_status=$(getenforce)
        echo "   SELinux: $selinux_status"
        if [ "$selinux_status" == "Enforcing" ]; then
            # Check if container SELinux types are available
            if ! seinfo -t container_file_t &>/dev/null 2>&1; then
                log_warn "SELinux container types may not be available"
                echo "   Install container-selinux: dnf install container-selinux"
                warnings=$((warnings + 1))
            fi
        fi
    else
        log_info "SELinux not detected"
    fi

    # 6. Check Firewall Status  
    log_step "Checking firewall status..."
    if systemctl is-active --quiet firewalld 2>/dev/null; then
        echo "   Firewalld: Active"
        # Check if nftables backend is in use (causes Docker issues)
        if grep -q "FirewallBackend=nftables" /etc/firewalld/firewalld.conf 2>/dev/null; then
            log_warn "Firewalld using nftables backend - may cause Docker networking issues"
            echo "   Will be reconfigured during installation"
        fi
    else
        log_info "Firewalld: Inactive"
    fi

    # Summary
    echo ""
    echo "========================================"
    if [ $errors -gt 0 ]; then
        log_error "Pre-flight checks found $errors error(s) and $warnings warning(s)"
        echo ""
        echo "❌ Critical issues must be resolved before continuing:"
        echo "   - Stop conflicting services (systemctl stop <service>)"
        echo "   - Free up blocked ports"
        echo ""
        read -p "Continue anyway? (y/N): " continue_anyway
        if [ "$continue_anyway" != "y" ] && [ "$continue_anyway" != "Y" ]; then
            echo "Aborting installation."
            exit 1
        fi
        echo ""
    elif [ $warnings -gt 0 ]; then
        log_warn "Pre-flight checks found $warnings warning(s)"
        echo "   These may cause issues but are not blocking."
        echo ""
    else
        log_info "All pre-flight checks passed!"
        echo ""
    fi
}

# ============================================
# Kernel Module Configuration
# ============================================
configure_kernel_modules() {
    log_step "Configuring kernel modules for container networking..."
    
    # Load required modules
    modprobe br_netfilter 2>/dev/null || log_warn "br_netfilter module not available"
    modprobe ip_tables 2>/dev/null || true
    modprobe iptable_nat 2>/dev/null || true
    modprobe iptable_filter 2>/dev/null || true
    modprobe overlay 2>/dev/null || true
    modprobe ip_vs 2>/dev/null || true
    modprobe ip_vs_rr 2>/dev/null || true
    
    # Make persistent
    cat > /etc/modules-load.d/docker-dsm.conf << 'EOF'
# Dell Server Manager - Required kernel modules for Docker
br_netfilter
ip_tables
iptable_nat
iptable_filter
overlay
ip_vs
ip_vs_rr
EOF
    
    # Configure sysctl for container networking
    cat > /etc/sysctl.d/99-docker-dsm.conf << 'EOF'
# Dell Server Manager - Docker networking configuration
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
net.ipv4.conf.all.forwarding = 1
# Increase connection tracking for high-load scenarios
net.netfilter.nf_conntrack_max = 131072
EOF
    
    # Apply sysctl settings
    sysctl --system > /dev/null 2>&1 || true
    
    log_info "Kernel modules configured"
}

# ============================================
# Docker Daemon Configuration for RHEL 9
# ============================================
configure_docker_daemon() {
    log_step "Configuring Docker daemon for RHEL 9..."
    
    mkdir -p /etc/docker
    
    # Create daemon.json optimized for RHEL 9 with cgroups v2
    cat > /etc/docker/daemon.json << 'EOF'
{
  "exec-opts": ["native.cgroupdriver=systemd"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.override_kernel_check=true"
  ],
  "live-restore": true,
  "iptables": true,
  "ip-forward": true,
  "userland-proxy": false,
  "default-address-pools": [
    {"base": "172.17.0.0/16", "size": 24},
    {"base": "172.18.0.0/16", "size": 24}
  ]
}
EOF
    
    log_info "Docker daemon configured for RHEL 9/cgroups v2"
}

# ============================================
# Firewalld Configuration for Docker
# ============================================
configure_firewalld_for_docker() {
    log_step "Configuring firewalld for Docker compatibility..."
    
    if ! systemctl is-active --quiet firewalld 2>/dev/null; then
        log_info "Firewalld not active, skipping firewall configuration"
        return 0
    fi
    
    # Check and fix nftables backend issue
    if grep -q "FirewallBackend=nftables" /etc/firewalld/firewalld.conf 2>/dev/null; then
        log_info "Switching firewalld to iptables backend for Docker compatibility..."
        sed -i 's/FirewallBackend=nftables/FirewallBackend=iptables/' /etc/firewalld/firewalld.conf
        systemctl restart firewalld
        sleep 2
    fi
    
    # Create a trusted zone for Docker if it doesn't exist
    firewall-cmd --permanent --zone=trusted --add-interface=docker0 2>/dev/null || true
    
    # Pre-open required ports BEFORE starting services
    local ports=(5432 3000 8000 8443 3100 4000 6543)
    for port in "${ports[@]}"; do
        firewall-cmd --permanent --add-port=${port}/tcp 2>/dev/null || true
    done
    
    # Enable masquerading for container networking (NAT)
    firewall-cmd --permanent --add-masquerade 2>/dev/null || true
    
    # Allow Docker to manage its own iptables rules
    firewall-cmd --permanent --direct --add-rule ipv4 filter FORWARD 0 -i docker0 -j ACCEPT 2>/dev/null || true
    firewall-cmd --permanent --direct --add-rule ipv4 filter FORWARD 0 -o docker0 -j ACCEPT 2>/dev/null || true
    
    # Reload firewall
    firewall-cmd --reload 2>/dev/null || true
    
    log_info "Firewalld configured for Docker"
}

# ============================================
# SELinux Configuration for Docker
# ============================================
configure_selinux_for_docker() {
    local volumes_dir="$1"
    
    log_step "Configuring SELinux for Docker..."
    
    if ! command -v getenforce &> /dev/null; then
        log_info "SELinux not installed, skipping"
        return 0
    fi
    
    local selinux_status=$(getenforce)
    if [ "$selinux_status" == "Disabled" ]; then
        log_info "SELinux disabled, skipping configuration"
        return 0
    fi
    
    # Install container-selinux if not present
    if ! rpm -q container-selinux &>/dev/null; then
        log_info "Installing container-selinux..."
        dnf install -y container-selinux 2>/dev/null || log_warn "Could not install container-selinux"
    fi
    
    # Set required SELinux booleans
    log_info "Setting SELinux booleans..."
    
    # Allow containers to manage cgroups (required for systemd in containers)
    setsebool -P container_manage_cgroup 1 2>/dev/null || true
    
    # Allow containers to connect to any TCP port
    setsebool -P container_connect_any 1 2>/dev/null || true
    
    # If volumes directory is provided, set proper context
    if [ -n "$volumes_dir" ] && [ -d "$volumes_dir" ]; then
        log_info "Setting SELinux context on volumes directory..."
        
        # Try container_file_t first (preferred), fall back to svirt_sandbox_file_t
        if seinfo -t container_file_t &>/dev/null 2>&1; then
            chcon -Rt container_file_t "$volumes_dir" 2>/dev/null || true
        else
            chcon -Rt svirt_sandbox_file_t "$volumes_dir" 2>/dev/null || true
        fi
        
        # Also run restorecon to ensure consistency
        restorecon -R "$volumes_dir" 2>/dev/null || true
    fi
    
    log_info "SELinux configured for Docker"
}

# ============================================
# Conflict Resolution
# ============================================
resolve_conflicts() {
    log_step "Checking for service conflicts..."
    
    # Handle Podman conflict
    if systemctl is-active --quiet podman.socket 2>/dev/null || systemctl is-active --quiet podman.service 2>/dev/null; then
        echo ""
        log_warn "Podman services detected - these may conflict with Docker"
        echo "   Options:"
        echo "     1) Stop and disable Podman (recommended for Docker use)"
        echo "     2) Keep Podman running (may cause issues)"
        echo ""
        read -p "   Stop Podman services? (Y/n): " stop_podman
        if [ "$stop_podman" != "n" ] && [ "$stop_podman" != "N" ]; then
            systemctl stop podman.socket podman.service 2>/dev/null || true
            systemctl disable podman.socket podman.service 2>/dev/null || true
            log_info "Podman services stopped and disabled"
        fi
    fi
    
    # Handle native PostgreSQL conflict
    if systemctl is-active --quiet postgresql 2>/dev/null; then
        echo ""
        log_error "Native PostgreSQL is running on this host"
        echo "   This will conflict with Supabase's PostgreSQL container (port 5432)"
        echo ""
        read -p "   Stop native PostgreSQL? (Y/n): " stop_pg
        if [ "$stop_pg" != "n" ] && [ "$stop_pg" != "N" ]; then
            systemctl stop postgresql 2>/dev/null || true
            systemctl disable postgresql 2>/dev/null || true
            log_info "Native PostgreSQL stopped and disabled"
        else
            log_error "Cannot continue with PostgreSQL conflict on port 5432"
            exit 1
        fi
    fi
    
    # Handle nginx conflict (only if it would block our ports)
    if systemctl is-active --quiet nginx 2>/dev/null; then
        if ss -tuln | grep -q ":3000 " || ss -tuln | grep -q ":8000 "; then
            log_warn "nginx may be using ports needed by this application"
            read -p "   Stop nginx? (y/N): " stop_nginx
            if [ "$stop_nginx" = "y" ] || [ "$stop_nginx" = "Y" ]; then
                systemctl stop nginx 2>/dev/null || true
                log_info "nginx stopped"
            fi
        fi
    fi
    
    log_info "Conflict resolution complete"
}

# ============================================
# Docker Network Verification
# ============================================
verify_docker_networking() {
    log_step "Verifying Docker networking..."
    
    if ! command -v docker &> /dev/null; then
        log_warn "Docker not yet installed, skipping network verification"
        return 0
    fi
    
    if ! docker info &>/dev/null 2>&1; then
        log_warn "Docker daemon not running, skipping network verification"
        return 0
    fi
    
    # Test if Docker can create networks
    if docker network create dsm-preflight-test &>/dev/null 2>&1; then
        docker network rm dsm-preflight-test &>/dev/null 2>&1 || true
        log_info "Docker networking is functional"
    else
        log_warn "Docker may have networking issues"
        echo "   Try: systemctl restart docker"
    fi
}

# ============================================
# END OF RHEL 9 HARDENING FUNCTIONS
# ============================================

# Run pre-flight checks first
preflight_checks

# Deployment mode selection
echo "🔧 Deployment Mode"
echo "=================="
echo ""
echo "Choose your deployment mode:"
echo "  1) Local/Air-gapped - Install local Supabase (for offline/secure networks)"
echo "  2) Cloud-connected - Use Lovable Cloud backend (requires internet)"
echo ""
read -p "Enter your choice (1 or 2): " DEPLOY_MODE

if [[ "$DEPLOY_MODE" != "1" && "$DEPLOY_MODE" != "2" ]]; then
    echo "❌ Invalid choice. Please run the script again and select 1 or 2."
    exit 1
fi

echo ""
if [ "$DEPLOY_MODE" = "1" ]; then
    echo "✅ Selected: Local/Air-gapped deployment"
else
    echo "✅ Selected: Cloud-connected deployment"
fi
echo ""

# Resolve conflicts before installing anything
resolve_conflicts

if [ "$DEPLOY_MODE" = "1" ]; then

# Configure kernel modules BEFORE Docker installation
configure_kernel_modules

# Step 1: Install Docker
echo "📦 Step 1/6: Installing Docker..."
if ! command -v docker &> /dev/null; then
    dnf config-manager --add-repo=https://download.docker.com/linux/rhel/docker-ce.repo
    dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Configure Docker daemon for RHEL 9 BEFORE starting
    configure_docker_daemon
    
    systemctl start docker
    systemctl enable docker
    echo "✅ Docker installed and configured"
else
    echo "✅ Docker already installed"
    # Still configure daemon.json if not present
    if [ ! -f /etc/docker/daemon.json ]; then
        configure_docker_daemon
        systemctl restart docker
    fi
fi

# Configure firewalld for Docker BEFORE starting containers
configure_firewalld_for_docker

# Verify Docker networking
verify_docker_networking

# Step 2: Install Node.js 18
echo "📦 Step 2/6: Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    dnf module install -y nodejs:18/common
    echo "✅ Node.js installed"
else
    echo "✅ Node.js already installed"
fi

# Step 3: Setup Supabase using project's custom configuration
echo "🗄️  Step 3/6: Setting up Supabase..."

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPABASE_DIR="/opt/supabase-local"

# Check if project's custom Supabase config exists
if [ ! -d "$PROJECT_ROOT/supabase/docker" ]; then
    echo "❌ Project's Supabase docker configuration not found!"
    echo "   Expected location: $PROJECT_ROOT/supabase/docker"
    echo "   Please ensure you're running from the project directory"
    exit 1
fi

# ============================================
# CLEANUP: Handle failed previous deployments
# ============================================
if [ -d "$SUPABASE_DIR" ]; then
    echo "⚠️  Existing Supabase installation detected at $SUPABASE_DIR"
    echo ""
    echo "Choose an option:"
    echo "  1) Clean reinstall (recommended for failed deployments)"
    echo "  2) Keep existing data and update configuration"
    echo "  3) Abort"
    echo ""
    read -p "Enter your choice (1/2/3): " CLEANUP_CHOICE
    
    case $CLEANUP_CHOICE in
        1)
            echo "🧹 Performing clean reinstall..."
            cd "$SUPABASE_DIR" 2>/dev/null || true
            
            # Stop and remove all containers
            if [ -f "docker-compose.yml" ]; then
                echo "   Stopping containers..."
                docker compose down -v --remove-orphans 2>/dev/null || true
            fi
            
            # Remove any orphaned containers
            echo "   Removing orphaned containers..."
            docker rm -f $(docker ps -aq --filter "name=supabase") 2>/dev/null || true
            
            # Remove volumes
            echo "   Removing Docker volumes..."
            docker volume rm $(docker volume ls -q --filter "name=supabase") 2>/dev/null || true
            
            # Remove installation directory
            echo "   Removing installation directory..."
            cd /
            rm -rf "$SUPABASE_DIR"
            
            # Clean Docker system
            echo "   Cleaning Docker system..."
            docker system prune -f 2>/dev/null || true
            
            echo "✅ Cleanup complete"
            ;;
        2)
            echo "ℹ️  Keeping existing data, updating configuration only..."
            cd "$SUPABASE_DIR"
            docker compose down 2>/dev/null || true
            ;;
        3)
            echo "❌ Aborted by user"
            exit 0
            ;;
        *)
            echo "❌ Invalid choice. Aborting."
            exit 1
            ;;
    esac
fi

# Create Supabase directory
mkdir -p "$SUPABASE_DIR"
cd "$SUPABASE_DIR"

# ============================================
# IMPORTANT: Clean up volumes directory first
# This fixes "cannot overwrite directory with non-directory" errors
# ============================================
echo "   Preparing volume directories..."
rm -rf "$SUPABASE_DIR/volumes" 2>/dev/null || true

# Copy configuration files (excluding volumes which we'll create fresh)
for item in "$PROJECT_ROOT/supabase/docker/"*; do
    item_name=$(basename "$item")
    if [ "$item_name" != "volumes" ]; then
        cp -r "$item" "$SUPABASE_DIR/"
    fi
done

# Create required directories with correct structure
mkdir -p volumes/api
mkdir -p volumes/storage
mkdir -p volumes/db/init

# Copy kong.yml as a FILE (not directory)
if [ -f "$PROJECT_ROOT/supabase/docker/volumes/api/kong.yml" ]; then
    cp "$PROJECT_ROOT/supabase/docker/volumes/api/kong.yml" volumes/api/kong.yml
fi

# Configure SELinux for volumes directory
configure_selinux_for_docker "$SUPABASE_DIR/volumes"

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

# Generate secure credentials
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
JWT_SECRET=$(openssl rand -base64 64 | tr -d '/+=')
SECRET_KEY_BASE=$(openssl rand -base64 64 | tr -d '/+=')
LOGFLARE_API_KEY=$(openssl rand -hex 16)
VAULT_ENC_KEY=$(openssl rand -base64 32 | tr -d '/+=')
PG_META_CRYPTO_KEY=$(openssl rand -base64 32 | tr -d '/+=')
DASHBOARD_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=')

# ============================================
# CRITICAL: Create custom init script that runs LAST (99-)
# This ensures Supabase's built-in scripts run first, then we fix passwords
# ============================================
cat > volumes/db/init/99-custom-roles.sh << 'INITSCRIPT'
#!/bin/bash
set -e

echo "=== Dell Server Manager: Custom Supabase Initialization ==="
echo "Running AFTER Supabase built-in init scripts..."

# This script runs during postgres container first startup
# It ensures all roles have the correct password from $POSTGRES_PASSWORD

psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Create roles if they don't exist (Supabase should have created these, but just in case)
  DO \$\$
  BEGIN
    -- Core Supabase roles
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
      CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD '$POSTGRES_PASSWORD';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
      CREATE ROLE supabase_auth_admin LOGIN PASSWORD '$POSTGRES_PASSWORD' NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
      CREATE ROLE supabase_storage_admin LOGIN PASSWORD '$POSTGRES_PASSWORD' NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
      CREATE ROLE supabase_functions_admin LOGIN PASSWORD '$POSTGRES_PASSWORD' NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_replication_admin') THEN
      CREATE ROLE supabase_replication_admin LOGIN PASSWORD '$POSTGRES_PASSWORD' REPLICATION;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
      CREATE ROLE supabase_read_only_user LOGIN PASSWORD '$POSTGRES_PASSWORD';
    END IF;
    
    -- API roles
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
      CREATE ROLE authenticator LOGIN PASSWORD '$POSTGRES_PASSWORD' NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pgbouncer') THEN
      CREATE ROLE pgbouncer LOGIN PASSWORD '$POSTGRES_PASSWORD';
    END IF;
  END
  \$\$;

  -- Set/update passwords for all service roles to match POSTGRES_PASSWORD
  ALTER ROLE supabase_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE supabase_functions_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE supabase_replication_admin WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE supabase_read_only_user WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
  ALTER ROLE pgbouncer WITH PASSWORD '$POSTGRES_PASSWORD';

  -- Grant roles to authenticator (needed for PostgREST role switching)
  GRANT anon TO authenticator;
  GRANT authenticated TO authenticator;
  GRANT service_role TO authenticator;

  -- Create schemas (some may already exist from Supabase init)
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE SCHEMA IF NOT EXISTS _realtime;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE SCHEMA IF NOT EXISTS _analytics;

  -- Grant schema permissions
  GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
  GRANT USAGE ON SCHEMA auth TO authenticator;
  GRANT USAGE ON SCHEMA auth TO anon;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT USAGE ON SCHEMA auth TO service_role;

  GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
  GRANT USAGE ON SCHEMA storage TO authenticator;
  GRANT USAGE ON SCHEMA storage TO anon;
  GRANT USAGE ON SCHEMA storage TO authenticated;
  GRANT USAGE ON SCHEMA storage TO service_role;

  GRANT ALL ON SCHEMA _realtime TO supabase_admin;
  GRANT USAGE ON SCHEMA _realtime TO authenticator;

  GRANT ALL ON SCHEMA _analytics TO supabase_admin;
  
  GRANT ALL ON SCHEMA extensions TO supabase_admin;
  GRANT USAGE ON SCHEMA extensions TO authenticator;
  GRANT USAGE ON SCHEMA extensions TO anon;
  GRANT USAGE ON SCHEMA extensions TO authenticated;
  GRANT USAGE ON SCHEMA extensions TO service_role;

  -- Create realtime publication
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END
  \$\$;

  -- Essential extensions
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pgjwt WITH SCHEMA extensions;

  -- Grant extension usage
  GRANT USAGE ON SCHEMA extensions TO PUBLIC;

EOSQL

echo "=== Dell Server Manager: Custom initialization complete ==="
INITSCRIPT

chmod +x volumes/db/init/99-custom-roles.sh
echo "✅ Custom init script created"

echo "✅ Directory structure created"

# Set world-readable permissions on volumes
chmod -R 755 "$SUPABASE_DIR/volumes"

# Generate proper JWT tokens that match the JWT_SECRET
generate_jwt() {
    local role=$1
    local header='{"alg":"HS256","typ":"JWT"}'
    local payload="{\"iss\":\"supabase-local\",\"role\":\"$role\",\"iat\":$(date +%s),\"exp\":$(($(date +%s) + 315360000))}"
    
    local header_base64=$(echo -n "$header" | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    local payload_base64=$(echo -n "$payload" | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    local signature=$(echo -n "${header_base64}.${payload_base64}" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    
    echo "${header_base64}.${payload_base64}.${signature}"
}

ANON_KEY=$(generate_jwt "anon")
SERVICE_ROLE_KEY=$(generate_jwt "service_role")

# Create complete .env file with ALL required variables
cat > .env << EOF
############
# Secrets - KEEP THESE SAFE!
############
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SECRET_KEY_BASE=$SECRET_KEY_BASE
VAULT_ENC_KEY=$VAULT_ENC_KEY
PG_META_CRYPTO_KEY=$PG_META_CRYPTO_KEY

############
# Database
############
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=postgres

############
# API Proxy - Kong
############
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443

############
# API - PostgREST
############
PGRST_DB_SCHEMAS=public,storage,graphql_public

############
# Auth - GoTrue
############
SITE_URL=http://${SERVER_IP}:3000
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false

MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
MAILER_URLPATHS_INVITE=/auth/v1/verify
MAILER_URLPATHS_RECOVERY=/auth/v1/verify
MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify

############
# SMTP (optional - leave empty if not using email)
############
SMTP_ADMIN_EMAIL=admin@localhost
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=Dell Server Manager

############
# Storage
############
IMGPROXY_ENABLE_WEBP_DETECTION=true

############
# Functions
############
FUNCTIONS_VERIFY_JWT=false
FUNCTIONS_PATH=$PROJECT_ROOT/supabase/functions

############
# Logging
############
LOGFLARE_API_KEY=$LOGFLARE_API_KEY
LOGFLARE_PUBLIC_ACCESS_TOKEN=$LOGFLARE_API_KEY
LOGFLARE_PRIVATE_ACCESS_TOKEN=$LOGFLARE_API_KEY

############
# Studio Dashboard
############
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
STUDIO_DEFAULT_ORGANIZATION=Dell Server Manager
STUDIO_DEFAULT_PROJECT=Local Deployment

############
# Docker
############
DOCKER_SOCKET_LOCATION=/var/run/docker.sock

############
# Connection Pooler
############
POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_DB_POOL_SIZE=10
POOLER_TENANT_ID=local

############
# External URLs
############
API_EXTERNAL_URL=http://${SERVER_IP}:8000
SUPABASE_PUBLIC_URL=http://${SERVER_IP}:8000
EOF

echo "✅ Supabase configuration created with all required variables"

# Step 4: Start Supabase (STAGED STARTUP)
echo "🚀 Step 4/6: Starting Supabase services..."

# ============================================
# STAGED STARTUP: Start DB first, verify passwords, then start other services
# This prevents auth/storage/realtime from failing due to race conditions
# ============================================

echo "🗄️  Stage 1: Starting database service first..."
docker compose up -d db

echo "⏳ Stage 2: Waiting for database to initialize..."
MAX_WAIT=120
WAITED=0
DB_READY=false
while [ $WAITED -lt $MAX_WAIT ]; do
    if docker compose exec -T db pg_isready -U postgres > /dev/null 2>&1; then
        echo "   Database accepting connections..."
        # Give it a few more seconds to run init scripts
        sleep 5
        DB_READY=true
        break
    fi
    sleep 5
    WAITED=$((WAITED + 5))
    echo "   ... waiting ($WAITED seconds)"
done

if [ "$DB_READY" != "true" ]; then
    echo "❌ Database failed to start. Check logs with: docker compose logs db"
    exit 1
fi

# ============================================
# Stage 3: Verify init script ran correctly
# The 99-custom-roles.sh script should have created schemas and fixed passwords
# ============================================
echo "🔐 Stage 3: Verifying database initialization..."

# Wait a bit for init scripts to complete
sleep 10

# Check if auth schema exists (created by our init script)
AUTH_SCHEMA_READY=false
for i in {1..30}; do
    if docker compose exec -T db psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_namespace WHERE nspname = 'auth'" 2>/dev/null | grep -q "1"; then
        echo "   ✅ auth schema exists"
        AUTH_SCHEMA_READY=true
        break
    fi
    sleep 2
    if [ $((i % 5)) -eq 0 ]; then
        echo "   ... waiting for init scripts ($((i * 2)) seconds)"
    fi
done

if [ "$AUTH_SCHEMA_READY" != "true" ]; then
    echo "⚠️  auth schema not found - init script may not have run"
    echo "   This can happen if the database volume already existed"
    echo "   Applying manual fixes..."
    
    # Manual fallback: run the same SQL as the init script
    docker compose exec -T db psql -U postgres -d postgres -c "
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE SCHEMA IF NOT EXISTS _realtime;
    CREATE SCHEMA IF NOT EXISTS extensions;
    " 2>/dev/null || true
fi

# Verify role passwords work
echo "   Verifying role connections..."
ROLES_OK=true

if docker compose exec -T db psql -U supabase_auth_admin -d postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo "   ✅ supabase_auth_admin can connect"
else
    echo "   ⚠️  supabase_auth_admin connection failed - applying password fix"
    docker compose exec -T db psql -U postgres -d postgres -c "ALTER ROLE supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || true
    ROLES_OK=false
fi

if docker compose exec -T db psql -U supabase_storage_admin -d postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo "   ✅ supabase_storage_admin can connect"
else
    echo "   ⚠️  supabase_storage_admin connection failed - applying password fix"
    docker compose exec -T db psql -U postgres -d postgres -c "ALTER ROLE supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || true
    ROLES_OK=false
fi

if docker compose exec -T db psql -U authenticator -d postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo "   ✅ authenticator can connect"
else
    echo "   ⚠️  authenticator connection failed - applying password fix"
    docker compose exec -T db psql -U postgres -d postgres -c "ALTER ROLE authenticator WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || true
    ROLES_OK=false
fi

# If any roles failed, apply comprehensive fix
if [ "$ROLES_OK" != "true" ]; then
    echo "   Applying comprehensive role fixes..."
    docker compose exec -T db psql -U postgres -d postgres -c "
    ALTER ROLE supabase_admin WITH PASSWORD '$POSTGRES_PASSWORD';
    ALTER ROLE supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
    ALTER ROLE supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
    ALTER ROLE supabase_functions_admin WITH PASSWORD '$POSTGRES_PASSWORD';
    ALTER ROLE authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
    ALTER ROLE pgbouncer WITH PASSWORD '$POSTGRES_PASSWORD';
    
    -- Ensure API roles exist and are granted
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    \$\$;
    
    GRANT anon TO authenticator;
    GRANT authenticated TO authenticator;
    GRANT service_role TO authenticator;
    " 2>/dev/null || true
    
    # Restart db to pick up changes, then re-verify
    echo "   Restarting database to apply changes..."
    docker compose restart db
    sleep 10
fi

echo "✅ Database roles and schemas configured"

# ============================================
# Stage 4: Now start all remaining services
# ============================================
echo "🚀 Stage 4: Starting remaining services..."
docker compose up -d

echo "⏳ Waiting for services to stabilize (90 seconds)..."
for i in {1..9}; do
    sleep 10
    echo "   ... $((i * 10)) seconds"
done

# Check service health
echo "🔍 Checking service status..."
docker compose ps

# Check for critical services (fixed grep command - capture single integer)
UNHEALTHY_COUNT=$(docker compose ps 2>/dev/null | grep -ci "restarting" || true)
UNHEALTHY_COUNT=${UNHEALTHY_COUNT:-0}
if [ "$UNHEALTHY_COUNT" -gt 0 ] 2>/dev/null; then
    echo "⚠️  Some services are restarting. Checking logs..."
    echo ""
    echo "Auth service logs (last 30 lines):"
    docker compose logs auth --tail=30 2>/dev/null || true
    echo ""
    echo "Storage service logs (last 20 lines):"
    docker compose logs storage --tail=20 2>/dev/null || true
    echo ""
    echo "Realtime service logs (last 20 lines):"
    docker compose logs realtime --tail=20 2>/dev/null || true
    echo ""
fi

# Apply Supabase migrations from the repository for local deployment
echo "📊 Applying Supabase migrations..."
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "❌ CRITICAL: Supabase migrations not found!"
    echo "Expected location: $MIGRATIONS_DIR"
    echo "Without migrations, authentication will not work!"
    echo ""
    echo "To resolve this issue:"
    echo "  1. Ensure you have the latest code: git pull"
    echo "  2. Check that supabase/migrations/ exists"
    echo "  3. Download missing migrations from the repository"
    exit 1
fi

MIGRATION_COUNT=$(find "$MIGRATIONS_DIR" -name "*.sql" -type f | wc -l)
if [ "$MIGRATION_COUNT" -eq 0 ]; then
    echo "❌ No migration files found in $MIGRATIONS_DIR"
    exit 1
fi

echo "ℹ Found $MIGRATION_COUNT migration files to apply"
APPLIED_COUNT=0
FAILED_MIGRATIONS=()

for migration_file in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration_file" ]; then
        filename=$(basename "$migration_file")
        echo "  → Applying $filename..."
        
        if docker exec -i supabase-db psql -U postgres -d postgres < "$migration_file" 2>&1; then
            echo "    ✓ $filename applied"
            APPLIED_COUNT=$((APPLIED_COUNT + 1))
        else
            echo "    ✗ Failed to apply $filename"
            FAILED_MIGRATIONS+=("$filename")
        fi
    fi
done

echo ""
echo "📊 Applied $APPLIED_COUNT of $MIGRATION_COUNT migrations"

if [ ${#FAILED_MIGRATIONS[@]} -gt 0 ]; then
    echo "❌ Failed migrations:"
    for failed in "${FAILED_MIGRATIONS[@]}"; do
        echo "  ✗ $failed"
    done
    echo ""
    echo "To rollback and retry:"
    echo "  docker exec supabase-db psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'"
    echo "  Then re-run this deployment script"
    exit 1
fi

# Verify database schema
echo "🔍 Verifying database schema..."
VERIFY_SCRIPT="$(dirname "$0")/verify-database.sh"

if [ -f "$VERIFY_SCRIPT" ]; then
    if bash "$VERIFY_SCRIPT"; then
        echo "✅ Database schema verified successfully"
    else
        echo "❌ Database schema verification failed!"
        echo "Authentication will not work without proper schema"
        echo ""
        echo "Run manually to see details:"
        echo "  bash scripts/verify-database.sh"
        exit 1
    fi
else
    echo "ℹ Schema verification script not found, skipping..."
fi

echo "✅ Database setup complete"

# Create initial admin user via Supabase signup API
echo "👤 Step 5/7: Creating initial admin user..."
read -p "Enter admin email: " ADMIN_EMAIL
read -s -p "Enter admin password: " ADMIN_PASSWORD
echo ""

# Use Supabase signup API to properly create user
SUPABASE_URL=$(grep API_EXTERNAL_URL /opt/supabase-local/.env | cut -d'=' -f2)
ANON_KEY=$(grep "^ANON_KEY=" /opt/supabase-local/.env | cut -d'=' -f2)

curl -X POST "${SUPABASE_URL}/auth/v1/signup" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\",
    \"email_confirm\": true,
    \"data\": {
      \"full_name\": \"Administrator\"
    }
  }" > /dev/null 2>&1

# Wait for triggers to complete
sleep 2

# Assign admin role
docker exec supabase-db psql -U postgres -d postgres -c "
  UPDATE public.user_roles SET role = 'admin'::app_role
  WHERE user_id = (SELECT id FROM auth.users WHERE email = '$ADMIN_EMAIL');
"

echo "✅ Admin user created: $ADMIN_EMAIL"

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')
SUPABASE_URL="http://${SERVER_IP}:8000"

else
    # Cloud mode
    echo "☁️  Step 1/3: Configuring Lovable Cloud connection"
    echo "=================================================="
    echo ""
    echo "📋 Required Information"
    echo "----------------------"
    echo ""
    echo "You will need your Lovable Cloud SERVICE_ROLE_KEY to proceed."
    echo ""
    echo "To get your SERVICE_ROLE_KEY:"
    echo "  1. Open your project in Lovable"
    echo "  2. Click the Backend button (Cloud icon) in the top-right"
    echo "  3. Go to Settings → API"
    echo "  4. Copy the 'service_role' key (starts with 'eyJ...')"
    echo ""
    echo "⚠️  WARNING: This key has admin access - keep it secure!"
    echo ""
    
    # Validate SERVICE_ROLE_KEY
    while true; do
        read -sp "Enter your SERVICE_ROLE_KEY: " SERVICE_ROLE_KEY
        echo ""
        
        if [ -z "$SERVICE_ROLE_KEY" ]; then
            echo "❌ SERVICE_ROLE_KEY cannot be empty"
            echo ""
            continue
        fi
        
        # Basic JWT validation
        if [[ ! "$SERVICE_ROLE_KEY" =~ ^eyJ ]]; then
            echo "⚠️  Key doesn't look like a valid JWT token (should start with 'eyJ')"
            read -p "Continue anyway? (y/n): " confirm
            if [ "$confirm" != "y" ]; then
                continue
            fi
        fi
        
        # Test the key
        echo "🔍 Validating SERVICE_ROLE_KEY..."
        SUPABASE_URL="https://ylwkczjqvymshktuuqkx.supabase.co"
        ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsd2tjempxdnltc2hrdHV1cWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODQ0OTMsImV4cCI6MjA3Nzc2MDQ5M30.hIkDV2AAos-Z9hvQLfZmiQ7UvGCpGqwG5kzd1VBRx0w"
        
        if curl -s -f -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
           "$SUPABASE_URL/rest/v1/" > /dev/null 2>&1; then
            echo "✅ SERVICE_ROLE_KEY validated successfully!"
            break
        else
            echo "❌ Failed to validate SERVICE_ROLE_KEY"
            echo "❌ Please check the key and try again"
            echo ""
            read -p "Try again? (y/n): " retry
            if [ "$retry" != "y" ]; then
                echo "❌ Cannot proceed without valid SERVICE_ROLE_KEY"
                exit 1
            fi
        fi
    done
    
    SERVER_IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo "✅ Using Lovable Cloud backend"
    echo "✅ Database management available through Lovable Cloud interface"
    echo ""
    
    # Install Node.js (still needed for frontend)
    echo "📦 Step 2/3: Installing Node.js 18..."
    if ! command -v node &> /dev/null; then
        dnf module install -y nodejs:18/common
        echo "✅ Node.js installed"
    else
        echo "✅ Node.js already installed"
    fi
fi

# Step 6: Setup application
if [ "$DEPLOY_MODE" = "1" ]; then
    echo "📱 Step 6/7: Setting up Dell Server Manager..."
else
    echo "📱 Step 3/3: Setting up Dell Server Manager..."
fi
cd ~
if [ ! -d "dell-server-manager" ]; then
    echo "❌ Please clone the Dell Server Manager repository first"
    echo "   git clone <your-repo-url> dell-server-manager"
    exit 1
fi

cd dell-server-manager
npm install

# Create .env.local based on deployment mode
if [ "$DEPLOY_MODE" = "1" ]; then
    # Local mode: Override with local Supabase
    cp .env.offline.template .env.local
    sed -i "s|http://127.0.0.1:54321|http://$SERVER_IP:8000|g" .env.local
    sed -i "s|VITE_SUPABASE_PROJECT_ID=\"local\"|VITE_SUPABASE_PROJECT_ID=\"default\"|g" .env.local
else
    # Cloud mode: Use Lovable Cloud configuration
    cat > .env.local << EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
EOF
fi

# Build application
npm run build

# Step 7: Setup systemd service
echo "🔧 Step 7/7: Creating systemd service..."
cat > /etc/systemd/system/dell-server-manager.service << EOF
[Unit]
Description=Dell Server Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/npx serve dist -l 3000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl start dell-server-manager
systemctl enable dell-server-manager

# Step 7b: Setup Job Executor systemd service
echo "🔧 Setting up Job Executor service..."

# Install Python dependencies
if [ -f "requirements.txt" ]; then
    pip3 install -r requirements.txt --quiet
    echo "✅ Python dependencies installed"
else
    echo "⚠️ requirements.txt not found - skipping Python dependencies"
fi

# Create systemd service for Job Executor
if [ "$DEPLOY_MODE" = "1" ]; then
    DSM_URL="http://${SERVER_IP}:8000"
else
    DSM_URL="http://${SERVER_IP}:3000"
fi

cat > /etc/systemd/system/dell-job-executor.service << EOF
[Unit]
Description=Dell Server Manager - Job Executor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$(pwd)
Environment="SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
Environment="DSM_URL=$DSM_URL"
ExecStart=/usr/bin/python3 job-executor.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/dell-job-executor.log
StandardError=append:/var/log/dell-job-executor-error.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dell-job-executor.service
systemctl start dell-job-executor.service

echo "✅ Job Executor service created and started"

# Open firewall ports
# Step 8: Optional SSL/TLS Setup
echo "🔒 Step 8/8: SSL/TLS Setup (Optional)..."
read -p "Do you have a domain name for SSL/TLS? (y/n): " SETUP_SSL

if [ "$SETUP_SSL" = "y" ] || [ "$SETUP_SSL" = "Y" ]; then
    read -p "Enter your domain name (e.g., example.com): " DOMAIN_NAME
    
    # Install nginx and certbot
    echo "📦 Installing nginx and certbot..."
    dnf install -y nginx certbot python3-certbot-nginx
    
    # Create nginx configuration
    cat > /etc/nginx/conf.d/dell-server-manager.conf << EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN_NAME;
    
    # SSL certificates (will be configured by certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Application proxy
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
    
    # Supabase proxy
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
    
    # Start and enable nginx
    systemctl start nginx
    systemctl enable nginx
    
    # Obtain SSL certificate
    echo "📜 Obtaining SSL certificate from Let's Encrypt..."
    certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --email $ADMIN_EMAIL --redirect
    
    # Setup auto-renewal
    systemctl enable certbot-renew.timer
    systemctl start certbot-renew.timer
    
    # Open firewall ports
    echo "🔥 Opening firewall ports..."
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-port=8000/tcp  # Supabase API
    firewall-cmd --reload
    
    SSL_URL="https://$DOMAIN_NAME"
    echo "✅ SSL/TLS configured successfully!"
else
    # Firewall ports already configured by configure_firewalld_for_docker()
    # Just ensure they're applied
    if systemctl is-active --quiet firewalld 2>/dev/null; then
        echo "🔥 Verifying firewall ports..."
        firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
        firewall-cmd --permanent --add-port=8000/tcp 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
    fi
    
    SSL_URL="http://$SERVER_IP:3000"
fi

echo ""
echo "=========================================="
echo "🎉 Deployment Complete!"
echo "=========================================="
echo ""

if [ "$DEPLOY_MODE" = "1" ]; then
    # Local mode summary
    echo "📍 Access Points:"
    echo "  Dell Server Manager: $SSL_URL"
    echo "  Supabase Studio:     http://${SERVER_IP}:8000"
    echo ""
    echo "🔐 Credentials saved to: ~/dell-server-manager/deployment-credentials.txt"
    echo ""
    echo "📊 Database Connection:"
    echo "  URL: http://${SERVER_IP}:8000"
    echo "  Admin Email: $ADMIN_EMAIL"
    echo ""
else
    # Cloud mode summary
    echo "📍 Access Points:"
    echo "  Dell Server Manager: $SSL_URL"
    echo "  Backend Management:  https://lovable.dev (Backend button)"
    echo ""
    echo "☁️  Lovable Cloud Configuration:"
    echo "  Backend URL: $SUPABASE_URL"
    echo "  Note: SERVICE_ROLE_KEY configured for Job Executor"
    echo ""
    echo "🔐 Credentials saved to: ~/dell-server-manager/deployment-credentials.txt"
    echo ""
fi

echo "🔧 Service Management:"
echo "  Check app status:      systemctl status dell-server-manager"
echo "  Check Job Executor:    systemctl status dell-job-executor"
echo "  View app logs:         journalctl -u dell-server-manager -f"
echo "  View Job Executor logs: tail -f /var/log/dell-job-executor.log"
echo ""

if [ "$DEPLOY_MODE" = "2" ]; then
    echo "✅ Job Executor Verification:"
    echo "  1. Go to Settings → Network Connectivity"
    echo "  2. Click 'Run All Tests' in Job Executor Diagnostics"
    echo "  3. All tests should pass (green)"
    echo ""
    echo "🔍 Troubleshooting (if tests fail):"
    echo "  - Check logs: tail -f /var/log/dell-job-executor-error.log"
    echo "  - Verify SERVICE_ROLE_KEY: systemctl show dell-job-executor | grep Environment"
    echo "  - Restart service: systemctl restart dell-job-executor"
    echo ""
fi

echo "📋 Next Steps:"
if [ "$DEPLOY_MODE" = "1" ]; then
    echo "  1. Access Dell Server Manager at $SSL_URL"
    echo "  2. Log in with your admin credentials"
    echo "  3. Configure iDRAC credentials in Settings"
    echo "  4. Start discovering servers"
else
    echo "  1. Access Dell Server Manager at $SSL_URL"
    echo "  2. Log in using your Lovable account"
    echo "  3. Configure iDRAC credentials in Settings"
    echo "  4. Start discovering servers"
fi
echo ""
echo "📚 Documentation:"
echo "  - Backup Guide: docs/BACKUP_GUIDE.md"
echo "  - Job Executor Guide: docs/JOB_EXECUTOR_GUIDE.md"
echo "  - vCenter Sync Guide: docs/VCENTER_SYNC_GUIDE.md"
echo ""

# Save deployment credentials
CREDS_FILE="~/dell-server-manager/deployment-credentials.txt"

if [ "$DEPLOY_MODE" = "1" ]; then
    cat > "$CREDS_FILE" << EOF
Dell Server Manager Deployment Credentials
==========================================
Deployment Time: $(date '+%Y-%m-%d %H:%M:%S')
Deployment Mode: Local/Air-gapped

Application URL: $SSL_URL
Supabase Studio: http://${SERVER_IP}:8000

Supabase Credentials:
--------------------
URL: http://${SERVER_IP}:8000
Anon Key: $ANON_KEY
Service Role Key: $SERVICE_ROLE_KEY

Admin User:
----------
Email: $ADMIN_EMAIL
Password: [The password you entered during setup]

Services:
--------
Dell Server Manager: Running on port 3000
Job Executor: Running in background
Supabase: Running on port 8000

Service Management:
------------------
Check status: systemctl status dell-server-manager
Check Job Executor: systemctl status dell-job-executor
View logs: journalctl -u dell-server-manager -f

SECURITY WARNING:
----------------
- Keep this file secure - it contains sensitive credentials
- Store in a safe location
- Do not commit to version control
EOF
else
    cat > "$CREDS_FILE" << EOF
Dell Server Manager Deployment Credentials
==========================================
Deployment Time: $(date '+%Y-%m-%d %H:%M:%S')
Deployment Mode: Cloud-connected (Lovable Cloud)

Application URL: $SSL_URL

Lovable Cloud Backend:
---------------------
Backend URL: $SUPABASE_URL
Anon Key: $ANON_KEY
Service Role Key: [Configured for Job Executor - keep secure]

Backend Management:
------------------
Access your backend through Lovable:
1. Open your project in Lovable
2. Click the Backend button (Cloud icon)
3. Manage database, users, and settings

Services:
--------
Dell Server Manager: Running on port 3000
Job Executor: Running in background (processing iDRAC jobs)

Service Management:
------------------
Check status: systemctl status dell-server-manager
Check Job Executor: systemctl status dell-job-executor
View app logs: journalctl -u dell-server-manager -f
View Job Executor logs: tail -f /var/log/dell-job-executor.log

Authentication:
--------------
Use your Lovable account credentials to log in.

SECURITY WARNING:
----------------
- Keep this file secure - it contains sensitive information
- SERVICE_ROLE_KEY has full admin access
- Store in a safe location
- Do not commit to version control
EOF
fi

chmod 600 "$CREDS_FILE"
echo "✅ Credentials saved to: $CREDS_FILE"
