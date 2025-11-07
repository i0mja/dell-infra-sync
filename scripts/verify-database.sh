#!/bin/bash
# Database Schema Verification Script for Dell Server Manager
# Verifies that all required database objects exist in the local Supabase instance

set +e  # Continue on errors

DB_URL="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
FAILURE_COUNT=0
SUCCESS_COUNT=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

write_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((SUCCESS_COUNT++))
}

write_failure() {
    echo -e "${RED}[✗]${NC} $1"
    ((FAILURE_COUNT++))
}

test_database_connection() {
    echo -e "\n${CYAN}=== Testing Database Connection ===${NC}"
    
    if docker exec supabase-db psql -U postgres -t -c "SELECT version();" &>/dev/null; then
        write_success "Database connection successful"
        return 0
    else
        write_failure "Cannot connect to database"
        return 1
    fi
}

test_custom_types() {
    echo -e "\n${CYAN}=== Verifying Custom Types ===${NC}"
    
    local types=("app_role" "job_status" "job_type")
    
    for type in "${types[@]}"; do
        local result=$(docker exec supabase-db psql -U postgres -t -c "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '$type');" 2>/dev/null)
        
        if [[ $result == *"t"* ]]; then
            write_success "Custom type '$type' exists"
        else
            write_failure "Custom type '$type' is missing"
        fi
    done
}

test_tables() {
    echo -e "\n${CYAN}=== Verifying Tables ===${NC}"
    
    local tables=(
        "profiles"
        "user_roles"
        "servers"
        "vcenter_hosts"
        "jobs"
        "job_tasks"
        "audit_logs"
        "notification_settings"
        "openmanage_settings"
        "api_tokens"
    )
    
    for table in "${tables[@]}"; do
        local result=$(docker exec supabase-db psql -U postgres -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');" 2>/dev/null)
        
        if [[ $result == *"t"* ]]; then
            write_success "Table 'public.$table' exists"
        else
            write_failure "Table 'public.$table' is missing"
        fi
    done
}

test_functions() {
    echo -e "\n${CYAN}=== Verifying Functions ===${NC}"
    
    local functions=(
        "update_updated_at_column"
        "handle_new_user"
        "has_role"
        "get_user_role"
        "validate_api_token"
    )
    
    for func in "${functions[@]}"; do
        local result=$(docker exec supabase-db psql -U postgres -t -c "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '$func');" 2>/dev/null)
        
        if [[ $result == *"t"* ]]; then
            write_success "Function 'public.$func' exists"
        else
            write_failure "Function 'public.$func' is missing"
        fi
    done
}

test_triggers() {
    echo -e "\n${CYAN}=== Verifying Triggers ===${NC}"
    
    local triggers=(
        "on_auth_user_created:users:auth"
        "update_profiles_updated_at:profiles:public"
        "update_servers_updated_at:servers:public"
        "update_vcenter_hosts_updated_at:vcenter_hosts:public"
        "update_notification_settings_updated_at:notification_settings:public"
        "update_openmanage_settings_updated_at:openmanage_settings:public"
    )
    
    for trigger_info in "${triggers[@]}"; do
        IFS=':' read -r trigger_name table_name schema_name <<< "$trigger_info"
        local result=$(docker exec supabase-db psql -U postgres -t -c "SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE t.tgname = '$trigger_name' AND c.relname = '$table_name' AND n.nspname = '$schema_name');" 2>/dev/null)
        
        if [[ $result == *"t"* ]]; then
            write_success "Trigger '$trigger_name' exists on $schema_name.$table_name"
        else
            write_failure "Trigger '$trigger_name' is missing on $schema_name.$table_name"
        fi
    done
}

test_rls_enabled() {
    echo -e "\n${CYAN}=== Verifying RLS is Enabled ===${NC}"
    
    local tables=(
        "profiles" "user_roles" "servers" "vcenter_hosts"
        "jobs" "job_tasks" "audit_logs" "notification_settings"
        "openmanage_settings" "api_tokens"
    )
    
    for table in "${tables[@]}"; do
        local result=$(docker exec supabase-db psql -U postgres -t -c "SELECT relrowsecurity FROM pg_class WHERE relname = '$table';" 2>/dev/null)
        
        if [[ $result == *"t"* ]]; then
            write_success "RLS enabled on 'public.$table'"
        else
            write_failure "RLS not enabled on 'public.$table'"
        fi
    done
}

test_rls_policies() {
    echo -e "\n${CYAN}=== Verifying RLS Policies ===${NC}"
    
    local result=$(docker exec supabase-db psql -U postgres -t -c "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';" 2>/dev/null)
    local policy_count=$(echo $result | tr -d ' ')
    
    if [ "$policy_count" -gt 20 ]; then
        write_success "Found $policy_count RLS policies in public schema"
    else
        write_failure "Only found $policy_count RLS policies (expected 20+)"
    fi
}

show_summary() {
    echo -e "\n${CYAN}=== Verification Summary ===${NC}"
    echo -e "${GREEN}Passed: $SUCCESS_COUNT${NC}"
    echo -e "${RED}Failed: $FAILURE_COUNT${NC}"
    
    if [ $FAILURE_COUNT -eq 0 ]; then
        echo -e "\n${GREEN}✓ Database schema is fully configured!${NC}"
        exit 0
    else
        echo -e "\n${RED}✗ Database schema has missing components!${NC}"
        echo -e "\n${YELLOW}To fix, run:${NC}"
        echo -e "${YELLOW}  docker exec supabase-db psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'${NC}"
        echo -e "${YELLOW}  supabase db reset${NC}"
        exit 1
    fi
}

# Main execution
echo -e "${CYAN}Dell Server Manager - Database Schema Verification${NC}"
echo -e "${CYAN}=================================================${NC}"

if test_database_connection; then
    test_custom_types
    test_tables
    test_functions
    test_triggers
    test_rls_enabled
    test_rls_policies
fi

show_summary
