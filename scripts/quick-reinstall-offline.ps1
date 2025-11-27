#Requires -Version 5.1
#Requires -RunAsAdministrator

<#
.SYNOPSIS
    Quick reinstall of Dell Server Manager in offline/local mode
.DESCRIPTION
    Combines cleanup and reinstallation with local Supabase backend.
    Automatically generates new Supabase keys on each install.
.PARAMETER Force
    Skip confirmation prompts
.PARAMETER AdminEmail
    Admin user email (optional, will prompt if not provided)
.EXAMPLE
    .\quick-reinstall-offline.ps1
    .\quick-reinstall-offline.ps1 -Force
    .\quick-reinstall-offline.ps1 -AdminEmail admin@local.test
#>

param(
    [switch]$Force,
    [string]$AdminEmail = ""
)

# Set encoding and error handling
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# Constants
$AppDir = "C:\dell-server-manager"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Dell Server Manager - Quick Reinstall (Offline)" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Function: Wait for Docker to be ready
function Wait-Docker {
    Write-Host "Checking Docker Desktop..." -ForegroundColor Yellow
    
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "✗ Docker Desktop not found. Please install Docker Desktop first." -ForegroundColor Red
        exit 1
    }
    
    $maxAttempts = 30
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        try {
            docker ps 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Docker is ready" -ForegroundColor Green
                return
            }
        }
        catch { }
        
        $attempt++
        Write-Host "  Waiting for Docker... ($attempt/$maxAttempts)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
    
    Write-Host "✗ Docker Desktop is not responding. Please start it manually." -ForegroundColor Red
    exit 1
}

# Function: Cleanup existing installation
function Invoke-Cleanup {
    Write-Host "`n[CLEANUP PHASE]" -ForegroundColor Cyan
    
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
    
    # Stop Supabase
    Write-Host "Stopping Supabase..." -ForegroundColor Yellow
    if (Test-Path "C:\supabase") {
        Set-Location "C:\supabase"
        if (Get-Command supabase -ErrorAction SilentlyContinue) {
            supabase stop --no-backup 2>&1 | Out-Null
        }
    }
    
    # Clean Docker
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host "Cleaning Docker artifacts..." -ForegroundColor Yellow
        docker ps -q | ForEach-Object { docker stop $_ 2>$null | Out-Null }
        docker ps -aq | ForEach-Object { docker rm $_ 2>$null | Out-Null }
        docker volume ls -q | Where-Object { $_ -like "*supabase*" } | ForEach-Object { 
            docker volume rm $_ 2>$null | Out-Null 
        }
        Write-Host "  ✓ Docker cleaned" -ForegroundColor Green
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

# Function: Setup Supabase
function Invoke-SupabaseSetup {
    Write-Host "`n[SUPABASE SETUP]" -ForegroundColor Cyan
    
    # Create Supabase directory
    Write-Host "Setting up Supabase directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "C:\supabase" -Force | Out-Null
    Set-Location "C:\supabase"
    
    # Copy config from repo
    $sourceDir = $PSScriptRoot | Split-Path -Parent
    Write-Host "  Copying Supabase config..."
    Copy-Item "$sourceDir\supabase" "C:\supabase" -Recurse -Force
    Write-Host "  ✓ Config copied" -ForegroundColor Green
    
    # Start Supabase
    Write-Host "Starting Supabase (this may take a few minutes)..." -ForegroundColor Yellow
    supabase start 2>&1 | Out-Null
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to start Supabase" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ Supabase started" -ForegroundColor Green
    
    # Get credentials
    Write-Host "Retrieving Supabase credentials..." -ForegroundColor Yellow
    $status = supabase status --output json | ConvertFrom-Json
    
    $script:SupabaseUrl = "http://127.0.0.1:54321"
    $script:AnonKey = $status.ANON_KEY
    $script:ServiceRoleKey = $status.SERVICE_ROLE_KEY
    
    Write-Host "  ✓ Credentials retrieved" -ForegroundColor Green
    
    # Apply migrations
    Write-Host "Applying database migrations..." -ForegroundColor Yellow
    supabase db push 2>&1 | Out-Null
    Write-Host "  ✓ Migrations applied" -ForegroundColor Green
    
    return @{
        Url = $script:SupabaseUrl
        AnonKey = $script:AnonKey
        ServiceRoleKey = $script:ServiceRoleKey
    }
}

# Function: Create admin user
function New-AdminUser {
    param(
        [string]$Email,
        [string]$Password,
        [hashtable]$SupabaseConfig
    )
    
    Write-Host "`n[ADMIN USER SETUP]" -ForegroundColor Cyan
    
    # Clear existing users
    Write-Host "Clearing existing users..." -ForegroundColor Yellow
    $container = docker ps --format "{{.Names}}" | Where-Object { $_ -like "*postgres*" }
    if ($container) {
        docker exec $container psql -U postgres -d postgres -c "DELETE FROM auth.users;" 2>&1 | Out-Null
        docker exec $container psql -U postgres -d postgres -c "DELETE FROM public.user_roles;" 2>&1 | Out-Null
        docker exec $container psql -U postgres -d postgres -c "DELETE FROM public.profiles;" 2>&1 | Out-Null
        Write-Host "  ✓ Existing users cleared" -ForegroundColor Green
    }
    
    # Create admin user via API
    Write-Host "Creating admin user: $Email..." -ForegroundColor Yellow
    
    $body = @{
        email = $Email
        password = $Password
    } | ConvertTo-Json
    
    $headers = @{
        "apikey" = $SupabaseConfig.AnonKey
        "Content-Type" = "application/json"
    }
    
    try {
        $response = Invoke-RestMethod -Uri "$($SupabaseConfig.Url)/auth/v1/signup" `
            -Method POST `
            -Headers $headers `
            -Body $body `
            -ErrorAction Stop
        
        $userId = $response.user.id
        Write-Host "  ✓ Admin user created (ID: $userId)" -ForegroundColor Green
        
        # Assign admin role
        Write-Host "Assigning admin role..." -ForegroundColor Yellow
        docker exec $container psql -U postgres -d postgres -c "UPDATE public.user_roles SET role = 'admin' WHERE user_id = '$userId';" 2>&1 | Out-Null
        Write-Host "  ✓ Admin role assigned" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Failed to create admin user: $_" -ForegroundColor Red
        exit 1
    }
}

# Function: Reinstall application
function Invoke-AppSetup {
    param([hashtable]$SupabaseConfig)
    
    Write-Host "`n[APPLICATION SETUP]" -ForegroundColor Cyan
    
    # Setup directory
    Write-Host "Setting up application directory..." -ForegroundColor Yellow
    if (-not (Test-Path $AppDir)) {
        New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
    }
    
    # Copy files
    $sourceDir = $PSScriptRoot | Split-Path -Parent
    Write-Host "  Copying files from $sourceDir..."
    Copy-Item "$sourceDir\*" $AppDir -Recurse -Force -Exclude @('.git', 'node_modules', 'dist', '.vite')
    Write-Host "  ✓ Files copied" -ForegroundColor Green
    
    Set-Location $AppDir
    
    # Install dependencies
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install 2>&1 | Out-Null
    Write-Host "  ✓ npm install complete" -ForegroundColor Green
    
    # Build application
    Write-Host "Building application..." -ForegroundColor Yellow
    npm run build 2>&1 | Out-Null
    Write-Host "  ✓ Build complete" -ForegroundColor Green
    
    # Create .env file
    Write-Host "Creating .env file..." -ForegroundColor Yellow
    @"
VITE_SUPABASE_URL=$($SupabaseConfig.Url)
VITE_SUPABASE_PUBLISHABLE_KEY=$($SupabaseConfig.AnonKey)
"@ | Set-Content "$AppDir\.env"
    Write-Host "  ✓ .env created" -ForegroundColor Green
    
    # Install Python dependencies
    Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
    pip install -r requirements.txt 2>&1 | Out-Null
    Write-Host "  ✓ Python dependencies installed" -ForegroundColor Green
    
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
    nssm set DellServerManagerJobExecutor AppEnvironmentExtra "DSM_URL=$($SupabaseConfig.Url)" "SERVICE_ROLE_KEY=$($SupabaseConfig.ServiceRoleKey)" "SUPABASE_URL=$($SupabaseConfig.Url)" | Out-Null
    Write-Host "  ✓ DellServerManagerJobExecutor service installed" -ForegroundColor Green
    
    # Configure firewall
    Write-Host "Configuring firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "Dell Server Manager" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -ErrorAction SilentlyContinue | Out-Null
    New-NetFirewallRule -DisplayName "Supabase API" -Direction Inbound -Protocol TCP -LocalPort 54321 -Action Allow -ErrorAction SilentlyContinue | Out-Null
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
        Write-Host "⚠ WARNING: This will completely remove and reinstall Dell Server Manager with local Supabase" -ForegroundColor Yellow
        Write-Host ""
        $confirm = Read-Host "Continue? (yes/no)"
        if ($confirm -ne "yes") {
            Write-Host "Aborted." -ForegroundColor Red
            exit 1
        }
    }
    
    # Wait for Docker
    Wait-Docker
    
    # Execute cleanup
    Invoke-Cleanup
    
    # Setup Supabase
    $supabaseConfig = Invoke-SupabaseSetup
    
    # Get admin credentials
    if (-not $AdminEmail) {
        Write-Host ""
        $AdminEmail = Read-Host "Enter admin email (default: admin@local.test)"
        if (-not $AdminEmail) {
            $AdminEmail = "admin@local.test"
        }
    }
    
    Write-Host "Enter admin password (default: admin123)" -ForegroundColor Yellow
    $adminPassword = Read-Host -AsSecureString
    $adminPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword)
    )
    if (-not $adminPasswordPlain) {
        $adminPasswordPlain = "admin123"
    }
    
    # Create admin user
    New-AdminUser -Email $AdminEmail -Password $adminPasswordPlain -SupabaseConfig $supabaseConfig
    
    # Setup application
    Invoke-AppSetup -SupabaseConfig $supabaseConfig
    
    # Success summary
    Write-Host "`n===============================================" -ForegroundColor Green
    Write-Host "  ✓ Reinstall Complete!" -ForegroundColor Green
    Write-Host "===============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Application URL: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "Backend: Local Supabase (http://127.0.0.1:54321)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Admin Credentials:" -ForegroundColor Yellow
    Write-Host "  Email: $AdminEmail" -ForegroundColor White
    Write-Host "  Password: $adminPasswordPlain" -ForegroundColor White
    Write-Host ""
    Write-Host "Services are running. Check logs at:" -ForegroundColor Gray
    Write-Host "  $AppDir\logs\" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To reinstall again: .\quick-reinstall-offline.ps1" -ForegroundColor Gray
}
catch {
    Write-Host "`n✗ Error during reinstall: $_" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
