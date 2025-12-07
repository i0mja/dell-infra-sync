# Plan: Deploy ZFS Target from Template

## Overview
Enable one-click deployment of ZFS replication targets from pre-built VMware templates. The system clones a template VM, applies guest customization (IP, hostname), configures ZFS/NFS, and auto-registers as a replication target.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Wizard                              │
│  Step 1: Select Template → Step 2: Configure → Step 3: Deploy       │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Job Executor (Python)                           │
│  deploy_zfs_target job type                                          │
│  - Clone template via pyVmomi                                        │
│  - Apply guest customization                                         │
│  - SSH post-config (ZFS pool, NFS exports)                          │
│  - Register in replication_targets                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Supabase Tables                              │
│  zfs_target_templates - Template configurations                      │
│  replication_targets  - Deployed targets (existing)                  │
│  jobs/job_tasks       - Deployment tracking                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Database Schema

### New Table: `zfs_target_templates`

```sql
CREATE TABLE public.zfs_target_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- vCenter reference
  vcenter_id UUID REFERENCES public.vcenters(id) ON DELETE CASCADE,
  template_moref TEXT NOT NULL,        -- e.g., "vm-123"
  template_name TEXT NOT NULL,         -- Display name from vCenter
  
  -- Default deployment settings
  default_datacenter TEXT,
  default_cluster TEXT,
  default_datastore TEXT,
  default_network TEXT,
  default_resource_pool TEXT,
  
  -- ZFS configuration defaults
  default_zfs_pool_name TEXT DEFAULT 'tank',
  default_zfs_disk_path TEXT DEFAULT '/dev/sdb',  -- Second disk for ZFS
  default_nfs_network TEXT DEFAULT '10.0.0.0/8',
  
  -- VM sizing defaults
  default_cpu_count INTEGER DEFAULT 2,
  default_memory_gb INTEGER DEFAULT 8,
  default_zfs_disk_gb INTEGER DEFAULT 500,
  
  -- SSH access (template should have SSH enabled)
  default_ssh_username TEXT DEFAULT 'zfsadmin',
  ssh_key_encrypted TEXT,              -- For passwordless access post-deploy
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.zfs_target_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ZFS templates"
  ON public.zfs_target_templates FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Operators can view ZFS templates"
  ON public.zfs_target_templates FOR SELECT
  USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));
```

### Add job_type enum value

```sql
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'deploy_zfs_target';
```

---

## 2. Frontend Wizard UI

### File: `src/components/replication/DeployZfsTargetWizard.tsx`

**Step 1: Select Template**
- Dropdown of registered templates from `zfs_target_templates`
- Shows template details: name, vCenter, default settings
- Option to "Register New Template" (links to template management)

**Step 2: Configure Deployment**
- Target VM name (auto-generated default: `zfs-dr-{timestamp}`)
- Network configuration:
  - IP Address (static)
  - Subnet Mask
  - Gateway
  - DNS Servers
- Hostname
- ZFS Pool settings:
  - Pool name (default from template)
  - ZFS disk size (can override template default)
- NFS export network (CIDR, e.g., `10.0.0.0/8`)
- Optional: Override CPU/Memory from template defaults

**Step 3: Review & Deploy**
- Summary of all settings
- Estimated deployment time
- "Deploy" button creates job

**Step 4: Deployment Progress**
- Real-time job status via job polling
- Substeps shown:
  1. Cloning template...
  2. Customizing guest OS...
  3. Powering on VM...
  4. Waiting for VM tools...
  5. Configuring ZFS pool...
  6. Setting up NFS exports...
  7. Registering replication target...
- Success: Shows new target details + "Test Connection" button

### File: `src/components/replication/ZfsTemplateManagement.tsx`

Settings panel for managing templates:
- List registered templates
- "Add Template" dialog:
  - Select vCenter
  - Browse/select VM template (from vCenter inventory)
  - Configure defaults
- Edit/Delete templates

### File: `src/hooks/useZfsTemplates.ts`

```typescript
export function useZfsTemplates() {
  // Fetch templates
  // Create template
  // Update template
  // Delete template
  // Deploy from template (creates job)
}
```

---

## 3. Backend Handler (Job Executor)

### File: `job_executor/handlers/zfs_deploy.py`

```python
class ZfsDeployHandler(BaseHandler):
    """
    Deploys a ZFS replication target from a VMware template.
    
    Job details schema:
    {
        "template_id": "uuid",
        "vm_name": "zfs-dr-001",
        "hostname": "zfs-dr-001",
        "ip_address": "10.1.1.50",
        "subnet_mask": "255.255.255.0",
        "gateway": "10.1.1.1",
        "dns_servers": ["10.1.1.10"],
        "zfs_pool_name": "tank",
        "zfs_disk_gb": 500,
        "nfs_network": "10.0.0.0/8",
        "cpu_count": 2,
        "memory_gb": 8,
        "register_as_target": true,
        "target_name": "DR Site ZFS"
    }
    """
    
    async def execute(self, job: Job) -> dict:
        details = job.details
        
        # 1. Fetch template config from database
        template = await self.get_template(details['template_id'])
        
        # 2. Connect to vCenter via pyVmomi
        vcenter = await self.connect_vcenter(template['vcenter_id'])
        
        # 3. Clone template
        self.update_progress(job, 10, "Cloning template...")
        clone_task = await self.clone_template(
            vcenter=vcenter,
            template_moref=template['template_moref'],
            vm_name=details['vm_name'],
            datacenter=template['default_datacenter'],
            cluster=template['default_cluster'],
            datastore=template['default_datastore'],
            resource_pool=template['default_resource_pool']
        )
        
        # 4. Apply guest customization
        self.update_progress(job, 30, "Applying guest customization...")
        await self.customize_guest(
            vcenter=vcenter,
            vm=clone_task.vm,
            hostname=details['hostname'],
            ip_address=details['ip_address'],
            subnet_mask=details['subnet_mask'],
            gateway=details['gateway'],
            dns_servers=details['dns_servers']
        )
        
        # 5. Add ZFS disk if needed
        self.update_progress(job, 40, "Adding ZFS storage disk...")
        await self.add_disk(
            vcenter=vcenter,
            vm=clone_task.vm,
            size_gb=details['zfs_disk_gb'],
            datastore=template['default_datastore']
        )
        
        # 6. Power on and wait for VMware Tools
        self.update_progress(job, 50, "Powering on VM...")
        await self.power_on_and_wait(vcenter, clone_task.vm)
        
        # 7. SSH post-configuration
        self.update_progress(job, 70, "Configuring ZFS pool...")
        ssh = await self.connect_ssh(
            host=details['ip_address'],
            username=template['default_ssh_username'],
            key=await self.decrypt(template['ssh_key_encrypted'])
        )
        
        # Create ZFS pool
        await ssh.execute(f"""
            sudo zpool create -f {details['zfs_pool_name']} {template['default_zfs_disk_path']}
            sudo zfs set compression=lz4 {details['zfs_pool_name']}
            sudo zfs set atime=off {details['zfs_pool_name']}
        """)
        
        # 8. Configure NFS exports
        self.update_progress(job, 85, "Setting up NFS exports...")
        await ssh.execute(f"""
            sudo zfs set sharenfs='rw=@{details['nfs_network']},no_root_squash' {details['zfs_pool_name']}
            sudo exportfs -ra
        """)
        
        # 9. Register as replication target
        if details.get('register_as_target', True):
            self.update_progress(job, 95, "Registering replication target...")
            target = await self.register_target(
                name=details.get('target_name', details['vm_name']),
                hostname=details['ip_address'],
                zfs_pool=details['zfs_pool_name'],
                ssh_username=template['default_ssh_username'],
                ssh_key=template['ssh_key_encrypted']
            )
        
        self.update_progress(job, 100, "Deployment complete!")
        
        return {
            "success": True,
            "vm_name": details['vm_name'],
            "ip_address": details['ip_address'],
            "zfs_pool": details['zfs_pool_name'],
            "replication_target_id": target['id'] if target else None
        }
```

### pyVmomi Operations Required

```python
# In job_executor/mixins/vcenter_ops.py

async def clone_template(self, vcenter, template_moref, vm_name, ...):
    """Clone a VM template."""
    template = vcenter.get_vm_by_moref(template_moref)
    
    # Build clone spec
    relocate_spec = vim.vm.RelocateSpec()
    relocate_spec.datastore = datastore
    relocate_spec.pool = resource_pool
    
    clone_spec = vim.vm.CloneSpec()
    clone_spec.location = relocate_spec
    clone_spec.powerOn = False
    clone_spec.template = False
    
    # Execute clone
    task = template.Clone(folder=folder, name=vm_name, spec=clone_spec)
    return await self.wait_for_task(task)

async def customize_guest(self, vcenter, vm, hostname, ip_address, ...):
    """Apply guest customization for Linux."""
    # Build customization spec
    ip_settings = vim.vm.customization.IPSettings()
    ip_settings.ip = vim.vm.customization.FixedIp(ipAddress=ip_address)
    ip_settings.subnetMask = subnet_mask
    ip_settings.gateway = [gateway]
    ip_settings.dnsServerList = dns_servers
    
    adapter_mapping = vim.vm.customization.AdapterMapping()
    adapter_mapping.adapter = ip_settings
    
    global_ip = vim.vm.customization.GlobalIPSettings()
    global_ip.dnsServerList = dns_servers
    
    ident = vim.vm.customization.LinuxPrep()
    ident.hostName = vim.vm.customization.FixedName(name=hostname)
    ident.domain = "local"
    
    custom_spec = vim.vm.customization.Specification()
    custom_spec.identity = ident
    custom_spec.globalIPSettings = global_ip
    custom_spec.nicSettingMap = [adapter_mapping]
    
    task = vm.Customize(spec=custom_spec)
    return await self.wait_for_task(task)
```

---

## 4. Template Requirements

The VMware template must be pre-configured with:

### Required Software
- Debian 12 (or similar Linux)
- ZFS utilities (`zfsutils-linux`)
- NFS server (`nfs-kernel-server`)
- SSH server with key-based auth enabled
- VMware Tools (open-vm-tools)

### Template Preparation Script
```bash
#!/bin/bash
# Run this on the template VM before converting to template

# Install packages
apt update && apt install -y \
    zfsutils-linux \
    nfs-kernel-server \
    open-vm-tools \
    openssh-server

# Enable services
systemctl enable ssh nfs-kernel-server

# Create zfsadmin user
useradd -m -s /bin/bash zfsadmin
echo "zfsadmin ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zfsadmin

# Add SSH key (replace with your key)
mkdir -p /home/zfsadmin/.ssh
echo "ssh-rsa AAAA..." > /home/zfsadmin/.ssh/authorized_keys
chown -R zfsadmin:zfsadmin /home/zfsadmin/.ssh
chmod 700 /home/zfsadmin/.ssh
chmod 600 /home/zfsadmin/.ssh/authorized_keys

# Clean up for templating
apt clean
cat /dev/null > /etc/machine-id
cloud-init clean  # If cloud-init is installed
```

---

## 5. UI Flow Mockup

```
┌─────────────────────────────────────────────────────────────────────┐
│  Deploy ZFS Replication Target                              [X]     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ● Step 1    ○ Step 2    ○ Step 3    ○ Step 4                      │
│  Template    Configure   Review      Deploy                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Select Template                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │ ▼ ZFS Debian 12 Template                            │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  │                                                              │   │
│  │  Template Details:                                           │   │
│  │  • vCenter: vcenter.lab.local                               │   │
│  │  • Default Pool: tank                                        │   │
│  │  • Default CPU: 2 cores                                      │   │
│  │  • Default Memory: 8 GB                                      │   │
│  │                                                              │   │
│  │  No templates? [Register a Template]                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                                          [Cancel]  [Next →]         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Order

### Phase 1: Database & Templates
1. Create `zfs_target_templates` table migration
2. Add `deploy_zfs_target` to job_type enum
3. Create `ZfsTemplateManagement.tsx` settings panel
4. Create `useZfsTemplates.ts` hook

### Phase 2: Deployment Wizard
5. Create `DeployZfsTargetWizard.tsx` (4-step wizard)
6. Integrate with job creation flow
7. Add deployment results display

### Phase 3: Backend Handler
8. Create `job_executor/handlers/zfs_deploy.py`
9. Add pyVmomi clone/customize operations to `vcenter_ops.py`
10. Add SSH post-config helpers
11. Register handler in `job-executor.py`

### Phase 4: Integration
12. Add "Deploy ZFS Target" button to Replication page
13. Add template management to Settings
14. Test end-to-end deployment flow

---

## 7. Error Handling

| Stage | Error | Recovery |
|-------|-------|----------|
| Clone | Template not found | Show error, suggest re-registering template |
| Clone | Insufficient resources | Show available resources, let user adjust |
| Customize | Customization failed | Power off VM, show logs |
| Power On | VM tools timeout | Retry with longer timeout, manual SSH fallback |
| SSH | Connection refused | Check firewall, verify template SSH config |
| ZFS | Pool creation failed | Check disk path, show zpool status |
| NFS | Export failed | Show NFS logs, verify network settings |

---

## 8. Security Considerations

- SSH keys stored encrypted in database
- Template credentials never exposed to frontend
- All SSH commands run via Job Executor (local network access)
- Guest customization passwords hashed/temporary
- RLS policies restrict template management to admins
