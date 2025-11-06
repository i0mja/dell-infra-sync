#Requires -Version 5.1

<#
.SYNOPSIS
    Health check script for Dell Server Manager deployment

.DESCRIPTION
    Validates deployment configuration and tests connectivity to the selected backend
    (local Supabase or Lovable Cloud). Provides detailed diagnostics and troubleshooting guidance.

.PARAMETER Detailed
    Show detailed output for all checks

.PARAMETER ExportJson
    Export results to JSON file

.PARAMETER Quiet
    Suppress non-critical output (exit codes only)

.EXAMPLE
    .\health-check.ps1
    Run basic health check

.EXAMPLE
    .\health-check.ps1 -Detailed -ExportJson health-report.json
    Run detailed check and export to JSON
#>

param(
    [switch]$Detailed,
    [string]$ExportJson,
    [switch]$Quiet
)

$ErrorActionPreference = "SilentlyContinue"
$ProgressPreference = "SilentlyContinue"

# Health check results
$script:Results = @{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Mode = "Unknown"
    Checks = @()
    OverallHealth = 0
    TotalChecks = 0
    PassedChecks = 0
}

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Success", "Warning", "Error", "Info")]
        [string]$Type = "Info"
    )
    
    if ($Quiet) { return }
    
    $color = switch ($Type) {
        "Success" { "Green" }
        "Warning" { "Yellow" }
        "Error" { "Red" }
        "Info" { "Cyan" }
    }
    
    $icon = switch ($Type) {
        "Success" { "✅" }
        "Warning" { "⚠️" }
        "Error" { "❌" }
        "Info" { "ℹ️" }
    }
    
    Write-Host "$icon $Message" -ForegroundColor $color
}

function Add-CheckResult {
    param(
        [string]$Category,
        [string]$Check,
        [bool]$Passed,
        [string]$Message,
        [string]$Details = "",
        [string]$Remediation = "",
        [object]$Metadata = $null
    )
    
    $script:Results.TotalChecks++
    if ($Passed) { $script:Results.PassedChecks++ }
    
    $result = @{
        Category = $Category
        Check = $Check
        Passed = $Passed
        Message = $Message
        Details = $Details
        Remediation = $Remediation
        Metadata = $Metadata
    }
    
    $script:Results.Checks += $result
    
    $status = if ($Passed) { "Success" } else { "Error" }
    Write-Status "[$Category] $Check : $Message" -Type $status
    
    if ($Detailed -and $Details) {
        Write-Host "    Details: $Details" -ForegroundColor Gray
    }
    
    if (-not $Passed -and $Remediation) {
        Write-Host "    💡 Fix: $Remediation" -ForegroundColor Yellow
    }
}

function Get-DeploymentMode {
    $envPath = "C:\dell-server-manager\.env"
    
    if (-not (Test-Path $envPath)) {
        return $null
    }
    
    $envContent = Get-Content $envPath -Raw
    
    if ($envContent -match 'VITE_SUPABASE_URL="?([^"]+)"?') {
        $url = $Matches[1]
        if ($url -match '127\.0\.0\.1|localhost') {
            return "Local"
        } elseif ($url -match 'supabase\.co') {
            return "Cloud"
        }
    }
    
    return "Unknown"
}

function Test-Configuration {
    Write-Status "`n[CONFIG] Validating Configuration..." -Type Info
    
    $envPath = "C:\dell-server-manager\.env"
    
    # Check .env exists
    if (Test-Path $envPath) {
        Add-CheckResult -Category "CONFIG" -Check "Configuration File" -Passed $true -Message "Found" -Details $envPath
    } else {
        Add-CheckResult -Category "CONFIG" -Check "Configuration File" -Passed $false -Message "Not found" -Remediation "Run deployment script to create .env file"
        return $false
    }
    
    # Parse .env
    $config = @{}
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^([^=]+)="?([^"]+)"?$') {
            $config[$Matches[1]] = $Matches[2]
        }
    }
    
    # Validate required variables
    $required = @("VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PROJECT_ID")
    $allPresent = $true
    
    foreach ($var in $required) {
        if ($config[$var]) {
            Add-CheckResult -Category "CONFIG" -Check $var -Passed $true -Message "Set" -Metadata @{ Value = $config[$var].Substring(0, [Math]::Min(30, $config[$var].Length)) + "..." }
        } else {
            Add-CheckResult -Category "CONFIG" -Check $var -Passed $false -Message "Missing" -Remediation "Add $var to .env file"
            $allPresent = $false
        }
    }
    
    return $allPresent
}

function Test-Services {
    Write-Status "`n[SERVICE] Checking Services..." -Type Info
    
    # Check DellServerManager service
    $service = Get-Service -Name "DellServerManager" -ErrorAction SilentlyContinue
    
    if ($service) {
        if ($service.Status -eq "Running") {
            Add-CheckResult -Category "SERVICE" -Check "DellServerManager" -Passed $true -Message "Running" -Metadata @{ Status = $service.Status }
        } else {
            Add-CheckResult -Category "SERVICE" -Check "DellServerManager" -Passed $false -Message "Not running (Status: $($service.Status))" -Remediation "Start service: Start-Service DellServerManager"
        }
    } else {
        Add-CheckResult -Category "SERVICE" -Check "DellServerManager" -Passed $false -Message "Service not found" -Remediation "Re-run deployment script to create service"
    }
    
    # Check if app is listening on port 3000
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    
    if ($listener) {
        Add-CheckResult -Category "SERVICE" -Check "Application Port 3000" -Passed $true -Message "Listening"
    } else {
        Add-CheckResult -Category "SERVICE" -Check "Application Port 3000" -Passed $false -Message "Not listening" -Remediation "Check if DellServerManager service is running and logs for errors"
    }
    
    # Docker checks (local mode only)
    if ($script:Results.Mode -eq "Local") {
        $docker = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
        
        if ($docker) {
            Add-CheckResult -Category "SERVICE" -Check "Docker Desktop" -Passed $true -Message "Running"
            
            # Check Supabase containers
            $containers = docker ps --filter "name=supabase" --format "{{.Names}}" 2>$null
            
            if ($containers) {
                $containerCount = ($containers | Measure-Object).Count
                Add-CheckResult -Category "SERVICE" -Check "Supabase Containers" -Passed $true -Message "$containerCount containers running" -Details ($containers -join ", ")
            } else {
                Add-CheckResult -Category "SERVICE" -Check "Supabase Containers" -Passed $false -Message "No containers running" -Remediation "Start Supabase: cd C:\dell-supabase; supabase start"
            }
        } else {
            Add-CheckResult -Category "SERVICE" -Check "Docker Desktop" -Passed $false -Message "Not running" -Remediation "Start Docker Desktop"
        }
    }
}

function Test-Connectivity {
    Write-Status "`n[NETWORK] Testing Connectivity..." -Type Info
    
    # Test application
    try {
        $start = Get-Date
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 10 -UseBasicParsing
        $elapsed = ((Get-Date) - $start).TotalMilliseconds
        
        if ($response.StatusCode -eq 200) {
            Add-CheckResult -Category "NETWORK" -Check "Application (port 3000)" -Passed $true -Message "Responding" -Details "$([int]$elapsed)ms" -Metadata @{ ResponseTime = $elapsed }
        } else {
            Add-CheckResult -Category "NETWORK" -Check "Application (port 3000)" -Passed $false -Message "HTTP $($response.StatusCode)"
        }
    } catch {
        Add-CheckResult -Category "NETWORK" -Check "Application (port 3000)" -Passed $false -Message "Connection failed" -Details $_.Exception.Message -Remediation "Check if DellServerManager service is running"
    }
    
    # Get Supabase URL from .env
    $envPath = "C:\dell-server-manager\.env"
    $supabaseUrl = ""
    
    if (Test-Path $envPath) {
        $envContent = Get-Content $envPath -Raw
        if ($envContent -match 'VITE_SUPABASE_URL="?([^"]+)"?') {
            $supabaseUrl = $Matches[1]
        }
    }
    
    if ($supabaseUrl) {
        # Test Supabase REST API
        try {
            $start = Get-Date
            $response = Invoke-WebRequest -Uri "$supabaseUrl/rest/v1/" -TimeoutSec 10 -UseBasicParsing
            $elapsed = ((Get-Date) - $start).TotalMilliseconds
            
            Add-CheckResult -Category "NETWORK" -Check "Backend REST API" -Passed $true -Message "Accessible" -Details "$([int]$elapsed)ms" -Metadata @{ ResponseTime = $elapsed; URL = $supabaseUrl }
        } catch {
            Add-CheckResult -Category "NETWORK" -Check "Backend REST API" -Passed $false -Message "Connection failed" -Details $_.Exception.Message -Remediation "Check backend service status"
        }
        
        # Test Auth endpoint
        try {
            $response = Invoke-WebRequest -Uri "$supabaseUrl/auth/v1/health" -TimeoutSec 10 -UseBasicParsing
            Add-CheckResult -Category "NETWORK" -Check "Backend Auth API" -Passed $true -Message "Accessible"
        } catch {
            Add-CheckResult -Category "NETWORK" -Check "Backend Auth API" -Passed $false -Message "Connection failed" -Details $_.Exception.Message
        }
    }
}

function Test-LocalDatabase {
    if ($script:Results.Mode -ne "Local") {
        return
    }
    
    Write-Status "`n[DATABASE] Testing Local Database..." -Type Info
    
    # Check PostgreSQL container
    $pgContainer = docker ps --filter "name=supabase-db" --format "{{.Names}}" 2>$null
    
    if ($pgContainer) {
        Add-CheckResult -Category "DATABASE" -Check "PostgreSQL Container" -Passed $true -Message "Running"
        
        # Test database connection
        $testQuery = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
        $result = docker exec supabase-db psql -U postgres -d postgres -t -c $testQuery 2>$null
        
        if ($result) {
            $tableCount = $result.Trim()
            Add-CheckResult -Category "DATABASE" -Check "Database Connection" -Passed $true -Message "Connected" -Details "$tableCount tables in public schema"
            
            # Check for required tables
            $requiredTables = @("profiles", "user_roles", "servers", "jobs", "job_tasks")
            foreach ($table in $requiredTables) {
                $checkTable = "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');"
                $exists = docker exec supabase-db psql -U postgres -d postgres -t -c $checkTable 2>$null
                
                if ($exists -match "t") {
                    Add-CheckResult -Category "DATABASE" -Check "Table: $table" -Passed $true -Message "Exists"
                } else {
                    Add-CheckResult -Category "DATABASE" -Check "Table: $table" -Passed $false -Message "Missing" -Remediation "Run database migrations"
                }
            }
        } else {
            Add-CheckResult -Category "DATABASE" -Check "Database Connection" -Passed $false -Message "Connection failed" -Remediation "Check PostgreSQL container logs: docker logs supabase-db"
        }
    } else {
        Add-CheckResult -Category "DATABASE" -Check "PostgreSQL Container" -Passed $false -Message "Not running" -Remediation "Start Supabase: cd C:\dell-supabase; supabase start"
    }
}

function Show-HealthReport {
    if ($Quiet) { return }
    
    Write-Host "`n=====================================" -ForegroundColor Cyan
    Write-Host "🏥 Dell Server Manager - Health Check" -ForegroundColor Cyan
    Write-Host "=====================================" -ForegroundColor Cyan
    
    Write-Host "`nDeployment Mode: " -NoNewline
    Write-Host $script:Results.Mode -ForegroundColor $(if ($script:Results.Mode -eq "Unknown") { "Red" } else { "Green" })
    
    Write-Host "Timestamp: $($script:Results.Timestamp)"
    
    # Calculate health percentage
    if ($script:Results.TotalChecks -gt 0) {
        $healthPercent = [math]::Round(($script:Results.PassedChecks / $script:Results.TotalChecks) * 100)
        $script:Results.OverallHealth = $healthPercent
        
        Write-Host "`nOverall Health: " -NoNewline
        
        $color = if ($healthPercent -eq 100) { "Green" } elseif ($healthPercent -ge 70) { "Yellow" } else { "Red" }
        $status = if ($healthPercent -eq 100) { "✅ HEALTHY" } elseif ($healthPercent -ge 70) { "⚠️ DEGRADED" } else { "❌ UNHEALTHY" }
        
        Write-Host "$status ($healthPercent%)" -ForegroundColor $color
        Write-Host "Checks: $($script:Results.PassedChecks)/$($script:Results.TotalChecks) passed"
    }
    
    # Show failed checks summary
    $failedChecks = $script:Results.Checks | Where-Object { -not $_.Passed }
    if ($failedChecks) {
        Write-Host "`n⚠️ Failed Checks:" -ForegroundColor Yellow
        foreach ($check in $failedChecks) {
            Write-Host "  • [$($check.Category)] $($check.Check): $($check.Message)" -ForegroundColor Red
            if ($check.Remediation) {
                Write-Host "    Fix: $($check.Remediation)" -ForegroundColor Yellow
            }
        }
    }
    
    Write-Host "`n=====================================" -ForegroundColor Cyan
    Write-Host "Next Check: Run .\scripts\health-check.ps1" -ForegroundColor Gray
    Write-Host "=====================================" -ForegroundColor Cyan
}

function Export-Results {
    param([string]$Path)
    
    if (-not $Path) { return }
    
    try {
        $json = $script:Results | ConvertTo-Json -Depth 10
        $json | Out-File -FilePath $Path -Encoding UTF8
        Write-Status "Results exported to: $Path" -Type Success
    } catch {
        Write-Status "Failed to export results: $_" -Type Error
    }
}

# Main execution
try {
    if (-not $Quiet) {
        Write-Host "🏥 Dell Server Manager - Health Check" -ForegroundColor Cyan
        Write-Host "=====================================" -ForegroundColor Cyan
        Write-Host ""
    }
    
    # Detect deployment mode
    $script:Results.Mode = Get-DeploymentMode
    
    if ($script:Results.Mode) {
        Write-Status "[CONFIG] Deployment Mode: $($script:Results.Mode)" -Type Info
    } else {
        Write-Status "[CONFIG] Deployment Mode: Unknown (could not detect)" -Type Warning
    }
    
    # Run health checks
    $configValid = Test-Configuration
    
    if ($configValid) {
        Test-Services
        Test-Connectivity
        Test-LocalDatabase
    } else {
        Write-Status "`n⚠️ Configuration validation failed. Skipping remaining checks." -Type Warning
    }
    
    # Show report
    Show-HealthReport
    
    # Export if requested
    if ($ExportJson) {
        Export-Results -Path $ExportJson
    }
    
    # Exit code based on health
    $exitCode = if ($script:Results.OverallHealth -ge 70) { 0 } else { 1 }
    exit $exitCode
    
} catch {
    Write-Status "Health check failed: $_" -Type Error
    exit 1
}
