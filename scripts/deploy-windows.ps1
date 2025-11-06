# Dell Server Manager - Windows Server 2022 Deployment Script
# Automates complete self-hosted setup on Windows Server 2022

#Requires -RunAsAdministrator

Write-Host "🚀 Dell Server Manager - Windows Server 2022 Self-Hosted Deployment" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Install Chocolatey
Write-Host "📦 Step 1/7: Installing Chocolatey..." -ForegroundColor Yellow
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Write-Host "✅ Chocolatey installed" -ForegroundColor Green
} else {
    Write-Host "✅ Chocolatey already installed" -ForegroundColor Green
}

# Step 2: Install Docker Desktop
Write-Host "📦 Step 2/7: Installing Docker Desktop..." -ForegroundColor Yellow
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    choco install docker-desktop -y
    Write-Host "⚠️  Docker Desktop installed - Please restart your computer and run this script again" -ForegroundColor Red
    exit 0
} else {
    Write-Host "✅ Docker Desktop already installed" -ForegroundColor Green
}

# Step 3: Install Node.js
Write-Host "📦 Step 3/7: Installing Node.js 18..." -ForegroundColor Yellow
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    choco install nodejs-lts -y
    refreshenv
    Write-Host "✅ Node.js installed" -ForegroundColor Green
} else {
    Write-Host "✅ Node.js already installed" -ForegroundColor Green
}

# Step 4: Install Git
Write-Host "📦 Step 4/7: Installing Git..." -ForegroundColor Yellow
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    choco install git -y
    refreshenv
    Write-Host "✅ Git installed" -ForegroundColor Green
} else {
    Write-Host "✅ Git already installed" -ForegroundColor Green
}

# Step 5: Setup Supabase
Write-Host "🗄️  Step 5/7: Setting up Supabase..." -ForegroundColor Yellow
$SupabasePath = "C:\supabase"
if (!(Test-Path $SupabasePath)) {
    git clone --depth 1 https://github.com/supabase/supabase $SupabasePath
}
Set-Location "$SupabasePath\docker"

# Generate secure credentials
$PostgresPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
$JwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object {[char]$_})
$DashboardPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object {[char]$_})
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
$ServiceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

# Get server IP
$ServerIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*"} | Select-Object -First 1).IPAddress

# Create .env file
@"
POSTGRES_PASSWORD=$PostgresPassword
JWT_SECRET=$JwtSecret
ANON_KEY=$AnonKey
SERVICE_ROLE_KEY=$ServiceRoleKey
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=$DashboardPassword

# Studio configuration
STUDIO_DEFAULT_ORGANIZATION=Default Organization
STUDIO_DEFAULT_PROJECT=Default Project

# API configuration
API_EXTERNAL_URL=http://${ServerIP}:8000
SUPABASE_PUBLIC_URL=http://${ServerIP}:8000
"@ | Out-File -FilePath ".env" -Encoding ASCII

Write-Host "✅ Supabase configuration created" -ForegroundColor Green

# Start Supabase
Write-Host "🚀 Step 6/7: Starting Supabase services..." -ForegroundColor Yellow
docker compose up -d
Write-Host "⏳ Waiting for services to start (60 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 60
Write-Host "✅ Supabase is running" -ForegroundColor Green

# Create initial admin user
Write-Host "👤 Step 5/7: Creating initial admin user..." -ForegroundColor Yellow
$AdminEmail = Read-Host "Enter admin email"
$AdminPassword = Read-Host "Enter admin password" -AsSecureString
$AdminPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword))

$AdminUserId = docker exec supabase-db psql -U postgres -d postgres -t -c @"
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
"@ | ForEach-Object { $_.Trim() }

docker exec supabase-db psql -U postgres -d postgres -c @"
  INSERT INTO public.profiles (id, email, full_name)
  VALUES ('$AdminUserId', '$AdminEmail', 'Administrator');
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('$AdminUserId', 'admin');
"@

Write-Host "✅ Admin user created: $AdminEmail" -ForegroundColor Green

# Step 6: Setup application
Write-Host "📱 Step 6/7: Setting up Dell Server Manager..." -ForegroundColor Yellow
$AppPath = "C:\dell-server-manager"
if (!(Test-Path $AppPath)) {
    Write-Host "❌ Please clone the Dell Server Manager repository first:" -ForegroundColor Red
    Write-Host "   git clone <your-repo-url> C:\dell-server-manager" -ForegroundColor Yellow
    exit 1
}

Set-Location $AppPath
npm install

# Create production .env
@"
VITE_SUPABASE_URL=http://${ServerIP}:8000
VITE_SUPABASE_PUBLISHABLE_KEY=$AnonKey
VITE_SUPABASE_PROJECT_ID=default
"@ | Out-File -FilePath ".env" -Encoding ASCII

# Build application
npm run build

# Step 7: Setup Windows Service
Write-Host "🔧 Step 7/7: Creating Windows Service..." -ForegroundColor Yellow

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

# Step 8: Optional SSL/TLS Setup
Write-Host "🔒 Step 8/8: SSL/TLS Setup (Optional)..." -ForegroundColor Yellow
$SetupSSL = Read-Host "Do you have a domain name for SSL/TLS? (y/n)"

if ($SetupSSL -eq "y" -or $SetupSSL -eq "Y") {
    $DomainName = Read-Host "Enter your domain name (e.g., example.com)"
    
    # Install IIS and URL Rewrite
    Write-Host "📦 Installing IIS and required features..." -ForegroundColor Yellow
    Install-WindowsFeature -Name Web-Server -IncludeManagementTools
    choco install urlrewrite -y
    
    # Install Win-ACME for Let's Encrypt
    Write-Host "📦 Installing Win-ACME..." -ForegroundColor Yellow
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
    Write-Host "📜 Obtaining SSL certificate from Let's Encrypt..." -ForegroundColor Yellow
    Write-Host "⚠️  Follow the Win-ACME prompts to configure SSL for $DomainName" -ForegroundColor Yellow
    & "C:\ProgramData\chocolatey\bin\wacs.exe" --target manual --host $DomainName --emailaddress $AdminEmail --accepttos --installation iis
    
    # Configure Windows Firewall
    Write-Host "🔥 Configuring Windows Firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "Supabase API" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
    
    $SslUrl = "https://$DomainName"
    Write-Host "✅ SSL/TLS configured successfully!" -ForegroundColor Green
} else {
    # Configure Windows Firewall without SSL
    Write-Host "🔥 Configuring Windows Firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "Dell Server Manager" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "Supabase API" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
    
    $SslUrl = "http://${ServerIP}:3000"
}

Write-Host ""
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Supabase Studio: http://${ServerIP}:8000" -ForegroundColor Cyan
Write-Host "   Username: supabase" -ForegroundColor Gray
Write-Host "   Password: $DashboardPassword" -ForegroundColor Gray
Write-Host ""
Write-Host "🌐 Dell Server Manager: $SslUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔑 Database Credentials:" -ForegroundColor Yellow
Write-Host "   Host: $ServerIP" -ForegroundColor Gray
Write-Host "   Port: 5432" -ForegroundColor Gray
Write-Host "   Database: postgres" -ForegroundColor Gray
Write-Host "   Username: postgres" -ForegroundColor Gray
Write-Host "   Password: $PostgresPassword" -ForegroundColor Gray
Write-Host ""
Write-Host "🎉 You can now login with:" -ForegroundColor Green
Write-Host "   Email: $AdminEmail" -ForegroundColor Gray
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Yellow
if ($SetupSSL -ne "y" -and $SetupSSL -ne "Y") {
    Write-Host "   1. Setup SSL/TLS (recommended for production)" -ForegroundColor Gray
    Write-Host "      Run Win-ACME for your domain" -ForegroundColor Gray
}
Write-Host "   2. Configure regular backups (see docs\BACKUP_GUIDE.md)" -ForegroundColor Gray
Write-Host ""
Write-Host "📝 Service Management:" -ForegroundColor Yellow
Write-Host "   nssm status DellServerManager" -ForegroundColor Gray
Write-Host "   nssm restart DellServerManager" -ForegroundColor Gray
Write-Host "   nssm stop DellServerManager" -ForegroundColor Gray
Write-Host ""

# Save credentials to file
$CredsPath = "$AppPath\deployment-credentials.txt"
@"
Dell Server Manager Deployment Credentials
==========================================
Generated: $(Get-Date)

Supabase Studio: http://${ServerIP}:8000
Username: supabase
Password: $DashboardPassword

Database Credentials:
Host: $ServerIP
Port: 5432
Database: postgres
Username: postgres
Password: $PostgresPassword

Application URL: http://${ServerIP}:3000
"@ | Out-File -FilePath $CredsPath -Encoding ASCII

Write-Host "💾 Credentials saved to: $CredsPath" -ForegroundColor Green
Write-Host ""
