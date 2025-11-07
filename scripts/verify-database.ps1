#!/usr/bin/env pwsh
# Database Schema Verification Script for Dell Server Manager
# Verifies that all required database objects exist in the local Supabase instance

param(
    [string]$DbUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

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

function Test-DatabaseConnection {
    Write-Host "`n=== Testing Database Connection ===" -ForegroundColor Cyan
    
    $query = "SELECT version();"
    $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Database connection successful"
        return $true
    } else {
        Write-Failure "Cannot connect to database"
        return $false
    }
}

function Test-CustomTypes {
    Write-Host "`n=== Verifying Custom Types ===" -ForegroundColor Cyan
    
    $types = @('app_role', 'job_status', 'job_type')
    
    foreach ($type in $types) {
        $query = "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '$type');"
        $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
        
        if ($result -match 't') {
            Write-Success "Custom type '$type' exists"
        } else {
            Write-Failure "Custom type '$type' is missing"
        }
    }
}

function Test-Tables {
    Write-Host "`n=== Verifying Tables ===" -ForegroundColor Cyan
    
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
        $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
        
        if ($result -match 't') {
            Write-Success "Table 'public.$table' exists"
        } else {
            Write-Failure "Table 'public.$table' is missing"
        }
    }
}

function Test-Functions {
    Write-Host "`n=== Verifying Functions ===" -ForegroundColor Cyan
    
    $functions = @(
        'update_updated_at_column',
        'handle_new_user',
        'has_role',
        'get_user_role',
        'validate_api_token'
    )
    
    foreach ($func in $functions) {
        $query = "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '$func');"
        $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
        
        if ($result -match 't') {
            Write-Success "Function 'public.$func' exists"
        } else {
            Write-Failure "Function 'public.$func' is missing"
        }
    }
}

function Test-Triggers {
    Write-Host "`n=== Verifying Triggers ===" -ForegroundColor Cyan
    
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
        $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
        
        if ($result -match 't') {
            Write-Success "Trigger '$($trigger.Name)' exists on $($trigger.Schema).$($trigger.Table)"
        } else {
            Write-Failure "Trigger '$($trigger.Name)' is missing on $($trigger.Schema).$($trigger.Table)"
        }
    }
}

function Test-RLSEnabled {
    Write-Host "`n=== Verifying RLS is Enabled ===" -ForegroundColor Cyan
    
    $tables = @(
        'profiles', 'user_roles', 'servers', 'vcenter_hosts',
        'jobs', 'job_tasks', 'audit_logs', 'notification_settings',
        'openmanage_settings', 'api_tokens'
    )
    
    foreach ($table in $tables) {
        $query = "SELECT relrowsecurity FROM pg_class WHERE relname = '$table';"
        $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
        
        if ($result -match 't') {
            Write-Success "RLS enabled on 'public.$table'"
        } else {
            Write-Failure "RLS not enabled on 'public.$table'"
        }
    }
}

function Test-RLSPolicies {
    Write-Host "`n=== Verifying RLS Policies ===" -ForegroundColor Cyan
    
    $query = "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';"
    $result = docker exec supabase-db psql -U postgres -t -c $query 2>$null
    $policyCount = $result.Trim()
    
    if ([int]$policyCount -gt 20) {
        Write-Success "Found $policyCount RLS policies in public schema"
    } else {
        Write-Failure "Only found $policyCount RLS policies (expected 20+)"
    }
}

function Show-Summary {
    Write-Host "`n=== Verification Summary ===" -ForegroundColor Cyan
    Write-Host "Passed: $script:SuccessCount" -ForegroundColor Green
    Write-Host "Failed: $script:FailureCount" -ForegroundColor Red
    
    if ($script:FailureCount -eq 0) {
        Write-Host "`n✓ Database schema is fully configured!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n✗ Database schema has missing components!" -ForegroundColor Red
        Write-Host "`nTo fix, run:" -ForegroundColor Yellow
        Write-Host "  docker exec supabase-db psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" -ForegroundColor Yellow
        Write-Host "  supabase db reset" -ForegroundColor Yellow
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
