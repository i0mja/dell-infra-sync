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

if [ "$DEPLOY_MODE" = "1" ]; then
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

# Apply Supabase migrations from the repository for local deployment
echo "📊 Applying Supabase migrations..."
MIGRATIONS_DIR="$(dirname "$0")/../supabase/migrations"

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
    # Open firewall ports without SSL
    echo "🔥 Opening firewall ports..."
    firewall-cmd --permanent --add-port=3000/tcp  # Application
    firewall-cmd --permanent --add-port=8000/tcp  # Supabase API
    firewall-cmd --reload
    
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
