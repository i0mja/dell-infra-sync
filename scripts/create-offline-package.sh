#!/bin/bash
# Create Offline Installation Package for Dell Server Manager
# Run this on an internet-connected machine to create a bundle for air-gapped deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PACKAGE_DIR="$PROJECT_ROOT/offline-package"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PACKAGE_NAME="dell-server-manager-offline-${TIMESTAMP}"

echo "========================================="
echo "Creating Offline Installation Package"
echo "========================================="
echo ""

# Create package directory structure
echo "Creating package directory structure..."
mkdir -p "$PACKAGE_DIR/$PACKAGE_NAME"/{docker-images,npm-packages,python-packages,app,docs,scripts}

# Copy application code
echo "Copying application code..."
rsync -av --exclude='node_modules' --exclude='dist' --exclude='.git' \
  --exclude='offline-package' --exclude='supabase/.branches' \
  "$PROJECT_ROOT/" "$PACKAGE_DIR/$PACKAGE_NAME/app/"

# Download npm dependencies
echo "Downloading npm dependencies..."
cd "$PROJECT_ROOT"
npm pack --pack-destination "$PACKAGE_DIR/$PACKAGE_NAME/npm-packages/"
npm install --legacy-peer-deps
tar -czf "$PACKAGE_DIR/$PACKAGE_NAME/npm-packages/node_modules.tar.gz" node_modules/

# Download Python packages
echo "Downloading Python packages..."
pip3 download -d "$PACKAGE_DIR/$PACKAGE_NAME/python-packages/" \
  requests pyVim pyVmomi urllib3 \
  || echo "Note: Some Python packages may need to be downloaded manually"

# Save Docker images
echo "Downloading and saving Docker images..."
echo "This may take 15-30 minutes depending on your connection..."

# Pull Supabase images
docker pull supabase/postgres:15.1.0.147
docker pull supabase/gotrue:v2.143.0
docker pull supabase/realtime:v2.25.50
docker pull supabase/storage-api:v0.43.11
docker pull supabase/postgrest:v12.0.2
docker pull supabase/postgres-meta:v0.75.0
docker pull supabase/studio:20240101-5e69d88
docker pull supabase/edge-runtime:v1.22.4
docker pull kong:2.8.1
docker pull supabase/logflare:1.4.0
docker pull prom/prometheus:latest
docker pull timberio/vector:0.34.0-alpine
docker pull darthsim/imgproxy:latest

# Save images to tar files
echo "Saving Docker images to tar files..."
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-postgres.tar" supabase/postgres:15.1.0.147
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-gotrue.tar" supabase/gotrue:v2.143.0
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-realtime.tar" supabase/realtime:v2.25.50
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-storage.tar" supabase/storage-api:v0.43.11
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-postgrest.tar" supabase/postgrest:v12.0.2
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-postgres-meta.tar" supabase/postgres-meta:v0.75.0
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-studio.tar" supabase/studio:20240101-5e69d88
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-edge-runtime.tar" supabase/edge-runtime:v1.22.4
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/kong.tar" kong:2.8.1
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/supabase-logflare.tar" supabase/logflare:1.4.0
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/prometheus.tar" prom/prometheus:latest
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/vector.tar" timberio/vector:0.34.0-alpine
docker save -o "$PACKAGE_DIR/$PACKAGE_NAME/docker-images/imgproxy.tar" darthsim/imgproxy:latest

echo "Compressing Docker images..."
cd "$PACKAGE_DIR/$PACKAGE_NAME/docker-images"
tar -czf docker-images.tar.gz *.tar
rm -f *.tar

# Copy documentation
echo "Copying documentation..."
cp -r "$PROJECT_ROOT/docs" "$PACKAGE_DIR/$PACKAGE_NAME/"
cp "$PROJECT_ROOT/README.md" "$PACKAGE_DIR/$PACKAGE_NAME/"

# Create installation manifest
echo "Creating installation manifest..."
cat > "$PACKAGE_DIR/$PACKAGE_NAME/MANIFEST.txt" << EOF
Dell Server Manager - Offline Installation Package
Generated: $(date)
Version: $(git -C "$PROJECT_ROOT" describe --tags --always 2>/dev/null || echo "unknown")

Contents:
  - app/                    : Complete application source code
  - docker-images/          : Pre-downloaded Docker images for Supabase
  - npm-packages/           : Node.js dependencies
  - python-packages/        : Python dependencies for job executors
  - docs/                   : Complete documentation
  - scripts/                : Installation scripts
  - MANIFEST.txt            : This file
  - README-OFFLINE.txt      : Offline installation instructions

Docker Images Included:
  - supabase/postgres:15.1.0.147
  - supabase/gotrue:v2.143.0
  - supabase/realtime:v2.25.50
  - supabase/storage-api:v0.43.11
  - supabase/postgrest:v12.0.2
  - supabase/postgres-meta:v0.75.0
  - supabase/studio:20240101-5e69d88
  - supabase/edge-runtime:v1.22.4
  - kong:2.8.1
  - supabase/logflare:1.4.0
  - prom/prometheus:latest
  - timberio/vector:0.34.0-alpine
  - darthsim/imgproxy:latest

System Requirements:
  RHEL/CentOS/Rocky Linux 9: 4GB RAM, 50GB disk space
  Windows Server 2022: 8GB RAM, 100GB disk space

Installation:
  RHEL: sudo bash install-offline-rhel9.sh
  Windows: Run PowerShell as Administrator, then: .\install-offline-windows.ps1
EOF

# Create offline installation README
cat > "$PACKAGE_DIR/$PACKAGE_NAME/README-OFFLINE.txt" << 'EOF'
Dell Server Manager - Offline Installation
===========================================

This package contains everything needed to deploy Dell Server Manager
in a completely air-gapped environment without internet access.

PREREQUISITES
-------------
1. Target system must be RHEL 9/CentOS 9/Rocky Linux 9 OR Windows Server 2022
2. Root/Administrator access required
3. Minimum 50GB free disk space (RHEL) or 100GB (Windows)
4. Minimum 4GB RAM (RHEL) or 8GB RAM (Windows)

INSTALLATION STEPS
------------------

For RHEL/CentOS/Rocky Linux 9:
1. Transfer this entire package to the target system
2. Extract: tar -xzf dell-server-manager-offline-*.tar.gz
3. cd dell-server-manager-offline-*/
4. chmod +x install-offline-rhel9.sh
5. sudo ./install-offline-rhel9.sh

For Windows Server 2022:
1. Transfer this entire package to the target system
2. Extract the ZIP file
3. Open PowerShell as Administrator
4. cd to the extracted directory
5. Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
6. .\install-offline-windows.ps1

POST-INSTALLATION
-----------------
After installation completes, you'll receive:
- Application URL (typically http://SERVER_IP:3000)
- Supabase Studio URL (typically http://SERVER_IP:8000)
- Database credentials
- Service management commands

The system will be fully functional without any internet connectivity.

NETWORK REQUIREMENTS (Internal Only)
------------------------------------
- Application: Port 3000 (or 443 if SSL configured)
- Supabase API: Port 8000
- iDRAC connections: Port 443 (to your Dell servers)
- vCenter connections: Port 443 (to your vCenter servers)

TROUBLESHOOTING
---------------
See docs/SELF_HOSTING.md for detailed troubleshooting steps.

Health checks:
  RHEL: sudo bash app/scripts/health-check.sh
  Windows: .\app\scripts\health-check.ps1
EOF

# Create compressed archive
echo "Creating compressed archive..."
cd "$PACKAGE_DIR"
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME/"
PACKAGE_SIZE=$(du -h "${PACKAGE_NAME}.tar.gz" | cut -f1)

echo ""
echo "========================================="
echo "Offline Package Created Successfully!"
echo "========================================="
echo ""
echo "Package Location: $PACKAGE_DIR/${PACKAGE_NAME}.tar.gz"
echo "Package Size: $PACKAGE_SIZE"
echo ""
echo "Transfer this file to your air-gapped system and extract it:"
echo "  tar -xzf ${PACKAGE_NAME}.tar.gz"
echo "  cd ${PACKAGE_NAME}/"
echo "  sudo bash install-offline-rhel9.sh    (for RHEL)"
echo "  or"
echo "  .\install-offline-windows.ps1         (for Windows)"
echo ""
echo "The package contains:"
echo "  ✓ Complete application code"
echo "  ✓ All Docker images (~3-5GB)"
echo "  ✓ All npm dependencies"
echo "  ✓ All Python packages"
echo "  ✓ Installation scripts"
echo "  ✓ Complete documentation"
echo ""
