# Offline Installation Script for Dell Server Manager on Windows Server 2022
# This script installs from a pre-packaged offline bundle

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $ScriptDir "app"
$InstallDir = "C:\dell-server-manager"
$LogFile = "C:\dell-server-manager\install-offline.log"

# Start transcript
New-Item -ItemType Directory -Force -Path "C:\dell-server-manager" | Out-Null
Start-Transcript -Path $LogFile -Append

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Dell Server Manager - Offline Installation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Installation log: $LogFile" -ForegroundColor Gray
Write-Host ""

# Check if we're in the offline package directory
if (-not (Test-Path "$ScriptDir\docker-images") -or -not (Test-Path "$ScriptDir\npm-packages")) {
    Write-Host "ERROR: This script must be run from the extracted offline package directory" -ForegroundColor Red
    exit 1
}

# Install core software
Write-Host "Installing core software..." -ForegroundColor Yellow

# Install Docker Desktop
if (-not (Test-Path "C:\Program Files\Docker\Docker\Docker Desktop.exe")) {
    Write-Host "Installing Docker Desktop..." -ForegroundColor Yellow
    $dockerInstaller = Get-ChildItem "$ScriptDir\installers" -Filter "Docker*.exe" | Select-Object -First 1
    if ($dockerInstaller) {
        Start-Process -FilePath $dockerInstaller.FullName -ArgumentList "install", "--quiet" -Wait
        Write-Host "Docker Desktop installed. System restart required." -ForegroundColor Yellow
        $restart = Read-Host "Restart now? (y/n)"
        if ($restart -eq 'y') {
            Restart-Computer -Force
            exit 0
        }
    } else {
        Write-Host "ERROR: Docker installer not found in installers folder" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Docker Desktop already installed" -ForegroundColor Green
}

# Install Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Node.js..." -ForegroundColor Yellow
    $nodeInstaller = Get-ChildItem "$ScriptDir\installers" -Filter "node*.msi" | Select-Object -First 1
    if ($nodeInstaller) {
        Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", $nodeInstaller.FullName, "/quiet", "/norestart" -Wait
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        Write-Host "ERROR: Node.js installer not found in installers folder" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Node.js already installed ($(node --version))" -ForegroundColor Green
}

# Install Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git..." -ForegroundColor Yellow
    $gitInstaller = Get-ChildItem "$ScriptDir\installers" -Filter "Git*.exe" | Select-Object -First 1
    if ($gitInstaller) {
        Start-Process -FilePath $gitInstaller.FullName -ArgumentList "/VERYSILENT", "/NORESTART" -Wait
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        Write-Host "ERROR: Git installer not found in installers folder" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Git already installed" -ForegroundColor Green
}

# Wait for Docker to be ready
Write-Host "Waiting for Docker to be ready..." -ForegroundColor Yellow
Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
$maxAttempts = 60
$attempt = 0
while ($attempt -lt $maxAttempts) {
    try {
        docker version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Docker is ready" -ForegroundColor Green
            break
        }
    } catch {}
    $attempt++
    Start-Sleep -Seconds 5
}

if ($attempt -eq $maxAttempts) {
    Write-Host "ERROR: Docker failed to start. Please start Docker Desktop manually and run this script again." -ForegroundColor Red
    exit 1
}

# Load Docker images
Write-Host "Loading Docker images..." -ForegroundColor Yellow
Write-Host "This may take 10-15 minutes..." -ForegroundColor Gray
Push-Location "$ScriptDir\docker-images"
Expand-Archive -Path "docker-images.zip" -DestinationPath "." -Force
Get-ChildItem -Filter "*.tar" | ForEach-Object {
    Write-Host "Loading $($_.BaseName)..." -ForegroundColor Gray
    docker load -i $_.FullName
}
Remove-Item "*.tar"
Pop-Location
Write-Host "✓ All Docker images loaded" -ForegroundColor Green

# Setup Supabase
Write-Host "Setting up Supabase..." -ForegroundColor Yellow
$SupabaseDir = "C:\supabase"
New-Item -ItemType Directory -Force -Path $SupabaseDir | Out-Null
Copy-Item -Path "$AppDir\supabase" -Destination $SupabaseDir -Recurse -Force

# Generate secure passwords
$PostgresPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 25 | ForEach-Object {[char]$_})
$JwtSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 25 | ForEach-Object {[char]$_})
$AnonKey = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 25 | ForEach-Object {[char]$_})
$ServiceRoleKey = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 25 | ForEach-Object {[char]$_})
$DashboardPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 16 | ForEach-Object {[char]$_})

# Create .env file
@"
POSTGRES_PASSWORD=$PostgresPassword
JWT_SECRET=$JwtSecret
ANON_KEY=$AnonKey
SERVICE_ROLE_KEY=$ServiceRoleKey
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=$DashboardPassword
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
STUDIO_PORT=8000
API_PORT=8000
"@ | Out-File -FilePath "$SupabaseDir\.env" -Encoding UTF8

# Start Supabase
Write-Host "Starting Supabase services..." -ForegroundColor Yellow
Push-Location "$SupabaseDir\supabase"
docker compose up -d
Pop-Location

# Wait for database
Write-Host "Waiting for database to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
$dbReady = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        docker exec supabase-db pg_isready -U postgres 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $dbReady = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 5
}

if (-not $dbReady) {
    Write-Host "ERROR: Database failed to start" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Database is ready" -ForegroundColor Green

# Apply migrations
Write-Host "Applying database migrations..." -ForegroundColor Yellow
Get-ChildItem "$ScriptDir\app\supabase\migrations" -Filter "*.sql" | Sort-Object Name | ForEach-Object {
    Write-Host "Applying $($_.Name)..." -ForegroundColor Gray
    Get-Content $_.FullName | docker exec -i supabase-db psql -U postgres -d postgres
}

# Verify database
Write-Host "Verifying database schema..." -ForegroundColor Yellow
& "$ScriptDir\app\scripts\verify-database.ps1"

$DbUrl = "postgresql://postgres:${PostgresPassword}@localhost:5432/postgres"
$SupabaseUrl = "http://localhost:8000"

Write-Host ""
Write-Host "Supabase is running!" -ForegroundColor Green
Write-Host "Studio URL: http://localhost:8000" -ForegroundColor Cyan
Write-Host ""

# Create admin user via Supabase signup API (not direct SQL)
Write-Host "Creating admin user..." -ForegroundColor Yellow
$AdminEmail = Read-Host "Enter admin email address"
$AdminPassword = Read-Host "Enter admin password" -AsSecureString
$AdminPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword))

# Use Supabase signup API to properly create user
$headers = @{
    "apikey" = $AnonKey
    "Content-Type" = "application/json"
}

$body = @{
    email = $AdminEmail
    password = $AdminPasswordText
    email_confirm = $true
    data = @{
        full_name = "Administrator"
    }
} | ConvertTo-Json

try {
    Invoke-WebRequest -Uri "$SupabaseUrl/auth/v1/signup" -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
    Write-Host "✓ User account created" -ForegroundColor Green
} catch {
    Write-Host "WARNING: User creation failed or user already exists" -ForegroundColor Yellow
}

# Wait for triggers to complete
Start-Sleep -Seconds 2

# Assign admin role
docker exec -i supabase-db psql -U postgres -d postgres -c "UPDATE public.user_roles SET role = 'admin'::app_role WHERE user_id = (SELECT id FROM auth.users WHERE email = '$AdminEmail');" | Out-Null

Write-Host "✓ Admin user created" -ForegroundColor Green

# Install application
Write-Host "Installing Dell Server Manager application..." -ForegroundColor Yellow
Copy-Item -Path "$AppDir\*" -Destination $InstallDir -Recurse -Force

# Remove cloud .env if it exists (should not be in offline package, but safety check)
if (Test-Path "$InstallDir\.env") {
    Remove-Item "$InstallDir\.env" -Force
    Write-Host "✓ Removed cloud .env file" -ForegroundColor Green
}

# Extract npm packages
Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
if (Test-Path "$ScriptDir\npm-packages\node_modules.zip") {
    Expand-Archive -Path "$ScriptDir\npm-packages\node_modules.zip" -DestinationPath $InstallDir -Force
    Write-Host "✓ npm dependencies installed" -ForegroundColor Green
}

# Install Python packages
Write-Host "Installing Python packages..." -ForegroundColor Yellow
pip3 install --no-index --find-links="$ScriptDir\python-packages" requests pyVim pyVmomi urllib3

# Build application and create .env for local Supabase
Write-Host "Building application..." -ForegroundColor Yellow
Push-Location $InstallDir
Copy-Item ".env.offline.template" ".env"
(Get-Content ".env") -replace 'http://127.0.0.1:54321', "$SupabaseUrl" | Set-Content ".env"

npm run build
Pop-Location

# Install Python dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
if (Test-Path "$InstallDir\requirements.txt") {
    pip3 install -r "$InstallDir\requirements.txt" --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Python dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "⚠ Some Python packages may have failed to install" -ForegroundColor Yellow
    }
}

# Create Windows service
Write-Host "Creating Windows service..." -ForegroundColor Yellow
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    choco install nssm -y --no-progress
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")
}

nssm install DellServerManager "npm" "run preview -- --host 0.0.0.0 --port 3000"
nssm set DellServerManager AppDirectory $InstallDir
nssm set DellServerManager DisplayName "Dell Server Manager"
nssm set DellServerManager Description "Dell iDRAC and vCenter Management Platform"
nssm set DellServerManager Start SERVICE_AUTO_START
nssm set DellServerManager AppStdout "$InstallDir\logs\service.log"
nssm set DellServerManager AppStderr "$InstallDir\logs\service-error.log"
nssm start DellServerManager

# Setup Job Executor service
Write-Host "Setting up Job Executor service..." -ForegroundColor Yellow
$PythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonPath) {
    $PythonPath = (Get-Command python3 -ErrorAction SilentlyContinue).Source
}

if ($PythonPath) {
    $JobExecutorScript = Join-Path $InstallDir "job-executor.py"
    
    nssm install DellServerManagerJobExecutor $PythonPath $JobExecutorScript
    nssm set DellServerManagerJobExecutor AppDirectory $InstallDir
    nssm set DellServerManagerJobExecutor DisplayName "Dell Server Manager - Job Executor"
    nssm set DellServerManagerJobExecutor Description "Processes iDRAC and vCenter jobs"
    nssm set DellServerManagerJobExecutor Start SERVICE_AUTO_START
    
    # Set environment variables (including PYTHONUTF8=1 for Unicode support)
    nssm set DellServerManagerJobExecutor AppEnvironmentExtra "SERVICE_ROLE_KEY=$ServiceRoleKey" "DSM_URL=$SupabaseUrl" "PYTHONUTF8=1"
    
    # Log files
    New-Item -ItemType Directory -Path "$InstallDir\logs" -Force | Out-Null
    nssm set DellServerManagerJobExecutor AppStdout "$InstallDir\logs\job-executor-output.log"
    nssm set DellServerManagerJobExecutor AppStderr "$InstallDir\logs\job-executor-error.log"
    
    # Start service
    nssm start DellServerManagerJobExecutor
    Write-Host "✓ Job Executor service started" -ForegroundColor Green
} else {
    Write-Host "⚠ Python not found - Job Executor service not created" -ForegroundColor Yellow
    Write-Host "  Install Python 3.11+ and re-run setup" -ForegroundColor Gray
}

# Configure firewall
Write-Host "Configuring Windows Firewall..." -ForegroundColor Yellow
New-NetFirewallRule -DisplayName "Dell Server Manager" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Supabase API" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -ErrorAction SilentlyContinue

$ServerIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike "127.*"} | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "🎉 Dell Server Manager is now running in AIR-GAPPED mode!" -ForegroundColor Green
Write-Host ""
Write-Host "Application URL: http://${ServerIp}:3000" -ForegroundColor Cyan
Write-Host "Supabase Studio: http://${ServerIp}:8000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Admin Credentials:" -ForegroundColor Yellow
Write-Host "  Email: $AdminEmail" -ForegroundColor Gray
Write-Host ""
Write-Host "Service Management:" -ForegroundColor Yellow
Write-Host "  Status: Get-Service DellServerManager" -ForegroundColor Gray
Write-Host "  Stop: Stop-Service DellServerManager" -ForegroundColor Gray
Write-Host "  Start: Start-Service DellServerManager" -ForegroundColor Gray
Write-Host "  Restart: Restart-Service DellServerManager" -ForegroundColor Gray
Write-Host ""

# Save credentials
@"
Dell Server Manager - Air-Gapped Deployment Credentials
Installed: $(Get-Date)

Application URL: http://${ServerIp}:3000
Supabase Studio: http://${ServerIp}:8000

Admin User:
  Email: $AdminEmail
  
Database:
  URL: $DbUrl
  Password: $PostgresPassword

Supabase Studio:
  Username: supabase
  Password: $DashboardPassword
  
Service: DellServerManager
"@ | Out-File -FilePath "$InstallDir\deployment-credentials.txt" -Encoding UTF8

Write-Host "Credentials saved to: $InstallDir\deployment-credentials.txt" -ForegroundColor Cyan
Write-Host ""

Stop-Transcript
