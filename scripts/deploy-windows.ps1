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
Write-Host "[INFO] PowerShell Version: $($PSVersionTable.PSVersion)" -ForegroundColor Cyan
Write-Host ""

# Start transcript logging
$LogPath = "C:\dell-server-manager"
if (!(Test-Path $LogPath)) {
    New-Item -ItemType Directory -Path $LogPath -Force | Out-Null
}
$TranscriptFile = Join-Path $LogPath "deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
Start-Transcript -Path $TranscriptFile -Force
Write-Host "[LOG] Deployment log: $TranscriptFile" -ForegroundColor Cyan
Write-Host ""

# Prompt for deployment mode
Write-Host "[CONFIG] Choose deployment mode:" -ForegroundColor Yellow
Write-Host "  1) Local/Air-gapped (no internet required, local Supabase)" -ForegroundColor Cyan
Write-Host "  2) Cloud-connected (uses Lovable Cloud backend)" -ForegroundColor Cyan
$DeployMode = Read-Host "Enter choice (1 or 2)"

if ($DeployMode -ne "1" -and $DeployMode -ne "2") {
    Write-Host "[ERROR] Invalid choice. Please enter 1 or 2" -ForegroundColor Red
    Stop-Transcript
    exit 1
}

if ($DeployMode -eq "1") {
    Write-Host "[INFO] Selected: Local/Air-gapped deployment" -ForegroundColor Green
} else {
    Write-Host "[INFO] Selected: Cloud-connected deployment" -ForegroundColor Green
}
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

# Function to get the actual Supabase database container name
function Get-SupabaseDbContainer {
    try {
        # Get all Supabase containers
        $containers = docker ps --filter "name=supabase" --format "{{.Names}}" 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            throw "Docker command failed. Ensure Docker Desktop is running."
        }
        
        # Find the database container (contains _db_)
        $dbContainer = $containers | Where-Object { $_ -match "supabase.*_db_" } | Select-Object -First 1
        
        if ([string]::IsNullOrEmpty($dbContainer)) {
            throw "Supabase database container not found. Ensure 'supabase start' completed successfully."
        }
        
        return $dbContainer.Trim()
    } catch {
        Write-Host "[ERROR] Failed to detect Supabase container: $_" -ForegroundColor Red
        throw
    }
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

# Ensure Docker is ready before continuing (only for local mode)
if ($DeployMode -eq "1") {
    Wait-Docker
}

# Step 6: Setup Supabase CLI (only for local mode)
if ($DeployMode -eq "1") {
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

    # Use repository Supabase config (non-interactive deployment)
    Write-Host "[CONFIG] Using repository Supabase config (no interactive 'supabase init')..." -ForegroundColor Yellow

    # Resolve repository supabase path
    $RepoSupabasePath = Resolve-Path (Join-Path $PSScriptRoot "..\supabase") -ErrorAction SilentlyContinue

    if (-not $RepoSupabasePath) {
        Write-Host "[ERROR] Repository 'supabase' folder not found" -ForegroundColor Red
        Write-Host "[ERROR] Expected location: $(Join-Path $PSScriptRoot '..\supabase')" -ForegroundColor Red
        Write-Host "[HINT] Ensure you're running this script from the repository's 'scripts' directory" -ForegroundColor Yellow
        Stop-Transcript
        exit 1
    }

    Write-Host "[INFO] Resolved repository config: $RepoSupabasePath" -ForegroundColor Cyan

    try {
        Copy-Item -Recurse -Force $RepoSupabasePath (Join-Path $SupabaseProjectDir "supabase")
        Write-Host "[OK] Supabase configuration copied from repository" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to copy repository Supabase config: $_" -ForegroundColor Red
        Stop-Transcript
        exit 1
    }
    # Start Supabase services
    Write-Host "[*] Step 7/8: Starting Supabase services..." -ForegroundColor Yellow
    Write-Host "[WAIT] This may take several minutes on first run..." -ForegroundColor Yellow
    $StartOutput = supabase start 2>&1 | Out-String

    # Verify services started
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Supabase services failed to start" -ForegroundColor Red
        Write-Host "[ERROR] Check Docker Desktop is running and try again" -ForegroundColor Red
        $StartOutPath = Join-Path $LogPath "supabase-start-output.txt"
        $StartOutput | Out-File -FilePath $StartOutPath -Encoding UTF8
        Write-Host "[DEBUG] Saved supabase start output to: $StartOutPath" -ForegroundColor Yellow
        Stop-Transcript
        exit 1
    }

    Write-Host "[OK] Supabase services started" -ForegroundColor Green

    # Apply database migrations for air-gapped deployment
    Write-Host "[DATABASE] Applying air-gapped database migrations..." -ForegroundColor Yellow
    $MigrationsPath = Join-Path $PSScriptRoot "air-gapped-migrations"
    
    if (-not (Test-Path $MigrationsPath)) {
        Write-Host "[ERROR] Critical: Air-gapped migrations not found!" -ForegroundColor Red
        Write-Host "[ERROR] Expected location: $MigrationsPath" -ForegroundColor Red
        Write-Host "[ERROR] Without migrations, authentication will not work!" -ForegroundColor Red
        Write-Host "" -ForegroundColor Yellow
        Write-Host "[FIX] To resolve this issue:" -ForegroundColor Yellow
        Write-Host "  1. Ensure you have the latest code: git pull" -ForegroundColor White
        Write-Host "  2. Check that scripts/air-gapped-migrations/ exists" -ForegroundColor White
        Write-Host "  3. Download missing migrations from the repository" -ForegroundColor White
        Write-Host "" -ForegroundColor Yellow
        Stop-Transcript
        exit 1
    }
    
    $migrationFiles = Get-ChildItem -Path $MigrationsPath -Filter "*.sql" | Sort-Object Name
    $migrationCount = $migrationFiles.Count
    
    if ($migrationCount -eq 0) {
        Write-Host "[ERROR] No migration files found in $MigrationsPath" -ForegroundColor Red
        Stop-Transcript
        exit 1
    }
    
    Write-Host "[INFO] Found $migrationCount migration files to apply" -ForegroundColor Cyan
    
    # Detect the actual Supabase database container name
    try {
        $dbContainer = Get-SupabaseDbContainer
        Write-Host "[INFO] Detected Supabase database container: $dbContainer" -ForegroundColor Cyan
    } catch {
        Write-Host "[ERROR] Failed to detect Supabase database container" -ForegroundColor Red
        Write-Host "[ERROR] Make sure Supabase services are running with 'supabase start'" -ForegroundColor Red
        Stop-Transcript
        exit 1
    }
    
    # Show diagnostic information before migrations
    Write-Host "[DEBUG] Pre-migration diagnostics:" -ForegroundColor Cyan
    Write-Host "[DEBUG] Supabase containers:" -ForegroundColor Gray
    docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Status}}"
    Write-Host "[DEBUG] Testing database connectivity..." -ForegroundColor Gray
    $testQuery = docker exec $dbContainer psql -U postgres -t -c "SELECT 'Connected successfully' as status;" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[DEBUG] Database test: $($testQuery.Trim())" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Database test failed: $testQuery" -ForegroundColor Red
        Write-Host "[ERROR] Cannot proceed with migrations" -ForegroundColor Red
        Stop-Transcript
        exit 1
    }
    
    $appliedCount = 0
    $failedMigrations = @()
    
    foreach ($file in $migrationFiles) {
        Write-Host "[MIGRATE] Applying $($file.Name)..." -ForegroundColor Cyan
        
        try {
            Write-Host "[DEBUG] Running migration: $($file.FullName)" -ForegroundColor Gray
            $result = Get-Content $file.FullName | docker exec -i $dbContainer psql -U postgres -d postgres 2>&1
            $migrationExitCode = $LASTEXITCODE
            
            if ($migrationExitCode -eq 0) {
                Write-Host "[OK] $($file.Name) applied successfully" -ForegroundColor Green
                $appliedCount++
            } else {
                Write-Host "[ERROR] Failed to apply $($file.Name)" -ForegroundColor Red
                Write-Host "[ERROR] Exit code: $migrationExitCode" -ForegroundColor Red
                Write-Host "[ERROR] SQL Error output:" -ForegroundColor Red
                Write-Host "─────────────────────────────────────────────────" -ForegroundColor DarkGray
                $result | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
                Write-Host "─────────────────────────────────────────────────" -ForegroundColor DarkGray
                $failedMigrations += $file.Name
            }
        } catch {
            Write-Host "[ERROR] Exception applying $($file.Name): $_" -ForegroundColor Red
            Write-Host "[ERROR] Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
            $failedMigrations += $file.Name
        }
    }
    
    # Report migration results
    Write-Host "" -ForegroundColor White
    Write-Host "[SUMMARY] Applied $appliedCount of $migrationCount migrations" -ForegroundColor Cyan
    
    if ($failedMigrations.Count -gt 0) {
        Write-Host "[ERROR] Failed migrations:" -ForegroundColor Red
        foreach ($failed in $failedMigrations) {
            Write-Host "  ✗ $failed" -ForegroundColor Red
        }
        Write-Host "" -ForegroundColor Yellow
        Write-Host "[ROLLBACK] To reset the database:" -ForegroundColor Yellow
        try {
            $rollbackContainer = Get-SupabaseDbContainer
            Write-Host "  docker exec $rollbackContainer psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" -ForegroundColor White
        } catch {
            Write-Host "  docker exec <supabase-container-name> psql -U postgres -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'" -ForegroundColor White
            Write-Host "  (Use 'docker ps --filter name=supabase' to find your container name)" -ForegroundColor Yellow
        }
        Write-Host "  Then re-run this deployment script" -ForegroundColor White
        Stop-Transcript
        exit 1
    }
    
    # Verify database schema
    Write-Host "[VERIFY] Checking database schema integrity..." -ForegroundColor Yellow
    $verifyScript = Join-Path $PSScriptRoot "verify-database.ps1"
    
    if (Test-Path $verifyScript) {
        try {
            Write-Host "[VERIFY] Running database schema verification..." -ForegroundColor Yellow
            Write-Host "[VERIFY] Output from verification script:" -ForegroundColor Cyan
            Write-Host "─────────────────────────────────────────────────" -ForegroundColor DarkGray
            
            # Run verification and show ALL output
            & $verifyScript -Verbose
            $verifyExitCode = $LASTEXITCODE
            
            Write-Host "─────────────────────────────────────────────────" -ForegroundColor DarkGray
            
            if ($verifyExitCode -eq 0) {
                Write-Host "[OK] Database schema verified successfully" -ForegroundColor Green
            } else {
                Write-Host "" -ForegroundColor White
                Write-Host "[ERROR] Database schema verification failed!" -ForegroundColor Red
                Write-Host "[ERROR] See detailed output above for specific failures" -ForegroundColor Red
                Write-Host "" -ForegroundColor Yellow
                Write-Host "[DEBUG] Container info:" -ForegroundColor Yellow
                docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
                Write-Host "" -ForegroundColor Yellow
                Write-Host "[FIX] Check container logs for more details:" -ForegroundColor Yellow
                Write-Host "  docker logs $dbContainer --tail 50" -ForegroundColor White
                Stop-Transcript
                exit 1
            }
        } catch {
            Write-Host "[ERROR] Verification exception: $_" -ForegroundColor Red
            Stop-Transcript
            exit 1
        }
    } else {
        Write-Host "[INFO] Schema verification script not found, skipping..." -ForegroundColor Cyan
    }
    
    Write-Host "[OK] Database setup complete" -ForegroundColor Green

    # Get Supabase credentials from CLI
    Write-Host "[INFO] Retrieving Supabase credentials..." -ForegroundColor Yellow

    # Helper function to extract values using regex (supports both old and new label formats)
    function Get-MatchValue {
        param(
            [string]$Text,
            [string]$Pattern
        )
        $m = [regex]::Match($Text, $Pattern, 'IgnoreCase, Multiline')
        if ($m.Success) { return $m.Groups[1].Value.Trim() }
        return $null
    }

    # Define regex patterns for both old and new Supabase CLI output formats
    $ApiPattern = '^\s*API URL:\s*(.+)$'
    $DbPattern  = '^\s*(?:Database URL|DB URL):\s*(.+)$'
    $AnonPattern = '^\s*(?:Publishable key|anon key):\s*(.+)$'
    $ServicePattern = '^\s*(?:Secret key|service_role key):\s*(.+)$'

    # 1) Try parsing from 'supabase start' output first
    $SupabaseUrl = Get-MatchValue -Text $StartOutput -Pattern $ApiPattern
    $AnonKey = Get-MatchValue -Text $StartOutput -Pattern $AnonPattern
    $ServiceRoleKey = Get-MatchValue -Text $StartOutput -Pattern $ServicePattern
    $DbUrl = Get-MatchValue -Text $StartOutput -Pattern $DbPattern

    # 2) If any values are missing, fall back to 'supabase status'
    if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or
        [string]::IsNullOrWhiteSpace($AnonKey) -or
        [string]::IsNullOrWhiteSpace($ServiceRoleKey) -or
        [string]::IsNullOrWhiteSpace($DbUrl)) {

        Write-Host "[INFO] Some credentials missing from start output, checking status..." -ForegroundColor Yellow
        $StatusOutput = supabase status 2>&1 | Out-String
        $SupabaseUrl = if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) { Get-MatchValue -Text $StatusOutput -Pattern $ApiPattern } else { $SupabaseUrl }
        $AnonKey = if ([string]::IsNullOrWhiteSpace($AnonKey)) { Get-MatchValue -Text $StatusOutput -Pattern $AnonPattern } else { $AnonKey }
        $ServiceRoleKey = if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) { Get-MatchValue -Text $StatusOutput -Pattern $ServicePattern } else { $ServiceRoleKey }
        $DbUrl = if ([string]::IsNullOrWhiteSpace($DbUrl)) { Get-MatchValue -Text $StatusOutput -Pattern $DbPattern } else { $DbUrl }
    }

    # 3) If still missing critical values, dump outputs for debugging
    if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($AnonKey)) {
        Write-Host "[ERROR] Failed to retrieve Supabase credentials" -ForegroundColor Red
        
        # Save start output for debugging
        $StartOutPath = Join-Path $LogPath "supabase-start-output.txt"
        $StartOutput | Out-File -FilePath $StartOutPath -Encoding UTF8
        Write-Host "[DEBUG] Saved supabase start output to: $StartOutPath" -ForegroundColor Yellow
        
        # Save status output for debugging
        if (-not $StatusOutput) {
            $StatusOutput = supabase status 2>&1 | Out-String
        }
        $StatusOutPath = Join-Path $LogPath "supabase-status-output.txt"
        $StatusOutput | Out-File -FilePath $StatusOutPath -Encoding UTF8
        Write-Host "[DEBUG] Saved supabase status output to: $StatusOutPath" -ForegroundColor Yellow
        
        Write-Host "" -ForegroundColor Red
        Write-Host "[FIX] Review the output files above for credential details." -ForegroundColor Yellow
        Write-Host "      If you see 'Publishable key' and 'Secret key', copy them to .env manually:" -ForegroundColor Yellow
        Write-Host "      VITE_SUPABASE_URL=<API URL>" -ForegroundColor Gray
        Write-Host "      VITE_SUPABASE_PUBLISHABLE_KEY=<Publishable key>" -ForegroundColor Gray
        Stop-Transcript
        exit 1
    }

    Write-Host "[OK] Retrieved credentials successfully" -ForegroundColor Green

    # Get server IP for external access
    $ServerIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*"} | Select-Object -First 1).IPAddress

    Write-Host "[OK] Supabase is running at $SupabaseUrl" -ForegroundColor Green

    # Create initial admin user
    Write-Host "[USER] Creating initial admin user..." -ForegroundColor Yellow
    $AdminEmail = Read-Host "Enter admin email"
    $AdminPassword = Read-Host "Enter admin password" -AsSecureString
    $AdminPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword))

    # Find the Supabase Postgres container
    $ContainerName = docker ps --filter "name=supabase_db" --format "{{.Names}}" | Select-Object -First 1

    if ([string]::IsNullOrWhiteSpace($ContainerName)) {
        Write-Host "[ERROR] Could not find Supabase Postgres container" -ForegroundColor Red
        Write-Host "[INFO] Available containers:" -ForegroundColor Yellow
        docker ps --format "table {{.Names}}\t{{.Status}}"
        exit 1
    }

    Write-Host "[INFO] Using Postgres container: $ContainerName" -ForegroundColor Cyan

    # Create admin user in auth.users and capture the user ID
    Write-Host "[SQL] Creating admin user in auth.users..." -ForegroundColor Yellow
    $SqlCreateUser = @"
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
"@

    # Use -A (unaligned), -t (tuples only), -q (quiet) for clean UUID output
    $AdminUserId = docker exec $ContainerName psql -U postgres -d postgres -A -t -q -c "$SqlCreateUser" 2>&1
    $AdminUserId = $AdminUserId.Trim()

    # Validate that we got a valid UUID format
    if ($AdminUserId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
        Write-Host "[ERROR] Failed to capture valid user ID" -ForegroundColor Red
        Write-Host "[DEBUG] Got: $AdminUserId" -ForegroundColor Yellow
        Write-Host "[INFO] This might be due to an empty email address or invalid SQL output" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[OK] Created user with ID: $AdminUserId" -ForegroundColor Green

    # Update profile and assign admin role (trigger already created profile with viewer role)
    Write-Host "[SQL] Updating profile and assigning admin role..." -ForegroundColor Yellow
    $SqlUpdateProfile = @"
-- Update profile if it exists, create if it doesn't (idempotent)
INSERT INTO public.profiles (id, email, full_name)
VALUES ('$AdminUserId', '$AdminEmail', 'Administrator')
ON CONFLICT (id) DO UPDATE 
SET full_name = EXCLUDED.full_name;

-- Update role from viewer to admin (idempotent)
UPDATE public.user_roles 
SET role = 'admin'
WHERE user_id = '$AdminUserId';
"@

    $ProfileResult = docker exec $ContainerName psql -U postgres -d postgres -c "$SqlUpdateProfile" 2>&1

    if ($ProfileResult -match "ERROR") {
        Write-Host "[ERROR] Failed to create profile/role" -ForegroundColor Red
        Write-Host "[DEBUG] Output: $ProfileResult" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[OK] Admin user created: $AdminEmail" -ForegroundColor Green
} else {
    Write-Host "[SKIP] Step 6/8: Skipping local Supabase setup (using Lovable Cloud)" -ForegroundColor Yellow
    
    # Set variables for cloud mode
    $SupabaseUrl = "https://ylwkczjqvymshktuuqkx.supabase.co"
    $AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsd2tjempxdnltc2hrdHV1cWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODQ0OTMsImV4cCI6MjA3Nzc2MDQ5M30.hIkDV2AAos-Z9hvQLfZmiQ7UvGCpGqwG5kzd1VBRx0w"
    $ServiceRoleKey = "[Service role key managed in Lovable Cloud]"
    $ServerIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*"} | Select-Object -First 1).IPAddress
    
    Write-Host "[INFO] Using Lovable Cloud backend" -ForegroundColor Green
    Write-Host "[INFO] Database management available through Lovable Cloud interface" -ForegroundColor Cyan
}

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

# Create production .env based on deployment mode
if ($DeployMode -eq "1") {
    # Local/Air-gapped mode - use extracted local Supabase credentials
    Write-Host "[CONFIG] Creating .env for local Supabase..." -ForegroundColor Yellow
    @"
VITE_SUPABASE_URL=$SupabaseUrl
VITE_SUPABASE_PUBLISHABLE_KEY=$AnonKey
VITE_SUPABASE_PROJECT_ID=local
"@ | Out-File -FilePath ".env" -Encoding ASCII
} else {
    # Cloud mode - use Lovable Cloud credentials
    Write-Host "[CONFIG] Creating .env for Lovable Cloud..." -ForegroundColor Yellow
    @"
VITE_SUPABASE_PROJECT_ID=ylwkczjqvymshktuuqkx
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsd2tjempxdnltc2hrdHV1cWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODQ0OTMsImV4cCI6MjA3Nzc2MDQ5M30.hIkDV2AAos-Z9hvQLfZmiQ7UvGCpGqwG5kzd1VBRx0w
VITE_SUPABASE_URL=https://ylwkczjqvymshktuuqkx.supabase.co
"@ | Out-File -FilePath ".env" -Encoding ASCII
}

# Build application
npm run build

# Serve package not needed - using Vite preview instead

# Step 8: Setup Windows Service
Write-Host "[CONFIG] Step 8/8: Creating Windows Service..." -ForegroundColor Yellow

# Install NSSM (Non-Sucking Service Manager)
choco install nssm -y

# Create service using Vite preview
$NodePath = "C:\Program Files\nodejs\node.exe"
$VitePreviewArgs = "node_modules\vite\bin\vite.js preview --port 3000 --host 0.0.0.0 --strictPort"

nssm install DellServerManager $NodePath $VitePreviewArgs
nssm set DellServerManager AppDirectory $AppPath
nssm set DellServerManager DisplayName "Dell Server Manager"
nssm set DellServerManager Description "Enterprise datacenter infrastructure management platform"
nssm set DellServerManager Start SERVICE_AUTO_START

# Enable logging
nssm set DellServerManager AppStdout "$AppPath\service-output.log"
nssm set DellServerManager AppStderr "$AppPath\service-error.log"

# Start service
nssm start DellServerManager

# Wait for service to start and verify port 3000 is listening
Write-Host "[CHECK] Waiting for service to start on port 3000..." -ForegroundColor Yellow
$maxWaitSeconds = 30
$waited = 0
$portOpen = $false

while ($waited -lt $maxWaitSeconds) {
    Start-Sleep -Seconds 2
    $waited += 2
    $listening = netstat -ano | findstr ":3000"
    if ($listening) {
        $portOpen = $true
        Write-Host "[SUCCESS] Service is listening on port 3000!" -ForegroundColor Green
        break
    }
    Write-Host "  Waiting... ($waited/$maxWaitSeconds seconds)" -ForegroundColor Gray
}

if (-not $portOpen) {
    Write-Host "[ERROR] Service failed to start on port 3000 within $maxWaitSeconds seconds" -ForegroundColor Red
    Write-Host "[ERROR] Last 20 lines of service output log:" -ForegroundColor Red
    Get-Content "$AppPath\service-output.log" -Tail 20 -ErrorAction SilentlyContinue
    Write-Host "[ERROR] Last 20 lines of service error log:" -ForegroundColor Red
    Get-Content "$AppPath\service-error.log" -Tail 20 -ErrorAction SilentlyContinue
    Write-Host "[ERROR] Service may need manual troubleshooting. Check logs at:" -ForegroundColor Red
    Write-Host "  $AppPath\service-output.log" -ForegroundColor Yellow
    Write-Host "  $AppPath\service-error.log" -ForegroundColor Yellow
    exit 1
}

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

if ($DeployMode -eq "1") {
    # Local/Air-gapped deployment info
    Write-Host "[INFO] Deployment Mode: Local/Air-gapped" -ForegroundColor Cyan
    Write-Host "[INFO] Supabase Studio: $SupabaseUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[WEB] Dell Server Manager: $SslUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[CREDS] Local Supabase Credentials:" -ForegroundColor Yellow
    Write-Host "   API URL: $SupabaseUrl" -ForegroundColor Gray
    Write-Host "   Anon Key: $AnonKey" -ForegroundColor Gray
    Write-Host "   Service Role Key: $ServiceRoleKey" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[SUCCESS] You can now login with:" -ForegroundColor Green
    Write-Host "   Email: $AdminEmail" -ForegroundColor Gray
} else {
    # Cloud-connected deployment info
    Write-Host "[INFO] Deployment Mode: Cloud-connected" -ForegroundColor Cyan
    Write-Host "[INFO] Backend: Lovable Cloud (centrally managed)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[WEB] Dell Server Manager: $SslUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[INFO] Database and authentication managed through Lovable Cloud" -ForegroundColor Yellow
    Write-Host "[INFO] Create users and manage data through the Lovable Cloud interface" -ForegroundColor Yellow
}
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

if ($DeployMode -eq "1") {
    # Local mode credentials
    @"
Dell Server Manager Deployment Credentials
==========================================
Generated: $(Get-Date)
Deployment Mode: Local/Air-gapped

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
} else {
    # Cloud mode credentials
    @"
Dell Server Manager Deployment Credentials
==========================================
Generated: $(Get-Date)
Deployment Mode: Cloud-connected

Backend: Lovable Cloud
API URL: $SupabaseUrl

Application URL: $SslUrl

Note: Database and user management handled through Lovable Cloud interface.
Create and manage users through the Lovable Cloud backend dashboard.
"@ | Out-File -FilePath $CredsPath -Encoding ASCII
}

Write-Host "[SAVED] Credentials saved to: $CredsPath" -ForegroundColor Green
Write-Host ""

# Stop transcript logging
Stop-Transcript
Write-Host "[LOG] Deployment log saved to: $TranscriptFile" -ForegroundColor Green
