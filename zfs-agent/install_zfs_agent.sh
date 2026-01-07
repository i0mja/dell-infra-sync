#!/bin/bash
#
# ZFS Agent Installation Script
#
# Installs the ZFS Agent FastAPI service on an Ubuntu-based ZFS appliance.
# Should be run as root.
#

set -e

# Configuration
AGENT_USER="zfsagent"
AGENT_DIR="/opt/zfs-agent"
CONFIG_DIR="/etc/zfs-agent"
LOG_DIR="/var/log/zfs-agent"
SSL_DIR="${CONFIG_DIR}/ssl"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root"
    exit 1
fi

log_info "Starting ZFS Agent installation..."

# Install system dependencies
log_info "Installing system dependencies..."
apt-get update
apt-get install -y python3 python3-pip python3-venv openssl

# Create agent user
if ! id -u ${AGENT_USER} &>/dev/null; then
    log_info "Creating ${AGENT_USER} user..."
    useradd -r -s /bin/false -d ${AGENT_DIR} ${AGENT_USER}
else
    log_info "User ${AGENT_USER} already exists"
fi

# Create directories
log_info "Creating directories..."
mkdir -p ${AGENT_DIR}
mkdir -p ${CONFIG_DIR}
mkdir -p ${SSL_DIR}
mkdir -p ${LOG_DIR}

# Copy agent code
log_info "Installing agent code..."
if [[ -d "./zfs_agent" ]]; then
    cp -r ./zfs_agent ${AGENT_DIR}/
    cp requirements.txt ${AGENT_DIR}/
else
    log_error "Agent code not found. Run this script from the zfs-agent directory."
    exit 1
fi

# Create virtual environment
log_info "Creating Python virtual environment..."
python3 -m venv ${AGENT_DIR}/venv

# Install Python dependencies
log_info "Installing Python dependencies..."
${AGENT_DIR}/venv/bin/pip install --upgrade pip
${AGENT_DIR}/venv/bin/pip install -r ${AGENT_DIR}/requirements.txt

# Generate self-signed SSL certificate if not exists
if [[ ! -f "${SSL_DIR}/server.crt" ]]; then
    log_info "Generating self-signed SSL certificate..."
    HOSTNAME=$(hostname -f)
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout ${SSL_DIR}/server.key \
        -out ${SSL_DIR}/server.crt \
        -subj "/CN=${HOSTNAME}/O=ZFS Agent/C=US" \
        -addext "subjectAltName=DNS:${HOSTNAME},DNS:localhost,IP:127.0.0.1"
    chmod 600 ${SSL_DIR}/server.key
    log_info "SSL certificate generated for ${HOSTNAME}"
else
    log_info "SSL certificate already exists"
fi

# Create environment file
if [[ ! -f "${CONFIG_DIR}/agent.env" ]]; then
    log_info "Creating environment file..."
    cat > ${CONFIG_DIR}/agent.env << EOF
# ZFS Agent Configuration
# Edit this file to configure the agent

# Supabase connection (for pushing metrics)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT secret for API authentication
# ZFS_AGENT_JWT_SECRET=your-secret-key

# Default ZFS pool
ZFS_DEFAULT_POOL=tank

# Heartbeat interval (seconds)
HEARTBEAT_INTERVAL=60

# Log level
LOG_LEVEL=INFO
EOF
    chmod 600 ${CONFIG_DIR}/agent.env
fi

# Configure sudoers for ZFS commands
log_info "Configuring sudo access for ZFS commands..."
cat > /etc/sudoers.d/zfsagent << EOF
# Allow zfsagent to run ZFS commands without password
${AGENT_USER} ALL=(ALL) NOPASSWD: /usr/sbin/zfs
${AGENT_USER} ALL=(ALL) NOPASSWD: /usr/sbin/zpool
${AGENT_USER} ALL=(ALL) NOPASSWD: /usr/sbin/exportfs
${AGENT_USER} ALL=(ALL) NOPASSWD: /usr/bin/syncoid
${AGENT_USER} ALL=(ALL) NOPASSWD: /usr/bin/sanoid
EOF
chmod 440 /etc/sudoers.d/zfsagent

# Install systemd service
log_info "Installing systemd service..."
cp ./zfs-agent.service /etc/systemd/system/

# Set ownership
log_info "Setting file ownership..."
chown -R ${AGENT_USER}:${AGENT_USER} ${AGENT_DIR}
chown -R ${AGENT_USER}:${AGENT_USER} ${CONFIG_DIR}
chown -R ${AGENT_USER}:${AGENT_USER} ${LOG_DIR}

# Reload systemd and enable service
log_info "Enabling and starting service..."
systemctl daemon-reload
systemctl enable zfs-agent
systemctl start zfs-agent

# Wait a moment for service to start
sleep 2

# Check service status
if systemctl is-active --quiet zfs-agent; then
    log_info "ZFS Agent installed and running successfully!"
    log_info ""
    log_info "Service status: $(systemctl is-active zfs-agent)"
    log_info "API URL: https://$(hostname -f):8000"
    log_info "Swagger docs: https://$(hostname -f):8000/docs"
    log_info ""
    log_info "Configuration: ${CONFIG_DIR}/agent.env"
    log_info "Logs: journalctl -u zfs-agent -f"
else
    log_error "Service failed to start. Check logs with: journalctl -u zfs-agent"
    exit 1
fi
