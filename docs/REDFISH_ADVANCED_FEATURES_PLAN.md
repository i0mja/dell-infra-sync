# Advanced Redfish Features Implementation Plan

## Overview

This document outlines the implementation plan for three high-value Redfish API features:
1. **Virtual Media Management** - Remote ISO mounting for OS installation
2. **BIOS/UEFI Configuration Management** - View and modify BIOS settings
3. **Server Configuration Profile (SCP)** - Backup/restore complete server configurations

All features follow the established offline-first architecture using the Job Executor pattern.

---

## Architecture Integration

### Existing System
- **Job Executor** (Python) - Handles all iDRAC operations in local/offline mode
- **Edge Functions** - Secondary option for cloud deployments
- **Jobs Table** - Tracks all operations with status/progress
- **Activity Monitor** - Logs all iDRAC commands

### New Components
```
┌─────────────────────────────────────────────────────────┐
│                     UI Layer                             │
├─────────────────┬──────────────────┬────────────────────┤
│ Virtual Media   │ BIOS Config      │ SCP Backup/Restore │
│ Dialog          │ Dialog           │ Dialog             │
└────────┬────────┴────────┬─────────┴──────────┬─────────┘
         │                 │                     │
         └─────────────────┴─────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Jobs Table │
                    └──────┬──────┘
                           │
                    ┌──────▼──────────┐
                    │  Job Executor   │
                    │   (Python)      │
                    └──────┬──────────┘
                           │
                    ┌──────▼──────────┐
                    │ iDRAC Redfish   │
                    │      API        │
                    └─────────────────┘
```

---

## Database Schema Changes

### 1. New Job Types (Add to `job_type` enum)

```sql
ALTER TYPE job_type ADD VALUE 'virtual_media_mount';
ALTER TYPE job_type ADD VALUE 'virtual_media_unmount';
ALTER TYPE job_type ADD VALUE 'bios_config_read';
ALTER TYPE job_type ADD VALUE 'bios_config_write';
ALTER TYPE job_type ADD VALUE 'scp_export';
ALTER TYPE job_type ADD VALUE 'scp_import';
```

### 2. New Table: `virtual_media_sessions`

```sql
CREATE TABLE public.virtual_media_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  mount_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  unmount_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  
  -- Media details
  media_type TEXT NOT NULL, -- 'CD', 'DVD', 'USBStick', 'Floppy'
  image_name TEXT NOT NULL,
  remote_image_url TEXT NOT NULL, -- HTTP/HTTPS/NFS/CIFS URL
  
  -- Mount status
  is_mounted BOOLEAN DEFAULT false,
  inserted BOOLEAN DEFAULT false,
  write_protected BOOLEAN DEFAULT true,
  
  -- Timestamps
  mounted_at TIMESTAMP WITH TIME ZONE,
  unmounted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Optional auth for remote shares
  share_username TEXT,
  share_password_encrypted TEXT,
  
  CONSTRAINT valid_media_type CHECK (media_type IN ('CD', 'DVD', 'USBStick', 'Floppy'))
);

CREATE INDEX idx_virtual_media_server ON virtual_media_sessions(server_id);
CREATE INDEX idx_virtual_media_mounted ON virtual_media_sessions(is_mounted) WHERE is_mounted = true;
```

### 3. New Table: `bios_configurations`

```sql
CREATE TABLE public.bios_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  
  -- Configuration snapshot
  attributes JSONB NOT NULL, -- Full BIOS attribute key-value pairs
  pending_attributes JSONB, -- Attributes waiting for reboot
  
  -- Metadata
  bios_version TEXT,
  snapshot_type TEXT NOT NULL, -- 'current', 'pending', 'baseline'
  created_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  
  -- Timestamps
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  CONSTRAINT valid_snapshot_type CHECK (snapshot_type IN ('current', 'pending', 'baseline'))
);

CREATE INDEX idx_bios_config_server ON bios_configurations(server_id);
CREATE INDEX idx_bios_config_type ON bios_configurations(snapshot_type);
```

### 4. New Table: `scp_backups`

```sql
CREATE TABLE public.scp_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  export_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  import_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  
  -- Backup metadata
  backup_name TEXT NOT NULL,
  description TEXT,
  
  -- SCP file details
  scp_file_path TEXT, -- Local file path on job executor host
  scp_file_size_bytes BIGINT,
  scp_content JSONB, -- Optional: store small SCP files directly
  
  -- Configuration scope
  include_bios BOOLEAN DEFAULT true,
  include_idrac BOOLEAN DEFAULT true,
  include_nic BOOLEAN DEFAULT true,
  include_raid BOOLEAN DEFAULT true,
  
  -- Validation
  checksum TEXT, -- SHA256 of SCP file
  is_valid BOOLEAN DEFAULT true,
  validation_errors TEXT,
  
  -- Timestamps
  exported_at TIMESTAMP WITH TIME ZONE,
  last_imported_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

CREATE INDEX idx_scp_backups_server ON scp_backups(server_id);
CREATE INDEX idx_scp_backups_created ON scp_backups(created_at DESC);
```

### 5. RLS Policies

```sql
-- Virtual Media Sessions
ALTER TABLE public.virtual_media_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view virtual media sessions"
  ON public.virtual_media_sessions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage virtual media"
  ON public.virtual_media_sessions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- BIOS Configurations
ALTER TABLE public.bios_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view BIOS configs"
  ON public.bios_configurations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage BIOS configs"
  ON public.bios_configurations FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- SCP Backups
ALTER TABLE public.scp_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view SCP backups"
  ON public.scp_backups FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage SCP backups"
  ON public.scp_backups FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));
```

---

## Job Executor Implementation

### 1. Virtual Media Management

#### Mount Virtual Media Job Handler

```python
def execute_virtual_media_mount(self, job_id):
    """
    Mount virtual media (ISO) to iDRAC virtual CD/DVD
    
    Job details format:
    {
        "server_id": "uuid",
        "media_type": "CD",  # CD, DVD, USBStick
        "image_url": "http://192.168.1.100/iso/ubuntu-22.04.iso",
        "write_protected": true,
        "username": "optional",
        "password": "optional"
    }
    """
    details = self.get_job_details(job_id)
    server = self.get_server_details(details['server_id'])
    
    # Step 1: Get available virtual media
    vm_endpoint = f"{server['base_url']}/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia"
    vm_collection = self.make_idrac_request('GET', vm_endpoint, server, job_id)
    
    # Step 2: Find CD/DVD slot
    cd_slot = None
    for member in vm_collection.get('Members', []):
        slot_url = member['@odata.id']
        slot_info = self.make_idrac_request('GET', f"{server['base_url']}{slot_url}", server, job_id)
        
        if slot_info.get('MediaTypes') and details['media_type'] in slot_info['MediaTypes']:
            if not slot_info.get('Inserted'):
                cd_slot = slot_url
                break
    
    if not cd_slot:
        raise Exception(f"No available {details['media_type']} slot found")
    
    # Step 3: Mount the media
    mount_payload = {
        "Image": details['image_url'],
        "Inserted": True,
        "WriteProtected": details.get('write_protected', True)
    }
    
    if details.get('username'):
        mount_payload['UserName'] = details['username']
        mount_payload['Password'] = details['password']
    
    self.make_idrac_request(
        'POST',
        f"{server['base_url']}{cd_slot}/Actions/VirtualMedia.InsertMedia",
        server,
        job_id,
        json_data=mount_payload
    )
    
    # Step 4: Update database
    self.update_virtual_media_session(details['server_id'], job_id, 'mounted')
    
    self.complete_job(job_id, {"message": "Virtual media mounted successfully"})
```

#### Unmount Virtual Media Job Handler

```python
def execute_virtual_media_unmount(self, job_id):
    """Unmount virtual media from iDRAC"""
    details = self.get_job_details(job_id)
    server = self.get_server_details(details['server_id'])
    
    # Get mounted media slot
    session = self.get_virtual_media_session(details['session_id'])
    
    self.make_idrac_request(
        'POST',
        f"{server['base_url']}{session['slot_url']}/Actions/VirtualMedia.EjectMedia",
        server,
        job_id
    )
    
    self.update_virtual_media_session(details['server_id'], job_id, 'unmounted')
    self.complete_job(job_id, {"message": "Virtual media unmounted successfully"})
```

### 2. BIOS Configuration Management

#### Read BIOS Configuration Job Handler

```python
def execute_bios_config_read(self, job_id):
    """
    Read current and pending BIOS configuration
    
    Job details format:
    {
        "server_id": "uuid",
        "save_as_baseline": false
    }
    """
    details = self.get_job_details(job_id)
    server = self.get_server_details(details['server_id'])
    
    # Step 1: Get BIOS attributes
    bios_url = f"{server['base_url']}/redfish/v1/Systems/System.Embedded.1/Bios"
    bios_data = self.make_idrac_request('GET', bios_url, server, job_id)
    
    current_attributes = bios_data.get('Attributes', {})
    
    # Step 2: Get pending attributes (settings that need reboot)
    settings_url = f"{bios_url}/Settings"
    pending_data = self.make_idrac_request('GET', settings_url, server, job_id)
    pending_attributes = pending_data.get('Attributes', {})
    
    # Step 3: Save to database
    snapshot_type = 'baseline' if details.get('save_as_baseline') else 'current'
    
    config_data = {
        'server_id': details['server_id'],
        'job_id': job_id,
        'attributes': json.dumps(current_attributes),
        'pending_attributes': json.dumps(pending_attributes) if pending_attributes else None,
        'bios_version': bios_data.get('BiosVersion'),
        'snapshot_type': snapshot_type,
        'created_by': self.get_job_creator(job_id)
    }
    
    self.save_bios_configuration(config_data)
    
    self.complete_job(job_id, {
        "message": "BIOS configuration captured successfully",
        "attribute_count": len(current_attributes),
        "pending_count": len(pending_attributes)
    })
```

#### Write BIOS Configuration Job Handler

```python
def execute_bios_config_write(self, job_id):
    """
    Write BIOS configuration changes
    
    Job details format:
    {
        "server_id": "uuid",
        "attributes": {
            "ProcVirtualization": "Enabled",
            "MemTest": "Disabled",
            ...
        },
        "reboot_required": true,
        "create_maintenance_window": false
    }
    """
    details = self.get_job_details(job_id)
    server = self.get_server_details(details['server_id'])
    
    # Step 1: Apply BIOS settings
    settings_url = f"{server['base_url']}/redfish/v1/Systems/System.Embedded.1/Bios/Settings"
    
    payload = {
        "Attributes": details['attributes']
    }
    
    response = self.make_idrac_request('PATCH', settings_url, server, job_id, json_data=payload)
    
    # Step 2: Check if reboot is needed
    if details.get('reboot_required'):
        # Create a scheduled reboot or maintenance window
        if details.get('create_maintenance_window'):
            # Schedule for later
            reboot_time = details.get('reboot_time', 'Immediate')
        else:
            # Immediate reboot
            self.reboot_server(server, job_id)
    
    self.complete_job(job_id, {
        "message": "BIOS configuration updated",
        "reboot_required": details.get('reboot_required', True),
        "settings_applied": len(details['attributes'])
    })
```

### 3. Server Configuration Profile (SCP)

#### Export SCP Job Handler

```python
def execute_scp_export(self, job_id):
    """
    Export Server Configuration Profile
    
    Job details format:
    {
        "server_id": "uuid",
        "backup_name": "pre-upgrade-backup",
        "include_bios": true,
        "include_idrac": true,
        "include_nic": true,
        "include_raid": true
    }
    """
    details = self.get_job_details(job_id)
    server = self.get_server_details(details['server_id'])
    
    # Step 1: Initiate SCP export
    export_url = f"{server['base_url']}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
    
    # Build target list based on included components
    targets = []
    if details.get('include_bios', True):
        targets.append('BIOS')
    if details.get('include_idrac', True):
        targets.append('iDRAC')
    if details.get('include_nic', True):
        targets.append('NIC')
    if details.get('include_raid', True):
        targets.append('RAID')
    
    payload = {
        "ExportFormat": "JSON",
        "ShareParameters": {
            "Target": ",".join(targets)
        }
    }
    
    response = self.make_idrac_request('POST', export_url, server, job_id, json_data=payload)
    
    # Step 2: Monitor export task
    task_uri = response.headers.get('Location')
    scp_content = self.poll_task_until_complete(task_uri, server, job_id)
    
    # Step 3: Save SCP backup
    scp_file_path = f"/var/idrac-manager/scp_backups/{details['server_id']}_{job_id}.json"
    
    with open(scp_file_path, 'w') as f:
        json.dump(scp_content, f, indent=2)
    
    file_size = os.path.getsize(scp_file_path)
    checksum = hashlib.sha256(json.dumps(scp_content).encode()).hexdigest()
    
    backup_data = {
        'server_id': details['server_id'],
        'export_job_id': job_id,
        'backup_name': details['backup_name'],
        'description': details.get('description'),
        'scp_file_path': scp_file_path,
        'scp_file_size_bytes': file_size,
        'scp_content': json.dumps(scp_content) if file_size < 1024*1024 else None,  # Store if < 1MB
        'include_bios': details.get('include_bios', True),
        'include_idrac': details.get('include_idrac', True),
        'include_nic': details.get('include_nic', True),
        'include_raid': details.get('include_raid', True),
        'checksum': checksum,
        'exported_at': datetime.now().isoformat(),
        'created_by': self.get_job_creator(job_id)
    }
    
    self.save_scp_backup(backup_data)
    
    self.complete_job(job_id, {
        "message": "SCP export completed successfully",
        "file_size_kb": round(file_size / 1024, 2),
        "components": targets
    })
```

#### Import SCP Job Handler

```python
def execute_scp_import(self, job_id):
    """
    Import Server Configuration Profile
    
    Job details format:
    {
        "server_id": "uuid",
        "backup_id": "uuid",
        "shutdown_type": "Graceful",  # Graceful, Forced, NoReboot
        "preview_only": false
    }
    """
    details = self.get_job_details(job_id)
    server = self.get_server_details(details['server_id'])
    
    # Step 1: Load SCP backup
    backup = self.get_scp_backup(details['backup_id'])
    
    if backup['scp_content']:
        scp_content = json.loads(backup['scp_content'])
    else:
        with open(backup['scp_file_path'], 'r') as f:
            scp_content = json.load(f)
    
    # Step 2: Validate SCP file
    if not self.validate_scp_content(scp_content, server):
        raise Exception("SCP file validation failed - may be incompatible with target server")
    
    # Step 3: Import SCP
    import_url = f"{server['base_url']}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration"
    
    payload = {
        "ImportBuffer": json.dumps(scp_content),
        "ShareParameters": {
            "Target": "ALL"
        },
        "ShutdownType": details.get('shutdown_type', 'Graceful')
    }
    
    if details.get('preview_only'):
        payload['PreviewOnly'] = True
    
    response = self.make_idrac_request('POST', import_url, server, job_id, json_data=payload)
    
    # Step 4: Monitor import task
    task_uri = response.headers.get('Location')
    result = self.poll_task_until_complete(task_uri, server, job_id)
    
    # Step 5: Update database
    self.update_scp_backup_import_time(details['backup_id'], job_id)
    
    self.complete_job(job_id, {
        "message": "SCP import completed successfully" if not details.get('preview_only') else "SCP preview completed",
        "preview_only": details.get('preview_only', False)
    })
```

---

## UI Components

### 1. Virtual Media Dialog (`VirtualMediaDialog.tsx`)

**Location**: `src/components/servers/VirtualMediaDialog.tsx`

**Features**:
- Mount ISO/IMG files via HTTP/HTTPS/NFS/CIFS URLs
- View currently mounted media
- Unmount media
- Share authentication for network shares
- Real-time mount status

**Key UI Elements**:
```tsx
<Tabs>
  <TabsList>
    <TabsTrigger value="mount">Mount Media</TabsTrigger>
    <TabsTrigger value="mounted">Currently Mounted</TabsTrigger>
  </TabsList>
  
  <TabsContent value="mount">
    <Select> {/* Media Type: CD, DVD, USB */}
    <Input placeholder="Image URL (http://, nfs://, cifs://)" />
    <Switch> {/* Write Protected */}
    <Collapsible> {/* Share Authentication */}
      <Input type="text" placeholder="Username" />
      <Input type="password" placeholder="Password" />
    </Collapsible>
    <Button onClick={handleMount}>Mount Virtual Media</Button>
  </TabsContent>
  
  <TabsContent value="mounted">
    <Card> {/* Each mounted media */}
      <Badge>{mediaType}</Badge>
      <span>{imageName}</span>
      <Button onClick={handleUnmount}>Eject</Button>
    </Card>
  </TabsContent>
</Tabs>
```

### 2. BIOS Configuration Dialog (`BiosConfigDialog.tsx`)

**Location**: `src/components/servers/BiosConfigDialog.tsx`

**Features**:
- View current BIOS settings in categorized tree
- Edit individual attributes with validation
- Compare current vs baseline configurations
- Apply changes with reboot scheduling
- Export/import BIOS profiles

**Key UI Elements**:
```tsx
<Tabs>
  <TabsList>
    <TabsTrigger value="current">Current Settings</TabsTrigger>
    <TabsTrigger value="edit">Edit Settings</TabsTrigger>
    <TabsTrigger value="history">Configuration History</TabsTrigger>
  </TabsList>
  
  <TabsContent value="current">
    <Accordion> {/* Categories: Processor, Memory, Boot, etc. */}
      <AccordionItem>
        <Table> {/* Attribute table */}
          <TableRow>
            <TableCell>{attributeName}</TableCell>
            <TableCell>{currentValue}</TableCell>
            <TableCell>{pendingValue}</TableCell>
          </TableRow>
        </Table>
      </AccordionItem>
    </Accordion>
  </TabsContent>
  
  <TabsContent value="edit">
    <SearchInput placeholder="Search settings..." />
    <ScrollArea>
      {/* Editable form fields for each attribute */}
      <FormField name="ProcVirtualization">
        <Select>
          <SelectItem value="Enabled">Enabled</SelectItem>
          <SelectItem value="Disabled">Disabled</SelectItem>
        </Select>
      </FormField>
    </ScrollArea>
    <Alert> {/* Reboot required warning */}
    <Button onClick={handleApplyChanges}>Apply Changes</Button>
  </TabsContent>
</Tabs>
```

### 3. SCP Backup/Restore Dialog (`ScpBackupDialog.tsx`)

**Location**: `src/components/servers/ScpBackupDialog.tsx`

**Features**:
- Create new SCP backups
- View backup history
- Restore from backup with preview
- Compare backups
- Delete old backups

**Key UI Elements**:
```tsx
<Tabs>
  <TabsList>
    <TabsTrigger value="create">Create Backup</TabsTrigger>
    <TabsTrigger value="backups">Backup History</TabsTrigger>
  </TabsList>
  
  <TabsContent value="create">
    <Input placeholder="Backup name" />
    <Textarea placeholder="Description (optional)" />
    <div> {/* Component selection */}
      <Checkbox checked={includeBios}>BIOS</Checkbox>
      <Checkbox checked={includeIdrac}>iDRAC</Checkbox>
      <Checkbox checked={includeNic}>NIC</Checkbox>
      <Checkbox checked={includeRaid}>RAID</Checkbox>
    </div>
    <Button onClick={handleCreateBackup}>Create Backup</Button>
  </TabsContent>
  
  <TabsContent value="backups">
    <Table>
      <TableRow>
        <TableCell>{backupName}</TableCell>
        <TableCell>{createdAt}</TableCell>
        <TableCell>{fileSize}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuItem onClick={handleRestore}>Restore</DropdownMenuItem>
            <DropdownMenuItem onClick={handlePreview}>Preview</DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownload}>Download</DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete}>Delete</DropdownMenuItem>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    </Table>
  </TabsContent>
</Tabs>
```

### 4. Server Actions Menu Updates

Add new menu items to `src/pages/Servers.tsx`:

```tsx
<DropdownMenu>
  {/* Existing items */}
  <DropdownMenuItem onClick={() => openVirtualMediaDialog(server)}>
    <Disc className="mr-2 h-4 w-4" />
    Virtual Media
  </DropdownMenuItem>
  <DropdownMenuItem onClick={() => openBiosConfigDialog(server)}>
    <Settings2 className="mr-2 h-4 w-4" />
    BIOS Configuration
  </DropdownMenuItem>
  <DropdownMenuItem onClick={() => openScpBackupDialog(server)}>
    <Archive className="mr-2 h-4 w-4" />
    SCP Backup/Restore
  </DropdownMenuItem>
</DropdownMenu>
```

---

## Implementation Phases

### Phase 1: Database & Job Executor Foundation (Week 1)
**Goal**: Set up database schema and basic job handlers

**Tasks**:
1. Create database migration with all new tables
2. Add new job types to enum
3. Implement basic job executor handlers (stub functions)
4. Add database helper methods to job executor
5. Test job creation and status tracking

**Deliverables**:
- Database migration file
- Updated job-executor.py with new handlers
- Test script to verify job flow

### Phase 2: Virtual Media (Week 2)
**Goal**: Complete virtual media mounting feature

**Tasks**:
1. Implement full virtual media job handlers
2. Add iDRAC API error handling for media operations
3. Create VirtualMediaDialog component
4. Add real-time status updates
5. Test with various ISO sources (HTTP, NFS, CIFS)

**Deliverables**:
- Working virtual media mount/unmount
- UI dialog with mount status
- Documentation for supported URL formats

### Phase 3: BIOS Configuration (Week 3-4)
**Goal**: Complete BIOS configuration management

**Tasks**:
1. Implement BIOS read/write job handlers
2. Add attribute validation and categorization
3. Create BiosConfigDialog with search/filter
4. Implement configuration comparison
5. Add baseline/snapshot management
6. Test with various BIOS versions

**Deliverables**:
- Working BIOS config read/write
- User-friendly config editor
- Configuration history tracking

### Phase 4: SCP Backup/Restore (Week 5)
**Goal**: Complete SCP backup/restore feature

**Tasks**:
1. Implement SCP export/import job handlers
2. Add SCP file validation
3. Create ScpBackupDialog component
4. Implement backup comparison
5. Add preview mode for imports
6. Test with full configuration backups

**Deliverables**:
- Working SCP backup/restore
- Backup history management
- Preview before restore

### Phase 5: Integration & Polish (Week 6)
**Goal**: Integrate all features and polish UX

**Tasks**:
1. Add new menu items to Servers page
2. Create unified advanced features panel
3. Add bulk operations (multi-server BIOS changes)
4. Implement job dependencies (backup before BIOS change)
5. Add comprehensive error handling
6. Create user documentation
7. Performance testing with large server fleets

**Deliverables**:
- Fully integrated feature set
- User documentation
- Performance benchmarks

---

## Testing Strategy

### Unit Tests
- Job executor methods for each feature
- Database helper functions
- URL parsing and validation

### Integration Tests
- End-to-end job flows
- Database operations with RLS policies
- Error handling and recovery

### Manual Test Scenarios

**Virtual Media**:
- [ ] Mount ISO from HTTP server
- [ ] Mount ISO from NFS share
- [ ] Mount ISO from CIFS share with auth
- [ ] Unmount media
- [ ] Handle mount failures gracefully
- [ ] Multiple concurrent mounts to different servers

**BIOS Configuration**:
- [ ] Read current BIOS settings
- [ ] Modify single attribute
- [ ] Modify multiple attributes
- [ ] Apply with immediate reboot
- [ ] Apply with scheduled reboot
- [ ] Compare current vs baseline
- [ ] Handle invalid attribute values

**SCP Backup/Restore**:
- [ ] Export full SCP
- [ ] Export partial SCP (BIOS only)
- [ ] Restore SCP with preview
- [ ] Restore SCP with reboot
- [ ] Handle incompatible SCP files
- [ ] Large SCP file handling (>5MB)

---

## Security Considerations

### Credential Management
- **Virtual Media**: Share passwords encrypted in database
- **SCP Backups**: Store locally on job executor host, not in database
- **BIOS Passwords**: Handle BIOS setup passwords if configured

### Access Control
- All features require admin or operator role
- Audit logging for all configuration changes
- SCP files stored with restricted permissions (chmod 600)

### Data Validation
- URL validation for virtual media sources
- BIOS attribute validation before apply
- SCP file integrity checks (checksum validation)

---

## Monitoring & Alerting

### Activity Monitor Integration
All operations logged to `idrac_commands` table:
- Virtual media mount/unmount operations
- BIOS attribute reads/writes
- SCP export/import operations

### Job Status Tracking
Enhanced job details for troubleshooting:
```json
{
  "feature": "virtual_media",
  "operation": "mount",
  "media_type": "CD",
  "image_url": "http://...",
  "duration_seconds": 12,
  "error_details": null
}
```

### Notification Integration
Leverage existing notification system for:
- SCP backup completion (large exports)
- BIOS configuration changes requiring reboot
- Virtual media mount failures

---

## File Structure Summary

```
docs/
  REDFISH_ADVANCED_FEATURES_PLAN.md (this file)

job-executor.py
  + execute_virtual_media_mount()
  + execute_virtual_media_unmount()
  + execute_bios_config_read()
  + execute_bios_config_write()
  + execute_scp_export()
  + execute_scp_import()

src/components/servers/
  VirtualMediaDialog.tsx (new)
  BiosConfigDialog.tsx (new)
  ScpBackupDialog.tsx (new)

src/pages/
  Servers.tsx (updated - add menu items)

supabase/migrations/
  YYYYMMDDHHMMSS_add_advanced_redfish_features.sql (new)
```

---

## Success Metrics

### Feature Adoption
- % of servers with BIOS baselines captured
- Number of virtual media mounts per week
- Number of SCP backups created

### Operational Efficiency
- Time saved on OS deployments (virtual media)
- Configuration drift detection (BIOS baselines)
- Disaster recovery time (SCP restore)

### System Reliability
- Job success rate for each feature
- Average job duration
- Error rate by operation type

---

## Next Steps

1. **Review & Approval**: Get stakeholder sign-off on plan
2. **Environment Setup**: Ensure test iDRAC servers available
3. **Sprint Planning**: Break phases into 2-week sprints
4. **Kickoff Phase 1**: Start with database migration

---

## Questions & Decisions Needed

1. **SCP File Storage**: Store SCP files on job executor host or in Supabase Storage?
   - **Recommendation**: Job executor host for offline-first architecture
   
2. **Virtual Media Sources**: Which protocols to prioritize?
   - **Recommendation**: HTTP/HTTPS first, then NFS, then CIFS
   
3. **BIOS Attribute UI**: Flat list or categorized tree?
   - **Recommendation**: Categorized accordion for better UX
   
4. **Backup Retention**: Auto-delete old SCP backups?
   - **Recommendation**: Yes, after 90 days by default (configurable)

5. **Bulk Operations**: Support multi-server BIOS changes in Phase 1?
   - **Recommendation**: Phase 5, use job chaining

---

## References

- [Dell iDRAC Redfish API Guide](https://www.dell.com/support/manuals/en-us/idrac9-lifecycle-controller-v5.x-series/idrac9_5.00.00.00_redfishapiguide/)
- [DMTF Redfish Specification](https://www.dmtf.org/standards/redfish)
- Existing: `docs/JOB_EXECUTOR_GUIDE.md`
- Existing: `ARCHITECTURE.md`
