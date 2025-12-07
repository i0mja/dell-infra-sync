# ZFS Target Deployment - Complete Implementation Plan

**Date:** July 12, 2025  
**Status:** Planning  
**Author:** AI Assistant  

---

## Executive Summary

This document outlines the complete implementation plan for the `deploy_zfs_target` job type. The wizard UI exists but the Job Executor handler is **not implemented**. This plan covers end-to-end deployment including:

1. VM cloning from template
2. IP detection (DHCP or static)
3. SSH connection and ZFS pool creation
4. NFS share configuration
5. Automatic datastore registration in vCenter

---

## Current State Analysis

### What Exists

| Component | Status | Location |
|-----------|--------|----------|
| Job type enum | ✅ Exists | `job_type` enum in database |
| Wizard UI | ✅ Exists | `src/components/replication/DeployZfsTargetWizard.tsx` |
| Template management | ✅ Exists | `zfs_target_templates` table |
| Network selection | ✅ Exists | Added VLAN dropdown with DHCP toggle |
| Hook | ✅ Exists | `src/hooks/useZfsTemplates.ts` |

### What's Missing

| Component | Status | Required |
|-----------|--------|----------|
| Job Executor handler | ❌ Missing | `job_executor/handlers/zfs_target.py` |
| Handler registration | ❌ Missing | Entry in `job-executor.py` |
| IP wait logic | ❌ Missing | Poll VMware Tools for DHCP IP |
| ZFS automation | ❌ Missing | SSH commands for pool/NFS setup |
| Datastore registration | ❌ Missing | pyVmomi NAS datastore creation |
| Deployment tracking | ❌ Missing | Migration for tracking columns |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Deploy ZFS Target Flow                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │   Wizard UI  │───▶│  Create Job  │───▶│ Job Executor │              │
│  │  (React)     │    │  (Supabase)  │    │  (Python)    │              │
│  └──────────────┘    └──────────────┘    └──────┬───────┘              │
│                                                  │                      │
│                    ┌─────────────────────────────┼─────────────────┐   │
│                    │           Job Executor Phases                  │   │
│                    ├─────────────────────────────┼─────────────────┤   │
│                    │                             ▼                  │   │
│                    │  ┌─────────────────────────────────────────┐  │   │
│                    │  │ Phase 1: Clone Template (0-20%)         │  │   │
│                    │  │ - Connect to vCenter                    │  │   │
│                    │  │ - Clone VM from template                │  │   │
│                    │  │ - Attach ZFS disk                       │  │   │
│                    │  │ - Configure network adapter             │  │   │
│                    │  │ - Apply guest customization             │  │   │
│                    │  └─────────────────┬───────────────────────┘  │   │
│                    │                    ▼                          │   │
│                    │  ┌─────────────────────────────────────────┐  │   │
│                    │  │ Phase 2: Power On & Wait (20-40%)       │  │   │
│                    │  │ - Power on VM                           │  │   │
│                    │  │ - Poll VM Tools status                  │  │   │
│                    │  │ - If DHCP: Wait for guest.ipAddress     │  │   │
│                    │  │ - If Static: Use configured IP          │  │   │
│                    │  │ - Update job with detected IP           │  │   │
│                    │  └─────────────────┬───────────────────────┘  │   │
│                    │                    ▼                          │   │
│                    │  ┌─────────────────────────────────────────┐  │   │
│                    │  │ Phase 3: SSH Connection (40-50%)        │  │   │
│                    │  │ - Decrypt SSH key from ssh_keys table   │  │   │
│                    │  │ - Connect via paramiko                  │  │   │
│                    │  │ - Verify connectivity                   │  │   │
│                    │  └─────────────────┬───────────────────────┘  │   │
│                    │                    ▼                          │   │
│                    │  ┌─────────────────────────────────────────┐  │   │
│                    │  │ Phase 4: ZFS Configuration (50-75%)     │  │   │
│                    │  │ - Detect new disk device                │  │   │
│                    │  │ - zpool create {pool} {device}          │  │   │
│                    │  │ - zfs create {pool}/nfs                 │  │   │
│                    │  │ - zfs set sharenfs=... {pool}/nfs       │  │   │
│                    │  │ - Enable NFS service                    │  │   │
│                    │  │ - Verify pool health                    │  │   │
│                    │  └─────────────────┬───────────────────────┘  │   │
│                    │                    ▼                          │   │
│                    │  ┌─────────────────────────────────────────┐  │   │
│                    │  │ Phase 5: Register Target (75-90%)       │  │   │
│                    │  │ - Insert replication_targets record     │  │   │
│                    │  │ - Link SSH key and vCenter              │  │   │
│                    │  │ - Update template deployment count      │  │   │
│                    │  └─────────────────┬───────────────────────┘  │   │
│                    │                    ▼                          │   │
│                    │  ┌─────────────────────────────────────────┐  │   │
│                    │  │ Phase 6: Register Datastore (90-100%)   │  │   │
│                    │  │ - Connect to target vCenter             │  │   │
│                    │  │ - CreateNasDatastore() on each host     │  │   │
│                    │  │ - Verify datastore visible              │  │   │
│                    │  │ - Update job complete                   │  │   │
│                    │  └─────────────────────────────────────────┘  │   │
│                    │                                                │   │
│                    └────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Job Executor Handler

### File: `job_executor/handlers/zfs_target.py`

```python
"""
ZFS Target Deployment Handler

Handles the deploy_zfs_target job type with the following phases:
1. Clone Template - Clone VM from vCenter template
2. Power On & Wait - Start VM and wait for IP (DHCP or static)
3. SSH Connection - Connect to VM via SSH
4. ZFS Configuration - Create pool, dataset, NFS share
5. Register Target - Add to replication_targets table
6. Register Datastore - Mount NFS as vCenter datastore
"""

import time
import paramiko
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import ssl

class ZfsTargetHandler:
    """Handler for deploy_zfs_target job type."""
    
    PHASES = [
        ('clone', 'Cloning Template', 0, 20),
        ('power_on', 'Powering On VM', 20, 25),
        ('wait_tools', 'Waiting for VM Tools', 25, 35),
        ('wait_ip', 'Waiting for IP Address', 35, 40),
        ('ssh_connect', 'Establishing SSH Connection', 40, 50),
        ('zfs_create', 'Creating ZFS Pool', 50, 60),
        ('nfs_setup', 'Configuring NFS Share', 60, 75),
        ('register_target', 'Registering Replication Target', 75, 85),
        ('register_datastore', 'Registering vCenter Datastore', 85, 100),
    ]
    
    def __init__(self, db_client, logger, encryption_key):
        self.db = db_client
        self.log = logger
        self.encryption_key = encryption_key
        self.vcenter_conn = None
        self.ssh_client = None
        
    async def execute(self, job: dict) -> dict:
        """Main execution entry point."""
        details = job.get('details', {})
        job_id = job['id']
        
        try:
            # Phase 1: Clone Template
            await self._update_phase(job_id, 'clone', 0)
            vm_moref = await self._clone_template(details)
            details['cloned_vm_moref'] = vm_moref
            
            # Phase 2: Power On
            await self._update_phase(job_id, 'power_on', 20)
            await self._power_on_vm(vm_moref)
            
            # Phase 3: Wait for VM Tools
            await self._update_phase(job_id, 'wait_tools', 25)
            await self._wait_for_tools(vm_moref)
            
            # Phase 4: Wait for IP
            await self._update_phase(job_id, 'wait_ip', 35)
            detected_ip = await self._wait_for_ip(vm_moref, details)
            details['detected_ip'] = detected_ip
            
            # Phase 5: SSH Connection
            await self._update_phase(job_id, 'ssh_connect', 40)
            await self._establish_ssh(detected_ip, details)
            
            # Phase 6: ZFS Pool Creation
            await self._update_phase(job_id, 'zfs_create', 50)
            await self._create_zfs_pool(details)
            
            # Phase 7: NFS Setup
            await self._update_phase(job_id, 'nfs_setup', 60)
            await self._configure_nfs(details)
            
            # Phase 8: Register Target
            await self._update_phase(job_id, 'register_target', 75)
            target_id = await self._register_replication_target(details, job_id)
            details['replication_target_id'] = target_id
            
            # Phase 9: Register Datastore
            await self._update_phase(job_id, 'register_datastore', 85)
            datastore_name = await self._register_datastore(details)
            details['datastore_name'] = datastore_name
            
            # Complete
            await self._update_phase(job_id, 'complete', 100)
            return {'success': True, 'details': details}
            
        except Exception as e:
            details['error'] = str(e)
            details['failed_phase'] = details.get('current_phase', 'unknown')
            raise
        finally:
            self._cleanup()
    
    # --- Phase Implementations ---
    
    async def _clone_template(self, details: dict) -> str:
        """Clone VM from template with disk and network config."""
        vcenter_id = details['vcenter_id']
        template_moref = details['template_moref']
        vm_name = details['vm_name']
        zfs_disk_gb = details.get('zfs_disk_gb', 500)
        network_name = details.get('network_name')
        
        # Connect to vCenter
        vcenter = await self._get_vcenter_connection(vcenter_id)
        
        # Find template
        template = self._get_vm_by_moref(template_moref)
        if not template:
            raise Exception(f"Template not found: {template_moref}")
        
        # Build clone spec
        clone_spec = vim.vm.CloneSpec()
        clone_spec.location = vim.vm.RelocateSpec()
        clone_spec.powerOn = False
        clone_spec.template = False
        
        # Guest customization for hostname
        if details.get('hostname'):
            clone_spec.customization = self._build_customization_spec(details)
        
        # Clone the VM
        self.log.info(f"Cloning template {template.name} to {vm_name}")
        task = template.Clone(folder=template.parent, name=vm_name, spec=clone_spec)
        self._wait_for_task(task)
        
        new_vm = task.info.result
        vm_moref = new_vm._moId
        
        # Add ZFS disk
        self.log.info(f"Adding {zfs_disk_gb}GB disk for ZFS pool")
        self._add_disk(new_vm, zfs_disk_gb)
        
        # Configure network
        if network_name:
            self.log.info(f"Configuring network: {network_name}")
            self._configure_network(new_vm, network_name)
        
        return vm_moref
    
    async def _power_on_vm(self, vm_moref: str):
        """Power on the cloned VM."""
        vm = self._get_vm_by_moref(vm_moref)
        self.log.info(f"Powering on VM: {vm.name}")
        task = vm.PowerOn()
        self._wait_for_task(task)
    
    async def _wait_for_tools(self, vm_moref: str, timeout: int = 300):
        """Wait for VMware Tools to be running."""
        vm = self._get_vm_by_moref(vm_moref)
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            tools_status = vm.guest.toolsRunningStatus
            if tools_status == 'guestToolsRunning':
                self.log.info("VMware Tools running")
                return
            self.log.debug(f"Waiting for VM Tools... Status: {tools_status}")
            time.sleep(10)
        
        raise Exception(f"VM Tools not running after {timeout}s")
    
    async def _wait_for_ip(self, vm_moref: str, details: dict, timeout: int = 300) -> str:
        """Wait for VM to acquire IP address."""
        use_dhcp = details.get('use_dhcp', True)
        configured_ip = details.get('ip_address')
        
        if not use_dhcp and configured_ip:
            # Static IP - verify connectivity
            self.log.info(f"Using static IP: {configured_ip}")
            return configured_ip
        
        # DHCP - wait for IP from VMware Tools
        vm = self._get_vm_by_moref(vm_moref)
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            ip = vm.guest.ipAddress
            if ip and not ip.startswith('169.254'):  # Skip APIPA
                self.log.info(f"VM acquired IP via DHCP: {ip}")
                return ip
            self.log.debug(f"Waiting for DHCP IP... Current: {ip}")
            time.sleep(10)
        
        raise Exception(f"VM did not acquire IP via DHCP after {timeout}s")
    
    async def _establish_ssh(self, ip: str, details: dict, retries: int = 5):
        """Establish SSH connection to the VM."""
        ssh_key_id = details.get('ssh_key_id')
        ssh_username = details.get('ssh_username', 'root')
        
        # Get SSH key from database
        key_data = await self._get_ssh_key(ssh_key_id)
        private_key = self._decrypt_ssh_key(key_data['private_key_encrypted'])
        
        for attempt in range(retries):
            try:
                self.ssh_client = paramiko.SSHClient()
                self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                
                pkey = paramiko.RSAKey.from_private_key(
                    file_obj=io.StringIO(private_key)
                )
                
                self.log.info(f"SSH attempt {attempt + 1}/{retries} to {ip}")
                self.ssh_client.connect(
                    hostname=ip,
                    username=ssh_username,
                    pkey=pkey,
                    timeout=30
                )
                
                # Verify connection
                stdin, stdout, stderr = self.ssh_client.exec_command('hostname')
                hostname = stdout.read().decode().strip()
                self.log.info(f"SSH connected to: {hostname}")
                return
                
            except Exception as e:
                self.log.warning(f"SSH attempt {attempt + 1} failed: {e}")
                if attempt < retries - 1:
                    time.sleep(15)
                else:
                    raise Exception(f"SSH connection failed after {retries} attempts: {e}")
    
    async def _create_zfs_pool(self, details: dict):
        """Create ZFS pool on the new disk."""
        pool_name = details.get('zfs_pool_name', 'tank')
        
        # Detect the new disk
        self.log.info("Detecting new disk...")
        disk_device = await self._detect_new_disk()
        
        # Create pool
        cmd = f"zpool create -f {pool_name} {disk_device}"
        self.log.info(f"Creating ZFS pool: {cmd}")
        await self._ssh_exec(cmd)
        
        # Verify pool
        status = await self._ssh_exec(f"zpool status {pool_name}")
        if 'ONLINE' not in status:
            raise Exception(f"ZFS pool creation failed: {status}")
        
        self.log.info(f"ZFS pool '{pool_name}' created successfully")
    
    async def _configure_nfs(self, details: dict):
        """Configure NFS share on the ZFS dataset."""
        pool_name = details.get('zfs_pool_name', 'tank')
        nfs_network = details.get('nfs_network', '10.0.0.0/8')
        
        # Create NFS dataset
        dataset = f"{pool_name}/nfs"
        self.log.info(f"Creating NFS dataset: {dataset}")
        await self._ssh_exec(f"zfs create {dataset}")
        
        # Configure NFS sharing
        nfs_opts = f"rw,no_root_squash,async,{nfs_network}"
        self.log.info(f"Setting NFS options: {nfs_opts}")
        await self._ssh_exec(f"zfs set sharenfs='{nfs_opts}' {dataset}")
        
        # Enable and start NFS service
        self.log.info("Enabling NFS service...")
        await self._ssh_exec("systemctl enable nfs-server")
        await self._ssh_exec("systemctl start nfs-server")
        
        # Verify NFS export
        exports = await self._ssh_exec("showmount -e localhost")
        if f"/{dataset}" not in exports and f"/{pool_name}/nfs" not in exports:
            self.log.warning(f"NFS export not visible in showmount: {exports}")
        
        self.log.info("NFS configured successfully")
    
    async def _register_replication_target(self, details: dict, job_id: str) -> str:
        """Register the new target in replication_targets table."""
        target_data = {
            'name': details['vm_name'],
            'hostname': details['detected_ip'],
            'zfs_pool': details.get('zfs_pool_name', 'tank'),
            'ssh_username': details.get('ssh_username', 'root'),
            'ssh_key_id': details.get('ssh_key_id'),
            'dr_vcenter_id': details.get('vcenter_id'),
            'target_type': 'zfs',
            'health_status': 'healthy',
            'is_active': True,
            'source_template_id': details.get('template_id'),
            'deployed_job_id': job_id,
            'deployed_vm_moref': details.get('cloned_vm_moref'),
            'deployed_ip_source': 'dhcp' if details.get('use_dhcp') else 'static',
        }
        
        result = await self.db.from_('replication_targets').insert(target_data).execute()
        target_id = result.data[0]['id']
        
        # Update template deployment count
        await self.db.rpc('increment_template_deployment', {
            'template_id': details.get('template_id')
        })
        
        self.log.info(f"Registered replication target: {target_id}")
        return target_id
    
    async def _register_datastore(self, details: dict) -> str:
        """Register NFS share as vCenter datastore."""
        ip = details['detected_ip']
        pool_name = details.get('zfs_pool_name', 'tank')
        vm_name = details['vm_name']
        datastore_name = f"nfs-{vm_name}"
        
        # Get all hosts in the cluster/datacenter
        hosts = self._get_datacenter_hosts()
        
        for host in hosts:
            try:
                self.log.info(f"Mounting NFS datastore on host: {host.name}")
                
                spec = vim.host.NasVolume.Specification()
                spec.remoteHost = ip
                spec.remotePath = f"/{pool_name}/nfs"
                spec.localPath = datastore_name
                spec.accessMode = 'readWrite'
                spec.type = 'NFS'
                
                host.configManager.datastoreSystem.CreateNasDatastore(spec)
                
            except vim.fault.DuplicateName:
                self.log.info(f"Datastore {datastore_name} already exists on {host.name}")
            except Exception as e:
                self.log.warning(f"Failed to mount on {host.name}: {e}")
        
        # Verify datastore exists
        datastores = self._get_datastores_by_name(datastore_name)
        if datastores:
            self.log.info(f"Datastore '{datastore_name}' registered successfully")
        else:
            self.log.warning(f"Datastore '{datastore_name}' not visible after registration")
        
        return datastore_name
    
    # --- Helper Methods ---
    
    async def _detect_new_disk(self) -> str:
        """Detect the newly added disk device."""
        # List block devices
        lsblk = await self._ssh_exec("lsblk -d -n -o NAME,SIZE,TYPE | grep disk")
        
        # Find disks without partitions (likely the new one)
        for line in lsblk.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 2:
                device = f"/dev/{parts[0]}"
                # Check if it has a partition table
                has_parts = await self._ssh_exec(f"lsblk {device} | wc -l")
                if int(has_parts.strip()) == 2:  # Just header + device = no partitions
                    return device
        
        # Fallback: Use the second disk
        return "/dev/sdb"
    
    async def _ssh_exec(self, command: str) -> str:
        """Execute command via SSH and return output."""
        stdin, stdout, stderr = self.ssh_client.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()
        output = stdout.read().decode()
        error = stderr.read().decode()
        
        if exit_code != 0:
            raise Exception(f"Command failed ({exit_code}): {command}\n{error}")
        
        return output
    
    def _cleanup(self):
        """Clean up connections."""
        if self.ssh_client:
            self.ssh_client.close()
        if self.vcenter_conn:
            Disconnect(self.vcenter_conn)
```

---

## Phase 2: Database Migrations

### Migration: Add Deployment Tracking Columns

```sql
-- Migration: Add ZFS target deployment tracking
-- Date: 2025-07-12

-- Track deployment history on templates
ALTER TABLE zfs_target_templates 
ADD COLUMN IF NOT EXISTS last_deployed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS deployment_count integer DEFAULT 0;

-- Add deployment source reference to replication_targets
ALTER TABLE replication_targets
ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES zfs_target_templates(id),
ADD COLUMN IF NOT EXISTS deployed_job_id uuid REFERENCES jobs(id),
ADD COLUMN IF NOT EXISTS deployed_vm_moref text,
ADD COLUMN IF NOT EXISTS deployed_ip_source text DEFAULT 'dhcp';

-- Create index for template lookups
CREATE INDEX IF NOT EXISTS idx_replication_targets_source_template 
ON replication_targets(source_template_id);

-- Function to increment deployment count
CREATE OR REPLACE FUNCTION increment_template_deployment(template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE zfs_target_templates
    SET 
        deployment_count = COALESCE(deployment_count, 0) + 1,
        last_deployed_at = now()
    WHERE id = template_id;
END;
$$;

-- Add comment for documentation
COMMENT ON COLUMN replication_targets.deployed_ip_source IS 
    'How IP was assigned: dhcp or static';
```

---

## Phase 3: Job Details Schema

### `deploy_zfs_target` Job Details Structure

```typescript
interface DeployZfsTargetJobDetails {
    // Template Info
    template_id: string;           // zfs_target_templates.id
    template_name: string;         // Display name
    template_moref: string;        // vCenter template VM moref
    vcenter_id: string;            // Source vCenter UUID
    
    // VM Configuration
    vm_name: string;               // Name for cloned VM
    hostname?: string;             // Guest OS hostname
    
    // Network Configuration
    network_id?: string;           // vcenter_networks.id
    network_name?: string;         // Port group name
    vlan_id?: number;              // VLAN ID for display
    use_dhcp: boolean;             // DHCP or static IP
    
    // Static IP (only if use_dhcp=false)
    ip_address?: string;
    subnet_mask?: string;
    gateway?: string;
    dns_servers?: string[];
    
    // ZFS Configuration
    zfs_pool_name: string;         // e.g., "tank"
    zfs_disk_gb: number;           // Size of ZFS disk
    nfs_network?: string;          // Allowed NFS clients CIDR
    
    // SSH Configuration
    ssh_key_id?: string;           // ssh_keys.id
    ssh_username: string;          // Default: "root"
    
    // Phase Tracking
    current_phase: 'clone' | 'power_on' | 'wait_tools' | 'wait_ip' | 
                   'ssh_connect' | 'zfs_create' | 'nfs_setup' | 
                   'register_target' | 'register_datastore' | 'complete';
    progress_percent: number;      // 0-100
    console_log: ConsoleEntry[];   // Real-time output
    
    // Results (populated during execution)
    cloned_vm_moref?: string;      // Created VM moref
    detected_ip?: string;          // IP after power on
    replication_target_id?: string; // Created target UUID
    datastore_name?: string;       // Created datastore name
    
    // Error Tracking
    error?: string;                // Error message if failed
    failed_phase?: string;         // Which phase failed
}

interface ConsoleEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug' | 'success';
    message: string;
}
```

---

## Phase 4: Error Handling Matrix

| Phase | Error | Cause | Recovery Action | User Message |
|-------|-------|-------|-----------------|--------------|
| **Clone** | Template not found | Template deleted or vCenter sync stale | Fail job | "Template not found. Please refresh vCenter sync and verify template exists." |
| **Clone** | Insufficient resources | Datastore full or resource pool limits | Fail job | "Insufficient resources to clone VM. Check datastore space and resource pool limits." |
| **Clone** | Network not found | Port group missing | Fail job | "Network '{name}' not found in vCenter. Verify network configuration." |
| **Power On** | VM cannot power on | Resource constraints | Fail job | "Failed to power on VM. Check cluster resources and DRS settings." |
| **Wait Tools** | Timeout (5 min) | Guest OS not booting | Retry 1x, then fail | "VMware Tools not responding. Guest OS may have boot issues." |
| **Wait IP** | DHCP timeout (5 min) | No DHCP server on VLAN | Fail with suggestion | "No IP acquired via DHCP. Verify DHCP server exists on VLAN {id} or use static IP." |
| **SSH** | Connection refused | SSH not running | Retry 5x, 15s apart | "SSH connection failed. Verify SSH service is enabled in template." |
| **SSH** | Key rejected | Wrong key or not in authorized_keys | Fail job | "SSH authentication failed. Verify SSH key is configured in template." |
| **ZFS Create** | Disk not found | Disk not attached properly | Try alternate detection | "ZFS disk not detected. Attempting alternate detection method." |
| **ZFS Create** | Pool exists | Previous partial deployment | Destroy and recreate | "Existing pool found. Recreating pool." |
| **NFS Setup** | Service failed | NFS packages missing | Fail job | "NFS service failed to start. Verify nfs-utils is installed in template." |
| **Register Target** | Duplicate name | Target already exists | Update existing | "Replication target already exists. Updating configuration." |
| **Register Datastore** | Mount failed | Network/firewall issue | Log warning, continue | "Datastore mount failed on some hosts. Manual verification needed." |
| **Register Datastore** | Duplicate name | Datastore exists | Skip, log info | "Datastore already registered." |

### Retry Configuration

```python
RETRY_CONFIG = {
    'wait_tools': {'max_retries': 1, 'timeout': 300},
    'wait_ip': {'max_retries': 0, 'timeout': 300},
    'ssh_connect': {'max_retries': 5, 'delay': 15},
    'zfs_create': {'max_retries': 2, 'delay': 5},
    'nfs_setup': {'max_retries': 1, 'delay': 5},
    'register_datastore': {'max_retries': 3, 'delay': 10},
}
```

---

## Phase 5: Files to Create/Modify

| File | Action | Priority | Description |
|------|--------|----------|-------------|
| `job_executor/handlers/zfs_target.py` | **CREATE** | P0 | Main handler class with all phases |
| `job_executor/handlers/__init__.py` | **MODIFY** | P0 | Export ZfsTargetHandler |
| `job-executor.py` | **MODIFY** | P0 | Register handler in job type map |
| `supabase/migrations/XXXXXX_zfs_deployment_tracking.sql` | **CREATE** | P1 | Add tracking columns |
| `src/components/replication/DeploymentConsole.tsx` | **MODIFY** | P2 | Enhanced IP detection display |
| `src/components/replication/DeployZfsTargetWizard.tsx` | **MODIFY** | P2 | Post-deploy actions |

---

## Phase 6: Implementation Order

### Sprint 1: Core Handler (P0)

1. ✅ Create plan document (this file)
2. Create `job_executor/handlers/zfs_target.py` with all phases
3. Update `job_executor/handlers/__init__.py` to export handler
4. Register handler in `job-executor.py` job type map
5. Manual test: Clone + Power On phases

### Sprint 2: Database & Tracking (P1)

6. Create migration for tracking columns
7. Implement SSH key decryption in handler
8. Implement ZFS pool creation
9. Implement NFS configuration
10. Manual test: Full flow with SSH

### Sprint 3: Integration (P2)

11. Implement replication target registration
12. Implement datastore registration
13. Enhance DeploymentConsole for IP detection
14. Add post-deployment actions to wizard
15. End-to-end testing

---

## Testing Checklist

### Unit Tests

- [ ] Clone spec generation
- [ ] Guest customization building
- [ ] Disk detection logic
- [ ] SSH key decryption

### Integration Tests

- [ ] DHCP IP acquisition
- [ ] Static IP assignment
- [ ] SSH connection with key
- [ ] ZFS pool creation
- [ ] NFS export verification

### End-to-End Tests

- [ ] Full deployment with DHCP
- [ ] Full deployment with static IP
- [ ] Datastore visible in vCenter
- [ ] Replication target functional
- [ ] Error recovery scenarios

---

## Appendix: pyVmomi Reference

### Clone VM with Guest Customization

```python
# Guest customization for static IP
def _build_customization_spec(self, details: dict) -> vim.vm.customization.Specification:
    spec = vim.vm.customization.Specification()
    
    # Identity (Linux)
    identity = vim.vm.customization.LinuxPrep()
    identity.hostName = vim.vm.customization.FixedName(name=details['hostname'])
    spec.identity = identity
    
    # Network
    if not details.get('use_dhcp'):
        adapter = vim.vm.customization.AdapterMapping()
        adapter.adapter = vim.vm.customization.IPSettings()
        adapter.adapter.ip = vim.vm.customization.FixedIp(
            ipAddress=details['ip_address']
        )
        adapter.adapter.subnetMask = details['subnet_mask']
        adapter.adapter.gateway = [details['gateway']]
        adapter.adapter.dnsServerList = details.get('dns_servers', [])
        spec.nicSettingMap = [adapter]
    else:
        adapter = vim.vm.customization.AdapterMapping()
        adapter.adapter = vim.vm.customization.IPSettings()
        adapter.adapter.ip = vim.vm.customization.DhcpIpGenerator()
        spec.nicSettingMap = [adapter]
    
    return spec
```

### Add Disk to VM

```python
def _add_disk(self, vm, size_gb: int):
    spec = vim.vm.ConfigSpec()
    
    # Find SCSI controller
    controller = None
    for device in vm.config.hardware.device:
        if isinstance(device, vim.vm.device.VirtualSCSIController):
            controller = device
            break
    
    # Calculate next unit number
    unit_number = 0
    for device in vm.config.hardware.device:
        if hasattr(device, 'controllerKey') and device.controllerKey == controller.key:
            unit_number = max(unit_number, device.unitNumber + 1)
    
    # Create disk
    disk = vim.vm.device.VirtualDisk()
    disk.capacityInKB = size_gb * 1024 * 1024
    disk.controllerKey = controller.key
    disk.unitNumber = unit_number
    
    disk.backing = vim.vm.device.VirtualDisk.FlatVer2BackingInfo()
    disk.backing.diskMode = 'persistent'
    disk.backing.thinProvisioned = False
    
    disk_spec = vim.vm.device.VirtualDeviceSpec()
    disk_spec.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
    disk_spec.fileOperation = vim.vm.device.VirtualDeviceSpec.FileOperation.create
    disk_spec.device = disk
    
    spec.deviceChange = [disk_spec]
    task = vm.ReconfigVM_Task(spec=spec)
    self._wait_for_task(task)
```

### Create NFS Datastore

```python
def _create_nfs_datastore(self, host, nfs_host: str, nfs_path: str, name: str):
    spec = vim.host.NasVolume.Specification()
    spec.remoteHost = nfs_host
    spec.remotePath = nfs_path
    spec.localPath = name
    spec.accessMode = 'readWrite'
    spec.type = 'NFS'
    
    return host.configManager.datastoreSystem.CreateNasDatastore(spec)
```

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2025-07-12 | 1.0 | AI Assistant | Initial plan document |
