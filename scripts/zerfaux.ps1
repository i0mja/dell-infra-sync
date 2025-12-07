<#
.SYNOPSIS
  ZFS-based VMware DR helper:
  - Option 1: "Protect" a VM by moving its disks to a ZFS-backed NFS datastore that gets replicated.
  - Option 2: Build a DR VM shell on a destination vCenter using the source VM's config and existing replicated VMDKs, with optional test boot.
  - Option 3: Flip DR back to PROD by reattaching updated VMDKs (from DR) to the original PROD VM.
#>

$ErrorActionPreference = 'Stop'

Write-Host "Enter credentials for vCenter (will be used for all connections in this session)..." -ForegroundColor Cyan
$Global:CommonVcCredential = Get-Credential -Message "vCenter credentials (same account used on all vCenters)"

# ==========================
#  GENERIC CHOICE HELPER
# ==========================

function Choose-ByNumber {
    param(
        [Parameter(Mandatory=$true)] [array]$Items,
        [Parameter(Mandatory=$true)] [string]$ItemType,
        [string]$Prompt = "Select item by number"
    )

    if (-not $Items -or $Items.Count -eq 0) {
        throw "No $ItemType objects available to select."
    }

    $indexed = @()
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $obj = $Items[$i]
        $indexed += [PSCustomObject]@{
            Index  = $i
            Name   = $obj.Name
            Object = $obj
        }
    }

    while ($true) {
        $indexed | Select-Object Index, Name | Format-Table | Out-Host
        $input = Read-Host "$Prompt (0-$($Items.Count-1), or 'q' to cancel)"
        if ($input -eq 'q') {
            throw "Selection of $ItemType cancelled by user."
        }

        [int]$idx = -1
        if ([int]::TryParse($input, [ref]$idx)) {
            if ($idx -ge 0 -and $idx -lt $Items.Count) {
                $choice = $indexed | Where-Object Index -eq $idx
                Write-Host ("Selected {0}: {1}" -f $ItemType, $choice.Name) -ForegroundColor Green
                return $choice.Object
            }
        }

        Write-Host "Invalid selection. Please enter a number between 0 and $($Items.Count-1)." -ForegroundColor Yellow
    }
}

# ==========================
#  HELPER FUNCTIONS
# ==========================

function Connect-VC {
    param(
        [string]$Prompt
    )
    Write-Host "==== $Prompt ====" -ForegroundColor Cyan
    $server = Read-Host "Enter vCenter FQDN or IP"
    if (-not $server) { throw "vCenter server is required." }

    if (-not $Global:CommonVcCredential) {
        throw "Common vCenter credential not set."
    }

    $session = Connect-VIServer -Server $server -Credential $Global:CommonVcCredential
    return $session
}

function Select-Datacenter {
    param(
        $Server
    )

    $dcs = Get-Datacenter -Server $Server | Sort-Object Name
    if (-not $dcs) { throw "No datacenters found on $($Server.Name)." }

    Write-Host "`nAvailable datacenters on $($Server.Name):" -ForegroundColor Cyan
    $dc = Choose-ByNumber -Items $dcs -ItemType "datacenter"
    return $dc
}

function Select-Cluster {
    param(
        [Parameter(Mandatory = $true)]
        $Datacenter
    )

    $clusters = Get-Cluster -Location $Datacenter | Sort-Object Name
    if (-not $clusters) { throw "No clusters found in datacenter '$($Datacenter.Name)'." }

    Write-Host "`nClusters in datacenter '$($Datacenter.Name)':" -ForegroundColor Cyan
    $cluster = Choose-ByNumber -Items $clusters -ItemType "cluster"
    return $cluster
}

function Select-VMFromCluster {
    param(
        $Cluster
    )
    $vms = Get-VM -Location $Cluster | Sort-Object Name
    if (-not $vms) { throw "No VMs found in cluster '$($Cluster.Name)'." }

    Write-Host "`nVMs in cluster '$($Cluster.Name)':" -ForegroundColor Cyan

    $filter = Read-Host "Optional: filter VMs by substring (name contains, or press Enter to show all)"
    if ($filter) {
        $vms = $vms | Where-Object { $_.Name -like "*$filter*" }
        if (-not $vms) {
            throw "No VMs match filter '$filter' in cluster '$($Cluster.Name)'."
        }
    }

    $vm = Choose-ByNumber -Items $vms -ItemType "VM"
    return $vm
}

function Select-Datastore {
    param(
        $Cluster
    )

    $allDS = Get-Datastore -RelatedObject $Cluster |
             Where-Object { $_.Type -like "NFS*" } |
             Sort-Object Name

    if (-not $allDS) { throw "No NFS datastores visible from cluster '$($Cluster.Name)'." }

    while ($true) {
        $display = $allDS | Select-Object Name, Type, @{
            Name       = 'RemoteHost'
            Expression = {
                if ($_.ExtensionData.Info -and $_.ExtensionData.Info.Nas) {
                    $_.ExtensionData.Info.Nas.RemoteHost
                } else { '' }
            }
        }, @{
            Name       = 'RemotePath'
            Expression = {
                if ($_.ExtensionData.Info -and $_.ExtensionData.Info.Nas) {
                    $_.ExtensionData.Info.Nas.RemotePath
                } else { '' }
            }
        }, FreeSpaceGB, CapacityGB

        Write-Host ""
        Write-Host "NFS datastores for cluster '$($Cluster.Name)':" -ForegroundColor Cyan
        $display | Format-Table | Out-Host

        $filter = Read-Host "Optional: filter by datastore name or NFS server (substring), or press Enter to show all"
        $list = if ($filter) {
            $allDS | Where-Object {
                $_.Name -like "*$filter*" -or
                ($_.ExtensionData.Info -and $_.ExtensionData.Info.Nas -and $_.ExtensionData.Info.Nas.RemoteHost -like "*$filter*")
            }
        } else {
            $allDS
        }

        if (-not $list) {
            Write-Host "No datastores match that filter. Try again." -ForegroundColor Yellow
            continue
        }

        Write-Host ""
        Write-Host "Filtered NFS datastores:" -ForegroundColor Cyan
        $list | Select-Object Name, Type, @{
            Name       = 'RemoteHost'
            Expression = {
                if ($_.ExtensionData.Info -and $_.ExtensionData.Info.Nas) {
                    $_.ExtensionData.Info.Nas.RemoteHost
                } else { '' }
            }
        }, @{
            Name       = 'RemotePath'
            Expression = {
                if ($_.ExtensionData.Info -and $_.ExtensionData.Info.Nas) {
                    $_.ExtensionData.Info.Nas.RemotePath
                } else { '' }
            }
        }, FreeSpaceGB, CapacityGB | Format-Table | Out-Host

        $ds = Choose-ByNumber -Items $list -ItemType "datastore" -Prompt "Select datastore by number"
        return $ds
    }
}

function Select-Network {
    param(
        $Cluster
    )
    $esxHost = Get-VMHost -Location $Cluster | Select-Object -First 1
    $nets = @()
    if ($esxHost) {
        $nets = Get-VirtualPortGroup -Distributed -VMHost $esxHost -ErrorAction SilentlyContinue
        if (-not $nets) {
            $nets = Get-VirtualPortGroup -VMHost $esxHost -ErrorAction SilentlyContinue
        }
    }
    if (-not $nets) {
        Write-Warning "No networks found for cluster '$($Cluster.Name)'. VM will be created without a NIC."
        return $null
    }

    Write-Host "`nNetworks on cluster '$($Cluster.Name)':" -ForegroundColor Cyan

    $filter = Read-Host "Optional: filter networks by substring (name contains, or press Enter to show all)"
    if ($filter) {
        $nets = $nets | Where-Object { $_.Name -like "*$filter*" }
        if (-not $nets) {
            Write-Warning "No networks match filter '$filter'. VM will be created without a NIC."
            return $null
        }
    }

    $net = Choose-ByNumber -Items $nets -ItemType "network" -Prompt "Select network by number"
    return $net
}

function Protect-VM {
    param(
        $SourceServer
    )

    Write-Host "=== PROTECT VM ON SOURCE VCENTER: MOVE DISKS TO ZFS NFS DATASTORE ===" -ForegroundColor Green
    $srcDC      = Select-Datacenter -Server $SourceServer
    $srcCluster = Select-Cluster -Datacenter $srcDC
    $vm         = Select-VMFromCluster -Cluster $srcCluster

    Write-Host "Select the datastore that is exported by ZFS (NFS) on this site (SOURCE/PROTECTION):" -ForegroundColor Cyan
    $protectDS  = Select-Datastore -Cluster $srcCluster

    Write-Host "Selected VM: $($vm.Name)" -ForegroundColor Yellow
    Write-Host "Target datastore (protection): $($protectDS.Name)" -ForegroundColor Yellow

    $confirm = Read-Host "Storage vMotion '$($vm.Name)' to datastore '$($protectDS.Name)'? (yes/no)"
    if ($confirm -ne 'yes') {
        Write-Host "Aborted by user." -ForegroundColor Red
        return
    }

    Write-Host "Moving VM storage, this may take a while..." -ForegroundColor Cyan
    Move-VM -VM $vm -Datastore $protectDS -Confirm:$false
    Write-Host "VM '$($vm.Name)' now resides on datastore '$($protectDS.Name)'." -ForegroundColor Green
}

function Test-BootVm {
    param(
        $VM
    )

    Write-Host "`n=== TEST BOOT: $($VM.Name) ===" -ForegroundColor Green
    if ($VM.PowerState -ne 'PoweredOff') {
        Write-Host "VM is not powered off. Powering off first..." -ForegroundColor Yellow
        Stop-VM -VM $VM -Confirm:$false | Out-Null
    }

    Write-Host "Powering on VM..." -ForegroundColor Cyan
    Start-VM -VM $VM -Confirm:$false | Out-Null

    $timeoutSec = 600  # 10 minutes
    $interval   = 15
    $elapsed    = 0
    $toolsOk    = $false

    Write-Host "Waiting for VMware Tools to report OK/OLD (up to $timeoutSec seconds)..." -ForegroundColor Cyan
    while ($elapsed -lt $timeoutSec) {
        $vmRef = Get-VM -Id $VM.Id
        $status = $vmRef.ExtensionData.Guest.ToolsStatus
        Write-Host "  Tools status: $status (t+${elapsed}s)"
        if ($status -eq 'toolsOk' -or $status -eq 'toolsOld') {
            $toolsOk = $true
            break
        }
        Start-Sleep -Seconds $interval
        $elapsed += $interval
    }

    if ($toolsOk) {
        Write-Host "VMware Tools is running. Attempting graceful guest shutdown..." -ForegroundColor Green
        try {
            Stop-VMGuest -VM $VM -Confirm:$false -ErrorAction Stop | Out-Null
            $wait = 300
            $elapsed = 0
            while ($elapsed -lt $wait) {
                $vmRef = Get-VM -Id $VM.Id
                if ($vmRef.PowerState -eq 'PoweredOff') {
                    Write-Host "VM powered off cleanly after test boot." -ForegroundColor Green
                    return
                }
                Start-Sleep -Seconds 10
                $elapsed += 10
            }
            Write-Warning "Guest did not power off in time; powering off VM forcefully."
            Stop-VM -VM $VM -Confirm:$false | Out-Null
        } catch {
            Write-Warning "Failed to stop guest cleanly: $($_.Exception.Message). Powering off VM."
            Stop-VM -VM $VM -Confirm:$false | Out-Null
        }
    } else {
        Write-Warning "VMware Tools never reached OK/OLD within timeout. Leaving VM powered on for manual inspection."
    }
}

function Set-DrVmFirmwareIfSupported {
    param(
        $VM,
        [string]$Firmware  # "bios" or "efi"
    )

    $setVmCmd = Get-Command Set-VM -ErrorAction SilentlyContinue
    if ($setVmCmd -and $setVmCmd.Parameters.ContainsKey('Firmware')) {
        Write-Host "Setting firmware on DR VM to '$Firmware' via Set-VM..." -ForegroundColor Cyan
        Set-VM -VM $VM -Firmware $Firmware -Confirm:$false | Out-Null
    } else {
        Write-Warning "Set-VM -Firmware is not supported. Ensure DR VM firmware matches source manually if needed."
    }
}

function Set-ScsiTypeIfSupported {
    param(
        $VM,
        [string]$DesiredType,
        [string]$Context
    )

    $scsi = Get-ScsiController -VM $VM | Select-Object -First 1
    if (-not $scsi) {
        Write-Warning "No SCSI controller found on $Context VM '$($VM.Name)'."
        return $null
    }

    $setScsiCmd = Get-Command Set-ScsiController -ErrorAction SilentlyContinue
    if ($setScsiCmd -and $setScsiCmd.Parameters.ContainsKey('Type')) {
        try {
            Write-Host "Setting SCSI controller type on $Context VM '$($VM.Name)' to '$DesiredType'..." -ForegroundColor Cyan
            Set-ScsiController -ScsiController $scsi -Type $DesiredType -Confirm:$false | Out-Null
            return (Get-ScsiController -VM $VM | Select-Object -First 1)
        } catch {
            Write-Warning "Failed to set SCSI type on $Context VM '$($VM.Name)': $($_.Exception.Message)"
            return $scsi
        }
    } else {
        Write-Warning "Set-ScsiController -Type is not supported in this environment. Leaving SCSI controller type as-is on $Context VM '$($VM.Name)'."
        return $scsi
    }
}

function Resolve-DrBaseFolder {
    param(
        $Datastore,
        [string]$SrcVMName
    )

    try {
        $driveName = "ds_" + ($Datastore.Name -replace '[^A-Za-z0-9]', '')
        if (-not (Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue)) {
            New-PSDrive -Name $driveName -PSProvider VimDatastore -Root "\" -Datastore $Datastore | Out-Null
        }

        $rootPath = "${driveName}:\"
        $folders = Get-ChildItem -Path $rootPath -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer }
        if (-not $folders) { return $null }

        # Exact match first
        $exact = $folders | Where-Object { $_.Name -eq $SrcVMName }
        if ($exact) {
            Write-Host "Detected DR folder exactly matching source VM name: '$($exact[0].Name)'" -ForegroundColor Green
            return $exact[0].Name
        }

        # Try prefix based on first 1–2 dash-separated segments (e.g. S06-NORDIC)
        $segments = $SrcVMName -split '-'
        $prefix = if ($segments.Count -ge 2) { ($segments[0..1] -join '-') } else { $SrcVMName }

        $cand = $folders | Where-Object { $_.Name -like "$prefix*" }
        if ($cand.Count -eq 1) {
            Write-Host "Detected single DR folder matching prefix '$prefix': '$($cand[0].Name)'" -ForegroundColor Green
            return $cand[0].Name
        } elseif ($cand.Count -gt 1) {
            Write-Host "`nDetected multiple DR folders matching prefix '$prefix' on datastore '$($Datastore.Name)':" -ForegroundColor Cyan
            $choice = Choose-ByNumber -Items $cand -ItemType "DR folder" -Prompt "Select DR folder by number (or 'q' to cancel auto-detect)"
            return $choice.Name
        }

        return $null
    } catch {
        Write-Warning "Auto-detect of DR folder failed on datastore '$($Datastore.Name)': $($_.Exception.Message)"
        return $null
    }
}

function Build-DrVm {
    param(
        $SourceServer,
        $DestServer
    )

    Write-Host "=== BUILD DR VM SHELL ON DEST VCENTER ===" -ForegroundColor Green

    # --- Source selection ---
    Write-Host "`nSelect SOURCE objects (original VM):" -ForegroundColor Cyan
    $srcDC      = Select-Datacenter -Server $SourceServer
    $srcCluster = Select-Cluster -Datacenter $srcDC
    $srcVM      = Select-VMFromCluster -Cluster $srcCluster

    # Collect source properties
    $srcVMView   = $srcVM.ExtensionData
    $srcScsiCtrl = Get-ScsiController -VM $srcVM | Select-Object -First 1
    $srcScsiType = if ($srcScsiCtrl) { $srcScsiCtrl.Type } else { $null }
    $scsiTypeForDr = if ($srcScsiType) { $srcScsiType } else { "VirtualLsiLogicSAS" }

    $srcFirmware = $srcVMView.Config.Firmware  # "bios" or "efi"
    $srcGuestId  = $srcVM.GuestId

    Write-Host "`nSource VM: $($srcVM.Name)"
    Write-Host "  CPUs: $($srcVM.NumCpu)"
    Write-Host "  MemoryGB: $([int]$srcVM.MemoryGB)"
    Write-Host "  GuestId: $srcGuestId"
    Write-Host "  Firmware: $srcFirmware"
    Write-Host "  SCSI Controller Type (source): $srcScsiType"
    Write-Host "  SCSI Controller Type (DR target): $scsiTypeForDr"

    $srcDisks = Get-HardDisk -VM $srcVM
    if (-not $srcDisks) { throw "Source VM has no hard disks? Aborting." }

    Write-Host "`nSource VM disks:" -ForegroundColor Cyan
    $srcDisks | Select-Object Name, CapacityGB, Filename | Format-Table | Out-Host

    # --- Destination selection ---
    Write-Host "`nSelect DESTINATION objects (DR shell):" -ForegroundColor Cyan
    $dstDC      = Select-Datacenter -Server $DestServer
    $dstCluster = Select-Cluster -Datacenter $dstDC

    Write-Host "Select the DR datastore that receives the ZFS-replicated VM folder (NFS):" -ForegroundColor Cyan
    $dstDS      = Select-Datastore -Cluster $dstCluster
    $dstNet     = Select-Network  -Cluster $dstCluster

    $defaultDrName = "$($srcVM.Name)-DR"
    $drName = Read-Host "Enter DR VM name (default: $defaultDrName)"
    if (-not $drName) { $drName = $defaultDrName }

    # Try to auto-detect DR folder
    $autoBase = Resolve-DrBaseFolder -Datastore $dstDS -SrcVMName $srcVM.Name
    $baseOverride = $null
    if ($autoBase) {
        $answer = Read-Host "Use detected DR folder '$autoBase' for VMDKs? (yes/no, default yes)"
        if (-not $answer -or $answer -eq 'yes') {
            $baseOverride = $autoBase
        }
    }

    if (-not $baseOverride) {
        Write-Host "`nIf the DR folder name differs from source (e.g. 'S06-NORDIC-VRP' instead of '$($srcVM.Name)'), you can set it here." -ForegroundColor Cyan
        $baseOverride = Read-Host "Optional: base folder override on DR datastore (press Enter to keep original folder layout)"
        if (-not $baseOverride) {
            $baseOverride = $null
        }
    }

    Write-Host "`nCreating DR VM shell '$drName' on '$($DestServer.Name)'..." -ForegroundColor Cyan
    $rp = Get-Cluster -Id $dstCluster.Id | Get-ResourcePool | Where-Object { $_.Name -eq 'Resources' } | Select-Object -First 1
    if (-not $rp) {
        $rp = Get-Cluster -Id $dstCluster.Id | Get-ResourcePool | Select-Object -First 1
    }

    $drVM = New-VM -Name $drName `
        -ResourcePool $rp `
        -Datastore $dstDS `
        -NumCPU $srcVM.NumCpu `
        -MemoryGB $srcVM.MemoryGB `
        -DiskGB 1 `
        -GuestId $srcGuestId `
        -Server $DestServer `
        -Confirm:$false

    # Try to set firmware if supported
    if ($srcFirmware -eq 'efi') {
        Set-DrVmFirmwareIfSupported -VM $drVM -Firmware 'efi'
    } else {
        Set-DrVmFirmwareIfSupported -VM $drVM -Firmware 'bios'
    }

    # Remove default disk (keep controller)
    $defaultDisks = Get-HardDisk -VM $drVM
    foreach ($dd in $defaultDisks) {
        Remove-HardDisk -HardDisk $dd -DeletePermanently:$false -Confirm:$false
    }

    # Adjust existing SCSI controller type to match source, if possible
    $drScsiCtrl = Set-ScsiTypeIfSupported -VM $drVM -DesiredType $scsiTypeForDr -Context "DR"
    if (-not $drScsiCtrl) {
        $drScsiCtrl = Get-ScsiController -VM $drVM | Select-Object -First 1
    }

    # Add NIC if network selected
    if ($dstNet) {
        New-NetworkAdapter -VM $drVM -NetworkName $dstNet.Name -StartConnected:$true -Confirm:$false | Out-Null
    }

    # Attach existing VMDKs
    Write-Host "`nAttaching existing replicated VMDKs..." -ForegroundColor Cyan

    $diskIndex = 0
    foreach ($srcDisk in $srcDisks) {
        $srcFile = $srcDisk.Filename
        $relPath = $srcFile -replace '^\[[^\]]+\]\s*',''  # strip "[DS] "

        if ($baseOverride) {
            if ($relPath -match '^[^/\\]+[/\\](.+)$') {
                $relPath = "$baseOverride/$($Matches[1])"
            } else {
                $relPath = "$baseOverride/$relPath"
            }
        }

        $destPath = "[{0}] {1}" -f $dstDS.Name, $relPath
        Write-Host "  Disk $diskIndex -> $destPath"

        if ($diskIndex -eq 0 -and $drScsiCtrl) {
            New-HardDisk -VM $drVM -DiskPath $destPath -Controller $drScsiCtrl -UnitNumber 0 -Confirm:$false | Out-Null
        } else {
            New-HardDisk -VM $drVM -DiskPath $destPath -Controller $drScsiCtrl -Confirm:$false | Out-Null
        }

        $diskIndex++
    }

    Write-Host "`nDR VM '$drName' created and disks attached." -ForegroundColor Green
    $doTestBoot = Read-Host "Run test boot now (power on, wait for VMware Tools, then shut down)? (yes/no)"
    if ($doTestBoot -eq 'yes') {
        Test-BootVm -VM $drVM
    } else {
        Write-Host "Skipping test boot. You can power on '$drName' manually." -ForegroundColor Yellow
    }
}

function Flip-DrBackToProd {
    param(
        $SourceServer,
        $DestServer
    )

    Write-Host "=== FLIP DR BACK TO PROD: REATTACH UPDATED VMDKs ===" -ForegroundColor Green
    Write-Host "`nThis will:"
    Write-Host "  - Power off the PROD VM"
    Write-Host "  - Remove its existing hard disks (without deleting VMDK files)"
    Write-Host "  - Attach the updated VMDKs (based on DR VM filenames) to the PROD VM"
    Write-Host ""

    # --- Select PROD (source) VM ---
    Write-Host "`nSelect PROD (original) VM on SOURCE vCenter:" -ForegroundColor Cyan
    $prodDC      = Select-Datacenter -Server $SourceServer
    $prodCluster = Select-Cluster -Datacenter $prodDC
    $prodVM      = Select-VMFromCluster -Cluster $prodCluster

    # --- Select DR VM ---
    Write-Host "`nSelect DR VM on DESTINATION vCenter:" -ForegroundColor Cyan
    $drDC      = Select-Datacenter -Server $DestServer
    $drCluster = Select-Cluster -Datacenter $drDC
    $drVM      = Select-VMFromCluster -Cluster $drCluster

    # Gather DR disk info
    $drDisks = Get-HardDisk -VM $drVM
    if (-not $drDisks) { throw "DR VM has no hard disks? Aborting." }

    Write-Host "`nDR VM disks:" -ForegroundColor Cyan
    $drDisks | Select-Object Name, CapacityGB, Filename | Format-Table | Out-Host

    # Determine SCSI type from DR VM
    $drScsiCtrl      = Get-ScsiController -VM $drVM | Select-Object -First 1
    $drScsiType      = if ($drScsiCtrl) { $drScsiCtrl.Type } else { $null }
    $scsiTypeForProd = if ($drScsiType) { $drScsiType } else { "VirtualLsiLogicSAS" }

    Write-Host "`nDR VM '$($drVM.Name)' SCSI controller type: $drScsiType -> will use '$scsiTypeForProd' on PROD" -ForegroundColor Yellow

    # Pick datastore on PROD side where the updated VMDKs live
    Write-Host "`nSelect the PROD datastore where the updated VMDKs (ZFS replicated back) reside (NFS):" -ForegroundColor Cyan
    $prodDS = Select-Datastore -Cluster $prodCluster

    Write-Host "`nThe script assumes the ZFS NFS datastore on PROD has the SAME folder/filenames as DR."
    Write-Host "Example: if DR disk is '[DRDS] VMs/MyVM/MyVM.vmdk', PROD disk will be '[${($prodDS.Name)}] VMs/MyVM/MyVM.vmdk'."
    $baseOverride = Read-Host "Optional: base folder override on PROD datastore (e.g. 'Prod-VMs' or press Enter to keep same path)"

    Write-Host "`nPROD VM: $($prodVM.Name)" -ForegroundColor Yellow
    Write-Host "DR VM (source of updated disks): $($drVM.Name)" -ForegroundColor Yellow
    $confirm = Read-Host "Proceed with flip-back (this will POWER OFF '$($prodVM.Name)' and reattach disks)? (yes/no)"
    if ($confirm -ne 'yes') {
        Write-Host "Aborted by user." -ForegroundColor Red
        return
    }

    # Power off PROD VM
    if ($prodVM.PowerState -ne 'PoweredOff') {
        Write-Host "Powering off PROD VM '$($prodVM.Name)'..." -ForegroundColor Cyan
        Stop-VM -VM $prodVM -Confirm:$false | Out-Null
    }

    # Remove existing disks from PROD VM (keep files)
    $oldProdDisks = Get-HardDisk -VM $prodVM
    foreach ($d in $oldProdDisks) {
        Write-Host "Removing old PROD disk: $($d.Filename)" -ForegroundColor Yellow
        Remove-HardDisk -HardDisk $d -DeletePermanently:$false -Confirm:$false
    }

    # Adjust existing PROD SCSI controller type to match DR, if possible
    $prodScsiCtrl = Set-ScsiTypeIfSupported -VM $prodVM -DesiredType $scsiTypeForProd -Context "PROD"
    if (-not $prodScsiCtrl) {
        $prodScsiCtrl = Get-ScsiController -VM $prodVM | Select-Object -First 1
    }

    # Attach updated VMDKs (based on DR filenames)
    Write-Host "`nAttaching updated VMDKs to PROD VM..." -ForegroundColor Cyan
    $diskIndex = 0
    foreach ($drDisk in $drDisks) {
        $drFile = $drDisk.Filename
        $relPath = $drFile -replace '^\[[^\]]+\]\s*',''

        if ($baseOverride) {
            if ($relPath -match '^[^/\\]+[/\\](.+)$') {
                $relPath = "$baseOverride/$($Matches[1])"
            } else {
                $relPath = "$baseOverride/$relPath"
            }
        }

        $prodPath = "[{0}] {1}" -f $prodDS.Name, $relPath
        Write-Host "  Disk $diskIndex -> $prodPath"

        if ($diskIndex -eq 0 -and $prodScsiCtrl) {
            New-HardDisk -VM $prodVM -DiskPath $prodPath -Controller $prodScsiCtrl -UnitNumber 0 -Confirm:$false | Out-Null
        } else {
            New-HardDisk -VM $prodVM -DiskPath $prodPath -Controller $prodScsiCtrl -Confirm:$false | Out-Null
        }

        $diskIndex++
    }

    Write-Host "`nFlip-back complete. PROD VM '$($prodVM.Name)' now points at the updated VMDKs." -ForegroundColor Green
    Write-Host "Review in vCenter, then power on when ready." -ForegroundColor Yellow
}

# ==========================
#  MAIN MENU
# ==========================

Write-Host "=== ZFS / VMware DR Helper ===" -ForegroundColor Cyan
Write-Host "1) Protect VM on SOURCE vCenter (move storage to protection datastore)"
Write-Host "2) Build DR VM shell on DESTINATION vCenter (using source config + replicated VMDKs)"
Write-Host "3) Flip DR back to PROD (reattach updated VMDKs to PROD VM)"
$choice = Read-Host "Select option (1, 2, or 3)"

switch ($choice) {
    '1' {
        $srcSession = Connect-VC -Prompt "Connect to SOURCE vCenter"
        Protect-VM -SourceServer $srcSession
    }
    '2' {
        $srcSession = Connect-VC -Prompt "Connect to SOURCE vCenter"
        $dstSession = Connect-VC -Prompt "Connect to DESTINATION vCenter (can be same as source)"
        Build-DrVm -SourceServer $srcSession -DestServer $dstSession
    }
    '3' {
        $srcSession = Connect-VC -Prompt "Connect to SOURCE (PROD) vCenter"
        $dstSession = Connect-VC -Prompt "Connect to DESTINATION (DR) vCenter"
        Flip-DrBackToProd -SourceServer $srcSession -DestServer $dstSession
    }
    default {
        Write-Host "Invalid selection. Exiting." -ForegroundColor Red
    }
}
