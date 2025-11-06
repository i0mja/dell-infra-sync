# Dell Server Manager - Windows Server 2022 Deployment Script
# Automates complete self-hosted setup on Windows Server 2022
# Requires: PowerShell 5.1 or higher

#Requires -RunAsAdministrator

# Set UTF-8 encoding (suppress errors in some admin contexts)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # Ignore encoding errors - they're non-critical
}

# Check PowerShell version
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host "[ERROR] This script requires PowerShell 5.1 or higher" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Dell Server Manager - Windows Server 2022 Self-Hosted Deployment" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

# Function to refresh PATH from registry
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + 
                ";" + 
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# Function to ensure Docker Desktop is running with Linux containers
function Wait-Docker {
    Write-Host "[DOCKER] Ensuring Docker Desktop is running with Linux containers..." -ForegroundColor Yellow
    
    # Check if Docker Desktop is installed
    $dockerDesktopPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    $dockerCliPath = "C:\Program Files\Docker\Docker\DockerCli.exe"
    
    if (!(Test-Path $dockerDesktopPath)) {
        Write-Host "[ERROR] Docker Desktop not found at $dockerDesktopPath" -ForegroundColor Red
        exit 1
    }
    
    # Start Docker Desktop if not running
    $dockerProcess = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
    if (!$dockerProcess) {
        Write-Host "[INFO] Starting Docker Desktop..." -ForegroundColor Cyan
        Start-Process $dockerDesktopPath
        Start-Sleep -Seconds 10
    } else {
        Write-Host "[OK] Docker Desktop is already running" -ForegroundColor Green
    }
    
    # Switch to Linux containers
    Write-Host "[INFO] Switching to Linux containers..." -ForegroundColor Cyan
    if (Test-Path $dockerCliPath) {
        & $dockerCliPath -SwitchLinuxEngine 2>&1 | Out-Null
    }
    
    # Wait for Docker engine to be ready (max 3 minutes)
    Write-Host "[WAIT] Waiting for Docker engine to be ready..." -ForegroundColor Yellow
    $deadline = (Get-Date).AddMinutes(3)
    $ready = $false
    
    while ((Get-Date) -lt $deadline) {
        try {
            $null = docker info 2>&1
            if ($LASTEXITCODE -eq 0) {
                $ready = $true
                break
            }
        } catch {
            # Docker not ready yet
        }
        Start-Sleep -Seconds 3
    }
    
    if (!$ready) {
        Write-Host "[ERROR] Docker engine did not start within 3 minutes" -ForegroundColor Red
        Write-Host "[ERROR] Please ensure Docker Desktop is installed and running" -ForegroundColor Red
        Write-Host "[ERROR] Make sure it's set to Linux containers mode" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "[OK] Docker engine is ready" -ForegroundColor Green
}

# Step 1: Install Chocolatey
Write-Host "[INSTALL] Step 1/8: Installing Chocolatey..." -ForegroundColor Yellow
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Write-Host "[OK] Chocolatey installed" -ForegroundColor Green
} else {
    Write-Host "[OK] Chocolatey already installed" -ForegroundColor Green
}

# Step 2: Install Docker Desktop
Write-Host "[INSTALL] Step 2/8: Installing Docker Desktop..." -ForegroundColor Yellow
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    choco install docker-desktop -y
    Write-Host "[WARN] Docker Desktop installed - Please restart your computer and run this script again" -ForegroundColor Red
    exit 0
} else {
    Write-Host "[OK] Docker Desktop already installed" -ForegroundColor Green
}

# Step 3: Install Node.js
Write-Host "[INSTALL] Step 3/8: Installing Node.js 18..." -ForegroundColor Yellow
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    choco install nodejs-lts -y
    Refresh-Path
    Start-Sleep -Seconds 2
    
    # Verify npm is now available
    if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] npm command not found after Node.js installation" -ForegroundColor Red
        Write-Host "[ERROR] Please close this PowerShell window and run the script again" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Node.js installed" -ForegroundColor Green
} else {
    Write-Host "[OK] Node.js already installed" -ForegroundColor Green
}

# Step 4: Install Git
Write-Host "[INSTALL] Step 4/8: Installing Git..." -ForegroundColor Yellow
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    choco install git -y
    Refresh-Path
    Start-Sleep -Seconds 2
    Write-Host "[OK] Git installed" -ForegroundColor Green
} else {
    Write-Host "[OK] Git already installed" -ForegroundColor Green
}

# Step 5: Install Scoop (Package Manager for Supabase CLI)
Write-Host "[INSTALL] Step 5/8: Installing Scoop package manager..." -ForegroundColor Yellow
if (!(Get-Command scoop -ErrorAction SilentlyContinue)) {
    # Install Scoop with admin privileges
    Write-Host "[INFO] Installing Scoop with administrator privileges..." -ForegroundColor Cyan
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    iex "& {$(irm get.scoop.sh)} -RunAsAdmin"
    Refresh-Path
    Start-Sleep -Seconds 2
    
    # Verify Scoop is now available
    if (!(Get-Command scoop -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] Scoop installation failed" -ForegroundColor Red
        Write-Host "[INFO] This may happen if:" -ForegroundColor Yellow
        Write-Host "   1. Internet connection is unstable" -ForegroundColor Gray
        Write-Host "   2. PowerShell execution policy is too restrictive" -ForegroundColor Gray
        Write-Host "   3. Antivirus is blocking the installation" -ForegroundColor Gray
        Write-Host "" -ForegroundColor Gray
        Write-Host "[FIX] Try running these commands manually:" -ForegroundColor Yellow
        Write-Host "   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" -ForegroundColor Cyan
        Write-Host '   iex "& {$(irm get.scoop.sh)} -RunAsAdmin"' -ForegroundColor Cyan
        exit 1
    }
    Write-Host "[OK] Scoop installed" -ForegroundColor Green
} else {
    Write-Host "[OK] Scoop already installed" -ForegroundColor Green
}

# Ensure Docker is ready before continuing
Wait-Docker

# Step 6: Setup Supabase CLI
Write-Host "[DATABASE] Step 6/8: Setting up Supabase CLI..." -ForegroundColor Yellow

# Add Supabase bucket to Scoop
Write-Host "[CONFIG] Adding Supabase bucket to Scoop..." -ForegroundColor Yellow
$scoopBuckets = scoop bucket list 2>&1
if ($scoopBuckets -notmatch "supabase") {
    scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to add Supabase bucket" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Supabase bucket added" -ForegroundColor Green
} else {
    Write-Host "[OK] Supabase bucket already added" -ForegroundColor Green
}

# Install Supabase CLI via Scoop
Write-Host "[INSTALL] Installing Supabase CLI via Scoop..." -ForegroundColor Yellow
if (!(Get-Command supabase -ErrorAction SilentlyContinue)) {
    scoop install supabase
    Refresh-Path
    Start-Sleep -Seconds 2
    
    # Verify Supabase CLI is now available
    if (!(Get-Command supabase -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] Supabase CLI installation failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Supabase CLI installed" -ForegroundColor Green
} else {
    Write-Host "[OK] Supabase CLI already installed" -ForegroundColor Green
}

# Verify Supabase CLI version
Write-Host "[INFO] Verifying Supabase CLI..." -ForegroundColor Cyan
$supabaseVersion = supabase --version 2>&1
Write-Host "[OK] Supabase CLI version: $supabaseVersion" -ForegroundColor Green

# Create Supabase project directory
$SupabaseProjectDir = "C:\dell-supabase"

# Remove existing directory to prevent interactive prompts
if (Test-Path $SupabaseProjectDir) {
    Write-Host "[CLEANUP] Removing existing Supabase project directory..." -ForegroundColor Yellow
    try {
        Remove-Item -Recurse -Force $SupabaseProjectDir -ErrorAction Stop
        Write-Host "[OK] Cleanup complete" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not fully remove existing directory: $_" -ForegroundColor Yellow
        Write-Host "[INFO] Attempting to continue anyway..." -ForegroundColor Cyan
    }
}

# Create fresh directory
New-Item -ItemType Directory -Path $SupabaseProjectDir | Out-Null
Set-Location $SupabaseProjectDir

# Use repository Supabase config if available; fallback to timed 'supabase init'
$RepoSupabasePath = Join-Path $PSScriptRoot "..\supabase"

if (Test-Path $RepoSupabasePath) {
    Write-Host "[CONFIG] Using repository Supabase config (skipping 'supabase init')..." -ForegroundColor Yellow
    try {
        Copy-Item -Recurse -Force $RepoSupabasePath (Join-Path $SupabaseProjectDir "supabase")
        Write-Host "[OK] Supabase configuration copied" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to copy repository Supabase config: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[CONFIG] Repository 'supabase' folder not found; attempting 'supabase init' (60s timeout)..." -ForegroundColor Yellow
    try {
        $initProc = Start-Process -FilePath "supabase" -ArgumentList "init" -WorkingDirectory $SupabaseProjectDir -PassThru -NoNewWindow
        try {
            Wait-Process -Id $initProc.Id -Timeout 60 -ErrorAction Stop
            Write-Host "[OK] 'supabase init' completed" -ForegroundColor Green
        } catch {
            Write-Host "[ERROR] 'supabase init' timed out after 60s. Stopping process..." -ForegroundColor Red
            try { Stop-Process -Id $initProc.Id -Force -ErrorAction SilentlyContinue } catch {}
            Write-Host "[HINT] Ensure network connectivity and interactive prompts are not required in this environment." -ForegroundColor Yellow
            exit 1
        }
    } catch {
        Write-Host "[ERROR] Failed to start 'supabase init': $_" -ForegroundColor Red
        exit 1
    }
}
# Start Supabase services
Write-Host "[*] Step 7/8: Starting Supabase services..." -ForegroundColor Yellow
Write-Host "[WAIT] This may take several minutes on first run..." -ForegroundColor Yellow
supabase start

# Verify services started
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Supabase services failed to start" -ForegroundColor Red
    Write-Host "[ERROR] Check Docker Desktop is running and try again" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Supabase services started" -ForegroundColor Green

# Get Supabase credentials from CLI
Write-Host "[INFO] Retrieving Supabase credentials..." -ForegroundColor Yellow
$StatusOutput = supabase status | Out-String
$ApiUrlLine = ($StatusOutput -split "`n" | Select-String "API URL:").ToString()
$AnonKeyLine = ($StatusOutput -split "`n" | Select-String "anon key:").ToString()
$ServiceKeyLine = ($StatusOutput -split "`n" | Select-String "service_role key:").ToString()
$DbUrlLine = ($StatusOutput -split "`n" | Select-String "DB URL:").ToString()

# Parse credentials
$SupabaseUrl = ($ApiUrlLine -split "API URL:")[1].Trim()
$AnonKey = ($AnonKeyLine -split "anon key:")[1].Trim()
$ServiceRoleKey = ($ServiceKeyLine -split "service_role key:")[1].Trim()
$DbUrl = ($DbUrlLine -split "DB URL:")[1].Trim()

# Validate credentials were parsed successfully
if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($AnonKey)) {
    Write-Host "[ERROR] Failed to retrieve Supabase credentials" -ForegroundColor Red
    Write-Host "[ERROR] This usually means Supabase services didn't start properly" -ForegroundColor Red
    Write-Host "" -ForegroundColor Red
    Write-Host "[FIX] Try the following:" -ForegroundColor Yellow
    Write-Host "   1. Ensure Docker Desktop is running in Linux containers mode" -ForegroundColor Gray
    Write-Host "   2. Run: docker ps (should show Supabase containers)" -ForegroundColor Gray
    Write-Host "   3. If no containers, run the cleanup script and try again" -ForegroundColor Gray
    Write-Host "   4. Check: supabase status" -ForegroundColor Gray
    exit 1
}

# Get server IP for external access
$ServerIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*"} | Select-Object -First 1).IPAddress

Write-Host "[OK] Supabase is running at $SupabaseUrl" -ForegroundColor Green

# Create initial admin user
Write-Host "[USER] Creating initial admin user..." -ForegroundColor Yellow
$AdminEmail = Read-Host "Enter admin email"
$AdminPassword = Read-Host "Enter admin password" -AsSecureString
$AdminPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword))

# Use Supabase CLI to execute SQL
$AdminUserId = supabase db execute --sql @"
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, 
    encrypted_password, email_confirmed_at, 
    created_at, updated_at, confirmation_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    '$AdminEmail',
    crypt('$AdminPasswordText', gen_salt('bf')),
    now(),
    now(),
    now(),
    ''
  ) RETURNING id;
"@ | Select-Object -Last 1 | ForEach-Object { $_.Trim() }

supabase db execute --sql @"
  INSERT INTO public.profiles (id, email, full_name)
  VALUES ('$AdminUserId', '$AdminEmail', 'Administrator');
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('$AdminUserId', 'admin');
"@

Write-Host "[OK] Admin user created: $AdminEmail" -ForegroundColor Green

# Step 7: Setup application
Write-Host "[APP] Step 7/8: Setting up Dell Server Manager..." -ForegroundColor Yellow
$AppPath = "C:\dell-server-manager"
if (!(Test-Path $AppPath)) {
    Write-Host "[ERROR] Please clone the Dell Server Manager repository first:" -ForegroundColor Red
    Write-Host "   git clone <your-repo-url> C:\dell-server-manager" -ForegroundColor Yellow
    exit 1
}

Set-Location $AppPath
npm install

# Create production .env
@"
VITE_SUPABASE_URL=$SupabaseUrl
VITE_SUPABASE_PUBLISHABLE_KEY=$AnonKey
VITE_SUPABASE_PROJECT_ID=default
"@ | Out-File -FilePath ".env" -Encoding ASCII

# Build application
npm run build

# Step 8: Setup Windows Service
Write-Host "[CONFIG] Step 8/8: Creating Windows Service..." -ForegroundColor Yellow

# Install NSSM (Non-Sucking Service Manager)
choco install nssm -y

# Create service
nssm install DellServerManager "C:\Program Files\nodejs\npx.cmd" "serve dist -l 3000"
nssm set DellServerManager AppDirectory $AppPath
nssm set DellServerManager DisplayName "Dell Server Manager"
nssm set DellServerManager Description "Enterprise datacenter infrastructure management platform"
nssm set DellServerManager Start SERVICE_AUTO_START

# Start service
nssm start DellServerManager

# Step 9: Optional SSL/TLS Setup
Write-Host "[SSL] Step 9/9: SSL/TLS Setup (Optional)..." -ForegroundColor Yellow
$SetupSSL = Read-Host "Do you have a domain name for SSL/TLS? (y/n)"

if ($SetupSSL -eq "y" -or $SetupSSL -eq "Y") {
    $DomainName = Read-Host "Enter your domain name (e.g., example.com)"
    
    # Install IIS and URL Rewrite
    Write-Host "[INSTALL] Installing IIS and required features..." -ForegroundColor Yellow
    Install-WindowsFeature -Name Web-Server -IncludeManagementTools
    choco install urlrewrite -y
    
    # Install Win-ACME for Let's Encrypt
    Write-Host "[INSTALL] Installing Win-ACME..." -ForegroundColor Yellow
    choco install win-acme -y
    
    # Create IIS reverse proxy configuration
    $webConfigPath = "C:\inetpub\wwwroot\web.config"
    @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="DellServerManager" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/{R:1}" />
                </rule>
            </rules>
        </rewrite>
    </system.webServer>
</configuration>
"@ | Out-File -FilePath $webConfigPath -Encoding ASCII
    
    # Configure IIS site
    Import-Module WebAdministration
    Set-ItemProperty "IIS:\Sites\Default Web Site" -Name bindings -Value @{protocol="http";bindingInformation="*:80:$DomainName"}
    
    # Obtain SSL certificate using Win-ACME
    Write-Host "[CERT] Obtaining SSL certificate from Let's Encrypt..." -ForegroundColor Yellow
    Write-Host "[WARN] Follow the Win-ACME prompts to configure SSL for $DomainName" -ForegroundColor Yellow
    & "C:\ProgramData\chocolatey\bin\wacs.exe" --target manual --host $DomainName --emailaddress $AdminEmail --accepttos --installation iis
    
    # Configure Windows Firewall
    Write-Host "[FIREWALL] Configuring Windows Firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "Supabase API" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
    
    $SslUrl = "https://$DomainName"
    Write-Host "[OK] SSL/TLS configured successfully!" -ForegroundColor Green
} else {
    # Configure Windows Firewall without SSL
    Write-Host "[FIREWALL] Configuring Windows Firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "Dell Server Manager" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "Supabase API" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
    
    $SslUrl = "http://${ServerIP}:3000"
}

Write-Host ""
Write-Host "[SUCCESS] Deployment Complete!" -ForegroundColor Green
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[INFO] Supabase Studio: $SupabaseUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "[WEB] Dell Server Manager: $SslUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "[CREDS] Supabase Credentials:" -ForegroundColor Yellow
Write-Host "   API URL: $SupabaseUrl" -ForegroundColor Gray
Write-Host "   Anon Key: $AnonKey" -ForegroundColor Gray
Write-Host "   Service Role Key: $ServiceRoleKey" -ForegroundColor Gray
Write-Host ""
Write-Host "[SUCCESS] You can now login with:" -ForegroundColor Green
Write-Host "   Email: $AdminEmail" -ForegroundColor Gray
Write-Host ""
Write-Host "[NEXT] Next Steps:" -ForegroundColor Yellow
if ($SetupSSL -ne "y" -and $SetupSSL -ne "Y") {
    Write-Host "   1. Setup SSL/TLS (recommended for production)" -ForegroundColor Gray
    Write-Host "      Run Win-ACME for your domain" -ForegroundColor Gray
}
Write-Host "   2. Configure regular backups (see docs\BACKUP_GUIDE.md)" -ForegroundColor Gray
Write-Host "   3. View database: supabase db studio" -ForegroundColor Gray
Write-Host ""
Write-Host "[SERVICE] Service Management:" -ForegroundColor Yellow
Write-Host "   Supabase: supabase status, supabase stop, supabase restart" -ForegroundColor Gray
Write-Host "   App: nssm status/restart/stop DellServerManager" -ForegroundColor Gray
Write-Host ""

# Save credentials to file
$CredsPath = "$AppPath\deployment-credentials.txt"
@"
Dell Server Manager Deployment Credentials
==========================================
Generated: $(Get-Date)

Supabase Studio: $SupabaseUrl
Anon Key: $AnonKey
Service Role Key: $ServiceRoleKey

Admin Login:
Email: $AdminEmail

Application URL: $SslUrl

Supabase CLI Commands:
- supabase status (check status)
- supabase stop (stop services)
- supabase start (start services)
- supabase db studio (open Studio in browser)
"@ | Out-File -FilePath $CredsPath -Encoding ASCII

Write-Host "[SAVED] Credentials saved to: $CredsPath" -ForegroundColor Green
Write-Host ""
