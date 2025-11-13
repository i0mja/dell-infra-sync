# Create Offline Installation Package for Dell Server Manager (Windows)
# Run this on an internet-connected Windows machine to create a bundle for air-gapped deployment

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$PackageDir = Join-Path $ProjectRoot "offline-package"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$PackageName = "dell-server-manager-offline-$Timestamp"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Creating Offline Installation Package" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Create package directory structure
Write-Host "Creating package directory structure..." -ForegroundColor Yellow
$PackagePath = Join-Path $PackageDir $PackageName
New-Item -ItemType Directory -Force -Path "$PackagePath\docker-images" | Out-Null
New-Item -ItemType Directory -Force -Path "$PackagePath\npm-packages" | Out-Null
New-Item -ItemType Directory -Force -Path "$PackagePath\python-packages" | Out-Null
New-Item -ItemType Directory -Force -Path "$PackagePath\app" | Out-Null
New-Item -ItemType Directory -Force -Path "$PackagePath\docs" | Out-Null
New-Item -ItemType Directory -Force -Path "$PackagePath\scripts" | Out-Null
New-Item -ItemType Directory -Force -Path "$PackagePath\installers" | Out-Null

# Copy application code
Write-Host "Copying application code..." -ForegroundColor Yellow
robocopy "$ProjectRoot" "$PackagePath\app" /E /XD node_modules dist .git offline-package supabase\.branches /XF *.log /NFL /NDL /NJH /NJS

# Download npm dependencies
Write-Host "Downloading npm dependencies..." -ForegroundColor Yellow
Push-Location $ProjectRoot
npm install --legacy-peer-deps
Compress-Archive -Path "node_modules" -DestinationPath "$PackagePath\npm-packages\node_modules.zip" -CompressionLevel Optimal
Pop-Location

# Download Python packages
Write-Host "Downloading Python packages..." -ForegroundColor Yellow
pip3 download -d "$PackagePath\python-packages" requests pyVim pyVmomi urllib3

# Download required installers
Write-Host "Downloading required installers..." -ForegroundColor Yellow
Write-Host "NOTE: The following must be downloaded manually and placed in the installers folder:" -ForegroundColor Yellow
Write-Host "  1. Docker Desktop Installer (DockerDesktopInstaller.exe)" -ForegroundColor Gray
Write-Host "  2. Node.js 18 LTS Installer (node-v18-x64.msi)" -ForegroundColor Gray
Write-Host "  3. Git for Windows Installer (Git-2.43.0-64-bit.exe or later)" -ForegroundColor Gray
Write-Host ""
Write-Host "Download locations:" -ForegroundColor Yellow
Write-Host "  Docker: https://www.docker.com/products/docker-desktop" -ForegroundColor Gray
Write-Host "  Node.js: https://nodejs.org/dist/v18.x/" -ForegroundColor Gray
Write-Host "  Git: https://git-scm.com/download/win" -ForegroundColor Gray
Write-Host ""
$continue = Read-Host "Have you placed the installers in $PackagePath\installers? (y/n)"
if ($continue -ne 'y') {
    Write-Host "Please download the installers and run this script again." -ForegroundColor Red
    exit 1
}

# Save Docker images
Write-Host "Downloading and saving Docker images..." -ForegroundColor Yellow
Write-Host "This may take 15-30 minutes depending on your connection..." -ForegroundColor Gray

# Pull Supabase images
$images = @(
    "supabase/postgres:15.1.0.147",
    "supabase/gotrue:v2.143.0",
    "supabase/realtime:v2.25.50",
    "supabase/storage-api:v0.43.11",
    "supabase/postgrest:v12.0.2",
    "supabase/postgres-meta:v0.75.0",
    "supabase/studio:20240101-5e69d88",
    "supabase/edge-runtime:v1.22.4",
    "kong:2.8.1",
    "supabase/logflare:1.4.0",
    "prom/prometheus:latest",
    "timberio/vector:0.34.0-alpine",
    "darthsim/imgproxy:latest"
)

foreach ($image in $images) {
    Write-Host "Pulling $image..." -ForegroundColor Gray
    docker pull $image
}

# Save images to tar files
Write-Host "Saving Docker images to tar files..." -ForegroundColor Yellow
docker save -o "$PackagePath\docker-images\supabase-postgres.tar" supabase/postgres:15.1.0.147
docker save -o "$PackagePath\docker-images\supabase-gotrue.tar" supabase/gotrue:v2.143.0
docker save -o "$PackagePath\docker-images\supabase-realtime.tar" supabase/realtime:v2.25.50
docker save -o "$PackagePath\docker-images\supabase-storage.tar" supabase/storage-api:v0.43.11
docker save -o "$PackagePath\docker-images\supabase-postgrest.tar" supabase/postgrest:v12.0.2
docker save -o "$PackagePath\docker-images\supabase-postgres-meta.tar" supabase/postgres-meta:v0.75.0
docker save -o "$PackagePath\docker-images\supabase-studio.tar" supabase/studio:20240101-5e69d88
docker save -o "$PackagePath\docker-images\supabase-edge-runtime.tar" supabase/edge-runtime:v1.22.4
docker save -o "$PackagePath\docker-images\kong.tar" kong:2.8.1
docker save -o "$PackagePath\docker-images\supabase-logflare.tar" supabase/logflare:1.4.0
docker save -o "$PackagePath\docker-images\prometheus.tar" prom/prometheus:latest
docker save -o "$PackagePath\docker-images\vector.tar" timberio/vector:0.34.0-alpine
docker save -o "$PackagePath\docker-images\imgproxy.tar" darthsim/imgproxy:latest

Write-Host "Compressing Docker images..." -ForegroundColor Yellow
Compress-Archive -Path "$PackagePath\docker-images\*.tar" -DestinationPath "$PackagePath\docker-images\docker-images.zip" -CompressionLevel Optimal
Remove-Item "$PackagePath\docker-images\*.tar"

# Copy documentation
Write-Host "Copying documentation..." -ForegroundColor Yellow
Copy-Item -Path "$ProjectRoot\docs" -Destination "$PackagePath\" -Recurse
Copy-Item -Path "$ProjectRoot\README.md" -Destination "$PackagePath\"

# Create installation manifest
Write-Host "Creating installation manifest..." -ForegroundColor Yellow
@"
Dell Server Manager - Offline Installation Package
Generated: $(Get-Date)
Version: $(git -C "$ProjectRoot" describe --tags --always 2>$null)

Contents:
  - app\                    : Complete application source code
  - docker-images\          : Pre-downloaded Docker images for Supabase
  - npm-packages\           : Node.js dependencies
  - python-packages\        : Python dependencies for job executors
  - docs\                   : Complete documentation
  - installers\             : Required software installers
  - scripts\                : Installation scripts
  - MANIFEST.txt            : This file
  - README-OFFLINE.txt      : Offline installation instructions

Required Installers (must be in installers\ folder):
  - DockerDesktopInstaller.exe
  - node-v18-x64.msi
  - Git-*-64-bit.exe

Docker Images Included:
  - supabase/postgres:15.1.0.147
  - supabase/gotrue:v2.143.0
  - supabase/realtime:v2.25.50
  - supabase/storage-api:v0.43.11
  - supabase/postgrest:v12.0.2
  - supabase/postgres-meta:v0.75.0
  - supabase/studio:20240101-5e69d88
  - supabase/edge-runtime:v1.22.4
  - kong:2.8.1
  - supabase/logflare:1.4.0
  - prom/prometheus:latest
  - timberio/vector:0.34.0-alpine
  - darthsim/imgproxy:latest

System Requirements:
  Windows Server 2022: 8GB RAM, 100GB disk space

Installation:
  Run PowerShell as Administrator:
  .\install-offline-windows.ps1
"@ | Out-File -FilePath "$PackagePath\MANIFEST.txt" -Encoding UTF8

# Create offline installation README
@"
Dell Server Manager - Offline Installation (Windows)
=====================================================

This package contains everything needed to deploy Dell Server Manager
in a completely air-gapped Windows environment without internet access.

PREREQUISITES
-------------
1. Windows Server 2022
2. Administrator access required
3. Minimum 100GB free disk space
4. Minimum 8GB RAM

INSTALLATION STEPS
------------------

1. Transfer this entire package to the target system
2. Extract the ZIP file to C:\dell-server-manager-offline
3. Open PowerShell as Administrator
4. Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
5. cd C:\dell-server-manager-offline
6. .\install-offline-windows.ps1

The script will:
  - Install Docker Desktop (requires restart)
  - Install Node.js 18 LTS
  - Install Git
  - Load all Docker images
  - Install and configure Supabase
  - Build and deploy the application
  - Create Windows service

POST-INSTALLATION
-----------------
After installation completes, you'll receive:
- Application URL (typically http://SERVER_IP:3000)
- Supabase Studio URL (typically http://SERVER_IP:8000)
- Database credentials
- Service management commands

The system will be fully functional without any internet connectivity.

NETWORK REQUIREMENTS (Internal Only)
------------------------------------
- Application: Port 3000 (or 443 if SSL configured)
- Supabase API: Port 8000
- iDRAC connections: Port 443 (to your Dell servers)
- vCenter connections: Port 443 (to your vCenter servers)

TROUBLESHOOTING
---------------
See docs\SELF_HOSTING.md for detailed troubleshooting steps.

Health check:
  .\app\scripts\health-check.ps1

Service management:
  Get-Service DellServerManager
  Restart-Service DellServerManager
  Stop-Service DellServerManager
"@ | Out-File -FilePath "$PackagePath\README-OFFLINE.txt" -Encoding UTF8

# Create compressed archive
Write-Host "Creating compressed archive..." -ForegroundColor Yellow
$ZipPath = "$PackageDir\$PackageName.zip"
Compress-Archive -Path $PackagePath -DestinationPath $ZipPath -CompressionLevel Optimal
$PackageSize = [math]::Round((Get-Item $ZipPath).Length / 1GB, 2)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "Offline Package Created Successfully!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Package Location: $ZipPath" -ForegroundColor Cyan
Write-Host "Package Size: $PackageSize GB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Transfer this file to your air-gapped system and extract it:" -ForegroundColor Yellow
Write-Host "  Expand-Archive -Path $PackageName.zip -DestinationPath C:\" -ForegroundColor Gray
Write-Host "  cd C:\$PackageName" -ForegroundColor Gray
Write-Host "  .\install-offline-windows.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "The package contains:" -ForegroundColor Yellow
Write-Host "  ✓ Complete application code" -ForegroundColor Green
Write-Host "  ✓ All Docker images (~3-5GB)" -ForegroundColor Green
Write-Host "  ✓ All npm dependencies" -ForegroundColor Green
Write-Host "  ✓ All Python packages" -ForegroundColor Green
Write-Host "  ✓ Required installers" -ForegroundColor Green
Write-Host "  ✓ Installation scripts" -ForegroundColor Green
Write-Host "  ✓ Complete documentation" -ForegroundColor Green
Write-Host ""
