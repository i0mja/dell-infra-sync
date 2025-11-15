#requires -Version 5.1

<#
.SYNOPSIS
    Dell Server Manager - Job Executor Management Script
.DESCRIPTION
    Interactive PowerShell script to manage the Job Executor service on Windows.
    Handles installation, configuration, monitoring, and diagnostics.
.NOTES
    Version: 1.0
    Requires: PowerShell 5.1+, Python 3.8+
#>

[CmdletBinding()]
param()

# Script configuration
$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
$ConfigDir = "C:\dell-server-manager"
$ConfigFile = Join-Path $ConfigDir "executor-config.json"
$LogDir = Join-Path $ConfigDir "logs"
$TaskName = "DellServerManager-JobExecutor"
$ExecutorScript = Join-Path $ProjectRoot "job-executor.py"

# Colors for output
$Colors = @{
    Success = "Green"
    Warning = "Yellow"
    Error = "Red"
    Info = "Cyan"
    Prompt = "Magenta"
    Highlight = "White"
}

#region Helper Functions

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [switch]$NoNewLine
    )
    if ($NoNewLine) {
        Write-Host $Message -ForegroundColor $Color -NoNewline
    } else {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Write-Header {
    param([string]$Title)
    Clear-Host
    Write-ColorOutput "`n═══════════════════════════════════════════════════════════════" -Color $Colors.Highlight
    Write-ColorOutput "  Dell Server Manager - Job Executor Manager" -Color $Colors.Highlight
    Write-ColorOutput "═══════════════════════════════════════════════════════════════" -Color $Colors.Highlight
    if ($Title) {
        Write-ColorOutput "  $Title" -Color $Colors.Info
        Write-ColorOutput "═══════════════════════════════════════════════════════════════`n" -Color $Colors.Highlight
    } else {
        Write-Host ""
    }
}

function Wait-KeyPress {
    param([string]$Message = "Press any key to continue...")
    Write-ColorOutput "`n$Message" -Color $Colors.Info
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

function Confirm-AdminPrivileges {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-PythonInstalled {
    try {
        $pythonVersion = & python --version 2>&1
        return $pythonVersion -match "Python 3\.\d+"
    } catch {
        return $false
    }
}

function Protect-String {
    param([string]$PlainText)
    if ([string]::IsNullOrEmpty($PlainText)) { return "" }
    $secureString = ConvertTo-SecureString $PlainText -AsPlainText -Force
    return ConvertFrom-SecureString $secureString
}

function Unprotect-String {
    param([string]$EncryptedText)
    if ([string]::IsNullOrEmpty($EncryptedText)) { return "" }
    try {
        $secureString = ConvertTo-SecureString $EncryptedText
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } catch {
        Write-ColorOutput "Warning: Failed to decrypt value" -Color $Colors.Warning
        return ""
    }
}

function Read-SecureInput {
    param(
        [string]$Prompt,
        [string]$DefaultValue = "",
        [switch]$IsPassword
    )
    
    if ($IsPassword) {
        Write-ColorOutput "$Prompt" -Color $Colors.Prompt -NoNewLine
        if ($DefaultValue) {
            Write-ColorOutput " [Current: ****]" -Color $Colors.Info -NoNewLine
        }
        Write-ColorOutput ": " -Color $Colors.Prompt -NoNewLine
        $secure = Read-Host -AsSecureString
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $value = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        return if ([string]::IsNullOrWhiteSpace($value)) { $DefaultValue } else { $value }
    } else {
        Write-ColorOutput "$Prompt" -Color $Colors.Prompt -NoNewLine
        if ($DefaultValue) {
            Write-ColorOutput " [$DefaultValue]" -Color $Colors.Info -NoNewLine
        }
        Write-ColorOutput ": " -Color $Colors.Prompt -NoNewLine
        $value = Read-Host
        return if ([string]::IsNullOrWhiteSpace($value)) { $DefaultValue } else { $value }
    }
}

#endregion

#region Configuration Management

function Initialize-ConfigDirectory {
    if (-not (Test-Path $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
        Write-ColorOutput "Created configuration directory: $ConfigDir" -Color $Colors.Success
    }
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
        Write-ColorOutput "Created log directory: $LogDir" -Color $Colors.Success
    }
}

function Get-DefaultConfig {
    return @{
        dsm_url = "http://127.0.0.1:54321"
        service_role_key = ""
        vcenter_host = ""
        vcenter_user = ""
        vcenter_password = ""
        vcenter_port = 443
        vcenter_verify_ssl = $false
        idrac_user = "root"
        idrac_password = ""
        firmware_repo_url = ""
        poll_interval = 10
        log_level = "INFO"
        max_concurrent_jobs = 3
    }
}

function Load-ExecutorConfig {
    Initialize-ConfigDirectory
    
    if (-not (Test-Path $ConfigFile)) {
        Write-ColorOutput "No configuration file found. Creating default configuration..." -Color $Colors.Warning
        $config = Get-DefaultConfig
        Save-ExecutorConfig $config
        return $config
    }
    
    try {
        $json = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $config = @{}
        $json.PSObject.Properties | ForEach-Object {
            $config[$_.Name] = $_.Value
        }
        return $config
    } catch {
        Write-ColorOutput "Error loading configuration: $_" -Color $Colors.Error
        Write-ColorOutput "Using default configuration..." -Color $Colors.Warning
        return Get-DefaultConfig
    }
}

function Save-ExecutorConfig {
    param($Config)
    
    Initialize-ConfigDirectory
    
    try {
        $Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Force
        Write-ColorOutput "Configuration saved successfully" -Color $Colors.Success
        return $true
    } catch {
        Write-ColorOutput "Error saving configuration: $_" -Color $Colors.Error
        return $false
    }
}

function Show-CurrentConfig {
    Write-Header "Current Configuration"
    
    $config = Load-ExecutorConfig
    
    Write-ColorOutput "General Settings:" -Color $Colors.Highlight
    Write-ColorOutput "  DSM URL:              $($config.dsm_url)" -Color $Colors.Info
    Write-ColorOutput "  Service Role Key:     $(if($config.service_role_key){'****[SET]'}else{'[NOT SET]'})" -Color $Colors.Info
    Write-ColorOutput "  Poll Interval:        $($config.poll_interval) seconds" -Color $Colors.Info
    Write-ColorOutput "  Log Level:            $($config.log_level)" -Color $Colors.Info
    Write-ColorOutput "  Max Concurrent Jobs:  $($config.max_concurrent_jobs)" -Color $Colors.Info
    
    Write-ColorOutput "`nvCenter Settings:" -Color $Colors.Highlight
    Write-ColorOutput "  Host:                 $($config.vcenter_host)" -Color $Colors.Info
    Write-ColorOutput "  Port:                 $($config.vcenter_port)" -Color $Colors.Info
    Write-ColorOutput "  Username:             $($config.vcenter_user)" -Color $Colors.Info
    Write-ColorOutput "  Password:             $(if($config.vcenter_password){'****[SET]'}else{'[NOT SET]'})" -Color $Colors.Info
    Write-ColorOutput "  Verify SSL:           $($config.vcenter_verify_ssl)" -Color $Colors.Info
    
    Write-ColorOutput "`niDRAC Settings:" -Color $Colors.Highlight
    Write-ColorOutput "  Username:             $($config.idrac_user)" -Color $Colors.Info
    Write-ColorOutput "  Password:             $(if($config.idrac_password){'****[SET]'}else{'[NOT SET]'})" -Color $Colors.Info
    
    Write-ColorOutput "`nFirmware Repository:" -Color $Colors.Highlight
    Write-ColorOutput "  URL:                  $($config.firmware_repo_url)" -Color $Colors.Info
    
    Wait-KeyPress
}

function Edit-Configuration {
    Write-Header "Edit Configuration"
    
    $config = Load-ExecutorConfig
    
    Write-ColorOutput "Edit configuration (press Enter to keep current value)`n" -Color $Colors.Info
    
    # General settings
    Write-ColorOutput "═══ General Settings ═══" -Color $Colors.Highlight
    $config.dsm_url = Read-SecureInput "DSM URL" $config.dsm_url
    
    $newKey = Read-SecureInput "Service Role Key" -IsPassword
    if (-not [string]::IsNullOrWhiteSpace($newKey)) {
        $config.service_role_key = Protect-String $newKey
    }
    
    $pollInterval = Read-SecureInput "Poll Interval (seconds)" $config.poll_interval
    if ($pollInterval -match '^\d+$') {
        $config.poll_interval = [int]$pollInterval
    }
    
    $config.log_level = Read-SecureInput "Log Level (DEBUG/INFO/WARNING/ERROR)" $config.log_level
    
    $maxJobs = Read-SecureInput "Max Concurrent Jobs" $config.max_concurrent_jobs
    if ($maxJobs -match '^\d+$') {
        $config.max_concurrent_jobs = [int]$maxJobs
    }
    
    # vCenter settings
    Write-ColorOutput "`n═══ vCenter Settings ═══" -Color $Colors.Highlight
    $config.vcenter_host = Read-SecureInput "vCenter Host" $config.vcenter_host
    
    $vcPort = Read-SecureInput "vCenter Port" $config.vcenter_port
    if ($vcPort -match '^\d+$') {
        $config.vcenter_port = [int]$vcPort
    }
    
    $config.vcenter_user = Read-SecureInput "vCenter Username" $config.vcenter_user
    
    $newVcPass = Read-SecureInput "vCenter Password" -IsPassword
    if (-not [string]::IsNullOrWhiteSpace($newVcPass)) {
        $config.vcenter_password = Protect-String $newVcPass
    }
    
    $verifySsl = Read-SecureInput "Verify SSL (true/false)" $config.vcenter_verify_ssl
    if ($verifySsl -match '^(true|false)$') {
        $config.vcenter_verify_ssl = $verifySsl -eq 'true'
    }
    
    # iDRAC settings
    Write-ColorOutput "`n═══ iDRAC Settings ═══" -Color $Colors.Highlight
    $config.idrac_user = Read-SecureInput "iDRAC Username" $config.idrac_user
    
    $newIdracPass = Read-SecureInput "iDRAC Password" -IsPassword
    if (-not [string]::IsNullOrWhiteSpace($newIdracPass)) {
        $config.idrac_password = Protect-String $newIdracPass
    }
    
    # Firmware repository
    Write-ColorOutput "`n═══ Firmware Repository ═══" -Color $Colors.Highlight
    $config.firmware_repo_url = Read-SecureInput "Firmware Repository URL" $config.firmware_repo_url
    
    # Save configuration
    Write-Host ""
    if (Save-ExecutorConfig $config) {
        Write-ColorOutput "Configuration updated successfully!" -Color $Colors.Success
        Write-ColorOutput "Note: Restart the service for changes to take effect." -Color $Colors.Warning
    }
    
    Wait-KeyPress
}

function Export-Configuration {
    Write-Header "Export Configuration"
    
    $config = Load-ExecutorConfig
    
    $defaultPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "executor-config-export.json"
    $exportPath = Read-SecureInput "Export path" $defaultPath
    
    try {
        # Create a sanitized copy (without decrypted passwords)
        $exportConfig = $config.Clone()
        if ($exportConfig.service_role_key) {
            $exportConfig.service_role_key = "[ENCRYPTED]"
        }
        if ($exportConfig.vcenter_password) {
            $exportConfig.vcenter_password = "[ENCRYPTED]"
        }
        if ($exportConfig.idrac_password) {
            $exportConfig.idrac_password = "[ENCRYPTED]"
        }
        
        $exportConfig | ConvertTo-Json -Depth 10 | Set-Content $exportPath -Force
        Write-ColorOutput "`nConfiguration exported to: $exportPath" -Color $Colors.Success
        Write-ColorOutput "Note: Passwords are NOT included in export for security." -Color $Colors.Warning
    } catch {
        Write-ColorOutput "Error exporting configuration: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

function Import-Configuration {
    Write-Header "Import Configuration"
    
    Write-ColorOutput "Warning: This will overwrite your current configuration!" -Color $Colors.Warning
    $confirm = Read-SecureInput "Are you sure? (yes/no)" "no"
    
    if ($confirm -ne "yes") {
        Write-ColorOutput "Import cancelled" -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    $defaultPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "executor-config-export.json"
    $importPath = Read-SecureInput "Import path" $defaultPath
    
    if (-not (Test-Path $importPath)) {
        Write-ColorOutput "File not found: $importPath" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    try {
        $importedConfig = Get-Content $importPath -Raw | ConvertFrom-Json
        $config = @{}
        $importedConfig.PSObject.Properties | ForEach-Object {
            $config[$_.Name] = $_.Value
        }
        
        # Re-prompt for passwords
        Write-ColorOutput "`nPasswords are not included in exports. Please enter them now:" -Color $Colors.Info
        
        $serviceKey = Read-SecureInput "Service Role Key" -IsPassword
        if (-not [string]::IsNullOrWhiteSpace($serviceKey)) {
            $config.service_role_key = Protect-String $serviceKey
        }
        
        $vcPass = Read-SecureInput "vCenter Password" -IsPassword
        if (-not [string]::IsNullOrWhiteSpace($vcPass)) {
            $config.vcenter_password = Protect-String $vcPass
        }
        
        $idracPass = Read-SecureInput "iDRAC Password" -IsPassword
        if (-not [string]::IsNullOrWhiteSpace($idracPass)) {
            $config.idrac_password = Protect-String $idracPass
        }
        
        if (Save-ExecutorConfig $config) {
            Write-ColorOutput "`nConfiguration imported successfully!" -Color $Colors.Success
        }
    } catch {
        Write-ColorOutput "Error importing configuration: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

function Start-QuickSetup {
    Write-Header "Quick Setup Wizard"
    
    Write-ColorOutput "This wizard will guide you through initial configuration.`n" -Color $Colors.Info
    
    $config = Get-DefaultConfig
    
    # Essential settings only
    Write-ColorOutput "═══ Essential Settings ═══`n" -Color $Colors.Highlight
    
    $config.dsm_url = Read-SecureInput "DSM URL" $config.dsm_url
    
    $serviceKey = Read-SecureInput "Service Role Key (from Settings → Diagnostics)" -IsPassword
    if (-not [string]::IsNullOrWhiteSpace($serviceKey)) {
        $config.service_role_key = Protect-String $serviceKey
    } else {
        Write-ColorOutput "Warning: Service Role Key is required!" -Color $Colors.Warning
    }
    
    Write-ColorOutput "`nOptional: Configure vCenter integration? (yes/no)" -Color $Colors.Prompt -NoNewLine
    Write-ColorOutput ": " -Color $Colors.Prompt -NoNewLine
    $configVcenter = Read-Host
    
    if ($configVcenter -eq "yes") {
        Write-Host ""
        $config.vcenter_host = Read-SecureInput "vCenter Host"
        $config.vcenter_user = Read-SecureInput "vCenter Username"
        $vcPass = Read-SecureInput "vCenter Password" -IsPassword
        if (-not [string]::IsNullOrWhiteSpace($vcPass)) {
            $config.vcenter_password = Protect-String $vcPass
        }
    }
    
    Write-Host ""
    if (Save-ExecutorConfig $config) {
        Write-ColorOutput "Setup complete! You can now install the service." -Color $Colors.Success
    }
    
    Wait-KeyPress
}

#endregion

#region Service Management

function Get-ExecutorStatus {
    try {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($null -eq $task) {
            return @{
                Installed = $false
                Running = $false
                Status = "Not Installed"
            }
        }
        
        $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
        $isRunning = $task.State -eq "Running"
        
        return @{
            Installed = $true
            Running = $isRunning
            Status = $task.State
            LastRunTime = $taskInfo.LastRunTime
            LastResult = $taskInfo.LastTaskResult
            NextRunTime = $taskInfo.NextRunTime
        }
    } catch {
        return @{
            Installed = $false
            Running = $false
            Status = "Error: $_"
        }
    }
}

function Show-ServiceStatus {
    Write-Header "Service Status"
    
    $status = Get-ExecutorStatus
    
    Write-ColorOutput "Service Status:" -Color $Colors.Highlight
    Write-ColorOutput "  Installed:      $(if($status.Installed){'Yes'}else{'No'})" -Color $(if($status.Installed){$Colors.Success}else{$Colors.Error})
    
    if ($status.Installed) {
        Write-ColorOutput "  State:          $($status.Status)" -Color $(if($status.Running){$Colors.Success}else{$Colors.Warning})
        Write-ColorOutput "  Last Run:       $($status.LastRunTime)" -Color $Colors.Info
        Write-ColorOutput "  Last Result:    $($status.LastResult)" -Color $(if($status.LastResult -eq 0){$Colors.Success}else{$Colors.Error})
        
        if ($status.NextRunTime) {
            Write-ColorOutput "  Next Run:       $($status.NextRunTime)" -Color $Colors.Info
        }
    }
    
    # Check configuration
    Write-ColorOutput "`nConfiguration:" -Color $Colors.Highlight
    if (Test-Path $ConfigFile) {
        Write-ColorOutput "  Config File:    Found" -Color $Colors.Success
        $config = Load-ExecutorConfig
        $hasServiceKey = -not [string]::IsNullOrEmpty($config.service_role_key)
        Write-ColorOutput "  Service Key:    $(if($hasServiceKey){'Configured'}else{'NOT CONFIGURED'})" -Color $(if($hasServiceKey){$Colors.Success}else{$Colors.Error})
    } else {
        Write-ColorOutput "  Config File:    Not Found" -Color $Colors.Error
    }
    
    # Check Python
    Write-ColorOutput "`nPrerequisites:" -Color $Colors.Highlight
    $hasPython = Test-PythonInstalled
    Write-ColorOutput "  Python:         $(if($hasPython){'Installed'}else{'NOT FOUND'})" -Color $(if($hasPython){$Colors.Success}else{$Colors.Error})
    
    $hasScript = Test-Path $ExecutorScript
    Write-ColorOutput "  Executor:       $(if($hasScript){'Found'}else{'NOT FOUND'})" -Color $(if($hasScript){$Colors.Success}else{$Colors.Error})
    
    Wait-KeyPress
}

function Install-ExecutorService {
    Write-Header "Install Service"
    
    if (-not (Confirm-AdminPrivileges)) {
        Write-ColorOutput "Error: Administrator privileges required!" -Color $Colors.Error
        Write-ColorOutput "Please run PowerShell as Administrator." -Color $Colors.Warning
        Wait-KeyPress
        return
    }
    
    # Check if already installed
    $status = Get-ExecutorStatus
    if ($status.Installed) {
        Write-ColorOutput "Service is already installed!" -Color $Colors.Warning
        Write-ColorOutput "Please uninstall first if you want to reinstall." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    # Validate prerequisites
    if (-not (Test-PythonInstalled)) {
        Write-ColorOutput "Error: Python 3.8+ is not installed!" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    if (-not (Test-Path $ExecutorScript)) {
        Write-ColorOutput "Error: job-executor.py not found at: $ExecutorScript" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    # Load configuration
    $config = Load-ExecutorConfig
    if ([string]::IsNullOrEmpty($config.service_role_key)) {
        Write-ColorOutput "Error: Service Role Key not configured!" -Color $Colors.Error
        Write-ColorOutput "Please run Quick Setup first (Configuration menu → Quick Setup Wizard)" -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "Installing Job Executor service...`n" -Color $Colors.Info
    
    try {
        # Decrypt sensitive values
        $serviceKey = Unprotect-String $config.service_role_key
        
        # Build environment variables
        $envVars = @(
            "DSM_URL=$($config.dsm_url)",
            "SERVICE_ROLE_KEY=$serviceKey",
            "POLL_INTERVAL=$($config.poll_interval)",
            "LOG_LEVEL=$($config.log_level)",
            "MAX_CONCURRENT_JOBS=$($config.max_concurrent_jobs)"
        )
        
        if ($config.vcenter_host) {
            $vcPass = Unprotect-String $config.vcenter_password
            $envVars += "VCENTER_HOST=$($config.vcenter_host)"
            $envVars += "VCENTER_USER=$($config.vcenter_user)"
            $envVars += "VCENTER_PASSWORD=$vcPass"
            $envVars += "VCENTER_PORT=$($config.vcenter_port)"
            $envVars += "VCENTER_VERIFY_SSL=$($config.vcenter_verify_ssl)"
        }
        
        if ($config.firmware_repo_url) {
            $envVars += "FIRMWARE_REPO_URL=$($config.firmware_repo_url)"
        }
        
        # Create wrapper script
        $wrapperScript = Join-Path $ConfigDir "run-executor.ps1"
        $wrapperContent = @"
# Job Executor Wrapper Script
Set-Location '$ProjectRoot'

# Set environment variables
$(($envVars | ForEach-Object { "`$env:$_" }) -join "`n")

# Run executor
& python '$ExecutorScript'
"@
        $wrapperContent | Set-Content $wrapperScript -Force
        
        # Create scheduled task
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapperScript`""
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Dell Server Manager Job Executor" | Out-Null
        
        # Start the task
        Start-ScheduledTask -TaskName $TaskName
        
        Write-ColorOutput "✓ Service installed successfully!" -Color $Colors.Success
        Write-ColorOutput "✓ Service started" -Color $Colors.Success
        Write-ColorOutput "`nThe Job Executor is now running and will start automatically on system boot." -Color $Colors.Info
        
    } catch {
        Write-ColorOutput "Error installing service: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

function Uninstall-ExecutorService {
    Write-Header "Uninstall Service"
    
    if (-not (Confirm-AdminPrivileges)) {
        Write-ColorOutput "Error: Administrator privileges required!" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    $status = Get-ExecutorStatus
    if (-not $status.Installed) {
        Write-ColorOutput "Service is not installed." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "Warning: This will remove the Job Executor service!" -Color $Colors.Warning
    Write-ColorOutput "Configuration files will be preserved." -Color $Colors.Info
    $confirm = Read-SecureInput "`nAre you sure? (yes/no)" "no"
    
    if ($confirm -ne "yes") {
        Write-ColorOutput "Uninstall cancelled" -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    try {
        # Stop the task first
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        
        # Unregister the task
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        
        Write-ColorOutput "`n✓ Service uninstalled successfully!" -Color $Colors.Success
        
    } catch {
        Write-ColorOutput "Error uninstalling service: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

function Start-ExecutorService {
    Write-Header "Start Service"
    
    if (-not (Confirm-AdminPrivileges)) {
        Write-ColorOutput "Error: Administrator privileges required!" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    $status = Get-ExecutorStatus
    if (-not $status.Installed) {
        Write-ColorOutput "Service is not installed. Please install it first." -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    if ($status.Running) {
        Write-ColorOutput "Service is already running." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    try {
        Start-ScheduledTask -TaskName $TaskName
        Write-ColorOutput "✓ Service started successfully!" -Color $Colors.Success
    } catch {
        Write-ColorOutput "Error starting service: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

function Stop-ExecutorService {
    Write-Header "Stop Service"
    
    if (-not (Confirm-AdminPrivileges)) {
        Write-ColorOutput "Error: Administrator privileges required!" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    $status = Get-ExecutorStatus
    if (-not $status.Installed) {
        Write-ColorOutput "Service is not installed." -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    if (-not $status.Running) {
        Write-ColorOutput "Service is not running." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    try {
        Stop-ScheduledTask -TaskName $TaskName
        Write-ColorOutput "✓ Service stopped successfully!" -Color $Colors.Success
    } catch {
        Write-ColorOutput "Error stopping service: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

function Restart-ExecutorService {
    Write-Header "Restart Service"
    
    if (-not (Confirm-AdminPrivileges)) {
        Write-ColorOutput "Error: Administrator privileges required!" -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    $status = Get-ExecutorStatus
    if (-not $status.Installed) {
        Write-ColorOutput "Service is not installed." -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    try {
        Write-ColorOutput "Stopping service..." -Color $Colors.Info
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        
        Write-ColorOutput "Starting service..." -Color $Colors.Info
        Start-ScheduledTask -TaskName $TaskName
        
        Write-ColorOutput "✓ Service restarted successfully!" -Color $Colors.Success
    } catch {
        Write-ColorOutput "Error restarting service: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

#endregion

#region Monitoring

function Get-LatestLogFile {
    if (-not (Test-Path $LogDir)) {
        return $null
    }
    
    $logFiles = Get-ChildItem -Path $LogDir -Filter "*.log" -ErrorAction SilentlyContinue
    if ($logFiles) {
        return ($logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    }
    return $null
}

function Show-LiveLogs {
    Write-Header "Live Logs"
    
    $logFile = Get-LatestLogFile
    if (-not $logFile) {
        Write-ColorOutput "No log files found in: $LogDir" -Color $Colors.Warning
        Write-ColorOutput "The service may not have started yet, or logs are in a different location." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "Showing live logs from: $logFile" -Color $Colors.Info
    Write-ColorOutput "Press Ctrl+C to exit`n" -Color $Colors.Warning
    Write-ColorOutput "─────────────────────────────────────────────────────────────────`n" -Color $Colors.Highlight
    
    try {
        Get-Content $logFile -Tail 50 -Wait | ForEach-Object {
            $line = $_
            $color = "White"
            
            if ($line -match "ERROR|CRITICAL|FAILED") {
                $color = $Colors.Error
            } elseif ($line -match "WARNING|WARN") {
                $color = $Colors.Warning
            } elseif ($line -match "SUCCESS|COMPLETED") {
                $color = $Colors.Success
            } elseif ($line -match "INFO") {
                $color = $Colors.Info
            }
            
            Write-ColorOutput $line -Color $color
        }
    } catch {
        Write-ColorOutput "`nLog viewing stopped." -Color $Colors.Info
    }
}

function Show-HistoricalLogs {
    Write-Header "Historical Logs"
    
    if (-not (Test-Path $LogDir)) {
        Write-ColorOutput "No log directory found: $LogDir" -Color $Colors.Warning
        Wait-KeyPress
        return
    }
    
    $logFiles = Get-ChildItem -Path $LogDir -Filter "*.log" | Sort-Object LastWriteTime -Descending
    
    if ($logFiles.Count -eq 0) {
        Write-ColorOutput "No log files found." -Color $Colors.Warning
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "Available log files:`n" -Color $Colors.Info
    
    for ($i = 0; $i -lt [Math]::Min($logFiles.Count, 10); $i++) {
        $file = $logFiles[$i]
        $size = "{0:N2} KB" -f ($file.Length / 1KB)
        Write-ColorOutput "  $($i + 1). $($file.Name) - $size - $($file.LastWriteTime)" -Color $Colors.Info
    }
    
    Write-Host ""
    $selection = Read-SecureInput "Select log file (1-$([Math]::Min($logFiles.Count, 10))) or 'q' to quit" "1"
    
    if ($selection -eq 'q') {
        return
    }
    
    if ($selection -match '^\d+$') {
        $index = [int]$selection - 1
        if ($index -ge 0 -and $index -lt $logFiles.Count) {
            $selectedFile = $logFiles[$index].FullName
            
            Clear-Host
            Write-ColorOutput "═══════════════════════════════════════════════════════════════" -Color $Colors.Highlight
            Write-ColorOutput "  Log File: $($logFiles[$index].Name)" -Color $Colors.Highlight
            Write-ColorOutput "═══════════════════════════════════════════════════════════════`n" -Color $Colors.Highlight
            
            Get-Content $selectedFile -Tail 100 | ForEach-Object {
                $line = $_
                $color = "White"
                
                if ($line -match "ERROR|CRITICAL|FAILED") {
                    $color = $Colors.Error
                } elseif ($line -match "WARNING|WARN") {
                    $color = $Colors.Warning
                } elseif ($line -match "SUCCESS|COMPLETED") {
                    $color = $Colors.Success
                }
                
                Write-ColorOutput $line -Color $color
            }
            
            Write-ColorOutput "`n(Showing last 100 lines)" -Color $Colors.Info
        }
    }
    
    Wait-KeyPress
}

function Show-LogStatistics {
    Write-Header "Log Statistics"
    
    if (-not (Test-Path $LogDir)) {
        Write-ColorOutput "No log directory found: $LogDir" -Color $Colors.Warning
        Wait-KeyPress
        return
    }
    
    $logFiles = Get-ChildItem -Path $LogDir -Filter "*.log"
    
    if ($logFiles.Count -eq 0) {
        Write-ColorOutput "No log files found." -Color $Colors.Warning
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "Log File Statistics:`n" -Color $Colors.Info
    
    $totalSize = ($logFiles | Measure-Object -Property Length -Sum).Sum
    Write-ColorOutput "  Total Files:      $($logFiles.Count)" -Color $Colors.Info
    Write-ColorOutput "  Total Size:       $("{0:N2} MB" -f ($totalSize / 1MB))" -Color $Colors.Info
    Write-ColorOutput "  Oldest Log:       $(($logFiles | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime)" -Color $Colors.Info
    Write-ColorOutput "  Newest Log:       $(($logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime)" -Color $Colors.Info
    
    # Count log levels in latest file
    $latestLog = Get-LatestLogFile
    if ($latestLog) {
        Write-ColorOutput "`nLatest Log Analysis:" -Color $Colors.Highlight
        $content = Get-Content $latestLog -ErrorAction SilentlyContinue
        
        $errorCount = ($content | Select-String -Pattern "ERROR|CRITICAL" -AllMatches).Matches.Count
        $warningCount = ($content | Select-String -Pattern "WARNING|WARN" -AllMatches).Matches.Count
        $infoCount = ($content | Select-String -Pattern "INFO" -AllMatches).Matches.Count
        
        Write-ColorOutput "  Errors:           $errorCount" -Color $(if($errorCount -gt 0){$Colors.Error}else{$Colors.Success})
        Write-ColorOutput "  Warnings:         $warningCount" -Color $(if($warningCount -gt 0){$Colors.Warning}else{$Colors.Success})
        Write-ColorOutput "  Info Messages:    $infoCount" -Color $Colors.Info
    }
    
    Wait-KeyPress
}

function Clear-OldLogs {
    Write-Header "Clear Old Logs"
    
    if (-not (Test-Path $LogDir)) {
        Write-ColorOutput "No log directory found." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    $days = Read-SecureInput "Delete logs older than (days)" "30"
    
    if (-not ($days -match '^\d+$')) {
        Write-ColorOutput "Invalid number of days." -Color $Colors.Error
        Wait-KeyPress
        return
    }
    
    $cutoffDate = (Get-Date).AddDays(-[int]$days)
    $oldLogs = Get-ChildItem -Path $LogDir -Filter "*.log" | Where-Object { $_.LastWriteTime -lt $cutoffDate }
    
    if ($oldLogs.Count -eq 0) {
        Write-ColorOutput "`nNo logs older than $days days found." -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "`nFound $($oldLogs.Count) log files to delete." -Color $Colors.Warning
    $confirm = Read-SecureInput "Are you sure? (yes/no)" "no"
    
    if ($confirm -eq "yes") {
        try {
            $oldLogs | Remove-Item -Force
            Write-ColorOutput "`n✓ Deleted $($oldLogs.Count) old log files" -Color $Colors.Success
        } catch {
            Write-ColorOutput "Error deleting logs: $_" -Color $Colors.Error
        }
    } else {
        Write-ColorOutput "Operation cancelled" -Color $Colors.Info
    }
    
    Wait-KeyPress
}

#endregion

#region Diagnostics

function Test-DSMConnectivity {
    Write-Header "Test DSM Connectivity"
    
    $config = Load-ExecutorConfig
    
    Write-ColorOutput "Testing connection to: $($config.dsm_url)`n" -Color $Colors.Info
    
    try {
        $healthUrl = "$($config.dsm_url)/health"
        Write-ColorOutput "Checking health endpoint..." -Color $Colors.Info
        
        $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 10 -ErrorAction Stop
        Write-ColorOutput "✓ DSM is reachable" -Color $Colors.Success
        
        # Test service role key if configured
        if ($config.service_role_key) {
            Write-ColorOutput "`nTesting Service Role Key..." -Color $Colors.Info
            $serviceKey = Unprotect-String $config.service_role_key
            
            $headers = @{
                "Authorization" = "Bearer $serviceKey"
                "apikey" = $serviceKey
            }
            
            $testUrl = "$($config.dsm_url)/rest/v1/jobs?limit=1"
            $testResponse = Invoke-RestMethod -Uri $testUrl -Method Get -Headers $headers -TimeoutSec 10 -ErrorAction Stop
            Write-ColorOutput "✓ Service Role Key is valid" -Color $Colors.Success
        } else {
            Write-ColorOutput "`nService Role Key not configured" -Color $Colors.Warning
        }
        
    } catch {
        Write-ColorOutput "✗ Connection failed: $_" -Color $Colors.Error
        
        if ($_.Exception.Message -match "401|403") {
            Write-ColorOutput "`nPossible causes:" -Color $Colors.Warning
            Write-ColorOutput "  - Invalid Service Role Key" -Color $Colors.Warning
            Write-ColorOutput "  - Expired credentials" -Color $Colors.Warning
        } elseif ($_.Exception.Message -match "timeout|unable to connect") {
            Write-ColorOutput "`nPossible causes:" -Color $Colors.Warning
            Write-ColorOutput "  - Supabase is not running" -Color $Colors.Warning
            Write-ColorOutput "  - Firewall blocking connection" -Color $Colors.Warning
            Write-ColorOutput "  - Incorrect DSM URL" -Color $Colors.Warning
        }
    }
    
    Wait-KeyPress
}

function Test-VCenterConnection {
    Write-Header "Test vCenter Connection"
    
    $config = Load-ExecutorConfig
    
    if ([string]::IsNullOrEmpty($config.vcenter_host)) {
        Write-ColorOutput "vCenter not configured." -Color $Colors.Warning
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "Testing connection to: $($config.vcenter_host):$($config.vcenter_port)`n" -Color $Colors.Info
    
    try {
        # Test basic connectivity
        $tcpTest = Test-NetConnection -ComputerName $config.vcenter_host -Port $config.vcenter_port -WarningAction SilentlyContinue
        
        if ($tcpTest.TcpTestSucceeded) {
            Write-ColorOutput "✓ vCenter is reachable on port $($config.vcenter_port)" -Color $Colors.Success
        } else {
            Write-ColorOutput "✗ Cannot reach vCenter on port $($config.vcenter_port)" -Color $Colors.Error
        }
        
        # Test HTTPS endpoint
        $vcUrl = "https://$($config.vcenter_host):$($config.vcenter_port)/ui"
        Write-ColorOutput "`nTesting HTTPS endpoint..." -Color $Colors.Info
        
        try {
            $response = Invoke-WebRequest -Uri $vcUrl -Method Head -TimeoutSec 5 -ErrorAction Stop
            Write-ColorOutput "✓ HTTPS endpoint is accessible" -Color $Colors.Success
        } catch {
            if ($_.Exception.Message -match "SSL") {
                Write-ColorOutput "⚠ SSL certificate issue (this is normal if using self-signed cert)" -Color $Colors.Warning
            } else {
                Write-ColorOutput "✗ HTTPS endpoint test failed: $($_.Exception.Message)" -Color $Colors.Error
            }
        }
        
    } catch {
        Write-ColorOutput "✗ Connection test failed: $_" -Color $Colors.Error
    }
    
    Write-ColorOutput "`nNote: Full vCenter API authentication testing requires the Job Executor to be running." -Color $Colors.Info
    
    Wait-KeyPress
}

function Test-IdracConnection {
    Write-Header "Test iDRAC Connection"
    
    Write-ColorOutput "This test requires an iDRAC IP address to test against.`n" -Color $Colors.Info
    
    $idracIp = Read-SecureInput "Enter iDRAC IP address to test"
    
    if ([string]::IsNullOrWhiteSpace($idracIp)) {
        Write-ColorOutput "Test cancelled" -Color $Colors.Info
        Wait-KeyPress
        return
    }
    
    Write-ColorOutput "`nTesting connection to: $idracIp`n" -Color $Colors.Info
    
    try {
        # Test basic connectivity
        $tcpTest = Test-NetConnection -ComputerName $idracIp -Port 443 -WarningAction SilentlyContinue
        
        if ($tcpTest.TcpTestSucceeded) {
            Write-ColorOutput "✓ iDRAC is reachable on port 443" -Color $Colors.Success
        } else {
            Write-ColorOutput "✗ Cannot reach iDRAC on port 443" -Color $Colors.Error
        }
        
        # Test Redfish endpoint
        $redfishUrl = "https://$idracIp/redfish/v1/"
        Write-ColorOutput "`nTesting Redfish API endpoint..." -Color $Colors.Info
        
        try {
            $response = Invoke-RestMethod -Uri $redfishUrl -Method Get -TimeoutSec 5 -SkipCertificateCheck -ErrorAction Stop
            Write-ColorOutput "✓ Redfish API is accessible" -Color $Colors.Success
            Write-ColorOutput "  Redfish Version: $($response.RedfishVersion)" -Color $Colors.Info
        } catch {
            Write-ColorOutput "✗ Redfish API test failed: $($_.Exception.Message)" -Color $Colors.Error
        }
        
    } catch {
        Write-ColorOutput "✗ Connection test failed: $_" -Color $Colors.Error
    }
    
    Write-ColorOutput "`nNote: Full authentication testing requires credentials and is done by the Job Executor." -Color $Colors.Info
    
    Wait-KeyPress
}

function Start-FullDiagnostics {
    Write-Header "Full Diagnostics"
    
    Write-ColorOutput "Running comprehensive diagnostics...`n" -Color $Colors.Info
    Start-Sleep -Seconds 1
    
    # System checks
    Write-ColorOutput "═══ System Checks ═══" -Color $Colors.Highlight
    
    $isAdmin = Confirm-AdminPrivileges
    Write-ColorOutput "  Admin Rights:     $(if($isAdmin){'Yes'}else{'No'})" -Color $(if($isAdmin){$Colors.Success}else{$Colors.Warning})
    
    $hasPython = Test-PythonInstalled
    Write-ColorOutput "  Python:           $(if($hasPython){'Installed'}else{'NOT FOUND'})" -Color $(if($hasPython){$Colors.Success}else{$Colors.Error})
    
    if ($hasPython) {
        $pythonVersion = & python --version 2>&1
        Write-ColorOutput "                    $pythonVersion" -Color $Colors.Info
    }
    
    $hasScript = Test-Path $ExecutorScript
    Write-ColorOutput "  Executor Script:  $(if($hasScript){'Found'}else{'NOT FOUND'})" -Color $(if($hasScript){$Colors.Success}else{$Colors.Error})
    
    # Service status
    Write-ColorOutput "`n═══ Service Status ═══" -Color $Colors.Highlight
    $status = Get-ExecutorStatus
    Write-ColorOutput "  Installed:        $(if($status.Installed){'Yes'}else{'No'})" -Color $(if($status.Installed){$Colors.Success}else{$Colors.Warning})
    if ($status.Installed) {
        Write-ColorOutput "  Running:          $(if($status.Running){'Yes'}else{'No'})" -Color $(if($status.Running){$Colors.Success}else{$Colors.Warning})
        Write-ColorOutput "  State:            $($status.Status)" -Color $Colors.Info
    }
    
    # Configuration
    Write-ColorOutput "`n═══ Configuration ═══" -Color $Colors.Highlight
    $configExists = Test-Path $ConfigFile
    Write-ColorOutput "  Config File:      $(if($configExists){'Found'}else{'NOT FOUND'})" -Color $(if($configExists){$Colors.Success}else{$Colors.Error})
    
    if ($configExists) {
        $config = Load-ExecutorConfig
        $hasServiceKey = -not [string]::IsNullOrEmpty($config.service_role_key)
        Write-ColorOutput "  Service Key:      $(if($hasServiceKey){'Configured'}else{'NOT CONFIGURED'})" -Color $(if($hasServiceKey){$Colors.Success}else{$Colors.Error})
        Write-ColorOutput "  DSM URL:          $($config.dsm_url)" -Color $Colors.Info
        
        $hasVcenter = -not [string]::IsNullOrEmpty($config.vcenter_host)
        Write-ColorOutput "  vCenter:          $(if($hasVcenter){'Configured'}else{'Not Configured'})" -Color $(if($hasVcenter){$Colors.Success}else{$Colors.Info})
    }
    
    # Logs
    Write-ColorOutput "`n═══ Logs ═══" -Color $Colors.Highlight
    $logDirExists = Test-Path $LogDir
    Write-ColorOutput "  Log Directory:    $(if($logDirExists){'Found'}else{'NOT FOUND'})" -Color $(if($logDirExists){$Colors.Success}else{$Colors.Warning})
    
    if ($logDirExists) {
        $logFiles = Get-ChildItem -Path $LogDir -Filter "*.log" -ErrorAction SilentlyContinue
        $logCount = if ($logFiles) { $logFiles.Count } else { 0 }
        Write-ColorOutput "  Log Files:        $logCount" -Color $Colors.Info
        
        if ($logCount -gt 0) {
            $latestLog = $logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            Write-ColorOutput "  Latest Log:       $($latestLog.Name)" -Color $Colors.Info
            Write-ColorOutput "                    $($latestLog.LastWriteTime)" -Color $Colors.Info
            
            # Check for recent errors
            $recentErrors = Get-Content $latestLog.FullName -Tail 100 | Select-String -Pattern "ERROR|CRITICAL" -AllMatches
            $errorCount = if ($recentErrors) { $recentErrors.Matches.Count } else { 0 }
            Write-ColorOutput "  Recent Errors:    $errorCount (in last 100 lines)" -Color $(if($errorCount -gt 0){$Colors.Warning}else{$Colors.Success})
        }
    }
    
    # Network connectivity
    Write-ColorOutput "`n═══ Network Connectivity ═══" -Color $Colors.Highlight
    if ($configExists -and $config.dsm_url) {
        try {
            $uri = [System.Uri]$config.dsm_url
            Write-ColorOutput "  Testing $($uri.Host):$($uri.Port)..." -Color $Colors.Info
            $tcpTest = Test-NetConnection -ComputerName $uri.Host -Port $uri.Port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
            Write-ColorOutput "  DSM Reachable:    $(if($tcpTest.TcpTestSucceeded){'Yes'}else{'No'})" -Color $(if($tcpTest.TcpTestSucceeded){$Colors.Success}else{$Colors.Error})
        } catch {
            Write-ColorOutput "  DSM Reachable:    Error testing" -Color $Colors.Warning
        }
    }
    
    Write-ColorOutput "`n═══ Diagnostic Summary ═══" -Color $Colors.Highlight
    
    $issues = @()
    if (-not $hasPython) { $issues += "Python not installed" }
    if (-not $hasScript) { $issues += "Executor script not found" }
    if (-not $configExists) { $issues += "Configuration not found" }
    if ($configExists -and -not $hasServiceKey) { $issues += "Service key not configured" }
    if (-not $status.Installed) { $issues += "Service not installed" }
    if ($status.Installed -and -not $status.Running) { $issues += "Service not running" }
    
    if ($issues.Count -eq 0) {
        Write-ColorOutput "  ✓ No issues detected!" -Color $Colors.Success
        Write-ColorOutput "  The Job Executor appears to be configured correctly." -Color $Colors.Success
    } else {
        Write-ColorOutput "  ⚠ Issues detected:" -Color $Colors.Warning
        $issues | ForEach-Object {
            Write-ColorOutput "    - $_" -Color $Colors.Warning
        }
    }
    
    Wait-KeyPress
}

function Export-DiagnosticReport {
    Write-Header "Generate Diagnostic Report"
    
    Write-ColorOutput "Generating diagnostic report...`n" -Color $Colors.Info
    
    $reportPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "executor-diagnostics-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
    
    $report = @"
Dell Server Manager - Job Executor Diagnostic Report
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Computer: $env:COMPUTERNAME
User: $env:USERNAME

═══════════════════════════════════════════════════════════════

SYSTEM INFORMATION
═══════════════════════════════════════════════════════════════
Operating System: $([System.Environment]::OSVersion.VersionString)
PowerShell Version: $($PSVersionTable.PSVersion)
Admin Rights: $(Confirm-AdminPrivileges)
Python Installed: $(Test-PythonInstalled)
Python Version: $(& python --version 2>&1)

═══════════════════════════════════════════════════════════════
SERVICE STATUS
═══════════════════════════════════════════════════════════════
"@

    $status = Get-ExecutorStatus
    $report += @"

Installed: $($status.Installed)
Running: $($status.Running)
State: $($status.Status)
Last Run: $($status.LastRunTime)
Last Result: $($status.LastResult)

═══════════════════════════════════════════════════════════════
CONFIGURATION
═══════════════════════════════════════════════════════════════
"@

    if (Test-Path $ConfigFile) {
        $config = Load-ExecutorConfig
        $report += @"

Config File: $ConfigFile
DSM URL: $($config.dsm_url)
Service Key: $(if($config.service_role_key){'[CONFIGURED]'}else{'[NOT SET]'})
Poll Interval: $($config.poll_interval)s
Log Level: $($config.log_level)
Max Concurrent Jobs: $($config.max_concurrent_jobs)

vCenter Host: $($config.vcenter_host)
vCenter Port: $($config.vcenter_port)
vCenter User: $($config.vcenter_user)
vCenter Password: $(if($config.vcenter_password){'[CONFIGURED]'}else{'[NOT SET]'})
vCenter Verify SSL: $($config.vcenter_verify_ssl)

iDRAC User: $($config.idrac_user)
iDRAC Password: $(if($config.idrac_password){'[CONFIGURED]'}else{'[NOT SET]'})

Firmware Repo: $($config.firmware_repo_url)
"@
    } else {
        $report += "`nConfiguration file not found"
    }

    $report += @"


═══════════════════════════════════════════════════════════════
LOG FILES
═══════════════════════════════════════════════════════════════
"@

    if (Test-Path $LogDir) {
        $logFiles = Get-ChildItem -Path $LogDir -Filter "*.log" -ErrorAction SilentlyContinue
        $report += "`nLog Directory: $LogDir"
        $report += "`nLog Files: $($logFiles.Count)"
        
        if ($logFiles.Count -gt 0) {
            $latestLog = $logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            $report += "`n`nLatest Log: $($latestLog.Name)"
            $report += "`nLast Modified: $($latestLog.LastWriteTime)"
            $report += "`nSize: $("{0:N2} KB" -f ($latestLog.Length / 1KB))"
            
            $report += "`n`nLast 50 Lines:`n"
            $report += Get-Content $latestLog.FullName -Tail 50 | Out-String
        }
    } else {
        $report += "`nLog directory not found"
    }

    $report += @"


═══════════════════════════════════════════════════════════════
END OF REPORT
═══════════════════════════════════════════════════════════════
"@

    try {
        $report | Set-Content $reportPath -Force
        Write-ColorOutput "✓ Diagnostic report saved to:" -Color $Colors.Success
        Write-ColorOutput "  $reportPath" -Color $Colors.Info
        
        $open = Read-SecureInput "`nOpen report now? (yes/no)" "yes"
        if ($open -eq "yes") {
            Start-Process notepad.exe -ArgumentList $reportPath
        }
    } catch {
        Write-ColorOutput "Error generating report: $_" -Color $Colors.Error
    }
    
    Wait-KeyPress
}

#endregion

#region Menu Functions

function Show-ServiceMenu {
    while ($true) {
        Write-Header "Service Management"
        
        $status = Get-ExecutorStatus
        
        Write-ColorOutput "Current Status: " -Color $Colors.Info -NoNewLine
        Write-ColorOutput $status.Status -Color $(if($status.Running){$Colors.Success}else{$Colors.Warning})
        
        Write-Host "`nService Management:"
        Write-Host "  1. Check Status"
        Write-Host "  2. Start Service"
        Write-Host "  3. Stop Service"
        Write-Host "  4. Restart Service"
        Write-Host "  5. Install Service"
        Write-Host "  6. Uninstall Service"
        Write-Host ""
        Write-Host "  0. Back to Main Menu"
        Write-Host ""
        
        $choice = Read-SecureInput "Select option" "0"
        
        switch ($choice) {
            "1" { Show-ServiceStatus }
            "2" { Start-ExecutorService }
            "3" { Stop-ExecutorService }
            "4" { Restart-ExecutorService }
            "5" { Install-ExecutorService }
            "6" { Uninstall-ExecutorService }
            "0" { return }
            default { 
                Write-ColorOutput "Invalid option" -Color $Colors.Error
                Start-Sleep -Seconds 1
            }
        }
    }
}

function Show-ConfigMenu {
    while ($true) {
        Write-Header "Configuration Management"
        
        Write-Host "Configuration Options:"
        Write-Host "  1. View Current Configuration"
        Write-Host "  2. Edit Configuration"
        Write-Host "  3. Quick Setup Wizard"
        Write-Host "  4. Export Configuration"
        Write-Host "  5. Import Configuration"
        Write-Host ""
        Write-Host "  0. Back to Main Menu"
        Write-Host ""
        
        $choice = Read-SecureInput "Select option" "0"
        
        switch ($choice) {
            "1" { Show-CurrentConfig }
            "2" { Edit-Configuration }
            "3" { Start-QuickSetup }
            "4" { Export-Configuration }
            "5" { Import-Configuration }
            "0" { return }
            default { 
                Write-ColorOutput "Invalid option" -Color $Colors.Error
                Start-Sleep -Seconds 1
            }
        }
    }
}

function Show-MonitoringMenu {
    while ($true) {
        Write-Header "Monitoring & Logs"
        
        Write-Host "Monitoring Options:"
        Write-Host "  1. View Live Logs"
        Write-Host "  2. View Historical Logs"
        Write-Host "  3. Log Statistics"
        Write-Host "  4. Clear Old Logs"
        Write-Host ""
        Write-Host "  0. Back to Main Menu"
        Write-Host ""
        
        $choice = Read-SecureInput "Select option" "0"
        
        switch ($choice) {
            "1" { Show-LiveLogs }
            "2" { Show-HistoricalLogs }
            "3" { Show-LogStatistics }
            "4" { Clear-OldLogs }
            "0" { return }
            default { 
                Write-ColorOutput "Invalid option" -Color $Colors.Error
                Start-Sleep -Seconds 1
            }
        }
    }
}

function Show-DiagnosticsMenu {
    while ($true) {
        Write-Header "Diagnostics & Testing"
        
        Write-Host "Diagnostic Options:"
        Write-Host "  1. Test DSM Connection"
        Write-Host "  2. Test vCenter Connection"
        Write-Host "  3. Test iDRAC Connection"
        Write-Host "  4. Run Full Diagnostics"
        Write-Host "  5. Generate Support Report"
        Write-Host ""
        Write-Host "  0. Back to Main Menu"
        Write-Host ""
        
        $choice = Read-SecureInput "Select option" "0"
        
        switch ($choice) {
            "1" { Test-DSMConnectivity }
            "2" { Test-VCenterConnection }
            "3" { Test-IdracConnection }
            "4" { Start-FullDiagnostics }
            "5" { Export-DiagnosticReport }
            "0" { return }
            default { 
                Write-ColorOutput "Invalid option" -Color $Colors.Error
                Start-Sleep -Seconds 1
            }
        }
    }
}

function Show-MainMenu {
    while ($true) {
        Write-Header
        
        $status = Get-ExecutorStatus
        Write-ColorOutput "Service Status: " -Color $Colors.Info -NoNewLine
        Write-ColorOutput $status.Status -Color $(if($status.Running){$Colors.Success}else{$Colors.Warning})
        
        Write-Host "`nMain Menu:"
        Write-Host "  1. Service Management"
        Write-Host "  2. Configuration"
        Write-Host "  3. Monitoring & Logs"
        Write-Host "  4. Diagnostics & Testing"
        Write-Host ""
        Write-Host "  5. Exit"
        Write-Host ""
        
        $choice = Read-SecureInput "Select option" "1"
        
        switch ($choice) {
            "1" { Show-ServiceMenu }
            "2" { Show-ConfigMenu }
            "3" { Show-MonitoringMenu }
            "4" { Show-DiagnosticsMenu }
            "5" { 
                Write-ColorOutput "`nGoodbye!" -Color $Colors.Success
                return 
            }
            default { 
                Write-ColorOutput "Invalid option" -Color $Colors.Error
                Start-Sleep -Seconds 1
            }
        }
    }
}

#endregion

# Main execution
try {
    Initialize-ConfigDirectory
    Show-MainMenu
} catch {
    Write-ColorOutput "Fatal error: $_" -Color $Colors.Error
    Write-ColorOutput $_.ScriptStackTrace -Color $Colors.Error
    Wait-KeyPress
    exit 1
}
