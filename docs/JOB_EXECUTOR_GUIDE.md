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

3. **vCenter Sync** (handled by separate script)
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

3. **Credentials**
   - Service Role Key from Supabase (for API access)
   - vCenter credentials
   - iDRAC default credentials

### Setup Instructions

#### Step 1: Get Service Role Key

1. Open your Dell Server Manager backend
2. Navigate to Settings → API
3. Copy the `service_role` key (starts with `eyJ...`)
4. **IMPORTANT**: This is a SECRET - do not commit to version control

#### Step 2: Configure the Script

Edit `job-executor.py` and update these settings:

```python
# Your Dell Server Manager URL
DSM_URL = "https://your-app.lovable.app"  # Change this

# vCenter connection
VCENTER_HOST = "vcenter.example.com"
VCENTER_USER = "administrator@vsphere.local"

# iDRAC credentials (for discovery and firmware updates)
IDRAC_DEFAULT_USER = "root"
IDRAC_DEFAULT_PASSWORD = "calvin"

# Polling interval (seconds)
POLL_INTERVAL = 10  # Check for jobs every 10 seconds
```

#### Step 3: Set Environment Variables (Recommended)

For security, use environment variables:

```bash
# Linux/Mac
export SERVICE_ROLE_KEY="your-service-role-key-here"
export VCENTER_PASSWORD="your-vcenter-password"
export IDRAC_PASSWORD="your-idrac-password"

# Windows PowerShell
$env:SERVICE_ROLE_KEY="your-service-role-key-here"
$env:VCENTER_PASSWORD="your-vcenter-password"
$env:IDRAC_PASSWORD="your-idrac-password"
```

#### Step 4: Run the Executor

```bash
python job-executor.py
```

Output:
```
======================================================================
Dell Server Manager - Job Executor
======================================================================
Polling interval: 10 seconds
Target URL: https://your-app.lovable.app
======================================================================
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

### Next Steps

- Implement full Redfish firmware update
- Add vCenter maintenance mode operations
- Auto-insert discovered servers into database
- Add retry logic for failed tasks
- Implement job cancellation
- Add email/Teams notifications on job completion

### Support

For issues:
1. Check script console output
2. View job details in UI
3. Check audit logs in backend
4. Verify network connectivity
5. Review this guide's troubleshooting section
