#Requires -Version 5.1
#Requires -RunAsAdministrator

<#
.SYNOPSIS
    Quick reinstall of Dell Server Manager in Lovable Cloud mode
.DESCRIPTION
    Combines cleanup and reinstallation into one streamlined operation.
    Caches SERVICE_ROLE_KEY for convenience between reinstalls.
.PARAMETER Force
    Skip confirmation prompts
.PARAMETER NewKey
    Force re-entry of SERVICE_ROLE_KEY (ignore cached value)
.PARAMETER SkipBackup
    Skip backing up source files before reinstall (faster but no rollback)
.PARAMETER GitClone
    Use git clone from GitHub instead of copying files (fastest option)
.EXAMPLE
    .\quick-reinstall-cloud.ps1
    .\quick-reinstall-cloud.ps1 -Force
    .\quick-reinstall-cloud.ps1 -NewKey
    .\quick-reinstall-cloud.ps1 -SkipBackup
    .\quick-reinstall-cloud.ps1 -GitClone
    .\quick-reinstall-cloud.ps1 -GitClone -Force
#>

param(
    [switch]$Force,
    [switch]$NewKey,
    [switch]$SkipBackup,
    [switch]$GitClone,
    [switch]$QuickUpdate,    # NEW: Git pull + restart services only
    [switch]$SkipBuild       # NEW: Skip npm install/build
)

# Set encoding and error handling
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# Constants
$KeyCachePath = "$env:APPDATA\DellServerManager\service-role-key.txt"
$SupabaseUrl = "https://ylwkczjqvymshktuuqkx.supabase.co"
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsd2tjempxdnltc2hrdHV1cWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODQ0OTMsImV4cCI6MjA3Nzc2MDQ5M30.hIkDV2AAos-Z9hvQLfZmiQ7UvGCpGqwG5kzd1VBRx0w"
$AppDir = "C:\dell-server-manager"
$GitHubRepo = "https://github.com/i0mja/dell-infra-sync.git"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Dell Server Manager - Quick Reinstall (Cloud)" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# FASTEST PATH: Quick update (git pull + rebuild + restart services)
if ($QuickUpdate) {
    Write-Host "===============================================" -ForegroundColor Yellow
    Write-Host "  Quick Update Mode (git pull + rebuild + restart)" -ForegroundColor Yellow
    Write-Host "===============================================" -ForegroundColor Yellow
    
    if (-not (Test-Path "$AppDir\.git")) {
        Write-Host "✗ Quick update requires git repository. Run with -GitClone first." -ForegroundColor Red
        exit 1
    }
    
    # Stop services
    Write-Host "Stopping services..." -ForegroundColor Yellow
    nssm stop DellServerManager 2>&1 | Out-Null
    nssm stop DellServerManagerJobExecutor 2>&1 | Out-Null
    Write-Host "  ✓ Services stopped" -ForegroundColor Green
    
    # Git pull
    Write-Host "Pulling latest changes..." -ForegroundColor Yellow
    Set-Location $AppDir
    git pull origin main 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠ Git pull had warnings (continuing anyway)" -ForegroundColor Yellow
    } else {
        Write-Host "  ✓ Git pull complete" -ForegroundColor Green
    }
    
    # Rebuild frontend (unless -SkipBuild is specified)
    if (-not $SkipBuild) {
        Write-Host "Rebuilding frontend..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ Build failed!" -ForegroundColor Red
            # Still try to start services
        } else {
            Write-Host "  ✓ Build complete" -ForegroundColor Green
        }
    } else {
        Write-Host "Skipping build (Python/backend only update)..." -ForegroundColor Gray
    }
    
    # Start services
    Write-Host "Starting services..." -ForegroundColor Yellow
    nssm start DellServerManager 2>&1 | Out-Null
    nssm start DellServerManagerJobExecutor 2>&1 | Out-Null
    Write-Host "  ✓ Services started" -ForegroundColor Green
    
    Write-Host "`n✓ Quick update complete!" -ForegroundColor Green
    Write-Host "Application URL: http://localhost:3000" -ForegroundColor Cyan
    exit 0
}

# Function: Get cached SERVICE_ROLE_KEY
function Get-CachedServiceRoleKey {
    if (Test-Path $KeyCachePath) {
        $key = Get-Content $KeyCachePath -Raw -ErrorAction SilentlyContinue
        return $key.Trim()
    }
    return $null
}

# Function: Save SERVICE_ROLE_KEY securely
function Save-ServiceRoleKey {
    param([string]$Key)
    
    $cacheDir = Split-Path $KeyCachePath -Parent
    if (-not (Test-Path $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    
    $Key | Set-Content $KeyCachePath -NoNewline
    
    # Set permissions: current user only
    $acl = Get-Acl $KeyCachePath
    $acl.SetAccessRuleProtection($true, $false)
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $env:USERNAME, "FullControl", "Allow"
    )
    $acl.SetAccessRule($accessRule)
    Set-Acl $KeyCachePath $acl
    
    Write-Host "✓ SERVICE_ROLE_KEY cached securely" -ForegroundColor Green
}

# Function: Validate SERVICE_ROLE_KEY
function Test-ServiceRoleKey {
    param([string]$Key)
    
    Write-Host "Validating SERVICE_ROLE_KEY..." -ForegroundColor Yellow
    
    try {
        $headers = @{
            "apikey" = $AnonKey
            "Authorization" = "Bearer $Key"
            "Content-Type" = "application/json"
        }
        
        $response = Invoke-WebRequest -Uri "$SupabaseUrl/rest/v1/" -Headers $headers -Method GET -ErrorAction Stop
        Write-Host "✓ SERVICE_ROLE_KEY is valid" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "✗ Invalid SERVICE_ROLE_KEY: $_" -ForegroundColor Red
        return $false
    }
}

# Function: Cleanup existing installation
function Invoke-Cleanup {
    param([switch]$DoBackup)
    
    Write-Host "`n[CLEANUP PHASE]" -ForegroundColor Cyan
    
    # Conditional backup of source files
    $script:tempBackupPath = $null
    if ($DoBackup -and (Test-Path "$AppDir\package.json")) {
        $script:tempBackupPath = "$env:TEMP\dell-server-manager-backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Write-Host "Backing up source files..." -ForegroundColor Yellow
        Copy-Item $AppDir $script:tempBackupPath -Recurse -Force -Exclude @('node_modules', 'dist', '.vite', 'logs') -ErrorAction SilentlyContinue
        Write-Host "  ✓ Source backed up to $script:tempBackupPath" -ForegroundColor Green
    } elseif (-not $DoBackup) {
        Write-Host "Skipping backup..." -ForegroundColor Gray
    }
    
    # Navigate to temp directory
    Set-Location $env:TEMP
    
    # Stop services
    Write-Host "Stopping services..." -ForegroundColor Yellow
    @("DellServerManager", "DellServerManagerJobExecutor") | ForEach-Object {
        $svc = Get-Service -Name $_ -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "  Stopping $_..."
            if (Get-Command nssm -ErrorAction SilentlyContinue) {
                nssm stop $_ | Out-Null
                Start-Sleep -Seconds 2
                nssm remove $_ confirm | Out-Null
            }
            Write-Host "  ✓ Removed $_" -ForegroundColor Green
        }
    }
    
    
    Start-Sleep -Seconds 5
    
    # Remove directories
    Write-Host "Removing directories..." -ForegroundColor Yellow
    @("C:\supabase", "C:\dell-supabase", $AppDir) | ForEach-Object {
        if (Test-Path $_) {
            Write-Host "  Removing $_..."
            try {
                Remove-Item $_ -Recurse -Force -ErrorAction Stop
                Write-Host "  ✓ Removed $_" -ForegroundColor Green
            }
            catch {
                Write-Host "  ⚠ Could not remove $_ (may be locked)" -ForegroundColor Yellow
            }
        }
    }
    
    # Remove firewall rules
    Write-Host "Removing firewall rules..." -ForegroundColor Yellow
    @("Dell Server Manager", "Supabase API") | ForEach-Object {
        Get-NetFirewallRule -DisplayName $_ -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    }
    Write-Host "  ✓ Firewall rules removed" -ForegroundColor Green
}

# Function: Reinstall application
function Invoke-Reinstall {
    param([string]$ServiceRoleKey)
    
    Write-Host "`n[REINSTALL PHASE]" -ForegroundColor Cyan
    
    # Clone/restore application
    Write-Host "Setting up application directory..." -ForegroundColor Yellow
    
    if ($GitClone) {
        # Fast path: Clone directly from GitHub
        Write-Host "  Cloning from GitHub: $GitHubRepo" -ForegroundColor Yellow
        $parentDir = Split-Path $AppDir -Parent
        Set-Location $parentDir
        
        # Remove target dir if exists
        if (Test-Path $AppDir) {
            Remove-Item $AppDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        
        # Clone repo
        $appDirName = Split-Path $AppDir -Leaf
        git clone $GitHubRepo $appDirName 2>&1 | Out-Null
        
        if ($LASTEXITCODE -ne 0) {
            throw "git clone failed. Ensure git is installed and GitHub is accessible."
        }
        
        Write-Host "  ✓ Git clone complete" -ForegroundColor Green
    }
    else {
        # Original path: Copy from backup or local source
        if (-not (Test-Path $AppDir)) {
            New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
        }
        
        # Try to restore from backup first, then from original source
        $tempBackup = Get-ChildItem "$env:TEMP\dell-server-manager-backup-*" | Sort-Object Name -Descending | Select-Object -First 1
        $sourceDir = $PSScriptRoot | Split-Path -Parent
        
        if ($tempBackup -and (Test-Path "$($tempBackup.FullName)\package.json")) {
            Write-Host "  Restoring from backup: $($tempBackup.FullName)..."
            Copy-Item "$($tempBackup.FullName)\*" $AppDir -Recurse -Force
            Remove-Item $tempBackup.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "  ✓ Files restored from backup" -ForegroundColor Green
        }
        elseif (Test-Path "$sourceDir\package.json") {
            Write-Host "  Copying files from $sourceDir..."
            Copy-Item "$sourceDir\*" $AppDir -Recurse -Force -Exclude @('.git', 'node_modules', 'dist', '.vite', 'logs')
            Write-Host "  ✓ Files copied" -ForegroundColor Green
        }
        else {
            throw "Source files not found. Please run this script from the dell-server-manager directory."
        }
    }
    
    Set-Location $AppDir
    
    # Create logs directory
    $logsDir = "$AppDir\logs"
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    }
    
    if ($SkipBuild) {
        Write-Host "Skipping build (using existing dist/)..." -ForegroundColor Gray
        if (-not (Test-Path "$AppDir\dist")) {
            Write-Host "  ⚠ Warning: No dist/ folder found. Build may be required." -ForegroundColor Yellow
        }
    }
    else {
        # Smart npm install - only if package-lock.json changed
        $lockfileHash = "$AppDir\.npm-lock-hash"
        $currentHash = $null
        if (Test-Path "$AppDir\package-lock.json") {
            $currentHash = (Get-FileHash "$AppDir\package-lock.json" -Algorithm MD5).Hash
        }
        
        $needsInstall = $true
        if ($currentHash -and (Test-Path $lockfileHash)) {
            $cachedHash = Get-Content $lockfileHash -Raw -ErrorAction SilentlyContinue
            if ($cachedHash -and $cachedHash.Trim() -eq $currentHash) {
                Write-Host "Skipping npm install (dependencies unchanged)..." -ForegroundColor Gray
                $needsInstall = $false
            }
        }
        
        if ($needsInstall) {
            Write-Host "Installing dependencies..." -ForegroundColor Yellow
            npm install
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE"
            }
            # Cache the hash for next time
            if ($currentHash) {
                $currentHash | Set-Content $lockfileHash -NoNewline
            }
            Write-Host "  ✓ npm install complete" -ForegroundColor Green
        }
        
        # Build application
        Write-Host "Building application..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed with exit code $LASTEXITCODE"
        }
        Write-Host "  ✓ Build complete" -ForegroundColor Green
    }
    
    # Create .env file
    Write-Host "Creating .env file..." -ForegroundColor Yellow
    @"
VITE_SUPABASE_URL=$SupabaseUrl
VITE_SUPABASE_PUBLISHABLE_KEY=$AnonKey
"@ | Set-Content "$AppDir\.env"
    Write-Host "  ✓ .env created" -ForegroundColor Green
    
    # Install services
    Write-Host "Installing services..." -ForegroundColor Yellow
    
    # Frontend service
    nssm install DellServerManager "C:\Program Files\nodejs\npm.cmd" | Out-Null
    nssm set DellServerManager AppParameters "run preview -- --port 3000 --host" | Out-Null
    nssm set DellServerManager AppDirectory $AppDir | Out-Null
    nssm set DellServerManager DisplayName "Dell Server Manager" | Out-Null
    nssm set DellServerManager Description "Dell Server Manager Web Application" | Out-Null
    nssm set DellServerManager Start SERVICE_AUTO_START | Out-Null
    nssm set DellServerManager AppStdout "$AppDir\logs\app.log" | Out-Null
    nssm set DellServerManager AppStderr "$AppDir\logs\app-error.log" | Out-Null
    Write-Host "  ✓ DellServerManager service installed" -ForegroundColor Green
    
    # Job Executor service
    nssm install DellServerManagerJobExecutor python | Out-Null
    nssm set DellServerManagerJobExecutor AppParameters "job-executor.py" | Out-Null
    nssm set DellServerManagerJobExecutor AppDirectory $AppDir | Out-Null
    nssm set DellServerManagerJobExecutor DisplayName "Dell Server Manager Job Executor" | Out-Null
    nssm set DellServerManagerJobExecutor Description "Job executor for Dell Server Manager" | Out-Null
    nssm set DellServerManagerJobExecutor Start SERVICE_AUTO_START | Out-Null
    nssm set DellServerManagerJobExecutor AppEnvironmentExtra "DSM_URL=$SupabaseUrl" "SERVICE_ROLE_KEY=$ServiceRoleKey" "SUPABASE_URL=$SupabaseUrl" | Out-Null
    Write-Host "  ✓ DellServerManagerJobExecutor service installed" -ForegroundColor Green
    
    # Configure firewall
    Write-Host "Configuring firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "Dell Server Manager" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow | Out-Null
    Write-Host "  ✓ Firewall configured" -ForegroundColor Green
    
    # Start services
    Write-Host "Starting services..." -ForegroundColor Yellow
    Start-Service DellServerManager
    Start-Service DellServerManagerJobExecutor
    Write-Host "  ✓ Services started" -ForegroundColor Green
}

# Main execution
try {
    # Confirmation
    if (-not $Force) {
        Write-Host "⚠ WARNING: This will completely remove and reinstall Dell Server Manager" -ForegroundColor Yellow
        Write-Host ""
        $confirm = Read-Host "Continue? (yes/no)"
        if ($confirm -ne "yes") {
            Write-Host "Aborted." -ForegroundColor Red
            exit 1
        }
    }
    
    # Ask about backup (unless -SkipBackup, -GitClone, or -Force)
    $doBackup = $false
    if ($GitClone) {
        # No backup needed when cloning fresh from GitHub
        Write-Host ""
        Write-Host "Using git clone - skipping backup" -ForegroundColor Gray
    }
    elseif (-not $SkipBackup -and (Test-Path "$AppDir\package.json")) {
        if ($Force) {
            $doBackup = $true  # Force mode still does backup for safety
            Write-Host ""
            Write-Host "Creating backup for safety (use -SkipBackup to skip)..." -ForegroundColor Gray
        } else {
            Write-Host ""
            Write-Host "Do you want to backup source files before reinstalling?" -ForegroundColor Yellow
            Write-Host "(This preserves your local changes but can take several minutes)" -ForegroundColor Gray
            $backupChoice = Read-Host "Backup? (y/n)"
            $doBackup = ($backupChoice -eq "y" -or $backupChoice -eq "yes")
        }
    }
    
    # Handle SERVICE_ROLE_KEY
    $serviceRoleKey = $null
    
    if (-not $NewKey) {
        $cachedKey = Get-CachedServiceRoleKey
        if ($cachedKey) {
            $maskedKey = $cachedKey.Substring(0, [Math]::Min(10, $cachedKey.Length)) + "..."
            Write-Host "Found cached SERVICE_ROLE_KEY: $maskedKey" -ForegroundColor Green
            Write-Host ""
            $choice = Read-Host "Use cached key? (y=yes, n=abort, new=enter new key)"
            
            switch ($choice.ToLower()) {
                "y" { $serviceRoleKey = $cachedKey }
                "yes" { $serviceRoleKey = $cachedKey }
                "new" { $serviceRoleKey = $null }
                default {
                    Write-Host "Aborted." -ForegroundColor Red
                    exit 1
                }
            }
        }
    }
    
    # Prompt for key if needed
    if (-not $serviceRoleKey) {
        Write-Host ""
        Write-Host "Enter your Lovable Cloud SERVICE_ROLE_KEY:" -ForegroundColor Yellow
        Write-Host "(Find it in Lovable: Project Settings -> Integrations -> Lovable Cloud -> Service Role Key)" -ForegroundColor Gray
        $serviceRoleKey = Read-Host
        
        if (-not $serviceRoleKey) {
            Write-Host "✗ SERVICE_ROLE_KEY is required" -ForegroundColor Red
            exit 1
        }
        
        # Validate key
        if (-not (Test-ServiceRoleKey $serviceRoleKey)) {
            exit 1
        }
        
        # Save key
        Save-ServiceRoleKey $serviceRoleKey
    }
    
    # Execute cleanup
    Invoke-Cleanup -DoBackup:$doBackup
    
    # Execute reinstall
    Invoke-Reinstall $serviceRoleKey
    
    # Success summary
    Write-Host "`n===============================================" -ForegroundColor Green
    Write-Host "  ✓ Reinstall Complete!" -ForegroundColor Green
    Write-Host "===============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Application URL: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "Backend: Lovable Cloud" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Services are running. Check logs at:" -ForegroundColor Gray
    Write-Host "  $AppDir\logs\" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To reinstall again: .\quick-reinstall-cloud.ps1" -ForegroundColor Gray
    Write-Host "To use a new key: .\quick-reinstall-cloud.ps1 -NewKey" -ForegroundColor Gray
}
catch {
    Write-Host "`n✗ Error during reinstall: $_" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
