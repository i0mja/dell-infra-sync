#!/bin/bash
#
# Dell Server Manager - Job Executor Management Script for Linux
# Version: 1.0
# Requires: bash 4+, Python 3.8+, jq, openssl
#
# Usage: sudo ./manage-job-executor.sh
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="/opt/dell-server-manager"
CONFIG_FILE="$CONFIG_DIR/executor-config.json"
MASTER_KEY_FILE="$CONFIG_DIR/.master.key"
ENV_FILE="$CONFIG_DIR/executor.env"
LOG_DIR="/var/log/dell-server-manager"
LOG_FILE="$LOG_DIR/executor.log"
ERROR_LOG_FILE="$LOG_DIR/executor-error.log"
SERVICE_NAME="dell-server-manager-executor"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
EXECUTOR_SCRIPT="$PROJECT_ROOT/job-executor.py"
WRAPPER_SCRIPT="$CONFIG_DIR/run-executor.sh"

# ============================================================================
# Color Codes
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${CYAN}ℹ $1${NC}"
}

print_header() {
    echo -e "${BLUE}$1${NC}"
}

show_header() {
    clear
    echo -e "${WHITE}"
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Dell Server Manager - Job Executor Manager"
    echo "═══════════════════════════════════════════════════════════════"
    if [[ -n "${1:-}" ]]; then
        echo "  $1"
        echo "═══════════════════════════════════════════════════════════════"
    fi
    echo -e "${NC}"
}

press_any_key() {
    echo ""
    read -n 1 -s -r -p "Press any key to continue..."
    echo ""
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This operation requires root privileges"
        print_warning "Please run with sudo: sudo $0"
        return 1
    fi
    return 0
}

check_dependencies() {
    local missing=()
    
    command -v python3 >/dev/null 2>&1 || missing+=("python3")
    command -v jq >/dev/null 2>&1 || missing+=("jq")
    command -v openssl >/dev/null 2>&1 || missing+=("openssl")
    command -v systemctl >/dev/null 2>&1 || missing+=("systemd")
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing required dependencies: ${missing[*]}"
        print_info "Install with: sudo apt-get install -y ${missing[*]}"
        print_info "Or on RHEL/CentOS: sudo yum install -y ${missing[*]}"
        return 1
    fi
    
    # Check Python version
    local python_version=$(python3 --version 2>&1 | awk '{print $2}')
    local major=$(echo "$python_version" | cut -d. -f1)
    local minor=$(echo "$python_version" | cut -d. -f2)
    
    if [[ $major -lt 3 ]] || [[ $major -eq 3 && $minor -lt 8 ]]; then
        print_error "Python 3.8 or higher is required (found $python_version)"
        return 1
    fi
    
    return 0
}

# ============================================================================
# Encryption Functions
# ============================================================================

generate_master_key() {
    if check_root; then
        print_info "Generating encryption master key..."
        openssl rand -base64 32 > "$MASTER_KEY_FILE"
        chmod 600 "$MASTER_KEY_FILE"
        print_success "Master key generated at $MASTER_KEY_FILE"
    fi
}

encrypt_value() {
    local plaintext="$1"
    if [[ -z "$plaintext" ]]; then
        echo ""
        return
    fi
    
    if [[ ! -f "$MASTER_KEY_FILE" ]]; then
        generate_master_key
    fi
    
    local encrypted=$(echo -n "$plaintext" | openssl enc -aes-256-cbc -a -salt -pass file:"$MASTER_KEY_FILE" 2>/dev/null)
    echo "encrypted:$encrypted"
}

decrypt_value() {
    local encrypted="$1"
    
    if [[ -z "$encrypted" ]]; then
        echo ""
        return
    fi
    
    # Check if value is encrypted
    if [[ ! "$encrypted" =~ ^encrypted: ]]; then
        echo "$encrypted"
        return
    fi
    
    # Remove "encrypted:" prefix
    encrypted="${encrypted#encrypted:}"
    
    if [[ ! -f "$MASTER_KEY_FILE" ]]; then
        print_error "Master key file not found"
        return 1
    fi
    
    local decrypted=$(echo -n "$encrypted" | openssl enc -aes-256-cbc -d -a -pass file:"$MASTER_KEY_FILE" 2>/dev/null)
    echo "$decrypted"
}

# ============================================================================
# Configuration Functions
# ============================================================================

init_config_file() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        cat > "$CONFIG_FILE" <<EOF
{
  "dsm_url": "http://127.0.0.1:54321",
  "service_role_key": "",
  "vcenter_host": "",
  "vcenter_port": 443,
  "vcenter_user": "",
  "vcenter_password": "",
  "vcenter_verify_ssl": true,
  "idrac_user": "root",
  "idrac_password": "",
  "firmware_repo_url": "",
  "poll_interval": 10,
  "log_level": "INFO",
  "max_concurrent_jobs": 3
}
EOF
        chmod 600 "$CONFIG_FILE"
    fi
}

load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        init_config_file
    fi
    
    if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
        print_error "Invalid JSON in configuration file"
        return 1
    fi
}

get_config_value() {
    local key="$1"
    jq -r ".$key // empty" "$CONFIG_FILE" 2>/dev/null || echo ""
}

set_config_value() {
    local key="$1"
    local value="$2"
    
    local tmp_file=$(mktemp)
    jq --arg key "$key" --arg value "$value" '.[$key] = $value' "$CONFIG_FILE" > "$tmp_file"
    mv "$tmp_file" "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
}

show_current_config() {
    show_header "Current Configuration"
    
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_warning "Configuration file not found"
        press_any_key
        return
    fi
    
    load_config || return
    
    echo -e "${CYAN}DSM Configuration:${NC}"
    echo "  DSM URL:              $(get_config_value 'dsm_url')"
    
    local service_key=$(get_config_value 'service_role_key')
    if [[ -n "$service_key" ]]; then
        echo "  Service Role Key:     ********** (configured)"
    else
        echo "  Service Role Key:     (not set)"
    fi
    
    echo ""
    echo -e "${CYAN}vCenter Configuration:${NC}"
    local vcenter_host=$(get_config_value 'vcenter_host')
    if [[ -n "$vcenter_host" ]]; then
        echo "  Host:                 $vcenter_host"
        echo "  Port:                 $(get_config_value 'vcenter_port')"
        echo "  Username:             $(get_config_value 'vcenter_user')"
        echo "  Password:             ********** (configured)"
        echo "  Verify SSL:           $(get_config_value 'vcenter_verify_ssl')"
    else
        echo "  Not configured"
    fi
    
    echo ""
    echo -e "${CYAN}iDRAC Default Credentials:${NC}"
    echo "  Username:             $(get_config_value 'idrac_user')"
    local idrac_pass=$(get_config_value 'idrac_password')
    if [[ -n "$idrac_pass" ]]; then
        echo "  Password:             ********** (configured)"
    else
        echo "  Password:             (not set)"
    fi
    
    echo ""
    echo -e "${CYAN}Other Settings:${NC}"
    echo "  Firmware Repo URL:    $(get_config_value 'firmware_repo_url')"
    echo "  Poll Interval:        $(get_config_value 'poll_interval') seconds"
    echo "  Log Level:            $(get_config_value 'log_level')"
    echo "  Max Concurrent Jobs:  $(get_config_value 'max_concurrent_jobs')"
    
    press_any_key
}

edit_configuration() {
    show_header "Edit Configuration"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    load_config || return
    
    echo -e "${CYAN}Edit configuration values (press Enter to keep current value)${NC}"
    echo ""
    
    # DSM URL
    local current_dsm=$(get_config_value 'dsm_url')
    read -p "DSM URL [$current_dsm]: " dsm_url
    dsm_url="${dsm_url:-$current_dsm}"
    set_config_value "dsm_url" "$dsm_url"
    
    # Service Role Key
    local has_key=$(get_config_value 'service_role_key')
    if [[ -n "$has_key" ]]; then
        echo "Service Role Key: ********** (already set)"
        read -p "Update Service Role Key? (y/N): " update_key
        if [[ "$update_key" =~ ^[Yy]$ ]]; then
            read -s -p "New Service Role Key: " service_key
            echo ""
            if [[ -n "$service_key" ]]; then
                local encrypted_key=$(encrypt_value "$service_key")
                set_config_value "service_role_key" "$encrypted_key"
                print_success "Service Role Key updated"
            fi
        fi
    else
        read -s -p "Service Role Key (required): " service_key
        echo ""
        if [[ -n "$service_key" ]]; then
            local encrypted_key=$(encrypt_value "$service_key")
            set_config_value "service_role_key" "$encrypted_key"
        fi
    fi
    
    echo ""
    echo -e "${CYAN}vCenter Configuration (optional):${NC}"
    
    local current_vcenter=$(get_config_value 'vcenter_host')
    read -p "vCenter Host [$current_vcenter]: " vcenter_host
    vcenter_host="${vcenter_host:-$current_vcenter}"
    set_config_value "vcenter_host" "$vcenter_host"
    
    if [[ -n "$vcenter_host" ]]; then
        local current_port=$(get_config_value 'vcenter_port')
        read -p "vCenter Port [$current_port]: " vcenter_port
        vcenter_port="${vcenter_port:-$current_port}"
        set_config_value "vcenter_port" "$vcenter_port"
        
        local current_user=$(get_config_value 'vcenter_user')
        read -p "vCenter Username [$current_user]: " vcenter_user
        vcenter_user="${vcenter_user:-$current_user}"
        set_config_value "vcenter_user" "$vcenter_user"
        
        read -s -p "vCenter Password: " vcenter_password
        echo ""
        if [[ -n "$vcenter_password" ]]; then
            local encrypted_pass=$(encrypt_value "$vcenter_password")
            set_config_value "vcenter_password" "$encrypted_pass"
        fi
        
        local current_ssl=$(get_config_value 'vcenter_verify_ssl')
        read -p "Verify SSL certificates? (true/false) [$current_ssl]: " verify_ssl
        verify_ssl="${verify_ssl:-$current_ssl}"
        set_config_value "vcenter_verify_ssl" "$verify_ssl"
    fi
    
    echo ""
    echo -e "${CYAN}iDRAC Default Credentials:${NC}"
    
    local current_idrac_user=$(get_config_value 'idrac_user')
    read -p "iDRAC Username [$current_idrac_user]: " idrac_user
    idrac_user="${idrac_user:-$current_idrac_user}"
    set_config_value "idrac_user" "$idrac_user"
    
    read -s -p "iDRAC Password: " idrac_password
    echo ""
    if [[ -n "$idrac_password" ]]; then
        local encrypted_idrac=$(encrypt_value "$idrac_password")
        set_config_value "idrac_password" "$encrypted_idrac"
    fi
    
    echo ""
    echo -e "${CYAN}Other Settings:${NC}"
    
    local current_repo=$(get_config_value 'firmware_repo_url')
    read -p "Firmware Repository URL [$current_repo]: " firmware_repo
    firmware_repo="${firmware_repo:-$current_repo}"
    set_config_value "firmware_repo_url" "$firmware_repo"
    
    local current_poll=$(get_config_value 'poll_interval')
    read -p "Poll Interval (seconds) [$current_poll]: " poll_interval
    poll_interval="${poll_interval:-$current_poll}"
    set_config_value "poll_interval" "$poll_interval"
    
    local current_log=$(get_config_value 'log_level')
    read -p "Log Level (DEBUG/INFO/WARNING/ERROR) [$current_log]: " log_level
    log_level="${log_level:-$current_log}"
    set_config_value "log_level" "$log_level"
    
    local current_jobs=$(get_config_value 'max_concurrent_jobs')
    read -p "Max Concurrent Jobs [$current_jobs]: " max_jobs
    max_jobs="${max_jobs:-$current_jobs}"
    set_config_value "max_concurrent_jobs" "$max_jobs"
    
    print_success "Configuration saved successfully"
    
    # Ask to restart service if running
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        echo ""
        read -p "Service is running. Restart now to apply changes? (Y/n): " restart
        if [[ ! "$restart" =~ ^[Nn]$ ]]; then
            restart_service
        fi
    fi
    
    press_any_key
}

quick_setup_wizard() {
    show_header "Quick Setup Wizard"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    echo -e "${CYAN}This wizard will guide you through the basic setup${NC}"
    echo ""
    
    load_config || return
    
    # Step 1: DSM URL
    print_header "Step 1: DSM Configuration"
    local default_dsm="http://127.0.0.1:54321"
    read -p "DSM URL [$default_dsm]: " dsm_url
    dsm_url="${dsm_url:-$default_dsm}"
    set_config_value "dsm_url" "$dsm_url"
    print_success "DSM URL configured"
    echo ""
    
    # Step 2: Service Role Key
    print_header "Step 2: Service Role Key (Required)"
    echo "This key is required for the Job Executor to communicate with DSM"
    echo "You can get this from Settings → Job Executor in the web interface"
    read -s -p "Service Role Key: " service_key
    echo ""
    
    if [[ -z "$service_key" ]]; then
        print_error "Service Role Key is required"
        press_any_key
        return
    fi
    
    local encrypted_key=$(encrypt_value "$service_key")
    set_config_value "service_role_key" "$encrypted_key"
    print_success "Service Role Key configured"
    echo ""
    
    # Step 3: vCenter (optional)
    print_header "Step 3: vCenter Configuration (Optional)"
    read -p "Configure vCenter? (y/N): " configure_vcenter
    
    if [[ "$configure_vcenter" =~ ^[Yy]$ ]]; then
        read -p "vCenter Host: " vcenter_host
        read -p "vCenter Username: " vcenter_user
        read -s -p "vCenter Password: " vcenter_password
        echo ""
        
        set_config_value "vcenter_host" "$vcenter_host"
        set_config_value "vcenter_user" "$vcenter_user"
        
        if [[ -n "$vcenter_password" ]]; then
            local encrypted_vcenter=$(encrypt_value "$vcenter_password")
            set_config_value "vcenter_password" "$encrypted_vcenter"
        fi
        
        print_success "vCenter configured"
    else
        print_info "Skipping vCenter configuration"
    fi
    echo ""
    
    # Step 4: Firmware Repository (optional)
    print_header "Step 4: Firmware Repository (Optional)"
    read -p "Firmware Repository URL (leave empty to skip): " firmware_repo
    
    if [[ -n "$firmware_repo" ]]; then
        set_config_value "firmware_repo_url" "$firmware_repo"
        print_success "Firmware repository configured"
    else
        print_info "Skipping firmware repository"
    fi
    echo ""
    
    print_success "Configuration complete!"
    echo ""
    
    # Offer to install service
    read -p "Install and start the Job Executor service now? (Y/n): " install_now
    if [[ ! "$install_now" =~ ^[Nn]$ ]]; then
        install_service
    fi
    
    press_any_key
}

export_configuration() {
    show_header "Export Configuration"
    
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_error "Configuration file not found"
        press_any_key
        return
    fi
    
    local default_export="$HOME/executor-config-export-$(date +%Y%m%d-%H%M%S).json"
    read -p "Export to [$default_export]: " export_file
    export_file="${export_file:-$default_export}"
    
    cp "$CONFIG_FILE" "$export_file"
    chmod 600 "$export_file"
    
    print_success "Configuration exported to: $export_file"
    print_warning "This file contains encrypted credentials"
    print_info "Keep it secure and transport it safely"
    
    press_any_key
}

import_configuration() {
    show_header "Import Configuration"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    read -p "Import from: " import_file
    
    if [[ ! -f "$import_file" ]]; then
        print_error "File not found: $import_file"
        press_any_key
        return
    fi
    
    if ! jq empty "$import_file" 2>/dev/null; then
        print_error "Invalid JSON file"
        press_any_key
        return
    fi
    
    # Backup current config
    if [[ -f "$CONFIG_FILE" ]]; then
        local backup="$CONFIG_FILE.backup-$(date +%Y%m%d-%H%M%S)"
        cp "$CONFIG_FILE" "$backup"
        print_info "Current configuration backed up to: $backup"
    fi
    
    cp "$import_file" "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
    
    print_success "Configuration imported successfully"
    
    # Ask to restart service if running
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        echo ""
        read -p "Service is running. Restart now? (Y/n): " restart
        if [[ ! "$restart" =~ ^[Nn]$ ]]; then
            restart_service
        fi
    fi
    
    press_any_key
}

# ============================================================================
# Service Management Functions
# ============================================================================

create_wrapper_script() {
    cat > "$WRAPPER_SCRIPT" <<'EOF'
#!/bin/bash
# Wrapper script for Job Executor

CONFIG_FILE="/opt/dell-server-manager/executor-config.json"
MASTER_KEY_FILE="/opt/dell-server-manager/.master.key"

decrypt_value() {
    local encrypted="$1"
    if [[ ! "$encrypted" =~ ^encrypted: ]]; then
        echo "$encrypted"
        return
    fi
    encrypted="${encrypted#encrypted:}"
    echo -n "$encrypted" | openssl enc -aes-256-cbc -d -a -pass file:"$MASTER_KEY_FILE" 2>/dev/null
}

get_config_value() {
    jq -r ".$1 // empty" "$CONFIG_FILE" 2>/dev/null || echo ""
}

# Load configuration and set environment variables
export SUPABASE_URL=$(get_config_value 'dsm_url')
export SUPABASE_SERVICE_ROLE_KEY=$(decrypt_value "$(get_config_value 'service_role_key')")
export VCENTER_HOST=$(get_config_value 'vcenter_host')
export VCENTER_PORT=$(get_config_value 'vcenter_port')
export VCENTER_USER=$(get_config_value 'vcenter_user')
export VCENTER_PASSWORD=$(decrypt_value "$(get_config_value 'vcenter_password')")
export VCENTER_VERIFY_SSL=$(get_config_value 'vcenter_verify_ssl')
export IDRAC_USER=$(get_config_value 'idrac_user')
export IDRAC_PASSWORD=$(decrypt_value "$(get_config_value 'idrac_password')")
export FIRMWARE_REPO_URL=$(get_config_value 'firmware_repo_url')
export POLL_INTERVAL=$(get_config_value 'poll_interval')
export LOG_LEVEL=$(get_config_value 'log_level')
export MAX_CONCURRENT_JOBS=$(get_config_value 'max_concurrent_jobs')

# Execute the Job Executor
exec python3 "$1"
EOF
    
    chmod 755 "$WRAPPER_SCRIPT"
}

create_service_file() {
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Dell Server Manager Job Executor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_ROOT
ExecStart=$WRAPPER_SCRIPT $EXECUTOR_SCRIPT
Restart=on-failure
RestartSec=10
StandardOutput=append:$LOG_FILE
StandardError=append:$ERROR_LOG_FILE

[Install]
WantedBy=multi-user.target
EOF
}

install_service() {
    show_header "Install Job Executor Service"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    # Check if job-executor.py exists
    if [[ ! -f "$EXECUTOR_SCRIPT" ]]; then
        print_error "Job Executor script not found: $EXECUTOR_SCRIPT"
        press_any_key
        return
    fi
    
    # Check if configuration exists and is valid
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_error "Configuration file not found"
        print_info "Please run the Quick Setup Wizard first (Menu: 2 → 3)"
        press_any_key
        return
    fi
    
    local service_key=$(get_config_value 'service_role_key')
    if [[ -z "$service_key" ]]; then
        print_error "Service Role Key not configured"
        print_info "Please configure it first (Menu: 2 → 2 or 2 → 3)"
        press_any_key
        return
    fi
    
    print_info "Installing Job Executor service..."
    
    # Create wrapper script
    create_wrapper_script
    print_success "Wrapper script created"
    
    # Create systemd service file
    create_service_file
    print_success "Service file created"
    
    # Reload systemd
    systemctl daemon-reload
    print_success "Systemd reloaded"
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    print_success "Service enabled (auto-start on boot)"
    
    # Start service
    systemctl start "$SERVICE_NAME"
    
    sleep 2
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        print_success "Service started successfully"
        echo ""
        get_service_status
    else
        print_error "Service failed to start"
        print_info "Check logs with: journalctl -u $SERVICE_NAME -n 50"
    fi
    
    press_any_key
}

uninstall_service() {
    show_header "Uninstall Job Executor Service"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    if [[ ! -f "$SERVICE_FILE" ]]; then
        print_warning "Service is not installed"
        press_any_key
        return
    fi
    
    read -p "Are you sure you want to uninstall the service? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_info "Cancelled"
        press_any_key
        return
    fi
    
    print_info "Uninstalling service..."
    
    # Stop service
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        systemctl stop "$SERVICE_NAME"
        print_success "Service stopped"
    fi
    
    # Disable service
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    print_success "Service disabled"
    
    # Remove service file
    rm -f "$SERVICE_FILE"
    print_success "Service file removed"
    
    # Reload systemd
    systemctl daemon-reload
    print_success "Systemd reloaded"
    
    # Ask about configuration and logs
    echo ""
    read -p "Delete configuration and logs? (y/N): " delete_data
    if [[ "$delete_data" =~ ^[Yy]$ ]]; then
        rm -rf "$CONFIG_DIR" "$LOG_DIR"
        print_success "Configuration and logs deleted"
    else
        print_info "Configuration and logs preserved in:"
        print_info "  - $CONFIG_DIR"
        print_info "  - $LOG_DIR"
    fi
    
    print_success "Service uninstalled"
    press_any_key
}

start_service() {
    show_header "Start Service"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    if [[ ! -f "$SERVICE_FILE" ]]; then
        print_error "Service is not installed"
        print_info "Install it first (Menu: 1 → 5)"
        press_any_key
        return
    fi
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        print_warning "Service is already running"
        press_any_key
        return
    fi
    
    print_info "Starting service..."
    systemctl start "$SERVICE_NAME"
    sleep 2
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        print_success "Service started successfully"
        echo ""
        get_service_status
    else
        print_error "Failed to start service"
        print_info "Check logs with: journalctl -u $SERVICE_NAME -n 50"
    fi
    
    press_any_key
}

stop_service() {
    show_header "Stop Service"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    if [[ ! -f "$SERVICE_FILE" ]]; then
        print_error "Service is not installed"
        press_any_key
        return
    fi
    
    if ! systemctl is-active --quiet "$SERVICE_NAME"; then
        print_warning "Service is not running"
        press_any_key
        return
    fi
    
    print_info "Stopping service..."
    systemctl stop "$SERVICE_NAME"
    sleep 1
    
    if ! systemctl is-active --quiet "$SERVICE_NAME"; then
        print_success "Service stopped successfully"
    else
        print_error "Failed to stop service"
    fi
    
    press_any_key
}

restart_service() {
    show_header "Restart Service"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    if [[ ! -f "$SERVICE_FILE" ]]; then
        print_error "Service is not installed"
        press_any_key
        return
    fi
    
    print_info "Restarting service..."
    systemctl restart "$SERVICE_NAME"
    sleep 2
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        print_success "Service restarted successfully"
        echo ""
        get_service_status
    else
        print_error "Failed to restart service"
        print_info "Check logs with: journalctl -u $SERVICE_NAME -n 50"
    fi
    
    press_any_key
}

get_service_status() {
    if [[ ! -f "$SERVICE_FILE" ]]; then
        echo -e "${YELLOW}Status: Not Installed${NC}"
        return
    fi
    
    local status_output=$(systemctl status "$SERVICE_NAME" 2>&1)
    local is_active=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "inactive")
    local is_enabled=$(systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || echo "disabled")
    
    if [[ "$is_active" == "active" ]]; then
        echo -e "${GREEN}Status: Running${NC}"
    else
        echo -e "${RED}Status: Stopped${NC}"
    fi
    
    if [[ "$is_enabled" == "enabled" ]]; then
        echo -e "${GREEN}Auto-start: Enabled${NC}"
    else
        echo -e "${YELLOW}Auto-start: Disabled${NC}"
    fi
    
    # Get PID if running
    if [[ "$is_active" == "active" ]]; then
        local pid=$(systemctl show -p MainPID --value "$SERVICE_NAME")
        if [[ "$pid" != "0" ]]; then
            echo "Process ID: $pid"
        fi
    fi
    
    # Show last start time
    local start_time=$(systemctl show -p ActiveEnterTimestamp --value "$SERVICE_NAME")
    if [[ -n "$start_time" && "$start_time" != "n/a" ]]; then
        echo "Started: $start_time"
    fi
}

enable_autostart() {
    show_header "Enable Auto-Start"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    if [[ ! -f "$SERVICE_FILE" ]]; then
        print_error "Service is not installed"
        press_any_key
        return
    fi
    
    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        print_warning "Auto-start is already enabled"
    else
        systemctl enable "$SERVICE_NAME"
        print_success "Auto-start enabled"
        print_info "Service will start automatically on system boot"
    fi
    
    press_any_key
}

# ============================================================================
# Monitoring Functions
# ============================================================================

view_live_logs() {
    show_header "Live Logs (Press Ctrl+C to exit)"
    
    if [[ ! -f "$LOG_FILE" ]]; then
        print_warning "Log file not found: $LOG_FILE"
        print_info "The service may not have been started yet"
        press_any_key
        return
    fi
    
    echo ""
    print_info "Showing live logs with color coding..."
    echo ""
    
    # Tail logs with color coding
    tail -f "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
        if [[ "$line" =~ ERROR|CRITICAL|EXCEPTION ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ "$line" =~ WARNING|WARN ]]; then
            echo -e "${YELLOW}$line${NC}"
        elif [[ "$line" =~ INFO ]]; then
            echo -e "${GREEN}$line${NC}"
        elif [[ "$line" =~ DEBUG ]]; then
            echo -e "${CYAN}$line${NC}"
        else
            echo "$line"
        fi
    done
}

view_historical_logs() {
    show_header "Historical Logs"
    
    if [[ ! -d "$LOG_DIR" ]]; then
        print_warning "Log directory not found: $LOG_DIR"
        press_any_key
        return
    fi
    
    local log_files=($(ls -t "$LOG_DIR"/*.log 2>/dev/null))
    
    if [[ ${#log_files[@]} -eq 0 ]]; then
        print_warning "No log files found"
        press_any_key
        return
    fi
    
    echo "Available log files:"
    echo ""
    
    local i=1
    for log_file in "${log_files[@]}"; do
        local file_size=$(du -h "$log_file" | cut -f1)
        local file_date=$(stat -c %y "$log_file" 2>/dev/null | cut -d' ' -f1)
        echo "  $i) $(basename "$log_file") ($file_size, $file_date)"
        ((i++))
    done
    
    echo ""
    read -p "Select log file (1-${#log_files[@]}) or 0 to cancel: " selection
    
    if [[ "$selection" == "0" ]]; then
        return
    fi
    
    if [[ "$selection" =~ ^[0-9]+$ ]] && [[ "$selection" -ge 1 ]] && [[ "$selection" -le "${#log_files[@]}" ]]; then
        local selected_file="${log_files[$((selection-1))]}"
        echo ""
        print_info "Viewing: $(basename "$selected_file")"
        echo ""
        less -R "$selected_file"
    else
        print_error "Invalid selection"
    fi
    
    press_any_key
}

show_log_statistics() {
    show_header "Log Statistics"
    
    if [[ ! -f "$LOG_FILE" ]]; then
        print_warning "Log file not found: $LOG_FILE"
        press_any_key
        return
    fi
    
    local total_lines=$(wc -l < "$LOG_FILE")
    local error_count=$(grep -c "ERROR\|CRITICAL" "$LOG_FILE" 2>/dev/null || echo "0")
    local warning_count=$(grep -c "WARNING" "$LOG_FILE" 2>/dev/null || echo "0")
    local info_count=$(grep -c "INFO" "$LOG_FILE" 2>/dev/null || echo "0")
    local file_size=$(du -h "$LOG_FILE" | cut -f1)
    local file_date=$(stat -c %y "$LOG_FILE" 2>/dev/null | cut -d' ' -f1)
    
    echo "Log File: $LOG_FILE"
    echo ""
    echo "Statistics:"
    echo "  Total Lines:    $total_lines"
    echo "  File Size:      $file_size"
    echo "  Last Modified:  $file_date"
    echo ""
    echo "Log Levels:"
    echo -e "  ${RED}Errors:         $error_count${NC}"
    echo -e "  ${YELLOW}Warnings:       $warning_count${NC}"
    echo -e "  ${GREEN}Info:           $info_count${NC}"
    
    # Recent activity
    echo ""
    echo "Recent Activity (last 10 entries):"
    echo ""
    tail -10 "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
        if [[ "$line" =~ ERROR|CRITICAL ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ "$line" =~ WARNING ]]; then
            echo -e "${YELLOW}$line${NC}"
        else
            echo -e "${CYAN}$line${NC}"
        fi
    done
    
    press_any_key
}

clear_old_logs() {
    show_header "Clear Old Logs"
    
    if ! check_root; then
        press_any_key
        return
    fi
    
    if [[ ! -d "$LOG_DIR" ]]; then
        print_warning "Log directory not found"
        press_any_key
        return
    fi
    
    read -p "Delete logs older than how many days? [30]: " retention_days
    retention_days="${retention_days:-30}"
    
    if ! [[ "$retention_days" =~ ^[0-9]+$ ]]; then
        print_error "Invalid number"
        press_any_key
        return
    fi
    
    local old_logs=$(find "$LOG_DIR" -name "*.log" -type f -mtime +$retention_days 2>/dev/null)
    local count=$(echo "$old_logs" | grep -c "." || echo "0")
    
    if [[ "$count" -eq 0 ]]; then
        print_info "No logs older than $retention_days days found"
        press_any_key
        return
    fi
    
    echo "Found $count log file(s) older than $retention_days days"
    echo ""
    
    read -p "Delete these logs? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        find "$LOG_DIR" -name "*.log" -type f -mtime +$retention_days -delete
        print_success "Old logs deleted"
    else
        print_info "Cancelled"
    fi
    
    press_any_key
}

# ============================================================================
# Diagnostic Functions
# ============================================================================

test_dsm_connection() {
    show_header "Test DSM Connection"
    
    local dsm_url=$(get_config_value 'dsm_url')
    
    if [[ -z "$dsm_url" ]]; then
        print_error "DSM URL not configured"
        press_any_key
        return
    fi
    
    print_info "Testing connection to: $dsm_url"
    echo ""
    
    # Test basic connectivity
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$dsm_url" >/dev/null 2>&1; then
        print_success "DSM is reachable"
    else
        print_error "Cannot reach DSM"
        print_info "Check if DSM is running and the URL is correct"
        press_any_key
        return
    fi
    
    # Test authentication with service key
    local service_key=$(get_config_value 'service_role_key')
    if [[ -n "$service_key" ]]; then
        local decrypted_key=$(decrypt_value "$service_key")
        
        print_info "Testing authentication..."
        
        local response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $decrypted_key" \
            -H "apikey: $decrypted_key" \
            "$dsm_url/rest/v1/jobs?limit=1" 2>&1)
        
        local http_code=$(echo "$response" | tail -n1)
        
        if [[ "$http_code" == "200" ]]; then
            print_success "Authentication successful"
            print_info "Service Role Key is valid"
        else
            print_error "Authentication failed (HTTP $http_code)"
            print_info "Service Role Key may be invalid"
        fi
    else
        print_warning "Service Role Key not configured - skipping auth test"
    fi
    
    press_any_key
}

test_vcenter_connection() {
    show_header "Test vCenter Connection"
    
    local vcenter_host=$(get_config_value 'vcenter_host')
    
    if [[ -z "$vcenter_host" ]]; then
        print_warning "vCenter not configured"
        press_any_key
        return
    fi
    
    local vcenter_port=$(get_config_value 'vcenter_port')
    local vcenter_user=$(get_config_value 'vcenter_user')
    local vcenter_password=$(decrypt_value "$(get_config_value 'vcenter_password')")
    
    print_info "Testing connection to: $vcenter_host:$vcenter_port"
    echo ""
    
    # Test basic connectivity
    if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$vcenter_host/$vcenter_port" 2>/dev/null; then
        print_success "vCenter is reachable on port $vcenter_port"
    else
        print_error "Cannot reach vCenter on port $vcenter_port"
        print_info "Check network connectivity and firewall rules"
        press_any_key
        return
    fi
    
    # Test authentication (requires Python)
    if command -v python3 >/dev/null 2>&1; then
        print_info "Testing authentication..."
        
        python3 - <<EOF 2>&1 | while IFS= read -r line; do
            if [[ "\$line" =~ ^SUCCESS ]]; then
                print_success "\${line#SUCCESS: }"
            elif [[ "\$line" =~ ^ERROR ]]; then
                print_error "\${line#ERROR: }"
            else
                echo "\$line"
            fi
        done
import sys
import warnings
warnings.filterwarnings('ignore')

try:
    import ssl
    import requests
    from requests.auth import HTTPBasicAuth
    
    # Disable SSL warnings
    requests.packages.urllib3.disable_warnings()
    
    url = "https://$vcenter_host:$vcenter_port/api/session"
    
    response = requests.post(
        url,
        auth=HTTPBasicAuth("$vcenter_user", "$vcenter_password"),
        verify=False,
        timeout=10
    )
    
    if response.status_code == 201:
        print("SUCCESS: Authentication successful")
        # Try to get vCenter version
        version_url = "https://$vcenter_host:$vcenter_port/api/vcenter/system/version"
        headers = {"vmware-api-session-id": response.json()}
        version_response = requests.get(version_url, headers=headers, verify=False, timeout=10)
        if version_response.status_code == 200:
            version = version_response.json().get("version", "unknown")
            print(f"SUCCESS: vCenter version: {version}")
    else:
        print(f"ERROR: Authentication failed (HTTP {response.status_code})")
        
except ImportError:
    print("ERROR: Python 'requests' library not installed")
    print("Install with: pip3 install requests")
except Exception as e:
    print(f"ERROR: {str(e)}")
EOF
    else
        print_warning "Python not available - skipping authentication test"
    fi
    
    press_any_key
}

test_idrac_connection() {
    show_header "Test iDRAC Connection"
    
    read -p "iDRAC IP Address: " idrac_ip
    
    if [[ -z "$idrac_ip" ]]; then
        print_error "IP address required"
        press_any_key
        return
    fi
    
    local idrac_user=$(get_config_value 'idrac_user')
    local idrac_password=$(decrypt_value "$(get_config_value 'idrac_password')")
    
    if [[ -z "$idrac_user" ]]; then
        read -p "iDRAC Username [root]: " idrac_user
        idrac_user="${idrac_user:-root}"
    fi
    
    if [[ -z "$idrac_password" ]]; then
        read -s -p "iDRAC Password: " idrac_password
        echo ""
    fi
    
    print_info "Testing connection to: $idrac_ip"
    echo ""
    
    # Test basic connectivity
    if ping -c 1 -W 2 "$idrac_ip" >/dev/null 2>&1; then
        print_success "iDRAC is reachable (ping successful)"
    else
        print_warning "iDRAC did not respond to ping (may be disabled)"
    fi
    
    # Test Redfish API
    print_info "Testing Redfish API..."
    
    local response=$(curl -s -k -u "$idrac_user:$idrac_password" \
        --connect-timeout 10 \
        "https://$idrac_ip/redfish/v1/Systems/System.Embedded.1" 2>&1)
    
    if echo "$response" | grep -q "ServiceTag"; then
        print_success "Redfish API is accessible"
        
        local service_tag=$(echo "$response" | grep -o '"ServiceTag":"[^"]*"' | cut -d'"' -f4)
        local model=$(echo "$response" | grep -o '"Model":"[^"]*"' | cut -d'"' -f4)
        
        if [[ -n "$service_tag" ]]; then
            print_info "Service Tag: $service_tag"
        fi
        if [[ -n "$model" ]]; then
            print_info "Model: $model"
        fi
    else
        print_error "Cannot access Redfish API"
        print_info "Check credentials and network connectivity"
    fi
    
    press_any_key
}

run_full_diagnostics() {
    show_header "Full Diagnostics"
    
    echo -e "${CYAN}Running comprehensive diagnostics...${NC}"
    echo ""
    
    # System information
    print_header "1. System Information"
    echo "  OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
    echo "  Kernel: $(uname -r)"
    echo "  Python: $(python3 --version 2>&1)"
    echo ""
    
    # Prerequisites
    print_header "2. Prerequisites Check"
    local all_ok=true
    
    if command -v python3 >/dev/null 2>&1; then
        print_success "Python 3 installed"
    else
        print_error "Python 3 not installed"
        all_ok=false
    fi
    
    if command -v jq >/dev/null 2>&1; then
        print_success "jq installed"
    else
        print_error "jq not installed"
        all_ok=false
    fi
    
    if command -v openssl >/dev/null 2>&1; then
        print_success "OpenSSL installed"
    else
        print_error "OpenSSL not installed"
        all_ok=false
    fi
    
    if [[ -f "$EXECUTOR_SCRIPT" ]]; then
        print_success "Job Executor script found"
    else
        print_error "Job Executor script not found"
        all_ok=false
    fi
    
    echo ""
    
    # Configuration
    print_header "3. Configuration Check"
    if [[ -f "$CONFIG_FILE" ]]; then
        print_success "Configuration file exists"
        
        if jq empty "$CONFIG_FILE" 2>/dev/null; then
            print_success "Configuration is valid JSON"
            
            local service_key=$(get_config_value 'service_role_key')
            if [[ -n "$service_key" ]]; then
                print_success "Service Role Key configured"
            else
                print_error "Service Role Key not configured"
                all_ok=false
            fi
        else
            print_error "Configuration has invalid JSON"
            all_ok=false
        fi
    else
        print_error "Configuration file not found"
        all_ok=false
    fi
    
    echo ""
    
    # Service status
    print_header "4. Service Status"
    if [[ -f "$SERVICE_FILE" ]]; then
        print_success "Service is installed"
        
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            print_success "Service is running"
        else
            print_warning "Service is not running"
        fi
        
        if systemctl is-enabled --quiet "$SERVICE_NAME"; then
            print_success "Auto-start is enabled"
        else
            print_warning "Auto-start is disabled"
        fi
    else
        print_warning "Service is not installed"
    fi
    
    echo ""
    
    # Log directory
    print_header "5. Log Directory"
    if [[ -d "$LOG_DIR" ]]; then
        print_success "Log directory exists"
        
        local log_count=$(ls -1 "$LOG_DIR"/*.log 2>/dev/null | wc -l)
        echo "  Log files: $log_count"
        
        local log_size=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
        echo "  Total size: $log_size"
    else
        print_warning "Log directory not found"
    fi
    
    echo ""
    
    # Connectivity tests
    print_header "6. Connectivity Tests"
    
    local dsm_url=$(get_config_value 'dsm_url')
    if [[ -n "$dsm_url" ]]; then
        if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$dsm_url" >/dev/null 2>&1; then
            print_success "DSM is reachable"
        else
            print_error "Cannot reach DSM"
            all_ok=false
        fi
    else
        print_warning "DSM URL not configured"
    fi
    
    local vcenter_host=$(get_config_value 'vcenter_host')
    if [[ -n "$vcenter_host" ]]; then
        local vcenter_port=$(get_config_value 'vcenter_port')
        if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$vcenter_host/$vcenter_port" 2>/dev/null; then
            print_success "vCenter is reachable"
        else
            print_warning "Cannot reach vCenter"
        fi
    else
        print_info "vCenter not configured (optional)"
    fi
    
    echo ""
    
    # Summary
    print_header "Summary"
    if $all_ok; then
        print_success "All critical checks passed"
        print_info "System is ready for operation"
    else
        print_warning "Some issues were found"
        print_info "Review the diagnostics above and fix any errors"
    fi
    
    press_any_key
}

generate_support_report() {
    show_header "Generate Support Report"
    
    local report_file="/tmp/dell-server-manager-diagnostics-$(date +%Y%m%d-%H%M%S).txt"
    
    print_info "Generating diagnostic report..."
    echo ""
    
    {
        echo "================================================================"
        echo "Dell Server Manager - Diagnostic Report"
        echo "Generated: $(date)"
        echo "================================================================"
        echo ""
        
        echo "SYSTEM INFORMATION"
        echo "------------------"
        echo "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
        echo "Kernel: $(uname -r)"
        echo "Hostname: $(hostname)"
        echo "Python Version: $(python3 --version 2>&1)"
        echo ""
        
        echo "SERVICE STATUS"
        echo "--------------"
        if [[ -f "$SERVICE_FILE" ]]; then
            systemctl status "$SERVICE_NAME" 2>&1 || echo "Service status unavailable"
        else
            echo "Service not installed"
        fi
        echo ""
        
        echo "CONFIGURATION (Sanitized)"
        echo "-------------------------"
        if [[ -f "$CONFIG_FILE" ]]; then
            jq 'walk(if type == "string" and (. | startswith("encrypted:")) then "********" else . end)' "$CONFIG_FILE" 2>/dev/null || echo "Configuration unavailable"
        else
            echo "Configuration file not found"
        fi
        echo ""
        
        echo "RECENT LOGS (Last 100 lines)"
        echo "----------------------------"
        if [[ -f "$LOG_FILE" ]]; then
            tail -100 "$LOG_FILE" 2>/dev/null || echo "Log file unavailable"
        else
            echo "Log file not found"
        fi
        echo ""
        
        echo "RECENT ERRORS (Last 50 lines)"
        echo "------------------------------"
        if [[ -f "$ERROR_LOG_FILE" ]]; then
            tail -50 "$ERROR_LOG_FILE" 2>/dev/null || echo "Error log unavailable"
        else
            echo "Error log file not found"
        fi
        echo ""
        
        echo "DISK SPACE"
        echo "----------"
        df -h "$CONFIG_DIR" "$LOG_DIR" 2>/dev/null || echo "Disk space info unavailable"
        echo ""
        
        echo "FILE PERMISSIONS"
        echo "----------------"
        ls -la "$CONFIG_DIR" 2>/dev/null || echo "Config directory unavailable"
        echo ""
        ls -la "$LOG_DIR" 2>/dev/null || echo "Log directory unavailable"
        echo ""
        
        echo "================================================================"
        echo "End of Diagnostic Report"
        echo "================================================================"
        
    } > "$report_file"
    
    chmod 600 "$report_file"
    
    print_success "Report generated: $report_file"
    echo ""
    
    read -p "View report now? (Y/n): " view_report
    if [[ ! "$view_report" =~ ^[Nn]$ ]]; then
        less "$report_file"
    fi
    
    print_info "Include this report when contacting support"
    press_any_key
}

# ============================================================================
# Menu Functions
# ============================================================================

show_service_menu() {
    while true; do
        show_header "Service Management"
        
        echo "  1) Check Status"
        echo "  2) Start Service"
        echo "  3) Stop Service"
        echo "  4) Restart Service"
        echo "  5) Install Service"
        echo "  6) Uninstall Service"
        echo "  7) Enable Auto-Start"
        echo ""
        echo "  0) Back to Main Menu"
        echo ""
        
        read -p "Select option: " option
        
        case $option in
            1)
                show_header "Service Status"
                get_service_status
                press_any_key
                ;;
            2) start_service ;;
            3) stop_service ;;
            4) restart_service ;;
            5) install_service ;;
            6) uninstall_service ;;
            7) enable_autostart ;;
            0) return ;;
            *) 
                print_error "Invalid option"
                sleep 1
                ;;
        esac
    done
}

show_config_menu() {
    while true; do
        show_header "Configuration Management"
        
        echo "  1) View Current Configuration"
        echo "  2) Edit Configuration"
        echo "  3) Quick Setup Wizard"
        echo "  4) Export Configuration"
        echo "  5) Import Configuration"
        echo ""
        echo "  0) Back to Main Menu"
        echo ""
        
        read -p "Select option: " option
        
        case $option in
            1) show_current_config ;;
            2) edit_configuration ;;
            3) quick_setup_wizard ;;
            4) export_configuration ;;
            5) import_configuration ;;
            0) return ;;
            *) 
                print_error "Invalid option"
                sleep 1
                ;;
        esac
    done
}

show_monitoring_menu() {
    while true; do
        show_header "Monitoring & Logs"
        
        echo "  1) View Live Logs (tail -f)"
        echo "  2) View Historical Logs"
        echo "  3) Log Statistics"
        echo "  4) Clear Old Logs"
        echo ""
        echo "  0) Back to Main Menu"
        echo ""
        
        read -p "Select option: " option
        
        case $option in
            1) view_live_logs ;;
            2) view_historical_logs ;;
            3) show_log_statistics ;;
            4) clear_old_logs ;;
            0) return ;;
            *) 
                print_error "Invalid option"
                sleep 1
                ;;
        esac
    done
}

show_diagnostics_menu() {
    while true; do
        show_header "Diagnostics"
        
        echo "  1) Test DSM Connection"
        echo "  2) Test vCenter Connection"
        echo "  3) Test iDRAC Connection"
        echo "  4) Run Full Diagnostics"
        echo "  5) Generate Support Report"
        echo ""
        echo "  0) Back to Main Menu"
        echo ""
        
        read -p "Select option: " option
        
        case $option in
            1) test_dsm_connection ;;
            2) test_vcenter_connection ;;
            3) test_idrac_connection ;;
            4) run_full_diagnostics ;;
            5) generate_support_report ;;
            0) return ;;
            *) 
                print_error "Invalid option"
                sleep 1
                ;;
        esac
    done
}

show_main_menu() {
    while true; do
        show_header
        
        # Show quick status
        if [[ -f "$SERVICE_FILE" ]]; then
            if systemctl is-active --quiet "$SERVICE_NAME"; then
                echo -e "  Service Status: ${GREEN}Running${NC}"
            else
                echo -e "  Service Status: ${YELLOW}Stopped${NC}"
            fi
        else
            echo -e "  Service Status: ${YELLOW}Not Installed${NC}"
        fi
        
        echo ""
        echo "  1) Service Management"
        echo "  2) Configuration"
        echo "  3) Monitoring & Logs"
        echo "  4) Diagnostics"
        echo ""
        echo "  5) Exit"
        echo ""
        
        read -p "Select option: " option
        
        case $option in
            1) show_service_menu ;;
            2) show_config_menu ;;
            3) show_monitoring_menu ;;
            4) show_diagnostics_menu ;;
            5) 
                clear
                echo -e "${GREEN}Thank you for using Dell Server Manager!${NC}"
                exit 0
                ;;
            *) 
                print_error "Invalid option"
                sleep 1
                ;;
        esac
    done
}

# ============================================================================
# Main Entry Point
# ============================================================================

main() {
    # Check dependencies
    if ! check_dependencies; then
        echo ""
        print_error "Please install missing dependencies and try again"
        exit 1
    fi
    
    # Ensure directories exist
    if check_root 2>/dev/null; then
        mkdir -p "$CONFIG_DIR" "$LOG_DIR"
        
        # Generate master key if it doesn't exist
        if [[ ! -f "$MASTER_KEY_FILE" ]]; then
            generate_master_key
        fi
        
        # Initialize config file if it doesn't exist
        if [[ ! -f "$CONFIG_FILE" ]]; then
            init_config_file
        fi
    fi
    
    # Show main menu
    show_main_menu
}

# Run main function
main "$@"
