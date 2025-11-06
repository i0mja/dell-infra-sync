#!/bin/bash

# Health check script for Dell Server Manager (RHEL/CentOS/Rocky Linux)
# Validates deployment configuration and tests connectivity to selected backend

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Flags
DETAILED=0
QUIET=0
EXPORT_JSON=""

# Health check results
declare -A RESULTS
RESULTS[timestamp]=$(date '+%Y-%m-%d %H:%M:%S')
RESULTS[mode]="Unknown"
RESULTS[total_checks]=0
RESULTS[passed_checks]=0
RESULTS[overall_health]=0

# JSON output array
declare -a CHECK_RESULTS

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --detailed)
            DETAILED=1
            shift
            ;;
        --quiet)
            QUIET=1
            shift
            ;;
        --json)
            EXPORT_JSON="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--detailed] [--quiet] [--json output.json]"
            exit 1
            ;;
    esac
done

# Function to print status messages
write_status() {
    local message="$1"
    local type="${2:-INFO}"
    
    if [ "$QUIET" -eq 1 ]; then
        return
    fi
    
    case "$type" in
        SUCCESS)
            echo -e "${GREEN}✅ ${message}${NC}"
            ;;
        ERROR)
            echo -e "${RED}❌ ${message}${NC}"
            ;;
        WARNING)
            echo -e "${YELLOW}⚠️  ${message}${NC}"
            ;;
        INFO)
            echo -e "${CYAN}ℹ️  ${message}${NC}"
            ;;
    esac
}

# Function to add check result
add_check_result() {
    local category="$1"
    local check="$2"
    local passed="$3"
    local message="$4"
    local details="${5:-}"
    local remediation="${6:-}"
    
    RESULTS[total_checks]=$((RESULTS[total_checks] + 1))
    
    if [ "$passed" = "true" ]; then
        RESULTS[passed_checks]=$((RESULTS[passed_checks] + 1))
        write_status "[$category] $check: $message" "SUCCESS"
    else
        write_status "[$category] $check: $message" "ERROR"
    fi
    
    if [ "$DETAILED" -eq 1 ] && [ -n "$details" ]; then
        echo -e "${GRAY}    Details: $details${NC}"
    fi
    
    if [ "$passed" = "false" ] && [ -n "$remediation" ]; then
        echo -e "${YELLOW}    💡 Fix: $remediation${NC}"
    fi
    
    # Store for JSON export
    CHECK_RESULTS+=("{\"category\":\"$category\",\"check\":\"$check\",\"passed\":$passed,\"message\":\"$message\",\"details\":\"$details\",\"remediation\":\"$remediation\"}")
}

# Function to detect deployment mode
get_deployment_mode() {
    local env_file="/opt/dell-server-manager/.env"
    
    if [ ! -f "$env_file" ]; then
        echo "Unknown"
        return
    fi
    
    if grep -q "VITE_SUPABASE_URL.*127\.0\.0\.1\|localhost" "$env_file"; then
        echo "Local"
    elif grep -q "VITE_SUPABASE_URL.*supabase\.co" "$env_file"; then
        echo "Cloud"
    else
        echo "Unknown"
    fi
}

# Function to test configuration
test_configuration() {
    write_status "" "INFO"
    write_status "[CONFIG] Validating Configuration..." "INFO"
    
    local env_file="/opt/dell-server-manager/.env"
    
    # Check .env exists
    if [ -f "$env_file" ]; then
        add_check_result "CONFIG" "Configuration File" "true" "Found" "$env_file"
    else
        add_check_result "CONFIG" "Configuration File" "false" "Not found" "" "Run deployment script to create .env file"
        return 1
    fi
    
    # Validate required variables
    local required_vars=("VITE_SUPABASE_URL" "VITE_SUPABASE_PUBLISHABLE_KEY" "VITE_SUPABASE_PROJECT_ID")
    local all_present=true
    
    for var in "${required_vars[@]}"; do
        if grep -q "^${var}=" "$env_file"; then
            local value=$(grep "^${var}=" "$env_file" | cut -d= -f2 | tr -d '"' | head -c 30)
            add_check_result "CONFIG" "$var" "true" "Set" "${value}..."
        else
            add_check_result "CONFIG" "$var" "false" "Missing" "" "Add $var to .env file"
            all_present=false
        fi
    done
    
    if [ "$all_present" = false ]; then
        return 1
    fi
    
    return 0
}

# Function to test services
test_services() {
    write_status "" "INFO"
    write_status "[SERVICE] Checking Services..." "INFO"
    
    # Check systemd service
    if systemctl is-active --quiet dell-server-manager; then
        add_check_result "SERVICE" "dell-server-manager" "true" "Running"
    else
        local status=$(systemctl is-active dell-server-manager 2>&1 || echo "inactive")
        add_check_result "SERVICE" "dell-server-manager" "false" "Not running (Status: $status)" "" "Start service: sudo systemctl start dell-server-manager"
    fi
    
    # Check if app is listening on port 3000
    if ss -tuln | grep -q ":3000 "; then
        add_check_result "SERVICE" "Application Port 3000" "true" "Listening"
    else
        add_check_result "SERVICE" "Application Port 3000" "false" "Not listening" "" "Check if dell-server-manager service is running and logs for errors"
    fi
    
    # Docker checks (local mode only)
    if [ "${RESULTS[mode]}" = "Local" ]; then
        if systemctl is-active --quiet docker; then
            add_check_result "SERVICE" "Docker" "true" "Running"
            
            # Check Supabase containers
            local container_count=$(docker ps --filter "name=supabase" --format "{{.Names}}" 2>/dev/null | wc -l)
            
            if [ "$container_count" -gt 0 ]; then
                local containers=$(docker ps --filter "name=supabase" --format "{{.Names}}" 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
                add_check_result "SERVICE" "Supabase Containers" "true" "$container_count containers running" "$containers"
            else
                add_check_result "SERVICE" "Supabase Containers" "false" "No containers running" "" "Start Supabase: cd /opt/dell-supabase && supabase start"
            fi
        else
            add_check_result "SERVICE" "Docker" "false" "Not running" "" "Start Docker: sudo systemctl start docker"
        fi
    fi
}

# Function to test connectivity
test_connectivity() {
    write_status "" "INFO"
    write_status "[NETWORK] Testing Connectivity..." "INFO"
    
    # Test application
    local start_time=$(date +%s%3N)
    if curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000 >/dev/null 2>&1; then
        local end_time=$(date +%s%3N)
        local elapsed=$((end_time - start_time))
        local status_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000)
        
        if [ "$status_code" = "200" ]; then
            add_check_result "NETWORK" "Application (port 3000)" "true" "Responding" "${elapsed}ms"
        else
            add_check_result "NETWORK" "Application (port 3000)" "false" "HTTP $status_code"
        fi
    else
        add_check_result "NETWORK" "Application (port 3000)" "false" "Connection failed" "" "Check if dell-server-manager service is running"
    fi
    
    # Get Supabase URL from .env
    local env_file="/opt/dell-server-manager/.env"
    local supabase_url=""
    
    if [ -f "$env_file" ]; then
        supabase_url=$(grep "^VITE_SUPABASE_URL=" "$env_file" | cut -d= -f2 | tr -d '"')
    fi
    
    if [ -n "$supabase_url" ]; then
        # Test Supabase REST API
        local start_time=$(date +%s%3N)
        if curl -s -o /dev/null --max-time 10 "${supabase_url}/rest/v1/" >/dev/null 2>&1; then
            local end_time=$(date +%s%3N)
            local elapsed=$((end_time - start_time))
            add_check_result "NETWORK" "Backend REST API" "true" "Accessible" "${elapsed}ms"
        else
            add_check_result "NETWORK" "Backend REST API" "false" "Connection failed" "" "Check backend service status"
        fi
        
        # Test Auth endpoint
        if curl -s -o /dev/null --max-time 10 "${supabase_url}/auth/v1/health" >/dev/null 2>&1; then
            add_check_result "NETWORK" "Backend Auth API" "true" "Accessible"
        else
            add_check_result "NETWORK" "Backend Auth API" "false" "Connection failed"
        fi
    fi
}

# Function to test local database
test_local_database() {
    if [ "${RESULTS[mode]}" != "Local" ]; then
        return
    fi
    
    write_status "" "INFO"
    write_status "[DATABASE] Testing Local Database..." "INFO"
    
    # Check PostgreSQL container
    if docker ps --filter "name=supabase-db" --format "{{.Names}}" 2>/dev/null | grep -q "supabase-db"; then
        add_check_result "DATABASE" "PostgreSQL Container" "true" "Running"
        
        # Test database connection
        local table_count=$(docker exec supabase-db psql -U postgres -d postgres -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
        
        if [ -n "$table_count" ]; then
            add_check_result "DATABASE" "Database Connection" "true" "Connected" "$table_count tables in public schema"
            
            # Check for required tables
            local required_tables=("profiles" "user_roles" "servers" "jobs" "job_tasks")
            for table in "${required_tables[@]}"; do
                local exists=$(docker exec supabase-db psql -U postgres -d postgres -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');" 2>/dev/null | tr -d ' ')
                
                if [ "$exists" = "t" ]; then
                    add_check_result "DATABASE" "Table: $table" "true" "Exists"
                else
                    add_check_result "DATABASE" "Table: $table" "false" "Missing" "" "Run database migrations"
                fi
            done
        else
            add_check_result "DATABASE" "Database Connection" "false" "Connection failed" "" "Check PostgreSQL container logs: docker logs supabase-db"
        fi
    else
        add_check_result "DATABASE" "PostgreSQL Container" "false" "Not running" "" "Start Supabase: cd /opt/dell-supabase && supabase start"
    fi
}

# Function to show health report
show_health_report() {
    if [ "$QUIET" -eq 1 ]; then
        return
    fi
    
    echo ""
    echo -e "${CYAN}=====================================${NC}"
    echo -e "${CYAN}🏥 Dell Server Manager - Health Check${NC}"
    echo -e "${CYAN}=====================================${NC}"
    echo ""
    
    echo -n "Deployment Mode: "
    if [ "${RESULTS[mode]}" = "Unknown" ]; then
        echo -e "${RED}${RESULTS[mode]}${NC}"
    else
        echo -e "${GREEN}${RESULTS[mode]}${NC}"
    fi
    
    echo "Timestamp: ${RESULTS[timestamp]}"
    
    # Calculate health percentage
    if [ "${RESULTS[total_checks]}" -gt 0 ]; then
        local health_percent=$((RESULTS[passed_checks] * 100 / RESULTS[total_checks]))
        RESULTS[overall_health]=$health_percent
        
        echo ""
        echo -n "Overall Health: "
        
        if [ "$health_percent" -eq 100 ]; then
            echo -e "${GREEN}✅ HEALTHY ($health_percent%)${NC}"
        elif [ "$health_percent" -ge 70 ]; then
            echo -e "${YELLOW}⚠️  DEGRADED ($health_percent%)${NC}"
        else
            echo -e "${RED}❌ UNHEALTHY ($health_percent%)${NC}"
        fi
        
        echo "Checks: ${RESULTS[passed_checks]}/${RESULTS[total_checks]} passed"
    fi
    
    # Show failed checks summary
    local has_failures=false
    for result in "${CHECK_RESULTS[@]}"; do
        if echo "$result" | grep -q '"passed":false'; then
            if [ "$has_failures" = false ]; then
                echo ""
                echo -e "${YELLOW}⚠️  Failed Checks:${NC}"
                has_failures=true
            fi
            
            local category=$(echo "$result" | grep -oP '(?<="category":")[^"]*')
            local check=$(echo "$result" | grep -oP '(?<="check":")[^"]*')
            local message=$(echo "$result" | grep -oP '(?<="message":")[^"]*')
            local remediation=$(echo "$result" | grep -oP '(?<="remediation":")[^"]*')
            
            echo -e "${RED}  • [$category] $check: $message${NC}"
            if [ -n "$remediation" ]; then
                echo -e "${YELLOW}    Fix: $remediation${NC}"
            fi
        fi
    done
    
    echo ""
    echo -e "${CYAN}=====================================${NC}"
    echo -e "${GRAY}Next Check: Run ./scripts/health-check.sh${NC}"
    echo -e "${CYAN}=====================================${NC}"
}

# Function to export results to JSON
export_results() {
    if [ -z "$EXPORT_JSON" ]; then
        return
    fi
    
    local checks_json=$(printf '%s\n' "${CHECK_RESULTS[@]}" | paste -sd,)
    
    cat > "$EXPORT_JSON" <<EOF
{
  "timestamp": "${RESULTS[timestamp]}",
  "mode": "${RESULTS[mode]}",
  "total_checks": ${RESULTS[total_checks]},
  "passed_checks": ${RESULTS[passed_checks]},
  "overall_health": ${RESULTS[overall_health]},
  "checks": [$checks_json]
}
EOF
    
    write_status "Results exported to: $EXPORT_JSON" "SUCCESS"
}

# Main execution
main() {
    if [ "$QUIET" -eq 0 ]; then
        echo -e "${CYAN}🏥 Dell Server Manager - Health Check${NC}"
        echo -e "${CYAN}=====================================${NC}"
        echo ""
    fi
    
    # Detect deployment mode
    RESULTS[mode]=$(get_deployment_mode)
    
    if [ "${RESULTS[mode]}" != "Unknown" ]; then
        write_status "[CONFIG] Deployment Mode: ${RESULTS[mode]}" "INFO"
    else
        write_status "[CONFIG] Deployment Mode: Unknown (could not detect)" "WARNING"
    fi
    
    # Run health checks
    if test_configuration; then
        test_services
        test_connectivity
        test_local_database
    else
        write_status "" "WARNING"
        write_status "⚠️  Configuration validation failed. Skipping remaining checks." "WARNING"
    fi
    
    # Show report
    show_health_report
    
    # Export if requested
    export_results
    
    # Exit code based on health
    if [ "${RESULTS[overall_health]}" -ge 70 ]; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main "$@"
