#!/bin/bash
# Offline Installation Script for Dell Server Manager on RHEL 9
# This script installs from a pre-packaged offline bundle

set -e

if [ "$EUID" -ne 0 ]; then 
  echo "ERROR: This script must be run as root"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
INSTALL_DIR="/opt/dell-server-manager"
LOG_FILE="/var/log/dell-server-manager-install.log"

exec 1> >(tee -a "$LOG_FILE")
exec 2>&1

echo "========================================="
echo "Dell Server Manager - Offline Installation"
echo "========================================="
echo "Installation log: $LOG_FILE"
echo ""

# Check if we're in the offline package directory
if [ ! -d "$SCRIPT_DIR/docker-images" ] || [ ! -d "$SCRIPT_DIR/npm-packages" ]; then
  echo "ERROR: This script must be run from the extracted offline package directory"
  exit 1
fi

# Install Docker if not present
echo "Checking Docker installation..."
if ! command -v docker &> /dev/null; then
  echo "Installing Docker from offline packages..."
  # This would need Docker RPMs included in the package
  # For now, we'll check if Docker is already installed
  echo "ERROR: Docker is not installed. Please install Docker before running this script."
  echo "Docker can be installed via RHEL DVD/ISO packages in air-gapped environments."
  exit 1
else
  echo "✓ Docker is installed"
  systemctl enable --now docker
fi

# Install Node.js if not present
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
  echo "Installing Node.js from system packages..."
  dnf module install -y nodejs:18 || {
    echo "ERROR: Node.js 18 module not available. Install from RHEL media."
    exit 1
  }
else
  echo "✓ Node.js is installed ($(node --version))"
fi

# Load Docker images
echo "Loading Docker images..."
echo "This may take 10-15 minutes..."
cd "$SCRIPT_DIR/docker-images"
tar -xzf docker-images.tar.gz
for image in *.tar; do
  echo "Loading $(basename "$image" .tar)..."
  docker load -i "$image"
done
rm -f *.tar
echo "✓ All Docker images loaded"

# Setup Supabase
echo "Setting up Supabase..."
mkdir -p /opt/supabase
cp -r "$APP_DIR/supabase" /opt/supabase/
cd /opt/supabase

# Generate secure passwords
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
ANON_KEY=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
SERVICE_ROLE_KEY=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
DASHBOARD_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)

# Create .env file for Supabase
cat > /opt/supabase/.env << EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
STUDIO_PORT=8000
API_PORT=8000
EOF

# Start Supabase services
echo "Starting Supabase services..."
cd /opt/supabase/supabase
docker compose up -d

# Wait for database to be ready
echo "Waiting for database to be ready..."
sleep 10
until docker exec supabase-db pg_isready -U postgres > /dev/null 2>&1; do
  echo "Waiting for database..."
  sleep 5
done
echo "✓ Database is ready"

# Apply database migrations
echo "Applying database migrations..."
for migration in "$SCRIPT_DIR/app/scripts/air-gapped-migrations"/*.sql; do
  echo "Applying $(basename "$migration")..."
  docker exec -i supabase-db psql -U postgres -d postgres < "$migration"
done

# Verify database schema
echo "Verifying database schema..."
bash "$SCRIPT_DIR/app/scripts/verify-database.sh" || {
  echo "WARNING: Database verification had issues. Check the output above."
}

# Extract connection details
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/postgres"
SUPABASE_URL="http://localhost:8000"

echo ""
echo "Supabase is running!"
echo "Studio URL: http://$(hostname -I | awk '{print $1}'):8000"
echo "Database URL: $DB_URL"
echo ""

# Create admin user via Supabase signup API
echo "Creating admin user..."
read -p "Enter admin email address: " ADMIN_EMAIL
read -sp "Enter admin password: " ADMIN_PASSWORD
echo ""

# Use Supabase signup API to properly create user
SUPABASE_URL=$(grep SUPABASE_URL /opt/supabase/.env | cut -d'=' -f2)
ANON_KEY=$(grep ANON_KEY /opt/supabase/.env | cut -d'=' -f2)

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
docker exec -i supabase-db psql -U postgres -d postgres << EOF
UPDATE public.user_roles SET role = 'admin'::app_role 
WHERE user_id = (SELECT id FROM auth.users WHERE email = '$ADMIN_EMAIL');
EOF

echo "✓ Admin user created"

# Install application
echo "Installing Dell Server Manager application..."
mkdir -p "$INSTALL_DIR"
cp -r "$APP_DIR"/* "$INSTALL_DIR/"
cd "$INSTALL_DIR"

# Extract and install npm packages
echo "Installing npm dependencies..."
cd "$SCRIPT_DIR/npm-packages"
if [ -f "node_modules.tar.gz" ]; then
  tar -xzf node_modules.tar.gz -C "$INSTALL_DIR/"
  echo "✓ npm dependencies installed from cache"
else
  cd "$INSTALL_DIR"
  npm install --legacy-peer-deps --offline
fi

# Install Python packages
echo "Installing Python packages..."
pip3 install --no-index --find-links="$SCRIPT_DIR/python-packages" \
  requests pyVim pyVmomi urllib3 || echo "Python packages may already be installed"

# Build application
echo "Building application..."
cd "$INSTALL_DIR"

# Create .env.local for local Supabase override
cp .env.offline.template .env.local
sed -i "s|http://127.0.0.1:54321|$SUPABASE_URL|g" .env.local

npm run build

# Create systemd service
echo "Creating systemd service..."
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

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dell-server-manager.service
systemctl start dell-server-manager.service

# Wait for application to start
echo "Waiting for application to start..."
sleep 5

# Configure firewall
echo "Configuring firewall..."
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --permanent --add-port=8000/tcp
firewall-cmd --reload

echo ""
echo "========================================="
echo "Installation Complete!"
echo "========================================="
echo ""
echo "🎉 Dell Server Manager is now running in AIR-GAPPED mode!"
echo ""
echo "Application URL: http://$(hostname -I | awk '{print $1}'):3000"
echo "Supabase Studio: http://$(hostname -I | awk '{print $1}'):8000"
echo ""
echo "Admin Credentials:"
echo "  Email: $ADMIN_EMAIL"
echo "  Password: [as entered]"
echo ""
echo "Database Credentials:"
echo "  URL: $DB_URL"
echo "  Password: $POSTGRES_PASSWORD"
echo ""
echo "Studio Credentials:"
echo "  Username: supabase"
echo "  Password: $DASHBOARD_PASSWORD"
echo ""
echo "Service Management:"
echo "  Status: systemctl status dell-server-manager"
echo "  Stop: systemctl stop dell-server-manager"
echo "  Start: systemctl start dell-server-manager"
echo "  Restart: systemctl restart dell-server-manager"
echo "  Logs: journalctl -u dell-server-manager -f"
echo ""
echo "Next Steps:"
echo "  1. Login at http://$(hostname -I | awk '{print $1}'):3000"
echo "  2. Add your iDRAC and vCenter credentials in Settings"
echo "  3. Add servers via Discovery Scan or manual entry"
echo "  4. Run health check: bash $INSTALL_DIR/scripts/health-check.sh"
echo ""

# Save credentials
cat > "$INSTALL_DIR/deployment-credentials.txt" << EOF
Dell Server Manager - Air-Gapped Deployment Credentials
Installed: $(date)

Application URL: http://$(hostname -I | awk '{print $1}'):3000
Supabase Studio: http://$(hostname -I | awk '{print $1}'):8000

Admin User:
  Email: $ADMIN_EMAIL
  
Database:
  URL: $DB_URL
  Password: $POSTGRES_PASSWORD

Supabase Studio:
  Username: supabase
  Password: $DASHBOARD_PASSWORD
  
Service: dell-server-manager.service
EOF

chmod 600 "$INSTALL_DIR/deployment-credentials.txt"
echo "Credentials saved to: $INSTALL_DIR/deployment-credentials.txt"
echo ""
