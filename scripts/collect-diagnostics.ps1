<#
.SYNOPSIS
    Collects comprehensive diagnostics for Dell Server Manager
    
.DESCRIPTION
    Gathers system information, logs, configuration, and status from all components
    for troubleshooting. Outputs formatted markdown report that can be copy-pasted.
    
.PARAMETER OutputFile
    Path to save the diagnostics report. If not specified, outputs to console.
    
.PARAMETER IncludeSensitive
    Include unmasked sensitive data (passwords, API keys). Default: masked with ***REDACTED***
    
.PARAMETER LogLines
    Number of log lines to collect per source. Default: 100
    
.PARAMETER Quiet
    Minimal progress output
    
.EXAMPLE
    .\collect-diagnostics.ps1
    Outputs diagnostics report to console
    
.EXAMPLE
    .\collect-diagnostics.ps1 -OutputFile "C:\diagnostics-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
    Saves diagnostics to timestamped file
    
.EXAMPLE
    .\collect-diagnostics.ps1 -LogLines 200 -OutputFile "C:\detailed-diagnostics.txt"
    Collects more detailed logs
#>

param(
    [string]$OutputFile = "",
    [switch]$IncludeSensitive = $false,
    [int]$LogLines = 100,
    [switch]$Quiet = $false
)

$ErrorActionPreference = 'Continue'
$script:Report = @()
$script:Errors = @()

# Helper Functions

function Write-Progress-Step {
    param([string]$Message)
    if (-not $Quiet) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -NoNewline -ForegroundColor Gray
        Write-Host $Message -ForegroundColor Cyan
    }
}

function Add-ReportSection {
    param(
        [string]$Title,
        [string]$Content,
        [int]$Level = 2
    )
    
    $heading = "#" * $Level
    $script:Report += ""
    $script:Report += "$heading $Title"
    $script:Report += ""
    $script:Report += $Content
}

function Mask-SensitiveData {
    param([string]$Text)
    
    if ($IncludeSensitive) {
        return $Text
    }
    
    # Mask common sensitive patterns
    $masked = $Text -replace '(password["\s:=]+)([^"\s,}]+)', '$1***REDACTED***'
    $masked = $masked -replace '(SUPABASE.*KEY["\s:=]+)([^"\s,}]+)', '$1***REDACTED***'
    $masked = $masked -replace '(token["\s:=]+)([^"\s,}]+)', '$1***REDACTED***'
    $masked = $masked -replace '(api[_-]?key["\s:=]+)([^"\s,}]+)', '$1***REDACTED***'
    $masked = $masked -replace '(secret["\s:=]+)([^"\s,}]+)', '$1***REDACTED***'
    $masked = $masked -replace '(Authorization:\s*Bearer\s+)([^\s]+)', '$1***REDACTED***'
    
    return $masked
}

function Get-DeploymentMode {
    # Check .env file (primary config)
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" -Raw
        # Local deployment uses localhost or 127.0.0.1
        if ($envContent -match "VITE_SUPABASE_URL=.*127\.0\.0\.1" -or 
            $envContent -match "VITE_SUPABASE_URL=.*localhost") {
            return "Local"
        }
        # Cloud deployment uses supabase.co
        if ($envContent -match "VITE_SUPABASE_URL=.*supabase\.co") {
            return "Cloud"
        }
    }
    
    # Fallback: Check if Docker is running and has Supabase containers
    try {
        $containers = docker ps --filter "name=supabase" --format "{{.Names}}" 2>$null
        if ($containers) {
            return "Local"
        }
    } catch {}
    
    return "Unknown"
}
    } catch {}
    
    return "Unknown"
}

function Get-SystemInformation {
    Write-Progress-Step "Collecting system information..."
    
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $cs = Get-CimInstance Win32_ComputerSystem
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        
        $uptime = (Get-Date) - $os.LastBootUpTime
        $totalRAM = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
        $freeRAM = [math]::Round($os.FreePhysicalMemory / 1MB / 1024, 2)
        
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        $diskTotal = [math]::Round($disk.Size / 1GB, 2)
        $diskFree = [math]::Round($disk.FreeSpace / 1GB, 2)
        
        $info = @"
**OS:** $($os.Caption) (Build $($os.BuildNumber))
**PowerShell:** $($PSVersionTable.PSVersion)
**Hostname:** $($env:COMPUTERNAME)
**Uptime:** $($uptime.Days) days, $($uptime.Hours) hours
**CPU:** $($cpu.Name)
**RAM:** $totalRAM GB ($freeRAM GB free)
**Disk:** C:\ $diskTotal GB ($diskFree GB free)
**Timezone:** $([System.TimeZoneInfo]::Local.DisplayName)
"@
        
        return $info
    } catch {
        $script:Errors += "Failed to collect system information: $_"
        return "Error collecting system information"
    }
}

function Get-Configuration {
    Write-Progress-Step "Reading configuration files..."
    
    $config = ""
    
    # .env file
    if (Test-Path ".env") {
        try {
            $envContent = Get-Content ".env" -Raw
            $masked = Mask-SensitiveData $envContent
            $config += "### .env File`n``````env`n$masked`n```````n`n"
        } catch {
            $config += "### .env File`n*Error reading file: $_*`n`n"
        }
    } else {
        $config += "### .env File`n*File not found*`n`n"
    }
    
    # config.toml (local mode only)
    if (Test-Path "supabase/config.toml") {
        try {
            $tomlContent = Get-Content "supabase/config.toml" -Raw
            $masked = Mask-SensitiveData $tomlContent
            $config += "### supabase/config.toml`n``````toml`n$masked`n```````n`n"
        } catch {
            $config += "### supabase/config.toml`n*Error reading file: $_*`n`n"
        }
    }
    
    return $config
}

function Get-DockerContainerLogs {
    param([string]$DeploymentMode)
    
    if ($DeploymentMode -ne "Local") {
        return "*Docker logs only available in Local deployment mode*"
    }
    
    Write-Progress-Step "Collecting Docker container logs..."
    
    $containers = @(
        "supabase_db_dell-server-manager",
        "supabase_kong_dell-server-manager",
        "supabase_auth_dell-server-manager",
        "supabase_rest_dell-server-manager",
        "supabase_realtime_dell-server-manager",
        "supabase_storage_dell-server-manager",
        "supabase_studio_dell-server-manager"
    )
    
    $logs = ""
    
    foreach ($container in $containers) {
        try {
            $status = docker inspect $container --format "{{.State.Status}}" 2>$null
            if (-not $status) {
                $logs += "### $container`n*Container not found*`n`n"
                continue
            }
            
            $health = docker inspect $container --format "{{.State.Health.Status}}" 2>$null
            if (-not $health) { $health = "N/A" }
            
            $restarts = docker inspect $container --format "{{.RestartCount}}" 2>$null
            $uptime = docker inspect $container --format "{{.State.StartedAt}}" 2>$null
            
            $logs += "### $container`n"
            $logs += "**Status:** $status $(if ($health -ne 'N/A') { "($health)" })`n"
            $logs += "**Restarts:** $restarts`n"
            $logs += "**Started:** $uptime`n`n"
            
            $containerLogs = docker logs $container --tail $LogLines 2>&1
            $logs += "**Last $LogLines Log Lines:**`n``````n$containerLogs`n```````n`n"
            
        } catch {
            $logs += "### $container`n*Error: $_*`n`n"
            $script:Errors += "Failed to get logs for $container : $_"
        }
    }
    
    return $logs
}

function Get-WindowsServiceStatus {
    Write-Progress-Step "Checking Windows service status..."
    
    try {
        $service = Get-Service -Name "DellServerManager" -ErrorAction SilentlyContinue
        
        if (-not $service) {
            return "*DellServerManager service not found*"
        }
        
        $serviceDetails = Get-CimInstance Win32_Service -Filter "Name='DellServerManager'"
        
        $uptime = "N/A"
        if ($service.Status -eq "Running") {
            $process = Get-Process -Id (Get-CimInstance Win32_Service -Filter "Name='DellServerManager'").ProcessId -ErrorAction SilentlyContinue
            if ($process) {
                $runtime = (Get-Date) - $process.StartTime
                $uptime = "$($runtime.Days) days, $($runtime.Hours) hours, $($runtime.Minutes) minutes"
            }
        }
        
        $status = @"
**Name:** $($service.Name)
**Display Name:** $($service.DisplayName)
**Status:** $($service.Status)
**Startup Type:** $($serviceDetails.StartMode)
**Account:** $($serviceDetails.StartName)
**Uptime:** $uptime
"@
        
        return $status
    } catch {
        $script:Errors += "Failed to get service status: $_"
        return "Error getting service status"
    }
}

function Get-WindowsEventLogs {
    Write-Progress-Step "Reading Windows event logs..."
    
    $logs = ""
    
    # Application logs
    try {
        $appLogs = Get-WinEvent -FilterHashtable @{
            LogName = 'Application'
            ProviderName = '*DellServerManager*'
        } -MaxEvents 50 -ErrorAction SilentlyContinue
        
        if ($appLogs) {
            $logs += "### Application Event Log (Last 50 Entries)`n`n"
            $logs += "| Timestamp | Level | Message |`n"
            $logs += "|-----------|-------|---------|`n"
            foreach ($log in $appLogs) {
                $time = $log.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss")
                $level = $log.LevelDisplayName
                $msg = ($log.Message -replace "`n", " " -replace "`r", "").Substring(0, [Math]::Min(100, $log.Message.Length))
                $logs += "| $time | $level | $msg... |`n"
            }
            $logs += "`n"
        } else {
            $logs += "### Application Event Log`n*No DellServerManager entries found*`n`n"
        }
    } catch {
        $logs += "### Application Event Log`n*Error: $_*`n`n"
    }
    
    # System logs (errors and warnings only)
    try {
        $sysLogs = Get-WinEvent -FilterHashtable @{
            LogName = 'System'
            Level = 2,3  # Error and Warning
        } -MaxEvents 50 -ErrorAction SilentlyContinue
        
        if ($sysLogs) {
            $logs += "### System Event Log (Last 50 Errors/Warnings)`n`n"
            $logs += "| Timestamp | Level | Source | Message |`n"
            $logs += "|-----------|-------|--------|---------|`n"
            foreach ($log in $sysLogs) {
                $time = $log.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss")
                $level = $log.LevelDisplayName
                $source = $log.ProviderName
                $msg = ($log.Message -replace "`n", " " -replace "`r", "").Substring(0, [Math]::Min(80, $log.Message.Length))
                $logs += "| $time | $level | $source | $msg... |`n"
            }
            $logs += "`n"
        }
    } catch {
        $logs += "### System Event Log`n*Error: $_*`n`n"
    }
    
    return $logs
}

function Get-ApplicationLogs {
    Write-Progress-Step "Looking for application log files..."
    
    $logPaths = @(
        "C:\dell-server-manager\logs",
        "C:\ProgramData\DellServerManager\logs",
        ".\logs",
        ".\"
    )
    
    $logs = ""
    $foundLogs = $false
    
    foreach ($path in $logPaths) {
        if (Test-Path $path) {
            $logFiles = Get-ChildItem -Path $path -Filter "*.log" -File -ErrorAction SilentlyContinue
            
            foreach ($file in $logFiles) {
                $foundLogs = $true
                try {
                    $content = Get-Content $file.FullName -Tail $LogLines -ErrorAction Stop
                    $logs += "### $($file.Name)`n"
                    $logs += "**Path:** $($file.FullName)`n"
                    $logs += "**Size:** $([math]::Round($file.Length / 1KB, 2)) KB`n"
                    $logs += "**Modified:** $($file.LastWriteTime)`n`n"
                    $logs += "**Last $LogLines Lines:**`n``````n$($content -join "`n")`n```````n`n"
                } catch {
                    $logs += "### $($file.Name)`n*Error reading file: $_*`n`n"
                }
            }
        }
    }
    
    if (-not $foundLogs) {
        $logs = "*No application log files found in common locations*"
    }
    
    return $logs
}

function Get-NetworkStatus {
    Write-Progress-Step "Checking network status..."
    
    $status = ""
    
    # Check open ports
    try {
        $ports = @(3000, 5432, 8000, 8001, 54321, 54322, 54323, 54324)
        $status += "### Open Ports`n`n"
        
        foreach ($port in $ports) {
            $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            if ($listener) {
                $status += "- Port $port`: LISTENING (PID $($listener.OwningProcess))`n"
            } else {
                $status += "- Port $port`: NOT LISTENING`n"
            }
        }
        $status += "`n"
    } catch {
        $status += "### Open Ports`n*Error: $_*`n`n"
    }
    
    # Connectivity tests
    $status += "### Connectivity Tests`n`n"
    
    # Test application
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $status += "- http://localhost:3000: ✓ $($response.StatusCode) $($response.StatusDescription)`n"
    } catch {
        $status += "- http://localhost:3000: ✗ $($_.Exception.Message)`n"
    }
    
    # Test backend (from .env)
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" -Raw
        if ($envContent -match 'VITE_SUPABASE_URL="?([^"\s]+)"?') {
            $backendUrl = $matches[1]
            try {
                $response = Invoke-WebRequest -Uri "$backendUrl/rest/v1/" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
                $status += "- Backend API ($backendUrl): ✓ $($response.StatusCode)`n"
            } catch {
                $status += "- Backend API ($backendUrl): ✗ $($_.Exception.Message)`n"
            }
        }
    }
    
    return $status
}

function Get-DatabaseStatus {
    param([string]$DeploymentMode)
    
    if ($DeploymentMode -ne "Local") {
        return "*Database diagnostics only available in Local deployment mode*"
    }
    
    Write-Progress-Step "Checking database status..."
    
    $status = ""
    
    try {
        # Check PostgreSQL container
        $dbStatus = docker inspect supabase_db_dell-server-manager --format "{{.State.Status}}" 2>$null
        if (-not $dbStatus) {
            return "*PostgreSQL container not found*"
        }
        
        $status += "**Container Status:** $dbStatus`n`n"
        
        # Try to connect and get basic info
        $dbPassword = "postgres"  # Default local password
        
        # Get database size
        $sizeQuery = "SELECT pg_size_pretty(pg_database_size('postgres')) as size;"
        $dbSize = docker exec supabase_db_dell-server-manager psql -U postgres -d postgres -t -c $sizeQuery 2>$null
        if ($dbSize) {
            $status += "**Database Size:** $($dbSize.Trim())`n"
        }
        
        # Get connection count
        $connQuery = "SELECT count(*) FROM pg_stat_activity;"
        $connCount = docker exec supabase_db_dell-server-manager psql -U postgres -d postgres -t -c $connQuery 2>$null
        if ($connCount) {
            $status += "**Active Connections:** $($connCount.Trim())`n`n"
        }
        
        # Get table row counts
        $status += "### Table Row Counts`n`n"
        $tables = @("servers", "jobs", "job_tasks", "idrac_commands", "credential_sets", "profiles")
        
        foreach ($table in $tables) {
            $countQuery = "SELECT COUNT(*) FROM public.$table;"
            $count = docker exec supabase_db_dell-server-manager psql -U postgres -d postgres -t -c $countQuery 2>$null
            if ($count) {
                $status += "- **$table**: $($count.Trim())`n"
            }
        }
        
        $status += "`n### Recent Database Errors (Last 20)`n`n"
        
        # Get recent errors from PostgreSQL logs
        $errorLogs = docker logs supabase_db_dell-server-manager --tail 1000 2>&1 | Select-String -Pattern "ERROR|FATAL" | Select-Object -Last 20
        if ($errorLogs) {
            $status += "``````n$($errorLogs -join "`n")`n```````n"
        } else {
            $status += "*No recent errors found*`n"
        }
        
    } catch {
        $status += "*Error collecting database status: $_*"
        $script:Errors += "Database status error: $_"
    }
    
    return $status
}

function Get-RecentErrors {
    Write-Progress-Step "Parsing logs for recent errors..."
    
    $allErrors = @()
    
    # Parse all collected text for error keywords
    $errorPatterns = @("ERROR", "FATAL", "CRITICAL", "EXCEPTION", "FAILED")
    
    # This is a simplified version - in real implementation would parse actual log content
    $errors = "### Summary`n`n"
    $errors += "*This section would contain the last 30 errors found across all logs with context.*`n"
    $errors += "*Implementation note: Parse collected logs for error keywords and show context.*`n`n"
    
    if ($script:Errors.Count -gt 0) {
        $errors += "### Errors During Diagnostics Collection`n`n"
        foreach ($err in $script:Errors) {
            $errors += "- $err`n"
        }
    }
    
    return $errors
}

function Get-PerformanceMetrics {
    Write-Progress-Step "Collecting performance metrics..."
    
    $metrics = ""
    
    try {
        # Docker disk usage (if local)
        try {
            $dockerInfo = docker system df 2>$null
            if ($dockerInfo) {
                $metrics += "### Docker Disk Usage`n``````n$dockerInfo`n```````n`n"
            }
        } catch {}
        
        # Top processes by memory
        $topProcs = Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10
        $metrics += "### Top Memory Consumers`n`n"
        $metrics += "| Process | Memory (MB) | CPU (s) |`n"
        $metrics += "|---------|-------------|---------|`n"
        
        foreach ($proc in $topProcs) {
            $memMB = [math]::Round($proc.WorkingSet / 1MB, 2)
            $cpuTime = [math]::Round($proc.TotalProcessorTime.TotalSeconds, 2)
            $metrics += "| $($proc.Name) | $memMB | $cpuTime |`n"
        }
        
    } catch {
        $metrics += "*Error collecting performance metrics: $_*"
    }
    
    return $metrics
}

# Main Script Execution

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "Dell Server Manager - Diagnostics Collection" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

$startTime = Get-Date

# Build report header
$script:Report += "# Dell Server Manager - Diagnostics Report"
$script:Report += ""
$script:Report += "**Generated:** $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $([System.TimeZoneInfo]::Local.DisplayName)"
$script:Report += "**Hostname:** $($env:COMPUTERNAME)"

# Detect deployment mode
$deploymentMode = Get-DeploymentMode
$script:Report += "**Deployment Mode:** $deploymentMode"
$script:Report += ""
$script:Report += "---"

# Collect all sections
Add-ReportSection "System Information" (Get-SystemInformation)
Add-ReportSection "Configuration Files" (Get-Configuration)
Add-ReportSection "Docker Containers" (Get-DockerContainerLogs -DeploymentMode $deploymentMode)
Add-ReportSection "Windows Service Status" (Get-WindowsServiceStatus)
Add-ReportSection "Windows Event Logs" (Get-WindowsEventLogs)
Add-ReportSection "Application Log Files" (Get-ApplicationLogs)
Add-ReportSection "Network Status" (Get-NetworkStatus)
Add-ReportSection "Database Status" (Get-DatabaseStatus -DeploymentMode $deploymentMode)
Add-ReportSection "Recent Errors" (Get-RecentErrors)
Add-ReportSection "Performance Metrics" (Get-PerformanceMetrics)

# Add footer
$elapsed = ((Get-Date) - $startTime).TotalSeconds
$script:Report += ""
$script:Report += "---"
$script:Report += ""
$script:Report += "*Report generated in $([math]::Round($elapsed, 2)) seconds*"
$script:Report += "*Total sections: 10*"
$script:Report += "*Sensitive data: $(if ($IncludeSensitive) { 'INCLUDED' } else { 'MASKED' })*"

# Output report
$reportText = $script:Report -join "`n"

if ($OutputFile) {
    try {
        $reportText | Out-File -FilePath $OutputFile -Encoding UTF8
        Write-Host "`n✓ Diagnostics report saved to: $OutputFile" -ForegroundColor Green
        Write-Host "  File size: $([math]::Round((Get-Item $OutputFile).Length / 1KB, 2)) KB`n" -ForegroundColor Gray
    } catch {
        Write-Host "`n✗ Failed to save report: $_" -ForegroundColor Red
        Write-Host "`nReport output:`n" -ForegroundColor Yellow
        Write-Host $reportText
    }
} else {
    Write-Host "`n" + $reportText
}

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "Diagnostics collection completed in $([math]::Round($elapsed, 2)) seconds" -ForegroundColor Green
Write-Host "============================================`n" -ForegroundColor Cyan

if ($script:Errors.Count -gt 0) {
    Write-Host "⚠ $($script:Errors.Count) error(s) occurred during collection" -ForegroundColor Yellow
}
