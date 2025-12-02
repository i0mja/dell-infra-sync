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
mkdir -p volumes/db/init
mkdir -p volumes/storage

# Copy kong.yml as a FILE (not directory)
if [ -f "$PROJECT_ROOT/supabase/docker/volumes/api/kong.yml" ]; then
    cp "$PROJECT_ROOT/supabase/docker/volumes/api/kong.yml" volumes/api/kong.yml
fi

# Get server IP (permissions will be set after init script creation)
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
# CRITICAL: Create database init script
# This fixes Supabase internal role passwords to match POSTGRES_PASSWORD
# Without this, auth/storage/realtime services fail to connect
# ============================================
echo "   Creating database initialization script..."
cat > volumes/db/init/00-setup-supabase-roles.sql << INIT_SQL
-- ============================================
-- Supabase Role Password Fix for Self-Hosted Deployment
-- This script runs at database initialization (before other init scripts)
-- It fixes the passwords for Supabase internal roles to match POSTGRES_PASSWORD
-- ============================================

-- Fix passwords for all Supabase internal roles
-- The supabase/postgres image creates these with default passwords
ALTER ROLE supabase_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_functions_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_replication_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_read_only_user WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE pgbouncer WITH PASSWORD '$POSTGRES_PASSWORD';

-- Create authenticated role if missing (used by RLS policies)
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
    RAISE NOTICE 'Created authenticated role';
  END IF;
END
\$\$;

-- Create anon role if missing (used by RLS policies)
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
    RAISE NOTICE 'Created anon role';
  END IF;
END
\$\$;

-- Create service_role if missing
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    RAISE NOTICE 'Created service_role';
  END IF;
END
\$\$;

-- Grant roles to authenticator (PostgREST connects as authenticator)
GRANT authenticated TO authenticator;
GRANT anon TO authenticator;
GRANT service_role TO authenticator;

-- Create extensions schema if not exists
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA extensions TO supabase_admin;

-- Create the realtime publication for real-time subscriptions
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
    RAISE NOTICE 'Created supabase_realtime publication';
  END IF;
END
\$\$;

-- Grant schema permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO supabase_admin;

-- Log completion
DO \$\$ BEGIN RAISE NOTICE 'Supabase roles initialized successfully'; END \$\$;
INIT_SQL

echo "✅ Database init script created"

# ============================================
# CRITICAL: Fix permissions for Docker containers
# The postgres container runs as UID 999 (postgres user)
# Without proper permissions, it cannot read init scripts
# ============================================
echo "   Setting permissions for Docker containers..."

# Set world-readable permissions on all volumes
chmod -R 755 "$SUPABASE_DIR/volumes"

# Set postgres ownership on db directories (UID 999 = postgres in container)
chown -R 999:999 "$SUPABASE_DIR/volumes/db"

# Verify permissions are correct
if [ "$(stat -c %a $SUPABASE_DIR/volumes/db/init 2>/dev/null)" != "755" ]; then
    echo "⚠️  Warning: Could not set permissions. Trying with sudo..."
    sudo chmod -R 755 "$SUPABASE_DIR/volumes" 2>/dev/null || true
    sudo chown -R 999:999 "$SUPABASE_DIR/volumes/db" 2>/dev/null || true
fi

echo "✅ Permissions set (db owned by UID 999, mode 755)"

# SELinux: Set proper context for RHEL 9 (only if Enforcing)
if command -v getenforce &> /dev/null && [ "$(getenforce)" == "Enforcing" ]; then
    echo "   Setting SELinux context for Docker volumes..."
    chcon -Rt container_file_t "$SUPABASE_DIR/volumes" || \
    chcon -Rt svirt_sandbox_file_t "$SUPABASE_DIR/volumes" || true
    echo "✅ SELinux context set"
fi

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

# Step 4: Start Supabase
echo "🚀 Step 4/6: Starting Supabase services..."
docker compose up -d

echo "⏳ Waiting for database to be ready..."
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if docker compose exec -T db pg_isready -U postgres > /dev/null 2>&1; then
        echo "✅ Database is ready"
        break
    fi
    sleep 5
    WAITED=$((WAITED + 5))
    echo "   ... waiting ($WAITED seconds)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo "⚠️  Database may not be fully ready. Continuing anyway..."
fi

echo "⏳ Waiting for services to stabilize (60 seconds)..."
for i in {1..6}; do
    sleep 10
    echo "   ... $((i * 10)) seconds"
done

# Check service health
echo "🔍 Checking service status..."
docker compose ps

# Check for critical services
UNHEALTHY_SERVICES=$(docker compose ps --format json 2>/dev/null | grep -c '"Status":"restarting"' || echo "0")
if [ "$UNHEALTHY_SERVICES" -gt "0" ]; then
    echo "⚠️  Some services are restarting. Checking logs..."
    echo ""
    echo "Auth service logs (last 20 lines):"
    docker compose logs auth --tail=20 2>/dev/null || true
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
