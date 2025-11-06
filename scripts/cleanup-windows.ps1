# Dell Server Manager - Windows Cleanup Script
# Safely removes all components and prepares for fresh installation
# Requires: PowerShell 5.1 or higher, Administrator privileges

#Requires -RunAsAdministrator

# Ensure proper console encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "[*] Dell Server Manager - Windows Cleanup Script" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[WARN] This will remove ALL Dell Server Manager and Supabase components" -ForegroundColor Yellow
Write-Host "[WARN] Including all data, containers, volumes, and configurations" -ForegroundColor Yellow
Write-Host ""

$Confirm = Read-Host "Are you sure you want to continue? (yes/no)"
if ($Confirm -ne "yes") {
    Write-Host "[INFO] Cleanup cancelled" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "[*] Starting cleanup..." -ForegroundColor Yellow
Write-Host ""

# Step 1: Navigate away from any target directories
Write-Host "[STEP 1/7] Leaving target directories..." -ForegroundColor Yellow
Set-Location $env:TEMP
Write-Host "[OK] Moved to temporary directory" -ForegroundColor Green

# Step 2: Stop Windows Service
Write-Host "[STEP 2/7] Stopping Dell Server Manager service..." -ForegroundColor Yellow
try {
    $service = Get-Service -Name "DellServerManager" -ErrorAction SilentlyContinue
    if ($service) {
        if (Get-Command nssm -ErrorAction SilentlyContinue) {
            nssm stop DellServerManager 2>&1 | Out-Null
            Start-Sleep -Seconds 2
            nssm remove DellServerManager confirm 2>&1 | Out-Null
            Write-Host "[OK] Service stopped and removed" -ForegroundColor Green
        } else {
            Write-Host "[SKIP] NSSM not found, service may need manual removal" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[OK] No service found to remove" -ForegroundColor Green
    }
} catch {
    Write-Host "[WARN] Failed to remove service: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 3: Stop and remove Docker containers
Write-Host "[STEP 3/7] Cleaning up Docker containers..." -ForegroundColor Yellow

# Check if Docker is available
try {
    docker info 2>&1 | Out-Null
    $dockerAvailable = ($LASTEXITCODE -eq 0)
} catch {
    $dockerAvailable = $false
}

if ($dockerAvailable) {
    # Stop all containers
    $containerIds = docker ps -aq 2>&1
    if ($containerIds -and $LASTEXITCODE -eq 0) {
        Write-Host "[INFO] Stopping containers..." -ForegroundColor Cyan
        docker stop $containerIds 2>&1 | Out-Null
        Start-Sleep -Seconds 3
        
        Write-Host "[INFO] Removing containers..." -ForegroundColor Cyan
        docker rm -f $containerIds 2>&1 | Out-Null
        Write-Host "[OK] Containers removed" -ForegroundColor Green
    } else {
        Write-Host "[OK] No containers to remove" -ForegroundColor Green
    }
    
    # Remove all volumes
    $volumeIds = docker volume ls -q 2>&1
    if ($volumeIds -and $LASTEXITCODE -eq 0) {
        Write-Host "[INFO] Removing volumes..." -ForegroundColor Cyan
        docker volume rm -f $volumeIds 2>&1 | Out-Null
        Write-Host "[OK] Volumes removed" -ForegroundColor Green
    } else {
        Write-Host "[OK] No volumes to remove" -ForegroundColor Green
    }
    
    # Prune images (optional but helpful)
    Write-Host "[INFO] Pruning Docker images..." -ForegroundColor Cyan
    docker image prune -a -f 2>&1 | Out-Null
    Write-Host "[OK] Images pruned" -ForegroundColor Green
} else {
    Write-Host "[SKIP] Docker engine not available, skipping container cleanup" -ForegroundColor Yellow
}

# Step 4: Wait for file locks to release
Write-Host "[STEP 4/7] Waiting for file locks to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Step 5: Stop Docker processes if folders remain locked (optional)
Write-Host "[STEP 5/7] Stopping Docker background processes..." -ForegroundColor Yellow
try {
    Stop-Process -Name "com.docker.backend" -Force -ErrorAction SilentlyContinue
    Stop-Process -Name "Docker Desktop" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Write-Host "[OK] Docker processes stopped" -ForegroundColor Green
} catch {
    Write-Host "[OK] No Docker processes to stop" -ForegroundColor Green
}

# Step 6: Remove directories
Write-Host "[STEP 6/7] Removing directories..." -ForegroundColor Yellow

$directories = @(
    "C:\supabase",
    "C:\dell-supabase",
    "C:\dell-server-manager"
)

foreach ($dir in $directories) {
    if (Test-Path $dir) {
        try {
            Write-Host "[INFO] Removing $dir..." -ForegroundColor Cyan
            Remove-Item -Recurse -Force $dir -ErrorAction Stop
            Write-Host "[OK] Removed $dir" -ForegroundColor Green
        } catch {
            Write-Host "[WARN] Could not remove $dir : $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "[WARN] You may need to manually delete this folder after reboot" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[OK] $dir does not exist" -ForegroundColor Green
    }
}

# Step 7: Remove firewall rules
Write-Host "[STEP 7/7] Removing firewall rules..." -ForegroundColor Yellow
try {
    Remove-NetFirewallRule -DisplayName "Dell Server Manager" -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "Supabase API" -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "HTTP" -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "HTTPS" -ErrorAction SilentlyContinue
    Write-Host "[OK] Firewall rules removed" -ForegroundColor Green
} catch {
    Write-Host "[OK] No firewall rules to remove" -ForegroundColor Green
}

# Completion
Write-Host ""
Write-Host "[SUCCESS] Cleanup Complete!" -ForegroundColor Green
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[INFO] All Dell Server Manager components have been removed" -ForegroundColor Cyan
Write-Host ""
Write-Host "[NEXT] To reinstall:" -ForegroundColor Yellow
Write-Host "   1. Clone repository:" -ForegroundColor Gray
Write-Host "      git clone https://github.com/i0mja/dell-infra-sync C:\dell-server-manager" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Run deployment script:" -ForegroundColor Gray
Write-Host "      cd C:\dell-server-manager" -ForegroundColor Gray
Write-Host "      .\scripts\deploy-windows.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "[NOTE] If any folders could not be removed, restart your computer" -ForegroundColor Yellow
Write-Host "       and manually delete them before reinstalling" -ForegroundColor Yellow
Write-Host ""
