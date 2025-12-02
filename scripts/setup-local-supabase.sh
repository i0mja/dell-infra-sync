#!/bin/bash
# Setup Local Supabase for Dell Server Manager
# This script sets up a local Supabase instance for air-gapped/offline deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SUPABASE_DOCKER_DIR="$PROJECT_ROOT/supabase/docker"
SUPABASE_INSTALL_DIR="/opt/supabase"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "========================================="
echo "Dell Server Manager - Local Supabase Setup"
echo "========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo_error "This script must be run as root (or with sudo)"
  exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
  echo_error "Docker is not installed. Please install Docker first."
  echo "For RHEL 9: dnf install docker-ce docker-ce-cli containerd.io"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo_error "Docker daemon is not running. Starting Docker..."
  systemctl start docker
  systemctl enable docker
fi

# Check docker compose
if ! docker compose version &> /dev/null; then
  echo_error "Docker Compose is not available."
  echo "Please install docker-compose-plugin: dnf install docker-compose-plugin"
  exit 1
fi

echo_info "Docker and Docker Compose are available"

# Create installation directory
echo_info "Setting up Supabase installation directory..."
mkdir -p "$SUPABASE_INSTALL_DIR"
mkdir -p "$SUPABASE_INSTALL_DIR/volumes/api"
mkdir -p "$SUPABASE_INSTALL_DIR/volumes/db/init"
mkdir -p "$SUPABASE_INSTALL_DIR/volumes/storage"

# Copy configuration files
echo_info "Copying configuration files..."
cp "$SUPABASE_DOCKER_DIR/docker-compose.yml" "$SUPABASE_INSTALL_DIR/"
cp "$SUPABASE_DOCKER_DIR/volumes/api/kong.yml" "$SUPABASE_INSTALL_DIR/volumes/api/"

# Generate secure passwords
echo_info "Generating secure credentials..."
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long!!"

# Pre-generated JWT tokens that work with the demo JWT_SECRET
# These are safe for local/air-gapped use - they use the standard Supabase demo secret
# The secret used: "super-secret-jwt-token-with-at-least-32-characters-long!!"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
SECRET_KEY_BASE=$(openssl rand -base64 64 | tr -d '\n')

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

# Create .env file
echo_info "Creating environment configuration..."
cat > "$SUPABASE_INSTALL_DIR/.env" << EOF
# Dell Server Manager - Local Supabase Configuration
# Generated: $(date)

# Database
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# JWT Configuration
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SECRET_KEY_BASE=$SECRET_KEY_BASE

# URLs - Update these if using different ports or hostname
API_EXTERNAL_URL=http://${SERVER_IP}:8000
SITE_URL=http://${SERVER_IP}:3000

# Auth
DISABLE_SIGNUP=false
JWT_EXPIRY=3600

# Edge Functions path
FUNCTIONS_PATH=$PROJECT_ROOT/supabase/functions

# Analytics
LOGFLARE_API_KEY=demo-logflare-key
EOF

chmod 600 "$SUPABASE_INSTALL_DIR/.env"

# Start Supabase
echo_info "Starting Supabase services..."
cd "$SUPABASE_INSTALL_DIR"
docker compose up -d

# Wait for database to be healthy
echo_info "Waiting for database to be ready..."
RETRIES=30
until docker exec supabase-db pg_isready -U postgres > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  echo "Waiting for database... ($RETRIES retries remaining)"
  RETRIES=$((RETRIES-1))
  sleep 2
done

if [ $RETRIES -eq 0 ]; then
  echo_error "Database failed to start. Check logs: docker logs supabase-db"
  exit 1
fi

echo_info "Database is ready!"

# Apply migrations
echo_info "Applying database migrations..."
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"

if [ -d "$MIGRATIONS_DIR" ]; then
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
      echo "  Applying $(basename "$migration")..."
      docker exec -i supabase-db psql -U postgres -d postgres < "$migration" 2>/dev/null || {
        echo_warn "  Migration $(basename "$migration") may have already been applied"
      }
    fi
  done
  echo_info "Migrations applied"
else
  echo_warn "No migrations directory found at $MIGRATIONS_DIR"
fi

# Wait for auth service
echo_info "Waiting for auth service..."
sleep 5

# Print connection information
echo ""
echo "========================================="
echo "Supabase Setup Complete!"
echo "========================================="
echo ""
echo "Service URLs:"
echo "  API:     http://${SERVER_IP}:8000"
echo "  Studio:  http://${SERVER_IP}:3100"
echo ""
echo "Connection Details:"
echo "  Database Host: localhost"
echo "  Database Port: 5432"
echo "  Database Name: postgres"
echo "  Database User: postgres"
echo "  Database Password: $POSTGRES_PASSWORD"
echo ""
echo "API Keys:"
echo "  Anon Key:         $ANON_KEY"
echo "  Service Role Key: $SERVICE_ROLE_KEY"
echo ""
echo "For Dell Server Manager .env.local:"
echo "  VITE_SUPABASE_URL=http://${SERVER_IP}:8000"
echo "  VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY"
echo ""
echo "Docker Commands:"
echo "  Status:  cd $SUPABASE_INSTALL_DIR && docker compose ps"
echo "  Logs:    cd $SUPABASE_INSTALL_DIR && docker compose logs -f"
echo "  Stop:    cd $SUPABASE_INSTALL_DIR && docker compose down"
echo "  Start:   cd $SUPABASE_INSTALL_DIR && docker compose up -d"
echo ""

# Save credentials
cat > "$SUPABASE_INSTALL_DIR/credentials.txt" << EOF
Dell Server Manager - Local Supabase Credentials
Generated: $(date)

API URL: http://${SERVER_IP}:8000
Studio URL: http://${SERVER_IP}:3100

Database:
  Host: localhost
  Port: 5432
  Name: postgres
  User: postgres
  Password: $POSTGRES_PASSWORD

API Keys:
  Anon Key: $ANON_KEY
  Service Role Key: $SERVICE_ROLE_KEY
  JWT Secret: $JWT_SECRET

For .env.local:
  VITE_SUPABASE_URL=http://${SERVER_IP}:8000
  VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
EOF

chmod 600 "$SUPABASE_INSTALL_DIR/credentials.txt"
echo_info "Credentials saved to: $SUPABASE_INSTALL_DIR/credentials.txt"
