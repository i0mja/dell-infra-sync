#!/usr/bin/env pwsh
# Database Schema Verification Script for Dell Server Manager
# Verifies that all required database objects exist in the local Supabase instance

param(
    [string]$DbUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    [switch]$Verbose
)

if ($Verbose) {
    $VerbosePreference = "Continue"
}

$ErrorActionPreference = "Continue"
$script:FailureCount = 0
$script:SuccessCount = 0

function Write-Success {
    param([string]$Message)
    Write-Host "[✓] $Message" -ForegroundColor Green
    $script:SuccessCount++
}

function Write-Failure {
    param([string]$Message)
    Write-Host "[✗] $Message" -ForegroundColor Red
    $script:FailureCount++
}

# Function to get the actual Supabase database container name
function Get-SupabaseDbContainer {
    try {
        $containers = docker ps --filter "name=supabase" --format "{{.Names}}" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Docker command failed: $containers"
        }
        $dbContainer = $containers | Where-Object { $_ -match "supabase.*_db_" } | Select-Object -First 1
        if ([string]::IsNullOrEmpty($dbContainer)) {
            throw "No Supabase database container found. Run 'docker ps --filter name=supabase' to verify."
        }
        return $dbContainer.Trim()
    } catch {
        Write-Host "[ERROR] Container detection failed: $_" -ForegroundColor Red
        Write-Host "[DEBUG] Available containers:" -ForegroundColor Yellow
        docker ps --format "{{.Names}}" | Write-Host -ForegroundColor Gray
        throw
    }
}

function Test-DatabaseConnection {
    Write-Host "`n=== Testing Database Connection ===" -ForegroundColor Cyan
    
    try {
        $dbContainer = Get-SupabaseDbContainer
        Write-Host "[DEBUG] Using container: $dbContainer" -ForegroundColor Gray
        
        $query = "SELECT version();"
        $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            Write-Host "[DEBUG] PostgreSQL version: $($result.Trim())" -ForegroundColor Gray
            Write-Success "Database connection successful"
            return $true
        } else {
            Write-Host "[ERROR] Connection failed with exit code: $exitCode" -ForegroundColor Red
            Write-Host "[ERROR] Docker exec output: $result" -ForegroundColor Red
            Write-Host "[DEBUG] Attempted connection to container: $dbContainer" -ForegroundColor Yellow
            Write-Failure "Cannot connect to database"
            return $false
        }
    } catch {
        Write-Host "[ERROR] Exception during connection test: $_" -ForegroundColor Red
        Write-Failure "Cannot connect to database"
        return $false
    }
}

function Test-CustomTypes {
    Write-Host "`n=== Verifying Custom Types ===" -ForegroundColor Cyan
    
    $dbContainer = Get-SupabaseDbContainer
    $types = @('app_role', 'job_status', 'job_type')
    
    foreach ($type in $types) {
        $query = "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '$type');"
        Write-Verbose "Query: $query"
        $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
        
        if ($result -match 't') {
            Write-Success "Custom type '$type' exists"
        } else {
            Write-Host "[ERROR] Query result: $result" -ForegroundColor Red
            Write-Failure "Custom type '$type' is missing"
        }
    }
}

function Test-Tables {
    Write-Host "`n=== Verifying Tables ===" -ForegroundColor Cyan
    
    $dbContainer = Get-SupabaseDbContainer
    $tables = @(
        'profiles',
        'user_roles',
        'servers',
        'vcenter_hosts',
        'jobs',
        'job_tasks',
        'audit_logs',
        'notification_settings',
        'openmanage_settings',
        'api_tokens'
    )
    
    foreach ($table in $tables) {
        $query = "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');"
        Write-Verbose "Query: $query"
        $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
        
        if ($result -match 't') {
            Write-Success "Table 'public.$table' exists"
        } else {
            Write-Host "[ERROR] Query result: $result" -ForegroundColor Red
            Write-Failure "Table 'public.$table' is missing"
        }
    }
}

function Test-Functions {
    Write-Host "`n=== Verifying Functions ===" -ForegroundColor Cyan
    
    $dbContainer = Get-SupabaseDbContainer
    $functions = @(
        'update_updated_at_column',
        'handle_new_user',
        'has_role',
        'get_user_role',
        'validate_api_token'
    )
    
    foreach ($func in $functions) {
        $query = "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '$func');"
        Write-Verbose "Query: $query"
        $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
        
        if ($result -match 't') {
            Write-Success "Function 'public.$func' exists"
        } else {
            Write-Host "[ERROR] Query result: $result" -ForegroundColor Red
            Write-Failure "Function 'public.$func' is missing"
        }
    }
}

function Test-Triggers {
    Write-Host "`n=== Verifying Triggers ===" -ForegroundColor Cyan
    
    $dbContainer = Get-SupabaseDbContainer
    $triggers = @(
        @{Name='on_auth_user_created'; Table='users'; Schema='auth'},
        @{Name='update_profiles_updated_at'; Table='profiles'; Schema='public'},
        @{Name='update_servers_updated_at'; Table='servers'; Schema='public'},
        @{Name='update_vcenter_hosts_updated_at'; Table='vcenter_hosts'; Schema='public'},
        @{Name='update_notification_settings_updated_at'; Table='notification_settings'; Schema='public'},
        @{Name='update_openmanage_settings_updated_at'; Table='openmanage_settings'; Schema='public'}
    )
    
    foreach ($trigger in $triggers) {
        $query = "SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE t.tgname = '$($trigger.Name)' AND c.relname = '$($trigger.Table)' AND n.nspname = '$($trigger.Schema)');"
        Write-Verbose "Query: $query"
        $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
        
        if ($result -match 't') {
            Write-Success "Trigger '$($trigger.Name)' exists on $($trigger.Schema).$($trigger.Table)"
        } else {
            Write-Host "[ERROR] Query result: $result" -ForegroundColor Red
            Write-Failure "Trigger '$($trigger.Name)' is missing on $($trigger.Schema).$($trigger.Table)"
        }
    }
}

function Test-RLSEnabled {
    Write-Host "`n=== Verifying RLS is Enabled ===" -ForegroundColor Cyan
    
    $dbContainer = Get-SupabaseDbContainer
    $tables = @(
        'profiles', 'user_roles', 'servers', 'vcenter_hosts',
        'jobs', 'job_tasks', 'audit_logs', 'notification_settings',
        'openmanage_settings', 'api_tokens'
    )
    
    foreach ($table in $tables) {
        $query = "SELECT relrowsecurity FROM pg_class WHERE relname = '$table';"
        Write-Verbose "Query: $query"
        $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
        
        if ($result -match 't') {
            Write-Success "RLS enabled on 'public.$table'"
        } else {
            Write-Host "[ERROR] Query result: $result" -ForegroundColor Red
            Write-Failure "RLS not enabled on 'public.$table'"
        }
    }
}

function Test-RLSPolicies {
    Write-Host "`n=== Verifying RLS Policies ===" -ForegroundColor Cyan
    
    $dbContainer = Get-SupabaseDbContainer
    $query = "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';"
    Write-Verbose "Query: $query"
    $result = docker exec $dbContainer psql -U postgres -t -c $query 2>&1
    
    # Convert to string properly, handling both array and string results
    if ($result -is [array]) {
        $policyCountStr = ($result -join "").Trim()
    } else {
        $policyCountStr = ([string]$result).Trim()
    }
    
    Write-Verbose "Raw result type: $($result.GetType().Name)"
    Write-Verbose "Parsed count string: '$policyCountStr'"
    
    # Try to parse as integer
    try {
        $policyCount = [int]$policyCountStr
        
        if ($LASTEXITCODE -eq 0 -and $policyCount -gt 20) {
            Write-Success "Found $policyCount RLS policies in public schema"
        } else {
            Write-Host "[ERROR] Query result: $result" -ForegroundColor Red
            Write-Failure "Only found $policyCount RLS policies (expected 20+)"
        }
    } catch {
        Write-Host "[ERROR] Failed to parse policy count: $policyCountStr" -ForegroundColor Red
        Write-Host "[ERROR] Original result: $result" -ForegroundColor Red
        Write-Host "[ERROR] Parse exception: $_" -ForegroundColor Red
        Write-Failure "Could not verify RLS policies count"
    }
}

function Show-Summary {
    Write-Host "`n=== Verification Summary ===" -ForegroundColor Cyan
    
    try {
        $dbContainer = Get-SupabaseDbContainer
        Write-Host "Container: $dbContainer" -ForegroundColor Gray
    } catch {
        Write-Host "Container: Could not detect" -ForegroundColor Yellow
    }
    
    Write-Host "Passed: $script:SuccessCount" -ForegroundColor Green
    Write-Host "Failed: $script:FailureCount" -ForegroundColor Red
    
    if ($script:FailureCount -eq 0) {
        Write-Host "`n✓ Database schema is fully configured!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n✗ Database schema has missing components!" -ForegroundColor Red
        Write-Host "`nTo fix, run:" -ForegroundColor Yellow
        try {
            $fixContainer = Get-SupabaseDbContainer
            Write-Host "  docker exec $fixContainer psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" -ForegroundColor Yellow
        } catch {
            Write-Host "  docker exec <container-name> psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" -ForegroundColor Yellow
        }
        Write-Host "  supabase db reset" -ForegroundColor Yellow
        Write-Host "`nFor more details, check container logs:" -ForegroundColor Yellow
        try {
            Write-Host "  docker logs $dbContainer --tail 50" -ForegroundColor Yellow
        } catch {
            Write-Host "  docker logs <container-name> --tail 50" -ForegroundColor Yellow
        }
        exit 1
    }
}

# Main execution
Write-Host "Dell Server Manager - Database Schema Verification" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

if (Test-DatabaseConnection) {
    Test-CustomTypes
    Test-Tables
    Test-Functions
    Test-Triggers
    Test-RLSEnabled
    Test-RLSPolicies
}

Show-Summary
