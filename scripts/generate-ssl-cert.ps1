#requires -Version 5.1
#requires -RunAsAdministrator

<#
.SYNOPSIS
    Generate SSL Certificate for Dell Server Manager Job Executor
.DESCRIPTION
    Creates a self-signed SSL certificate for the Job Executor API server.
    Supports both Windows Server (New-SelfSignedCertificate) and OpenSSL methods.
.NOTES
    Version: 1.0
    Requires: Administrator privileges
#>

[CmdletBinding()]
param(
    [string]$OutputDir = "C:\dell-server-manager\ssl",
    [int]$ValidDays = 365,
    [switch]$UseOpenSSL,
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
Write-ColorOutput "  Dell Server Manager - SSL Certificate Generator" -Color $Colors.Highlight
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

# Try OpenSSL first if requested or if Windows method fails
$useOpenSSLMethod = $UseOpenSSL

if (-not $useOpenSSLMethod) {
    # Check if we're on Windows Server with the required cmdlet
    $hasNewSelfSignedCert = Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue
    if (-not $hasNewSelfSignedCert) {
        Write-ColorOutput "New-SelfSignedCertificate not available, falling back to OpenSSL" -Color $Colors.Warning
        $useOpenSSLMethod = $true
    }
}

if ($useOpenSSLMethod) {
    # OpenSSL Method
    Write-ColorOutput "Using OpenSSL method..." -Color $Colors.Info
    
    # Check for OpenSSL
    $opensslPath = Get-Command openssl -ErrorAction SilentlyContinue
    if (-not $opensslPath) {
        Write-ColorOutput "OpenSSL not found. Installing via Chocolatey..." -Color $Colors.Warning
        choco install openssl -y
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $opensslPath = Get-Command openssl -ErrorAction SilentlyContinue
        if (-not $opensslPath) {
            Write-ColorOutput "Failed to install OpenSSL. Please install manually." -Color $Colors.Error
            exit 1
        }
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
    Write-ColorOutput "Generating certificate..." -Color $Colors.Info
    
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
    
} else {
    # Windows New-SelfSignedCertificate Method
    Write-ColorOutput "Using Windows certificate method..." -Color $Colors.Info
    
    # Build SAN list
    $dnsNames = @("localhost", $hostname)
    if ($fqdn -ne $hostname) {
        $dnsNames += $fqdn
    }
    
    # Create certificate using Microsoft Software Key Storage Provider
    # This avoids the "security device is read only" error from TPM/HSM
    Write-ColorOutput "Generating certificate..." -Color $Colors.Info
    
    $certParams = @{
        DnsName = $dnsNames
        CertStoreLocation = "Cert:\LocalMachine\My"
        KeyExportPolicy = "Exportable"
        KeyLength = 4096
        KeyAlgorithm = "RSA"
        HashAlgorithm = "SHA256"
        NotAfter = (Get-Date).AddDays($ValidDays)
        FriendlyName = "Dell Server Manager Job Executor"
        Provider = "Microsoft Software Key Storage Provider"
        KeyUsageProperty = "Sign"
        TextExtension = @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")
    }
    
    $cert = $null
    $windowsMethodFailed = $false
    
    # Try with full parameters first
    try {
        $cert = New-SelfSignedCertificate @certParams -ErrorAction Stop
    } catch {
        $errorMsg = $_.Exception.Message
        Write-ColorOutput "Warning: Failed with full params: $errorMsg" -Color $Colors.Warning
        
        # Check if it's the read-only security device error
        if ($errorMsg -match "read.?only|security device|provider") {
            Write-ColorOutput "Detected hardware security provider issue. Trying alternative..." -Color $Colors.Warning
            
            # Try without Provider parameter (let Windows choose)
            try {
                $certParams.Remove('Provider')
                $certParams.Remove('KeyUsageProperty')
                $certParams['KeySpec'] = 'Signature'  # Use Signature instead of KeyExchange
                $cert = New-SelfSignedCertificate @certParams -ErrorAction Stop
            } catch {
                Write-ColorOutput "Alternative method also failed: $_" -Color $Colors.Warning
                $windowsMethodFailed = $true
            }
        } else {
            # Try simplified parameters
            try {
                $certParams.Remove('TextExtension')
                $certParams.Remove('Provider')
                $certParams.Remove('KeyUsageProperty')
                $cert = New-SelfSignedCertificate @certParams -ErrorAction Stop
            } catch {
                Write-ColorOutput "Simplified method failed: $_" -Color $Colors.Warning
                $windowsMethodFailed = $true
            }
        }
    }
    
    # If Windows method failed completely, fall back to OpenSSL
    if ($windowsMethodFailed -or $null -eq $cert) {
        Write-ColorOutput "`nWindows certificate method failed. Falling back to OpenSSL..." -Color $Colors.Warning
        
        # Recursive call with OpenSSL flag
        & $PSCommandPath -OutputDir $OutputDir -ValidDays $ValidDays -UseOpenSSL -Force
        exit $LASTEXITCODE
    }
    
    Write-ColorOutput "Certificate created in Windows store: $($cert.Thumbprint)" -Color $Colors.Success
    
    # Export to PEM format
    Write-ColorOutput "Exporting certificate to PEM format..." -Color $Colors.Info
    
    # Export certificate (public key)
    $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $certBase64 = [System.Convert]::ToBase64String($certBytes, [System.Base64FormattingOptions]::InsertLineBreaks)
    $certPem = "-----BEGIN CERTIFICATE-----`n$certBase64`n-----END CERTIFICATE-----"
    $certPem | Set-Content -Path $certPath -Force
    
    # Export private key using modern CNG API
    $privateKeyExported = $false
    
    # Method 1: Try GetRSAPrivateKey() - modern .NET Core method
    try {
        $rsaPrivateKey = $cert.GetRSAPrivateKey()
        if ($rsaPrivateKey) {
            $pkcs8Bytes = $rsaPrivateKey.ExportPkcs8PrivateKey()
            $keyBase64 = [System.Convert]::ToBase64String($pkcs8Bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
            $keyPem = "-----BEGIN PRIVATE KEY-----`n$keyBase64`n-----END PRIVATE KEY-----"
            $keyPem | Set-Content -Path $keyPath -Force
            $privateKeyExported = $true
            Write-ColorOutput "Private key exported using CNG API" -Color $Colors.Success
        }
    } catch {
        Write-ColorOutput "CNG export method not available: $_" -Color $Colors.Warning
    }
    
    # Method 2: Try legacy PrivateKey property
    if (-not $privateKeyExported) {
        try {
            $privateKey = $cert.PrivateKey
            if ($privateKey) {
                $rsaParams = $privateKey.ExportParameters($true)
                $rsa = [System.Security.Cryptography.RSA]::Create()
                $rsa.ImportParameters($rsaParams)
                $pkcs8Bytes = $rsa.ExportPkcs8PrivateKey()
                $keyBase64 = [System.Convert]::ToBase64String($pkcs8Bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
                $keyPem = "-----BEGIN PRIVATE KEY-----`n$keyBase64`n-----END PRIVATE KEY-----"
                $keyPem | Set-Content -Path $keyPath -Force
                $privateKeyExported = $true
                Write-ColorOutput "Private key exported using legacy API" -Color $Colors.Success
            }
        } catch {
            Write-ColorOutput "Legacy export method failed: $_" -Color $Colors.Warning
        }
    }
    
    # Method 3: Fall back to PFX export + OpenSSL conversion
    if (-not $privateKeyExported) {
        Write-ColorOutput "Direct export failed. Attempting PFX method..." -Color $Colors.Info
        
        $pfxPath = Join-Path $OutputDir "temp.pfx"
        $password = ConvertTo-SecureString -String "temppassword" -Force -AsPlainText
        
        try {
            Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
            
            # Check if OpenSSL is available for conversion
            $opensslAvailable = Get-Command openssl -ErrorAction SilentlyContinue
            if ($opensslAvailable) {
                & openssl pkcs12 -in $pfxPath -nocerts -nodes -out $keyPath -password pass:temppassword 2>&1 | Out-Null
                & openssl pkcs12 -in $pfxPath -clcerts -nokeys -out $certPath -password pass:temppassword 2>&1 | Out-Null
                Remove-Item $pfxPath -Force -ErrorAction SilentlyContinue
                $privateKeyExported = $true
                Write-ColorOutput "Private key exported via PFX+OpenSSL" -Color $Colors.Success
            } else {
                Write-ColorOutput "OpenSSL not available for PFX conversion." -Color $Colors.Warning
                Write-ColorOutput "Certificate exported as PFX: $pfxPath" -Color $Colors.Info
                Write-ColorOutput "Manual conversion required. Run:" -Color $Colors.Info
                Write-ColorOutput "  openssl pkcs12 -in `"$pfxPath`" -nocerts -nodes -out `"$keyPath`" -password pass:temppassword" -Color $Colors.Highlight
            }
        } catch {
            Write-ColorOutput "PFX export failed: $_" -Color $Colors.Warning
        }
    }
    
    if (-not $privateKeyExported) {
        Write-ColorOutput "Warning: Could not export private key. Falling back to OpenSSL..." -Color $Colors.Warning
        & $PSCommandPath -OutputDir $OutputDir -ValidDays $ValidDays -UseOpenSSL -Force
        exit $LASTEXITCODE
    }
}

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
    Write-ColorOutput "  1. Enable SSL in Job Executor service:" -Color $Colors.Info
    Write-ColorOutput "     nssm set DellServerManagerJobExecutor AppEnvironmentExtra +API_SERVER_SSL_ENABLED=true" -Color $Colors.Highlight
    Write-ColorOutput "  2. Restart the service:" -Color $Colors.Info
    Write-ColorOutput "     nssm restart DellServerManagerJobExecutor" -Color $Colors.Highlight
    Write-ColorOutput "  3. Update Job Executor URL in Settings to use https://" -Color $Colors.Info
    Write-Host ""
} else {
    Write-ColorOutput "Certificate generation may have failed. Check output above." -Color $Colors.Error
    exit 1
}
