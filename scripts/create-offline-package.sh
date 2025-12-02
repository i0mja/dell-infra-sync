#!/bin/bash
# Create Offline Installation Package for Dell Server Manager
# Run this on an internet-connected machine to create a bundle for air-gapped deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PACKAGE_DIR="$PROJECT_ROOT/offline-package"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PACKAGE_NAME="dell-server-manager-offline-${TIMESTAMP}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

echo "========================================="
echo "Creating Offline Installation Package"
echo "========================================="
echo ""

# Check prerequisites
echo_step "Checking prerequisites..."

MISSING_PREREQS=0
RED='\033[0;31m'

# Check npm
if ! command -v npm &> /dev/null; then
  echo -e "${RED}[MISSING]${NC} npm is not installed"
  echo "         Install with: dnf module enable nodejs:18 && dnf install nodejs -y"
  MISSING_PREREQS=1
else
  echo_info "npm found: $(npm --version)"
fi

# Check docker
if ! command -v docker &> /dev/null; then
  echo -e "${RED}[MISSING]${NC} docker is not installed"
  echo "         Install Docker CE: https://docs.docker.com/engine/install/rhel/"
  echo "         Or quick install:"
  echo "           dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo"
  echo "           dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y"
  MISSING_PREREQS=1
elif ! docker info &> /dev/null 2>&1; then
  echo -e "${RED}[MISSING]${NC} Docker daemon is not running"
  echo "         Start with: systemctl start docker"
  echo "         Enable on boot: systemctl enable docker"
  MISSING_PREREQS=1
else
  echo_info "docker found: $(docker --version | cut -d' ' -f3 | tr -d ',')"
fi

# Check pip3
if ! command -v pip3 &> /dev/null; then
  echo -e "${RED}[MISSING]${NC} pip3 is not installed"
  echo "         Install with: dnf install python3-pip -y"
  MISSING_PREREQS=1
else
  echo_info "pip3 found: $(pip3 --version | cut -d' ' -f2)"
fi

# Check rsync
if ! command -v rsync &> /dev/null; then
  echo -e "${RED}[MISSING]${NC} rsync is not installed"
  echo "         Install with: dnf install rsync -y"
  MISSING_PREREQS=1
else
  echo_info "rsync found"
fi

# Check tar (usually always present, but verify)
if ! command -v tar &> /dev/null; then
  echo -e "${RED}[MISSING]${NC} tar is not installed"
  echo "         Install with: dnf install tar -y"
  MISSING_PREREQS=1
fi

# Exit if prerequisites missing
if [ $MISSING_PREREQS -eq 1 ]; then
  echo ""
  echo -e "${RED}=========================================${NC}"
  echo -e "${RED}   Missing Prerequisites - Cannot Continue${NC}"
  echo -e "${RED}=========================================${NC}"
  echo ""
  echo "Please install the missing tools and try again."
  echo ""
  echo "Quick install all prerequisites on RHEL 9:"
  echo "  # Enable Node.js 18"
  echo "  dnf module enable nodejs:18 -y"
  echo ""
  echo "  # Install tools"
  echo "  dnf install nodejs python3-pip rsync tar -y"
  echo ""
  echo "  # Install Docker (requires internet or offline repo)"
  echo "  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo"
  echo "  dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y"
  echo "  systemctl enable --now docker"
  echo ""
  exit 1
fi

echo ""
echo_info "All prerequisites found - continuing with package creation"
echo ""

# Create package directory structure
echo_step "Creating package directory structure..."
mkdir -p "$PACKAGE_DIR/$PACKAGE_NAME"/{docker-images,npm-packages,python-packages,app,docs}

# Copy application code
echo_step "Copying application code..."
rsync -av --exclude='node_modules' --exclude='dist' --exclude='.git' \
  --exclude='offline-package' --exclude='supabase/.branches' \
  --exclude='.env' --exclude='.env.local' \
  "$PROJECT_ROOT/" "$PACKAGE_DIR/$PACKAGE_NAME/app/"

# Download npm dependencies
echo_step "Downloading npm dependencies..."
cd "$PROJECT_ROOT"
npm install --legacy-peer-deps
echo_info "Packaging node_modules..."
tar -czf "$PACKAGE_DIR/$PACKAGE_NAME/npm-packages/node_modules.tar.gz" node_modules/

# Download Python packages
echo_step "Downloading Python packages..."
pip3 download -d "$PACKAGE_DIR/$PACKAGE_NAME/python-packages/" \
  requests pyVim pyVmomi urllib3 supabase \
  2>/dev/null || echo_warn "Some Python packages may need manual download"

# Define Docker images - updated to latest stable versions
echo_step "Pulling Docker images (this may take 15-30 minutes)..."

DOCKER_IMAGES=(
  "supabase/postgres:15.6.1.143"
  "supabase/gotrue:v2.167.0"
  "supabase/realtime:v2.30.34"
  "supabase/storage-api:v1.11.13"
  "postgrest/postgrest:v12.2.3"
  "supabase/postgres-meta:v0.84.2"
  "supabase/studio:20241202-60d42ab"
  "supabase/edge-runtime:v1.64.1"
  "kong:2.8.1"
  "supabase/logflare:1.4.0"
  "darthsim/imgproxy:v3.8.0"
)

for image in "${DOCKER_IMAGES[@]}"; do
  echo "  Pulling $image..."
  docker pull "$image" || echo_warn "Failed to pull $image"
done

# Save images to tar files
echo_step "Saving Docker images to tar files..."
cd "$PACKAGE_DIR/$PACKAGE_NAME/docker-images"

declare -A IMAGE_NAMES=(
  ["supabase/postgres:15.6.1.143"]="supabase-postgres"
  ["supabase/gotrue:v2.167.0"]="supabase-gotrue"
  ["supabase/realtime:v2.30.34"]="supabase-realtime"
  ["supabase/storage-api:v1.11.13"]="supabase-storage"
  ["postgrest/postgrest:v12.2.3"]="postgrest"
  ["supabase/postgres-meta:v0.84.2"]="supabase-postgres-meta"
  ["supabase/studio:20241202-60d42ab"]="supabase-studio"
  ["supabase/edge-runtime:v1.64.1"]="supabase-edge-runtime"
  ["kong:2.8.1"]="kong"
  ["supabase/logflare:1.4.0"]="supabase-logflare"
  ["darthsim/imgproxy:v3.8.0"]="imgproxy"
)

for image in "${DOCKER_IMAGES[@]}"; do
  name="${IMAGE_NAMES[$image]}"
  echo "  Saving $name..."
  docker save -o "${name}.tar" "$image" 2>/dev/null || echo_warn "Failed to save $image"
done

echo_info "Compressing Docker images..."
tar -czf docker-images.tar.gz *.tar
rm -f *.tar

# Copy documentation
echo_step "Copying documentation..."
cp -r "$PROJECT_ROOT/docs" "$PACKAGE_DIR/$PACKAGE_NAME/"
cp "$PROJECT_ROOT/README.md" "$PACKAGE_DIR/$PACKAGE_NAME/"

# Copy installation script to root of package
cp "$PROJECT_ROOT/scripts/install-offline-rhel9.sh" "$PACKAGE_DIR/$PACKAGE_NAME/"
chmod +x "$PACKAGE_DIR/$PACKAGE_NAME/install-offline-rhel9.sh"

# Create installation manifest
echo_step "Creating installation manifest..."
cat > "$PACKAGE_DIR/$PACKAGE_NAME/MANIFEST.txt" << EOF
Dell Server Manager - Offline Installation Package
===================================================
Generated: $(date)
Version: $(git -C "$PROJECT_ROOT" describe --tags --always 2>/dev/null || echo "dev")

Contents:
  app/                    : Complete application source code
  docker-images/          : Pre-downloaded Docker images for Supabase
  npm-packages/           : Node.js dependencies (node_modules.tar.gz)
  python-packages/        : Python dependencies for job executor
  docs/                   : Complete documentation
  install-offline-rhel9.sh: Installation script for RHEL 9
  MANIFEST.txt            : This file
  README-OFFLINE.txt      : Offline installation instructions

Docker Images Included:
  supabase/postgres:15.6.1.143      - PostgreSQL database
  supabase/gotrue:v2.167.0          - Authentication service
  supabase/realtime:v2.30.34        - Realtime subscriptions
  supabase/storage-api:v1.11.13     - File storage API
  postgrest/postgrest:v12.2.3       - REST API for PostgreSQL
  supabase/postgres-meta:v0.84.2    - Database management API
  supabase/studio:20241202-60d42ab  - Admin dashboard
  supabase/edge-runtime:v1.64.1     - Edge functions runtime
  kong:2.8.1                        - API gateway
  supabase/logflare:1.4.0           - Analytics/logging
  darthsim/imgproxy:v3.8.0          - Image processing

System Requirements:
  OS: RHEL 9 / Rocky Linux 9 / AlmaLinux 9
  RAM: 8GB minimum (16GB recommended)
  Disk: 50GB minimum
  Docker: Must be pre-installed
  
Network Requirements (Internal Only):
  Port 3000: Dell Server Manager web UI
  Port 3100: Supabase Studio (admin)
  Port 8000: Supabase API
  Port 5432: PostgreSQL (optional external access)

Installation:
  1. Transfer package to air-gapped system
  2. Extract: tar -xzf dell-server-manager-offline-*.tar.gz
  3. cd dell-server-manager-offline-*/
  4. sudo ./install-offline-rhel9.sh
EOF

# Create README
cat > "$PACKAGE_DIR/$PACKAGE_NAME/README-OFFLINE.txt" << 'EOF'
Dell Server Manager - Offline Installation Guide
=================================================

This package contains everything needed to deploy Dell Server Manager
in a completely air-gapped environment without internet access.

PREREQUISITES
-------------
Before installation, ensure the target system has:

1. Operating System: RHEL 9, Rocky Linux 9, or AlmaLinux 9
2. Docker: Pre-installed and running
   - For RHEL 9: dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin
   - Or use Podman with docker compatibility: dnf install podman-docker
3. Root/sudo access
4. Minimum 8GB RAM (16GB recommended for production)
5. Minimum 50GB free disk space

QUICK INSTALLATION
------------------
1. Transfer this package to the target system
2. Extract: tar -xzf dell-server-manager-offline-*.tar.gz
3. cd dell-server-manager-offline-*/
4. sudo ./install-offline-rhel9.sh
5. Follow the prompts to create admin user

The script will:
- Load all Docker images
- Start Supabase services
- Apply database migrations
- Build and configure the application
- Create systemd services
- Configure firewall rules

POST-INSTALLATION
-----------------
After installation:
- Application URL: http://SERVER_IP:3000
- Supabase Studio: http://SERVER_IP:3100
- Credentials saved to: /opt/dell-server-manager/deployment-credentials.txt

SERVICE MANAGEMENT
------------------
# Check application status
systemctl status dell-server-manager

# Check job executor status  
systemctl status dell-job-executor

# View application logs
journalctl -u dell-server-manager -f

# Restart application
systemctl restart dell-server-manager

# Check Supabase services
cd /opt/supabase && docker compose ps

TROUBLESHOOTING
---------------
1. If Docker images fail to load:
   - Check disk space: df -h
   - Check Docker status: systemctl status docker

2. If database won't start:
   - Check logs: docker logs supabase-db
   - Ensure port 5432 is free: ss -tlnp | grep 5432

3. If application won't build:
   - Check Node.js: node --version (should be 18+)
   - Check npm cache: npm cache clean --force

4. For detailed troubleshooting:
   See docs/SELF_HOSTING.md in this package

NETWORK REQUIREMENTS
--------------------
This installation requires NO internet access.
Internal network access needed for:
- iDRAC connections (port 443 to Dell servers)
- vCenter connections (port 443 to vCenter servers)
- Client browsers (port 3000 to this server)

SECURITY NOTES
--------------
- Change default passwords in /opt/supabase/.env
- Restrict access to /opt/dell-server-manager/deployment-credentials.txt
- Consider enabling HTTPS with a reverse proxy (nginx/apache)
- The JWT tokens included are demo tokens safe for air-gapped use
EOF

# Create the archive
echo_step "Creating compressed archive..."
cd "$PACKAGE_DIR"
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME/"
PACKAGE_SIZE=$(du -h "${PACKAGE_NAME}.tar.gz" | cut -f1)

# Cleanup
rm -rf "$PACKAGE_DIR/$PACKAGE_NAME"

echo ""
echo "========================================="
echo "Offline Package Created Successfully!"
echo "========================================="
echo ""
echo "Package: $PACKAGE_DIR/${PACKAGE_NAME}.tar.gz"
echo "Size: $PACKAGE_SIZE"
echo ""
echo "To deploy on air-gapped RHEL 9 system:"
echo "  1. Transfer ${PACKAGE_NAME}.tar.gz to target system"
echo "  2. tar -xzf ${PACKAGE_NAME}.tar.gz"
echo "  3. cd ${PACKAGE_NAME}/"
echo "  4. sudo ./install-offline-rhel9.sh"
echo ""
echo "Package contents:"
echo "  ✓ Complete application code"
echo "  ✓ Supabase Docker images (~4GB)"
echo "  ✓ npm dependencies"
echo "  ✓ Python packages"
echo "  ✓ Docker Compose configuration"
echo "  ✓ Installation scripts"
echo "  ✓ Documentation"
echo ""
