#requires -Version 5.1
#requires -RunAsAdministrator

<#
.SYNOPSIS
    Generate SSL Certificate for Dell Server Manager Job Executor
.DESCRIPTION
    Creates a self-signed SSL certificate for the Job Executor API server using OpenSSL.
    OpenSSL is used for consistency across Windows and Linux platforms.
.NOTES
    Version: 2.0
    Requires: Administrator privileges, OpenSSL (installed via Chocolatey if missing)
#>

[CmdletBinding()]
param(
    [string]$OutputDir = "C:\dell-server-manager\ssl",
    [int]$ValidDays = 365,
    [switch]$Force
)

# Colors for output
$Colors = @{
    Success = "Green"
    Warning = "Yellow"
    Error = "Red"
    Info = "Cyan"
    Highlight = "White"
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

Write-ColorOutput "`n═══════════════════════════════════════════════════════════════" -Color $Colors.Highlight
Write-ColorOutput "  Dell Server Manager - SSL Certificate Generator (OpenSSL)" -Color $Colors.Highlight
Write-ColorOutput "═══════════════════════════════════════════════════════════════`n" -Color $Colors.Highlight

# Gather hostnames and IPs for SANs
$hostname = $env:COMPUTERNAME
$fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName
$ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | 
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | 
    Select-Object -ExpandProperty IPAddress

Write-ColorOutput "Detected system information:" -Color $Colors.Info
Write-ColorOutput "  Hostname:     $hostname" -Color $Colors.Highlight
Write-ColorOutput "  FQDN:         $fqdn" -Color $Colors.Highlight
Write-ColorOutput "  IP Addresses: $($ipAddresses -join ', ')" -Color $Colors.Highlight
Write-Host ""

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-ColorOutput "Created SSL directory: $OutputDir" -Color $Colors.Success
}

$certPath = Join-Path $OutputDir "server.crt"
$keyPath = Join-Path $OutputDir "server.key"

# Check for existing certificates
if ((Test-Path $certPath) -and -not $Force) {
    Write-ColorOutput "Certificate already exists at: $certPath" -Color $Colors.Warning
    $overwrite = Read-Host "Overwrite existing certificate? (yes/no)"
    if ($overwrite -ne "yes") {
        Write-ColorOutput "Certificate generation cancelled." -Color $Colors.Info
        exit 0
    }
}

# Ensure OpenSSL is installed
Write-ColorOutput "Checking for OpenSSL..." -Color $Colors.Info
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue

if (-not $opensslPath) {
    Write-ColorOutput "OpenSSL not found. Installing via Chocolatey..." -Color $Colors.Warning
    
    # Check for Chocolatey
    if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-ColorOutput "Chocolatey not found. Installing Chocolatey first..." -Color $Colors.Warning
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    }
    
    choco install openssl -y
    
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $opensslPath = Get-Command openssl -ErrorAction SilentlyContinue
    if (-not $opensslPath) {
        Write-ColorOutput "Failed to install OpenSSL. Please install manually." -Color $Colors.Error
        exit 1
    }
    Write-ColorOutput "OpenSSL installed successfully" -Color $Colors.Success
} else {
    Write-ColorOutput "OpenSSL found: $($opensslPath.Source)" -Color $Colors.Success
}

# Build SAN entries
$sanEntries = @("DNS:localhost", "DNS:$hostname")
if ($fqdn -ne $hostname) {
    $sanEntries += "DNS:$fqdn"
}
foreach ($ip in $ipAddresses) {
    $sanEntries += "IP:$ip"
}
$sanEntries += "IP:127.0.0.1"
$sanString = $sanEntries -join ","

Write-ColorOutput "`nGenerating certificate with OpenSSL..." -Color $Colors.Info

# Create OpenSSL config file
$opensslConfig = @"
[req]
default_bits = 4096
prompt = no
default_md = sha256
req_extensions = req_ext
distinguished_name = dn

[dn]
C = US
O = Dell Server Manager
CN = $fqdn

[req_ext]
subjectAltName = $sanString
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[v3_ext]
subjectAltName = $sanString
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
"@

$configPath = Join-Path $OutputDir "openssl.cnf"
$opensslConfig | Set-Content -Path $configPath -Force

# Generate certificate with OpenSSL
$opensslArgs = @(
    "req", "-x509", "-newkey", "rsa:4096",
    "-keyout", $keyPath,
    "-out", $certPath,
    "-days", $ValidDays,
    "-nodes",
    "-config", $configPath,
    "-extensions", "v3_ext"
)

$process = Start-Process -FilePath "openssl" -ArgumentList $opensslArgs -Wait -NoNewWindow -PassThru

if ($process.ExitCode -ne 0) {
    Write-ColorOutput "Failed to generate certificate with OpenSSL" -Color $Colors.Error
    exit 1
}

# Cleanup config file
Remove-Item $configPath -Force -ErrorAction SilentlyContinue

# Set file permissions
Write-ColorOutput "`nSetting file permissions..." -Color $Colors.Info
$acl = Get-Acl $keyPath
$acl.SetAccessRuleProtection($true, $false)
$adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
$systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM", "FullControl", "Allow")
$acl.SetAccessRule($adminRule)
$acl.SetAccessRule($systemRule)
Set-Acl -Path $keyPath -AclObject $acl

# Verify files exist
Write-Host ""
if ((Test-Path $certPath) -and (Test-Path $keyPath)) {
    Write-ColorOutput "═══════════════════════════════════════════════════════════════" -Color $Colors.Success
    Write-ColorOutput "  SSL Certificate Generated Successfully!" -Color $Colors.Success
    Write-ColorOutput "═══════════════════════════════════════════════════════════════" -Color $Colors.Success
    Write-Host ""
    Write-ColorOutput "Certificate: $certPath" -Color $Colors.Highlight
    Write-ColorOutput "Private Key: $keyPath" -Color $Colors.Highlight
    Write-ColorOutput "Valid for:   $ValidDays days" -Color $Colors.Highlight
    Write-Host ""
    Write-ColorOutput "SANs included:" -Color $Colors.Info
    Write-ColorOutput "  - localhost" -Color $Colors.Highlight
    Write-ColorOutput "  - $hostname" -Color $Colors.Highlight
    if ($fqdn -ne $hostname) {
        Write-ColorOutput "  - $fqdn" -Color $Colors.Highlight
    }
    foreach ($ip in $ipAddresses) {
        Write-ColorOutput "  - $ip" -Color $Colors.Highlight
    }
    Write-ColorOutput "  - 127.0.0.1" -Color $Colors.Highlight
    Write-Host ""
    Write-ColorOutput "Next steps:" -Color $Colors.Warning
    Write-ColorOutput "  1. Set all environment variables (NSSM overwrites, doesn't append):" -Color $Colors.Info
    Write-ColorOutput '     nssm set DellServerManagerJobExecutor AppEnvironmentExtra "SERVICE_ROLE_KEY=<key>" "DSM_URL=<url>" "API_SERVER_SSL_ENABLED=true" "API_SERVER_SSL_CERT=C:\dell-server-manager\ssl\server.crt" "API_SERVER_SSL_KEY=C:\dell-server-manager\ssl\server.key"' -Color $Colors.Highlight
    Write-ColorOutput "  2. Restart the service:" -Color $Colors.Info
    Write-ColorOutput "     nssm restart DellServerManagerJobExecutor" -Color $Colors.Highlight
    Write-ColorOutput "  3. Update Job Executor URL in Settings to use https://" -Color $Colors.Info
    Write-Host ""
} else {
    Write-ColorOutput "Certificate generation may have failed. Check output above." -Color $Colors.Error
    exit 1
}
