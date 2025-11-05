#!/bin/bash
# Dell Server Manager - RHEL 9 Deployment Script
# Automates complete self-hosted setup on RHEL 9

set -e

echo "🚀 Dell Server Manager - RHEL 9 Self-Hosted Deployment"
echo "========================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "❌ Please run as root (sudo ./deploy-rhel9.sh)"
   exit 1
fi

# Step 1: Install Docker
echo "📦 Step 1/6: Installing Docker..."
if ! command -v docker &> /dev/null; then
    dnf config-manager --add-repo=https://download.docker.com/linux/rhel/docker-ce.repo
    dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl start docker
    systemctl enable docker
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# Step 2: Install Node.js 18
echo "📦 Step 2/6: Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    dnf module install -y nodejs:18/common
    echo "✅ Node.js installed"
else
    echo "✅ Node.js already installed"
fi

# Step 3: Clone and setup Supabase
echo "🗄️  Step 3/6: Setting up Supabase..."
cd /opt
if [ ! -d "supabase" ]; then
    git clone --depth 1 https://github.com/supabase/supabase
fi
cd supabase/docker

# Generate secure passwords
POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

# Create .env file
cat > .env << EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=$(openssl rand -base64 16)

# Studio configuration
STUDIO_DEFAULT_ORGANIZATION=Default Organization
STUDIO_DEFAULT_PROJECT=Default Project

# API configuration
API_EXTERNAL_URL=http://$(hostname -I | awk '{print $1}'):8000
SUPABASE_PUBLIC_URL=http://$(hostname -I | awk '{print $1}'):8000
EOF

echo "✅ Supabase configuration created"

# Step 4: Start Supabase
echo "🚀 Step 4/6: Starting Supabase services..."
docker compose up -d
echo "⏳ Waiting for services to start (60 seconds)..."
sleep 60
echo "✅ Supabase is running"

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

# Step 5: Setup application
echo "📱 Step 5/6: Setting up Dell Server Manager..."
cd ~
if [ ! -d "dell-server-manager" ]; then
    echo "❌ Please clone the Dell Server Manager repository first"
    echo "   git clone <your-repo-url> dell-server-manager"
    exit 1
fi

cd dell-server-manager
npm install

# Create production .env
cat > .env << EOF
VITE_SUPABASE_URL=http://$SERVER_IP:8000
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
VITE_SUPABASE_PROJECT_ID=default
EOF

# Build application
npm run build

# Step 6: Setup systemd service
echo "🔧 Step 6/6: Creating systemd service..."
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

# Open firewall ports
echo "🔥 Opening firewall ports..."
firewall-cmd --permanent --add-port=3000/tcp  # Application
firewall-cmd --permanent --add-port=8000/tcp  # Supabase API
firewall-cmd --reload

echo ""
echo "✅ Deployment Complete!"
echo "========================================================"
echo ""
echo "📊 Supabase Studio: http://$SERVER_IP:8000"
echo "   Username: supabase"
echo "   Password: $(grep DASHBOARD_PASSWORD /opt/supabase/docker/.env | cut -d= -f2)"
echo ""
echo "🌐 Dell Server Manager: http://$SERVER_IP:3000"
echo ""
echo "🔑 Database Credentials:"
echo "   Host: $SERVER_IP"
echo "   Port: 5432"
echo "   Database: postgres"
echo "   Username: postgres"
echo "   Password: $(grep POSTGRES_PASSWORD /opt/supabase/docker/.env | cut -d= -f2)"
echo ""
echo "📋 Next Steps:"
echo "   1. Import your database schema:"
echo "      cd ~/dell-server-manager"
echo "      npm run restore -- --backup-dir=./backups/<your-backup>"
echo ""
echo "   2. Setup SSL/TLS (recommended for production)"
echo "   3. Configure your DNS to point to $SERVER_IP"
echo ""
echo "📝 Service Management:"
echo "   sudo systemctl status dell-server-manager"
echo "   sudo systemctl restart dell-server-manager"
echo "   sudo journalctl -u dell-server-manager -f"
echo ""
