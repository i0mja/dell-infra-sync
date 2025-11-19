## Job Executor Guide

### Overview

The Job Executor is a Python script that runs on your local network to execute jobs created in the Dell Server Manager cloud application. It polls for pending jobs and performs operations that require access to your private network infrastructure (iDRAC, vCenter).

### Architecture

```
Cloud (Dell Server Manager)         Local Network (Your Infrastructure)
┌──────────────────────┐            ┌─────────────────────────────┐
│                      │            │                             │
│  User creates job    │            │  Job Executor (Python)      │
│  in UI               │            │         ↓                   │
│         ↓            │            │  Polls for pending jobs     │
│  Job stored in       │  ←─────────┤         ↓                   │
│  database (pending)  │   HTTPS    │  Executes operations:       │
│         ↓            │            │    • iDRAC Redfish API      │
│  Job Executor polls  │  ─────────→│    • vCenter maintenance    │
│  and fetches job     │   HTTPS    │    • IP discovery scans     │
│         ↓            │            │         ↓                   │
│  Receives progress   │  ←─────────┤  Reports progress back      │
│  updates in realtime │   HTTPS    │                             │
│                      │            │                             │
└──────────────────────┘            └─────────────────────────────┘
```

### Supported Job Types

1. **Firmware Update**
   - Updates Dell server firmware via iDRAC Redfish API
   - Orchestrates vCenter maintenance mode (enter/exit)
   - Rolling updates (one server at a time)
   - Real-time progress reporting

2. **IP Discovery Scan**
   - Scans IP ranges for Dell iDRAC endpoints
   - Tests connectivity and extracts hardware info
   - Reports discovered servers to cloud

3. **Full Server Update**
   - Updates all firmware components automatically in Dell-recommended order
   - Orchestrates sequential component updates: iDRAC → BIOS → CPLD → RAID → NIC → Backplane
   - Critical component failures (iDRAC, BIOS) stop the entire job
   - Non-critical component failures are logged but don't stop remaining updates
   - Each server gets one parent job with multiple sub-jobs (one per component)
   - All firmware updates use latest available versions with OnReset apply time

4. **vCenter Sync** (handled by separate script)
   - See `VCENTER_SYNC_GUIDE.md`

### Prerequisites

1. **Python Environment**
   ```bash
   pip install requests pyVmomi
   ```

2. **Network Access**
   - Connectivity to your Dell servers' iDRAC interfaces
   - Connectivity to vCenter (if using maintenance mode)
   - Outbound HTTPS to your Dell Server Manager URL

3. **Firmware Repository Options**
   
   **Option A: Manual Repository (Air-Gapped/Offline)**
   - HTTP/HTTPS server hosting Dell Update Packages (DUP files)
   - Must be accessible from iDRAC management network
   - Organized structure (e.g., `/dell/BIOS/`, `/dell/iDRAC/`, etc.)
   - Example: `http://firmware.example.com/dell/BIOS_R720_2.9.0.exe`
   - Works in completely offline environments
   
   **Option B: Dell Online Catalog (Internet-Connected)**
   - iDRAC downloads firmware directly from downloads.dell.com
   - No local repository needed
   - Always gets latest available firmware
   - Requires internet connectivity from iDRAC
   - DNS resolution and HTTPS (443) outbound required

4. **Credentials**
   - Service Role Key from Supabase (for API access)
   - vCenter credentials
   - iDRAC default credentials

### Troubleshooting Network Connectivity

Before running the Job Executor, verify that the machine where it will run has network access to your iDRACs.

#### Test iDRAC Connectivity Manually

**From PowerShell (Windows):**
```powershell
# Basic connectivity test (use curl.exe, not the PowerShell alias)
curl.exe -k -u "root:password" https://10.207.125.193/redfish/v1/

# Verbose test with full response
curl.exe -k -v -u "root:password" https://10.207.125.193/redfish/v1/

# Or using Invoke-WebRequest
$cred = Get-Credential
Invoke-WebRequest -Uri "https://10.207.125.193/redfish/v1/" -Credential $cred -SkipCertificateCheck
```

**From Bash (Linux/Mac):**
```bash
# Basic connectivity test
curl -k -u root:password https://10.207.125.193/redfish/v1/

# Verbose test with timing
time curl -k -v -u root:password https://10.207.125.193/redfish/v1/
```

**Expected Response:**
- HTTP status: `200 OK` or `401 Unauthorized` (both indicate reachability)
- JSON response with `"@odata.id":"/redfish/v1"`
- Response time: < 2 seconds typical

**If connectivity fails, check:**
- Network routing to iDRAC subnet (e.g., `ping 10.207.125.193`)
- Firewall rules allowing port 443
- iDRAC network configuration (check iDRAC web console)
- Credentials are correct
- iDRAC is powered on and responsive

**Why Network Validation Doesn't Work in Cloud Mode:**

The "Test All Prerequisites" button in Settings uses edge functions that run in the cloud. These cannot reach your private iDRAC network (e.g., 10.x.x.x, 192.168.x.x). This is expected and correct behavior for security.

When Job Executor mode is enabled, network validation is skipped in the cloud UI. Use the Job Executor running on your local network for all iDRAC operations.

### Setup Instructions

#### Step 1: Get Service Role Key

1. Open your Dell Server Manager backend
2. Navigate to Settings → API
3. Copy the `service_role` key (starts with `eyJ...`)
4. **IMPORTANT**: This is a SECRET - do not commit to version control

#### Step 2: Set Up Firmware Repository

**IMPORTANT**: Before running firmware updates, you must set up an HTTP server with Dell firmware packages:

1. **Download Dell Update Packages (DUP files)**
   - Visit Dell Support: https://www.dell.com/support
   - Download `.EXE` files for your components (BIOS, iDRAC, RAID, etc.)
   - Example: `iDRAC-with-Lifecycle-Controller_Firmware_ABC123_WN64_4.40.00.00_A00.EXE`

2. **Set up HTTP Server**
   ```bash
   # Simple Python HTTP server (for testing only)
   mkdir -p /opt/firmware-repo/dell
   cd /opt/firmware-repo
   python3 -m http.server 8080
   
   # For production, use Apache/Nginx with proper access controls
   ```

3. **Organize Firmware Files**
   ```
   /opt/firmware-repo/dell/
   ├── BIOS_R720_2.9.0.exe
   ├── BIOS_R730_2.11.0.exe
   ├── iDRAC_4.40.00.00.exe
   ├── RAID_H730_25.5.9.0001.exe
   └── ...
   ```

4. **Verify Accessibility**
   - Ensure iDRAC can reach the HTTP server
   - Test: `curl http://your-server:8080/dell/BIOS_R720_2.9.0.exe -I`

#### Step 3: Configure the Script

Edit `job-executor.py` and update these settings (or use environment variables):

```python
# Dell Server Manager URL - defaults to local Supabase
DSM_URL = os.getenv("DSM_URL", "http://127.0.0.1:54321")

# Firmware repository URL
FIRMWARE_REPO_URL = os.getenv("FIRMWARE_REPO_URL", "http://firmware.example.com:8080/dell")

# vCenter connection
VCENTER_HOST = os.getenv("VCENTER_HOST", "vcenter.example.com")
VCENTER_USER = os.getenv("VCENTER_USER", "administrator@vsphere.local")

# iDRAC credentials (for discovery and firmware updates)
IDRAC_DEFAULT_USER = os.getenv("IDRAC_USER", "root")
IDRAC_DEFAULT_PASSWORD = os.getenv("IDRAC_PASSWORD", "calvin")
```

#### Step 4: Run Job Executor

**For Local Development (Supabase running on localhost):**

```bash
# Linux/macOS
export DSM_URL="http://127.0.0.1:54321"
export SERVICE_ROLE_KEY="your-service-role-key"
python3 job-executor.py

# Windows PowerShell
$env:DSM_URL="http://127.0.0.1:54321"
$env:SERVICE_ROLE_KEY="your-service-role-key"
python job-executor.py
```

**For Cloud/Production Deployments:**

```bash
# Linux/macOS
export DSM_URL="https://ylwkczjqvymshktuuqkx.supabase.co"
export SERVICE_ROLE_KEY="your-service-role-key"
python3 job-executor.py

# Windows PowerShell
$env:DSM_URL="https://ylwkczjqvymshktuuqkx.supabase.co"
$env:SERVICE_ROLE_KEY="your-service-role-key"
python job-executor.py
```

**Additional Environment Variables (Optional):**

```bash
# Firmware repository
export FIRMWARE_REPO_URL="http://your-firmware-server:8080/dell"

# vCenter credentials
export VCENTER_HOST="vcenter.example.com"
export VCENTER_USER="administrator@vsphere.local"
export VCENTER_PASSWORD="your-vcenter-password"

# iDRAC default credentials
export IDRAC_USER="root"
export IDRAC_PASSWORD="your-idrac-password"
```

**Expected Output:**

```
======================================================================
Dell Server Manager - Job Executor
======================================================================
DSM_URL: http://127.0.0.1:54321
Polling interval: 10 seconds
SSL Verification: False
======================================================================
✓ Configuration validated
✓ Configuration validated
Job executor started. Polling for jobs...
```

The script will:
1. Poll for pending jobs every 10 seconds
2. Execute jobs as they become ready
3. Report progress back to the cloud in real-time
4. Continue running until stopped (Ctrl+C)

### How It Works

#### Firmware Update Job Flow

1. **User creates job in UI**
   - Selects target servers
   - Optionally schedules for later
   - Job created with status = "pending"

2. **Job Executor picks up job**
   - Polls API for pending jobs
   - Finds jobs ready to execute (not scheduled or schedule time reached)

3. **For each server in the job:**
   - Check if linked to vCenter host
   - **If linked**: Enter vCenter maintenance mode
   - Update firmware via iDRAC Redfish API
   - Wait for server reboot
   - **If linked**: Exit maintenance mode
   - Report task completion

### Firmware Update Options

The Job Executor supports three methods for firmware delivery:

#### **Option 1: Manual Repository (Offline/Air-Gapped)**

**Best for:** Air-gapped datacenters, controlled environments, strict change management

- Host firmware files on local HTTP/HTTPS server
- Full control over firmware versions deployed
- Works in completely offline environments
- Requires manual firmware downloads from Dell Support

**Setup:**
```bash
# Example: Simple HTTP server for firmware repository
mkdir -p /opt/firmware-repo/dell
cd /opt/firmware-repo
python3 -m http.server 8080

# Or use production web server (Apache/Nginx)
```

**File organization:**
```
/opt/firmware-repo/dell/
├── BIOS_R740_2.23.0.exe
├── iDRAC_7.00.00.174.exe
├── NIC_Broadcom_23.0.1.exe
└── RAID_H740_25.5.9.exe
```

**Job creation:** Select "Manual Repository" and provide full URL:
```
http://firmware.example.com:8080/dell/BIOS_R740_2.23.0.exe
```

---

#### **Option 2: Dell Online Catalog (Internet-Connected)** ⭐ **Recommended**

**Best for:** Internet-connected servers, lab environments, always-latest deployments

- iDRAC downloads firmware directly from downloads.dell.com
- Automatically gets latest Dell-approved firmware
- No local repository to maintain
- Zero bandwidth cost from your infrastructure

**Requirements:**
- iDRAC must have default gateway configured
- DNS resolution enabled on iDRAC (`dig downloads.dell.com` must work)
- Firewall allows HTTPS (443) outbound to Dell CDN
- iDRAC firmware version 4.00.00.00 or newer

**How it works:**
1. iDRAC queries `https://downloads.dell.com/catalog/Catalog.xml`
2. Identifies all applicable firmware for the specific server model/service tag
3. Downloads only the selected component(s) or all if "auto-select latest" enabled
4. Applies updates based on schedule (OnReset or Immediate)

**Job creation:** Select "Dell Online Catalog" and optionally:
- Use default catalog URL (recommended)
- Choose specific component or "all components"
- Enable/disable "auto-select latest"

**Network validation:**
```bash
# Test from machine with iDRAC-like network access
curl -I https://downloads.dell.com/catalog/Catalog.xml

# Test DNS resolution
nslookup downloads.dell.com

# Test from iDRAC SSH (if enabled)
ssh root@idrac-ip
ping downloads.dell.com
```

---

#### **Option 3: Dell Direct URL**

**Best for:** Specific firmware versions, testing, targeted deployments

- Uses Dell's download servers but with specific file URL
- Still requires internet but with version control
- Good for "pin to known-good version" scenarios

**Job creation:** Select "Dell Direct URL" and provide full Dell download URL:
```
https://downloads.dell.com/FOLDER09876543M/1/BIOS_ABC12_WN64_2.23.0.EXE
```

**Finding Dell URLs:**
1. Go to dell.com/support
2. Search by service tag
3. Find firmware update
4. Right-click "Download" → Copy Link Address

---

### Comparison Matrix

| Feature | Manual Repository | Dell Online Catalog | Dell Direct URL |
|---------|------------------|---------------------|-----------------|
| **Internet Required** | No | Yes (from iDRAC) | Yes (from iDRAC) |
| **Maintenance Effort** | High (manual downloads) | None | Low (find URLs) |
| **Version Control** | Full control | Always latest | Specific version |
| **Bandwidth Usage** | From your network | From Dell CDN | From Dell CDN |
| **Air-gap Support** | ✅ Yes | ❌ No | ❌ No |
| **Setup Complexity** | High (HTTP server) | None | None |
| **Firmware Currency** | Manual | Automatic | Manual |

### Deployment Scenarios

**Scenario: Production datacenter with DMZ**
- **DMZ servers:** Dell Online Catalog (internet access)
- **Internal servers:** Manual Repository (no internet)
- **Job Executor:** Runs on internal network with access to both zones

**Scenario: Fully air-gapped environment**
- **All servers:** Manual Repository only
- **Job Executor:** On same isolated network
- **Firmware updates:** Manually transfer DUP files to repository server

**Scenario: Lab/development environment**
- **All servers:** Dell Online Catalog
- **Job Executor:** Any machine with iDRAC access
- **Always latest firmware automatically**

**Scenario: Hybrid with change control**
- **Pre-production:** Dell Online Catalog (test latest)
- **Production:** Manual Repository (controlled versions)
- **Workflow:** Test latest in pre-prod → download approved versions → deploy to prod

4. **Real-time updates**
   - Task status updates sent to cloud
   - UI shows live progress
   - Job marked as completed/failed

#### Discovery Scan Job Flow

1. **User creates discovery scan**
   - Specifies IP range (CIDR or range)
   - Job created

2. **Job Executor executes scan**
   - Parses IP range
   - Tests each IP concurrently (20 threads)
   - Attempts Redfish API connection
   - Extracts hardware info if successful

3. **Results reported**
   - Discovered servers logged
   - TODO: Auto-insert into database
   - Job marked complete

#### Full Server Update Job Flow

1. **User creates full server update job in UI**
   - Selects target servers
   - Optionally provides custom firmware repository URI
   - One parent job created with status = "pending"

2. **Edge function creates sub-jobs**
   - Automatically creates 6 sub-jobs (one per component) linked to parent job
   - Sub-jobs ordered by Dell best practice sequence:
     1. iDRAC / Lifecycle Controller (order: 1)
     2. BIOS (order: 2)
     3. CPLD / FPGA (order: 3)
     4. RAID Controller (order: 4)
     5. Network Adapter (order: 5)
     6. Backplane (order: 6)

3. **Job Executor orchestrates updates**
   - Fetches all sub-jobs ordered by component_order
   - Executes each sub-job sequentially using `execute_firmware_update()`
   - Polls sub-job status until completion (15-minute timeout per component)
   - **Critical component failure handling:**
     - If iDRAC or BIOS fails: Stop entire job immediately
     - If other components fail: Log and continue with remaining updates
   - Updates parent job with:
     - Total components attempted
     - Failed components list
     - Completed components count

4. **Real-time monitoring**
   - UI shows parent job with expandable sub-jobs list
   - Each sub-job shows individual component status and progress
   - Parent job status reflects overall completion

**Benefits:**
- ✅ One-click to update everything
- ✅ Always follows Dell-recommended order
- ✅ Smart failure handling (critical vs non-critical)
- ✅ Clear visibility into which components succeeded/failed
- ✅ Suitable for scheduled maintenance windows

**Time Estimate:**
- Approximately 60-90 minutes per server
- Depends on number of components requiring updates

**Recommended Use:**
- Ideal for scheduled maintenance windows
- Best for servers requiring comprehensive updates
- Ensures proper update order automatically without manual intervention

### Running as a Service

#### Linux - systemd Service

Create `/etc/systemd/system/job-executor.service`:

```ini
[Unit]
Description=Dell Server Manager Job Executor
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/script
Environment="SERVICE_ROLE_KEY=your-key"
Environment="VCENTER_PASSWORD=your-password"
Environment="IDRAC_PASSWORD=your-password"
ExecStart=/usr/bin/python3 /path/to/job-executor.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable job-executor
sudo systemctl start job-executor
sudo systemctl status job-executor
```

View logs:
```bash
sudo journalctl -u job-executor -f
```

#### Windows - Task Scheduler

1. Create a batch script `run-executor.bat`:
```batch
@echo off
set SERVICE_ROLE_KEY=your-key-here
set VCENTER_PASSWORD=your-password
set IDRAC_PASSWORD=your-password
cd C:\path\to\script
python job-executor.py
```

2. Create scheduled task:
   - Trigger: At system startup
   - Action: Start `run-executor.bat`
   - Run whether user is logged on or not
   - Run with highest privileges

### Monitoring

#### UI Monitoring
- Navigate to **Jobs** page in Dell Server Manager
- View active jobs with real-time progress
- Click any job to see detailed task status
- Progress bars update automatically (no refresh needed)

#### Script Logs
The job executor provides detailed console output:

```
[2025-11-03 16:00:00] [INFO] Found 1 pending job(s)
[2025-11-03 16:00:00] [INFO] Executing job abc123 (firmware_update)
[2025-11-03 16:00:00] [INFO] Starting firmware update job abc123
[2025-11-03 16:00:00] [INFO] Processing 3 servers...
[2025-11-03 16:00:01] [INFO] Processing server: esx01.example.com
[2025-11-03 16:00:01] [INFO]   Entering maintenance mode...
[2025-11-03 16:00:03] [INFO]   Updating firmware on 192.168.1.10...
[2025-11-03 16:00:06] [INFO]   Exiting maintenance mode...
[2025-11-03 16:00:07] [INFO]   ✓ Completed
...
[2025-11-03 16:00:25] [INFO] Firmware update job complete: 3/3 successful
```

### Security Considerations

1. **Service Role Key Protection**
   - Store in environment variables only
   - Never commit to version control
   - Rotate regularly
   - Restrict access to the key file/env

2. **Network Isolation**
   - Run executor on a secure, managed server
   - Use firewall rules to restrict access
   - Consider running in a dedicated VLAN

3. **Credentials Management**
   - Use read-only vCenter account when possible
   - iDRAC credentials should have minimum required permissions
   - Rotate all credentials regularly

4. **SSL Verification**
   - Set `VERIFY_SSL = True` if you have valid certificates
   - For production, enable SSL verification

### Troubleshooting

#### "SERVICE_ROLE_KEY not set"
- Set the environment variable before running
- Check spelling and value

#### "Error fetching jobs: 401"
- Service role key is invalid or expired
- Get a fresh key from backend

#### "Failed to connect to vCenter"
- Check VCENTER_HOST is correct
- Verify credentials
- Ensure network connectivity

#### "Error testing iDRAC"
- Check iDRAC credentials
- Verify network can reach iDRAC IPs
- Ensure iDRAC Redfish API is enabled

#### Jobs stuck in "pending"
- Check job executor is running
- Verify poll interval isn't too long
- Check script logs for errors
- Ensure job isn't scheduled for future

#### Real-time updates not working
- Check network connectivity
- Verify websocket connections aren't blocked
- Refresh browser page

### Advanced Configuration

#### Custom Polling Interval
Adjust based on your needs:
```python
POLL_INTERVAL = 30  # Check every 30 seconds (less frequent)
POLL_INTERVAL = 5   # Check every 5 seconds (more responsive)
```

#### Concurrent Discovery Scans
Adjust thread pool size:
```python
with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
    # Scan 50 IPs concurrently
```

#### Firmware Update Timeout
Add timeouts for Redfish operations:
```python
response = requests.post(
    url,
    auth=(username, password),
    json=payload,
    verify=False,
    timeout=300  # 5 minute timeout
)
```

### Firmware Update Details

#### How Redfish Firmware Updates Work

1. **SimpleUpdate Method**
   - iDRAC downloads firmware from HTTP URI
   - Stages firmware in iDRAC memory
   - Applies firmware based on `apply_time` setting
   - Handles job queuing and scheduling

2. **Apply Time Options**
   - **OnReset**: Firmware applied on next reboot (recommended)
   - **Immediate**: Firmware applied immediately (may cause disruption)

3. **Update Flow**
   ```
   Create Session → Get Inventory → Enter Maintenance (optional)
   → Initiate Update → Monitor Progress (0-100%)
   → Trigger Reboot → Wait for Online → Exit Maintenance
   → Verify New Version → Close Session
   ```

#### Supported Components

- **BIOS**: System firmware
- **iDRAC**: Management controller firmware
- **RAID**: Storage controller firmware
- **NIC**: Network adapter firmware
- **Backplane**: Storage backplane firmware
- **PSU**: Power supply unit firmware

#### Troubleshooting Firmware Updates

**"Failed to initiate update: 400"**
- Check firmware URI is correct and accessible from iDRAC
- Verify firmware package matches server model
- Ensure iDRAC has network access to firmware repo

**"Update failed: Job already exists"**
- Another update is in progress
- Clear iDRAC job queue: iDRAC Web UI → Maintenance → Job Queue
- Wait for existing jobs to complete

**"System did not come back online"**
- Some updates require multiple reboots
- Check server physical console
- Verify network connectivity
- Increase `SYSTEM_REBOOT_WAIT` timeout

**"Firmware update timed out"**
- Large firmware files take longer to download
- Increase `FIRMWARE_UPDATE_TIMEOUT`
- Check network bandwidth to iDRAC

### Next Steps

- Add vCenter maintenance mode operations (currently simulated)
- Auto-insert discovered servers into database
- Add retry logic for failed tasks
- Implement job cancellation
- Add email/Teams notifications on job completion
- Add pre-update health checks (disk space, power redundancy)

### Support

For issues:
1. Check script console output
2. View job details in UI
3. Check audit logs in backend
4. Verify network connectivity
5. Review this guide's troubleshooting section
