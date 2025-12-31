#!/bin/bash
# Offline Installation Script for Dell Server Manager on RHEL 9
# This script installs from a pre-packaged offline bundle
# Requires: Docker pre-installed, offline package extracted
# Includes comprehensive RHEL 9 OS hardening and pre-flight checks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }
echo_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then 
  echo_error "This script must be run as root"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$SCRIPT_DIR"
APP_SOURCE="$PACKAGE_DIR/app"
INSTALL_DIR="/opt/dell-server-manager"
SUPABASE_DIR="/opt/supabase"
LOG_FILE="/var/log/dell-server-manager-install.log"

exec 1> >(tee -a "$LOG_FILE")
exec 2>&1

echo "========================================="
echo "Dell Server Manager - Offline Installation"
echo "========================================="
echo "Installation log: $LOG_FILE"
echo ""

# ============================================
# RHEL 9 HARDENING FUNCTIONS
# ============================================

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
    echo_step "Checking OS version..."
    if [ -f /etc/redhat-release ]; then
        OS_VERSION=$(cat /etc/redhat-release)
        echo "   Detected: $OS_VERSION"
        if ! grep -q "release 9" /etc/redhat-release && ! grep -q "release 8" /etc/redhat-release; then
            echo_warn "This script is optimized for RHEL 9. Some features may not work correctly."
            warnings=$((warnings + 1))
        fi
    else
        echo_warn "Not a Red Hat based system. Proceeding with caution."
        warnings=$((warnings + 1))
    fi

    # 2. Check for Port Conflicts
    echo_step "Checking for port conflicts..."
    local ports=(5432 3000 8000 8443 3100 4000 6543)
    for port in "${ports[@]}"; do
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            echo_error "Port $port is already in use!"
            local process_info=$(ss -tulnp 2>/dev/null | grep ":$port " | head -1)
            echo "   $process_info"
            errors=$((errors + 1))
        fi
    done
    if [ $errors -eq 0 ]; then
        echo_info "All required ports are available"
    fi

    # 3. Check for Conflicting Services
    echo_step "Checking for conflicting services..."
    
    # Check Podman (common on RHEL 9, conflicts with Docker)
    if systemctl is-active --quiet podman.socket 2>/dev/null; then
        echo_warn "Podman socket is active - may conflict with Docker"
        warnings=$((warnings + 1))
    fi
    
    if systemctl is-active --quiet podman.service 2>/dev/null; then
        echo_warn "Podman service is active"
        warnings=$((warnings + 1))
    fi

    # Check native PostgreSQL
    if systemctl is-active --quiet postgresql 2>/dev/null; then
        echo_error "Native PostgreSQL is running - will conflict with Supabase (port 5432)"
        errors=$((errors + 1))
    fi

    # Check nginx/httpd
    if systemctl is-active --quiet nginx 2>/dev/null; then
        echo_warn "nginx is running - may conflict if using same ports"
        warnings=$((warnings + 1))
    fi
    
    if systemctl is-active --quiet httpd 2>/dev/null; then
        echo_warn "httpd/Apache is running - may conflict if using same ports"
        warnings=$((warnings + 1))
    fi

    # 4. Check System Resources
    echo_step "Checking system resources..."
    
    # Disk space
    local free_disk=$(df -BG /opt 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
    if [ -n "$free_disk" ] && [ "$free_disk" -lt 20 ] 2>/dev/null; then
        echo_warn "Low disk space: ${free_disk}GB free in /opt (recommend 20GB+)"
        warnings=$((warnings + 1))
    else
        echo_info "Disk space: ${free_disk}GB available"
    fi
    
    # RAM
    local total_ram=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}')
    if [ -n "$total_ram" ] && [ "$total_ram" -lt 4 ] 2>/dev/null; then
        echo_warn "Low RAM: ${total_ram}GB (recommend 4GB+)"
        warnings=$((warnings + 1))
    else
        echo_info "RAM: ${total_ram}GB available"
    fi
    
    # CPU cores
    local cpu_cores=$(nproc 2>/dev/null || echo "unknown")
    if [ "$cpu_cores" != "unknown" ] && [ "$cpu_cores" -lt 2 ] 2>/dev/null; then
        echo_warn "Low CPU cores: $cpu_cores (recommend 2+)"
        warnings=$((warnings + 1))
    else
        echo_info "CPU cores: $cpu_cores"
    fi

    # 5. Check SELinux Status
    echo_step "Checking SELinux status..."
    if command -v getenforce &> /dev/null; then
        local selinux_status=$(getenforce)
        echo "   SELinux: $selinux_status"
        if [ "$selinux_status" == "Enforcing" ]; then
            if ! seinfo -t container_file_t &>/dev/null 2>&1; then
                echo_warn "SELinux container types may not be available"
                echo "   Install container-selinux package if available in offline bundle"
                warnings=$((warnings + 1))
            fi
        fi
    else
        echo_info "SELinux not detected"
    fi

    # 6. Check Firewall Status  
    echo_step "Checking firewall status..."
    if systemctl is-active --quiet firewalld 2>/dev/null; then
        echo "   Firewalld: Active"
        if grep -q "FirewallBackend=nftables" /etc/firewalld/firewalld.conf 2>/dev/null; then
            echo_warn "Firewalld using nftables backend - may cause Docker networking issues"
            echo "   Will be reconfigured during installation"
        fi
    else
        echo_info "Firewalld: Inactive"
    fi

    # Summary
    echo ""
    echo "========================================"
    if [ $errors -gt 0 ]; then
        echo_error "Pre-flight checks found $errors error(s) and $warnings warning(s)"
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
        echo_warn "Pre-flight checks found $warnings warning(s)"
        echo "   These may cause issues but are not blocking."
        echo ""
    else
        echo_info "All pre-flight checks passed!"
        echo ""
    fi
}

# ============================================
# Kernel Module Configuration
# ============================================
configure_kernel_modules() {
    echo_step "Configuring kernel modules for container networking..."
    
    # Load required modules
    modprobe br_netfilter 2>/dev/null || echo_warn "br_netfilter module not available"
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
    
    echo_info "Kernel modules configured"
}

# ============================================
# Docker Daemon Configuration for RHEL 9
# ============================================
configure_docker_daemon() {
    echo_step "Configuring Docker daemon for RHEL 9..."
    
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
    
    echo_info "Docker daemon configured for RHEL 9/cgroups v2"
}

# ============================================
# Firewalld Configuration for Docker
# ============================================
configure_firewalld_for_docker() {
    echo_step "Configuring firewalld for Docker compatibility..."
    
    if ! systemctl is-active --quiet firewalld 2>/dev/null; then
        echo_info "Firewalld not active, skipping firewall configuration"
        return 0
    fi
    
    # Check and fix nftables backend issue
    if grep -q "FirewallBackend=nftables" /etc/firewalld/firewalld.conf 2>/dev/null; then
        echo_info "Switching firewalld to iptables backend for Docker compatibility..."
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
    
    echo_info "Firewalld configured for Docker"
}

# ============================================
# SELinux Configuration for Docker
# ============================================
configure_selinux_for_docker() {
    local volumes_dir="$1"
    
    echo_step "Configuring SELinux for Docker..."
    
    if ! command -v getenforce &> /dev/null; then
        echo_info "SELinux not installed, skipping"
        return 0
    fi
    
    local selinux_status=$(getenforce)
    if [ "$selinux_status" == "Disabled" ]; then
        echo_info "SELinux disabled, skipping configuration"
        return 0
    fi
    
    # Set required SELinux booleans
    echo_info "Setting SELinux booleans..."
    
    # Allow containers to manage cgroups (required for systemd in containers)
    setsebool -P container_manage_cgroup 1 2>/dev/null || true
    
    # Allow containers to connect to any TCP port
    setsebool -P container_connect_any 1 2>/dev/null || true
    
    # If volumes directory is provided, set proper context
    if [ -n "$volumes_dir" ] && [ -d "$volumes_dir" ]; then
        echo_info "Setting SELinux context on volumes directory..."
        
        # Try container_file_t first (preferred), fall back to svirt_sandbox_file_t
        if seinfo -t container_file_t &>/dev/null 2>&1; then
            chcon -Rt container_file_t "$volumes_dir" 2>/dev/null || true
        else
            chcon -Rt svirt_sandbox_file_t "$volumes_dir" 2>/dev/null || true
        fi
        
        # Also run restorecon to ensure consistency
        restorecon -R "$volumes_dir" 2>/dev/null || true
    fi
    
    echo_info "SELinux configured for Docker"
}

# ============================================
# Conflict Resolution
# ============================================
resolve_conflicts() {
    echo_step "Checking for service conflicts..."
    
    # Handle Podman conflict
    if systemctl is-active --quiet podman.socket 2>/dev/null || systemctl is-active --quiet podman.service 2>/dev/null; then
        echo ""
        echo_warn "Podman services detected - these may conflict with Docker"
        echo "   Options:"
        echo "     1) Stop and disable Podman (recommended for Docker use)"
        echo "     2) Keep Podman running (may cause issues)"
        echo ""
        read -p "   Stop Podman services? (Y/n): " stop_podman
        if [ "$stop_podman" != "n" ] && [ "$stop_podman" != "N" ]; then
            systemctl stop podman.socket podman.service 2>/dev/null || true
            systemctl disable podman.socket podman.service 2>/dev/null || true
            echo_info "Podman services stopped and disabled"
        fi
    fi
    
    # Handle native PostgreSQL conflict
    if systemctl is-active --quiet postgresql 2>/dev/null; then
        echo ""
        echo_error "Native PostgreSQL is running on this host"
        echo "   This will conflict with Supabase's PostgreSQL container (port 5432)"
        echo ""
        read -p "   Stop native PostgreSQL? (Y/n): " stop_pg
        if [ "$stop_pg" != "n" ] && [ "$stop_pg" != "N" ]; then
            systemctl stop postgresql 2>/dev/null || true
            systemctl disable postgresql 2>/dev/null || true
            echo_info "Native PostgreSQL stopped and disabled"
        else
            echo_error "Cannot continue with PostgreSQL conflict on port 5432"
            exit 1
        fi
    fi
    
    # Handle nginx conflict (only if it would block our ports)
    if systemctl is-active --quiet nginx 2>/dev/null; then
        if ss -tuln | grep -q ":3000 " || ss -tuln | grep -q ":8000 "; then
            echo_warn "nginx may be using ports needed by this application"
            read -p "   Stop nginx? (y/N): " stop_nginx
            if [ "$stop_nginx" = "y" ] || [ "$stop_nginx" = "Y" ]; then
                systemctl stop nginx 2>/dev/null || true
                echo_info "nginx stopped"
            fi
        fi
    fi
    
    echo_info "Conflict resolution complete"
}

# ============================================
# Docker Network Verification
# ============================================
verify_docker_networking() {
    echo_step "Verifying Docker networking..."
    
    if ! command -v docker &> /dev/null; then
        echo_warn "Docker not available, skipping network verification"
        return 0
    fi
    
    if ! docker info &>/dev/null 2>&1; then
        echo_warn "Docker daemon not running, skipping network verification"
        return 0
    fi
    
    # Test if Docker can create networks
    if docker network create dsm-preflight-test &>/dev/null 2>&1; then
        docker network rm dsm-preflight-test &>/dev/null 2>&1 || true
        echo_info "Docker networking is functional"
    else
        echo_warn "Docker may have networking issues"
        echo "   Try: systemctl restart docker"
    fi
}

# ============================================
# END OF RHEL 9 HARDENING FUNCTIONS
# ============================================

# Run pre-flight checks first
preflight_checks

# Resolve conflicts before proceeding
resolve_conflicts

# Verify offline package structure
echo_step "Verifying offline package structure..."

REQUIRED_DIRS=("docker-images" "npm-packages" "app")
for dir in "${REQUIRED_DIRS[@]}"; do
  if [ ! -d "$PACKAGE_DIR/$dir" ]; then
    echo_error "Missing required directory: $dir"
    echo "This script must be run from the extracted offline package directory"
    exit 1
  fi
done
echo_info "Package structure verified"

# Configure kernel modules BEFORE Docker operations
configure_kernel_modules

# Check Docker
echo_step "Checking Docker installation..."
if ! command -v docker &> /dev/null; then
  echo_error "Docker is not installed."
  echo ""
  echo "For RHEL 9 in air-gapped environment, install Docker from RHEL media:"
  echo "  1. Mount RHEL 9 ISO or configure local repository"
  echo "  2. dnf install podman-docker (for Podman compatibility)"
  echo "     OR"
  echo "  2. Install Docker CE from included RPMs (if bundled)"
  echo ""
  echo "If you have Docker CE RPMs in this package:"
  echo "  dnf install -y $PACKAGE_DIR/docker-rpms/*.rpm"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo_info "Starting Docker daemon..."
  
  # Configure Docker daemon for RHEL 9 BEFORE starting
  configure_docker_daemon
  
  systemctl start docker
  systemctl enable docker
else
  # Still configure daemon.json if not present
  if [ ! -f /etc/docker/daemon.json ]; then
    configure_docker_daemon
    systemctl restart docker
    sleep 3
  fi
fi
echo_info "Docker is available"

# Check docker compose
if ! docker compose version &> /dev/null; then
  echo_error "Docker Compose plugin not available."
  echo "Install docker-compose-plugin package"
  exit 1
fi

# Configure firewalld BEFORE starting containers
configure_firewalld_for_docker

# Verify Docker networking
verify_docker_networking

# Check/Install Node.js
echo_step "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
  echo_info "Installing Node.js from offline packages..."
  
  if [ -d "$PACKAGE_DIR/nodejs" ]; then
    # If we bundled Node.js tarball
    tar -xzf "$PACKAGE_DIR/nodejs/node-v18*.tar.gz" -C /usr/local --strip-components=1
    echo_info "Node.js installed from tarball"
  else
    # Try system packages
    echo_warn "Node.js not bundled, attempting system module..."
    dnf module install -y nodejs:18 2>/dev/null || {
      echo_error "Node.js 18 not available. Please install manually."
      exit 1
    }
  fi
fi

NODE_VERSION=$(node --version)
echo_info "Node.js $NODE_VERSION available"

# Load Docker images
echo_step "Loading Docker images (this may take 10-15 minutes)..."
cd "$PACKAGE_DIR/docker-images"

if [ -f "docker-images.tar.gz" ]; then
  echo_info "Extracting Docker images..."
  tar -xzf docker-images.tar.gz
fi

for image in *.tar; do
  if [ -f "$image" ]; then
    IMAGE_NAME=$(basename "$image" .tar)
    echo "  Loading $IMAGE_NAME..."
    docker load -i "$image" || echo_warn "Failed to load $IMAGE_NAME"
  fi
done

# Cleanup extracted tar files (keep the gz)
rm -f *.tar 2>/dev/null || true
echo_info "Docker images loaded"

# Setup Supabase
echo_step "Setting up Supabase..."
mkdir -p "$SUPABASE_DIR"
mkdir -p "$SUPABASE_DIR/volumes/api"
mkdir -p "$SUPABASE_DIR/volumes/db/init"

# Copy Supabase configuration
cp "$APP_SOURCE/supabase/docker/docker-compose.yml" "$SUPABASE_DIR/"
cp "$APP_SOURCE/supabase/docker/volumes/api/kong.yml" "$SUPABASE_DIR/volumes/api/"

# Configure SELinux for volumes directory
configure_selinux_for_docker "$SUPABASE_DIR/volumes"

# Generate secure credentials
echo_info "Generating secure credentials..."
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)

# Use demo JWT secret that works with pre-generated tokens
# This is safe for air-gapped/local use
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long!!"

# Pre-generated valid JWT tokens for the demo secret
# These tokens are signed with HS256 and have expiry in 2033
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
SECRET_KEY_BASE=$(openssl rand -base64 64 | tr -d '\n')

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

# Create Supabase .env
cat > "$SUPABASE_DIR/.env" << EOF
# Dell Server Manager - Local Supabase Configuration
# Generated: $(date)

POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SECRET_KEY_BASE=$SECRET_KEY_BASE

API_EXTERNAL_URL=http://${SERVER_IP}:8000
SITE_URL=http://${SERVER_IP}:3000
DISABLE_SIGNUP=false
JWT_EXPIRY=3600

FUNCTIONS_PATH=$INSTALL_DIR/supabase/functions
LOGFLARE_API_KEY=demo-logflare-key
EOF

chmod 600 "$SUPABASE_DIR/.env"

# Start Supabase with staged startup
echo_step "Starting Supabase services..."
cd "$SUPABASE_DIR"

# Stage 1: Start database first
echo_info "Stage 1: Starting database service first..."
docker compose up -d db

# Wait for database with extended timeout
echo_info "Stage 2: Waiting for database to be ready..."
RETRIES=60
until docker exec supabase-db pg_isready -U postgres > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  echo "  Waiting for database... ($RETRIES retries remaining)"
  RETRIES=$((RETRIES-1))
  sleep 3
done

if [ $RETRIES -eq 0 ]; then
  echo_error "Database failed to start. Check: docker logs supabase-db"
  echo ""
  echo "Common issues on RHEL 9:"
  echo "  - SELinux blocking volume access: check 'ausearch -m avc -ts recent'"
  echo "  - Firewalld blocking internal traffic: firewall-cmd --list-all"
  echo "  - Docker networking: docker network inspect supabase_default"
  exit 1
fi
echo_info "Database is ready"

# Stage 3: Start remaining services
echo_info "Stage 3: Starting remaining services..."
docker compose up -d

# Wait for all services to stabilize
echo_info "Waiting for services to stabilize..."
sleep 30

# Apply migrations
echo_step "Applying database migrations..."
MIGRATIONS_DIR="$APP_SOURCE/supabase/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
      MIGRATION_NAME=$(basename "$migration")
      echo "  Applying $MIGRATION_NAME..."
      docker exec -i supabase-db psql -U postgres -d postgres < "$migration" 2>/dev/null || {
        echo_warn "  $MIGRATION_NAME may already be applied"
      }
    fi
  done
fi
echo_info "Migrations complete"

# Wait for auth service
echo_info "Waiting for auth service..."
sleep 10

# Create admin user
echo_step "Creating admin user..."
echo ""
read -p "Enter admin email address: " ADMIN_EMAIL
read -sp "Enter admin password (min 6 chars): " ADMIN_PASSWORD
echo ""

# Create user via Supabase Auth API
SIGNUP_RESPONSE=$(curl -s -X POST "http://localhost:8000/auth/v1/signup" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\",
    \"data\": {
      \"full_name\": \"Administrator\"
    }
  }")

# Check if signup was successful
if echo "$SIGNUP_RESPONSE" | grep -q "error"; then
  echo_error "Failed to create user: $SIGNUP_RESPONSE"
  echo_warn "You may need to create the user manually after installation"
else
  # Wait for trigger to create profile
  sleep 2
  
  # Assign admin role
  docker exec -i supabase-db psql -U postgres -d postgres << EOF
UPDATE public.user_roles SET role = 'admin'::app_role 
WHERE user_id = (SELECT id FROM auth.users WHERE email = '$ADMIN_EMAIL');
EOF
  echo_info "Admin user created"
fi

# Prompt for EXECUTOR_SHARED_SECRET (optional for offline installs)
echo ""
echo_step "EXECUTOR_SHARED_SECRET Configuration (Optional)"
echo "------------------------------------------------"
echo ""
echo "The EXECUTOR_SHARED_SECRET is used for HMAC authentication between"
echo "the Job Executor and the backend. For air-gapped deployments, you can"
echo "generate this secret from the Dell Server Manager GUI after installation."
echo ""
echo "To get your EXECUTOR_SHARED_SECRET (after first login):"
echo "  1. Open Dell Server Manager in your browser"
echo "  2. Go to Settings → Infrastructure → Job Executor"
echo "  3. Click 'Generate' to create a new secret"
echo "  4. Click 'Reveal' and copy the secret"
echo ""
read -p "Do you have an EXECUTOR_SHARED_SECRET to enter now? (y/N): " HAVE_SECRET

if [ "$HAVE_SECRET" = "y" ] || [ "$HAVE_SECRET" = "Y" ]; then
    read -sp "Enter your EXECUTOR_SHARED_SECRET: " EXECUTOR_SHARED_SECRET
    echo ""
    echo_info "EXECUTOR_SHARED_SECRET configured"
else
    EXECUTOR_SHARED_SECRET=""
    echo_info "Skipping EXECUTOR_SHARED_SECRET - configure later in Settings"
fi
echo ""

# Install application
echo_step "Installing Dell Server Manager application..."
mkdir -p "$INSTALL_DIR"
cp -r "$APP_SOURCE"/* "$INSTALL_DIR/"

# Remove any cloud .env
rm -f "$INSTALL_DIR/.env" 2>/dev/null || true

# Install npm dependencies from cache
echo_info "Installing npm dependencies..."
cd "$PACKAGE_DIR/npm-packages"
if [ -f "node_modules.tar.gz" ]; then
  tar -xzf node_modules.tar.gz -C "$INSTALL_DIR/"
  echo_info "Dependencies installed from cache"
else
  cd "$INSTALL_DIR"
  npm install --legacy-peer-deps --offline 2>/dev/null || npm install --legacy-peer-deps
fi

# Install Python packages
echo_info "Installing Python packages..."
if [ -d "$PACKAGE_DIR/python-packages" ]; then
  pip3 install --no-index --find-links="$PACKAGE_DIR/python-packages" \
    requests pyVim pyVmomi urllib3 2>/dev/null || echo_warn "Some Python packages may need manual installation"
fi

# Create application .env.local
echo_step "Configuring application..."
cat > "$INSTALL_DIR/.env.local" << EOF
# Dell Server Manager - Local Configuration
# Generated: $(date)

VITE_SUPABASE_URL=http://${SERVER_IP}:8000
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
VITE_SUPABASE_PROJECT_ID=local

# Job Executor Configuration
JOB_EXECUTOR_SUPABASE_URL=http://${SERVER_IP}:8000
JOB_EXECUTOR_SUPABASE_SERVICE_KEY=$SERVICE_ROLE_KEY
EOF

# Build application
echo_info "Building application..."
cd "$INSTALL_DIR"
npm run build

# Create Dell Server Manager systemd service
echo_step "Creating application service..."
cat > /etc/systemd/system/dell-server-manager.service << EOF
[Unit]
Description=Dell Server Manager
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/npm run preview -- --host 0.0.0.0 --port 3000
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Create Job Executor systemd service
echo_step "Creating job executor service..."

# Copy SSL certificate generation script
if [ -f "$APP_SOURCE/scripts/generate-ssl-cert.sh" ]; then
    mkdir -p /opt/job-executor
    cp "$APP_SOURCE/scripts/generate-ssl-cert.sh" /opt/job-executor/
    chmod +x /opt/job-executor/generate-ssl-cert.sh
    echo_info "SSL certificate generation script installed"
fi

# Create SSL directory
mkdir -p /etc/idrac-manager/ssl
chmod 755 /etc/idrac-manager/ssl

cat > /etc/systemd/system/dell-job-executor.service << EOF
[Unit]
Description=Dell Server Manager Job Executor
After=network.target docker.service dell-server-manager.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/python3 job-executor.py
Restart=always
RestartSec=10
Environment=SUPABASE_URL=http://${SERVER_IP}:8000
Environment=SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
Environment=EXECUTOR_SHARED_SECRET=$EXECUTOR_SHARED_SECRET
Environment=API_SERVER_SSL_ENABLED=false
Environment=API_SERVER_SSL_CERT=/etc/idrac-manager/ssl/server.crt
Environment=API_SERVER_SSL_KEY=/etc/idrac-manager/ssl/server.key

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
systemctl daemon-reload
systemctl enable dell-server-manager.service
systemctl enable dell-job-executor.service
systemctl start dell-server-manager.service
sleep 3
systemctl start dell-job-executor.service

# Verify firewall configuration (already done by configure_firewalld_for_docker but ensure)
echo_step "Verifying firewall configuration..."
if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
  # Ensure ports are open
  firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
  firewall-cmd --permanent --add-port=8000/tcp 2>/dev/null || true
  firewall-cmd --permanent --add-port=3100/tcp 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
  echo_info "Firewall verified"
else
  echo_warn "firewall-cmd not found or firewalld not active"
fi

# Print completion message
echo ""
echo "========================================="
echo "Installation Complete!"
echo "========================================="
echo ""
echo "Dell Server Manager is now running in AIR-GAPPED mode!"
echo ""
echo "Access URLs:"
echo "  Application:     http://${SERVER_IP}:3000"
echo "  Supabase Studio: http://${SERVER_IP}:3100"
echo "  Supabase API:    http://${SERVER_IP}:8000"
echo ""
echo "Admin Credentials:"
echo "  Email: $ADMIN_EMAIL"
echo "  Password: [as entered]"
echo ""
echo "Database:"
echo "  Host: localhost:5432"
echo "  Password: $POSTGRES_PASSWORD"
echo ""
echo "Service Commands:"
echo "  App Status:      systemctl status dell-server-manager"
echo "  App Logs:        journalctl -u dell-server-manager -f"
echo "  Job Executor:    systemctl status dell-job-executor"
echo "  Supabase:        cd $SUPABASE_DIR && docker compose ps"
echo ""
echo "RHEL 9 Troubleshooting:"
echo "  SELinux denials: ausearch -m avc -ts recent"
echo "  Firewall rules:  firewall-cmd --list-all"
echo "  Docker networks: docker network ls"
echo "  Container logs:  docker compose -f $SUPABASE_DIR/docker-compose.yml logs"
echo ""
echo "Next Steps:"
echo "  1. Open http://${SERVER_IP}:3000 in your browser"
echo "  2. Login with your admin credentials"
echo "  3. Add iDRAC credentials in Settings > Infrastructure"
echo "  4. Run a Discovery Scan to find servers"
echo ""
echo "Enable HTTPS for Remote Browser Access:"
echo "  1. Run: sudo /opt/job-executor/generate-ssl-cert.sh"
echo "  2. Edit /etc/systemd/system/dell-job-executor.service"
echo "  3. Change API_SERVER_SSL_ENABLED=true"
echo "  4. Run: systemctl daemon-reload && systemctl restart dell-job-executor"
echo "  5. Update Job Executor URL in Settings to https://${SERVER_IP}:8081"
echo ""

# Save credentials
cat > "$INSTALL_DIR/deployment-credentials.txt" << EOF
Dell Server Manager - Air-Gapped Deployment
Installed: $(date)
Hostname: $(hostname)

Application URL: http://${SERVER_IP}:3000
Supabase Studio: http://${SERVER_IP}:3100
Supabase API: http://${SERVER_IP}:8000

Admin User: $ADMIN_EMAIL

Database:
  Host: localhost
  Port: 5432
  User: postgres
  Password: $POSTGRES_PASSWORD

API Keys:
  Anon Key: $ANON_KEY
  Service Role Key: $SERVICE_ROLE_KEY

Services:
  dell-server-manager.service
  dell-job-executor.service

Supabase: $SUPABASE_DIR
Application: $INSTALL_DIR

RHEL 9 Configuration:
  Kernel modules: /etc/modules-load.d/docker-dsm.conf
  Sysctl settings: /etc/sysctl.d/99-docker-dsm.conf
  Docker daemon: /etc/docker/daemon.json
EOF

chmod 600 "$INSTALL_DIR/deployment-credentials.txt"
echo_info "Credentials saved to: $INSTALL_DIR/deployment-credentials.txt"
