# vCenter Sync Guide

## Overview

This guide explains how to sync ESXi host data from your private vCenter server to the Dell Server Manager cloud application.

## Architecture

```
Your Network                          Internet/Cloud
┌─────────────────────────┐          ┌──────────────────────┐
│                         │          │                      │
│  vCenter Server         │          │  Dell Server Manager │
│  (Private Network)      │          │  (Lovable Cloud)     │
│         ↓               │          │         ↑            │
│  Python Sync Script ────┼──────────┼────────→│            │
│  (runs on your network) │   HTTPS  │  Edge Function       │
│                         │          │  + Database          │
└─────────────────────────┘          └──────────────────────┘
```

The sync script runs on your local network, fetches data from vCenter, and pushes it to the cloud via HTTPS API.

## Prerequisites

### 1. Python Environment
- Python 3.7 or higher
- pip package manager

### 2. Install Required Packages
```bash
pip install requests pyvmomi
```

### 3. vCenter Access
- vCenter hostname/IP address
- vCenter username (read-only access is sufficient)
- vCenter password
- Network connectivity to vCenter from where the script runs

### 4. Dell Server Manager Access
- Your deployed app URL (e.g., https://your-app.lovable.app)
- Admin or Operator account credentials
- JWT authentication token

## Setup Instructions

### Step 1: Download the Sync Script

The sync script is located at: `vcenter-sync-script.py` in your project root.

### Step 2: Configure the Script

Edit `vcenter-sync-script.py` and update these settings:

```python
# Your Dell Server Manager URL
DSM_URL = "https://your-app.lovable.app"  # ← Change this

# vCenter connection
VCENTER_HOST = "vcenter.example.com"  # ← Your vCenter hostname/IP
VCENTER_USER = "readonly@vsphere.local"  # ← vCenter username
```

### Step 3: Set Environment Variables (Recommended)

For security, use environment variables instead of hardcoding credentials:

```bash
# Linux/Mac
export VCENTER_USER="readonly@vsphere.local"
export VCENTER_PASSWORD="your-vcenter-password"
export DSM_EMAIL="admin@company.com"
export DSM_PASSWORD="your-dsm-password"

# Windows PowerShell
$env:VCENTER_USER="readonly@vsphere.local"
$env:VCENTER_PASSWORD="your-vcenter-password"
$env:DSM_EMAIL="admin@company.com"
$env:DSM_PASSWORD="your-dsm-password"
```

### Step 4: Get Your JWT Token

1. Open your Dell Server Manager in a browser
2. Sign in with your admin/operator account
3. Open browser DevTools (F12)
4. Go to the Console tab
5. Run this command:
   ```javascript
   JSON.parse(localStorage.getItem('sb-ylwkczjqvymshktuuqkx-auth-token')).access_token
   ```
6. Copy the token value (starts with "eyJ...")

This token will be valid for 1 hour by default. For automated scripts, you can modify the script to use email/password authentication.

### Step 5: Run the Script

```bash
python vcenter-sync-script.py
```

The script will:
1. Prompt for any missing credentials
2. Connect to vCenter
3. Fetch all ESXi hosts
4. Push data to the cloud
5. Display sync results

## What Gets Synced

For each ESXi host, the script syncs:
- **Hostname**: ESXi host FQDN
- **Cluster**: Cluster membership (if any)
- **Serial Number**: Hardware serial (for auto-linking)
- **ESXi Version**: e.g., "7.0.3 build 19193900"
- **Status**: connected, disconnected, etc.
- **Maintenance Mode**: Boolean flag
- **vCenter ID**: Managed Object ID

## Auto-Linking Feature

The cloud automatically links ESXi hosts to physical servers when:
1. ESXi host serial number matches a server's Service Tag
2. Neither is already linked
3. Both exist in the database

Auto-linking happens during the sync and is logged in the audit trail.

## Scheduling Automated Syncs

### Linux/Mac - Using Cron

Create a wrapper script `vcenter-sync.sh`:
```bash
#!/bin/bash
export VCENTER_USER="readonly@vsphere.local"
export VCENTER_PASSWORD="your-password"
export DSM_EMAIL="admin@company.com"
export DSM_PASSWORD="your-password"

cd /path/to/script
python3 vcenter-sync-script.py >> /var/log/vcenter-sync.log 2>&1
```

Make it executable:
```bash
chmod +x vcenter-sync.sh
```

Add to crontab (run every hour):
```bash
crontab -e
# Add this line:
0 * * * * /path/to/vcenter-sync.sh
```

### Windows - Using Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (e.g., daily at 2 AM)
4. Action: Start a program
   - Program: `python`
   - Arguments: `C:\path\to\vcenter-sync-script.py`
   - Start in: `C:\path\to\`
5. Create environment variables in task settings

## Monitoring Sync Results

### In the UI
- Navigate to vCenter page in Dell Server Manager
- Check "Last Sync" timestamps on each host
- View auto-linked status badges

### In Audit Logs
- Admin users can view audit logs
- Look for `vcenter_sync` and `auto_link_server` events
- Contains detailed statistics and any errors

### Script Output
The script provides detailed console output:
```
=======================================================================
SYNC COMPLETED SUCCESSFULLY
=======================================================================
Total hosts: 12
New hosts: 2
Updated hosts: 10
Auto-linked servers: 1
=======================================================================
```

## Troubleshooting

### "Failed to connect to vCenter"
- Check VCENTER_HOST is correct (hostname or IP)
- Verify network connectivity: `ping vcenter.example.com`
- Ensure firewall allows outbound HTTPS (443) to vCenter
- Check vCenter credentials

### "Authentication failed" (Dell Server Manager)
- Verify DSM_EMAIL and DSM_PASSWORD are correct
- Check if account has admin or operator role
- Get a fresh JWT token (they expire after 1 hour)

### "Sync failed: HTTP 403"
- Your account doesn't have sufficient permissions
- Ensure you have admin or operator role in Dell Server Manager
- Check JWT token is valid

### "No hosts found in vCenter"
- vCenter user might not have permission to view hosts
- Check vCenter inventory in the vCenter UI

### SSL Certificate Errors
If you have valid SSL certificates, set in the script:
```python
VERIFY_SSL = True
```

For self-signed certificates, keep:
```python
VERIFY_SSL = False
```

### "Auto-link not working"
Auto-linking requires:
1. ESXi host has a serial number reported
2. A server exists with matching Service Tag
3. Neither is already linked to something else

Check in the UI:
- vCenter page: verify hosts have serial numbers
- Servers page: verify servers have Service Tags
- Match must be exact (case-insensitive)

## Security Best Practices

1. **vCenter Credentials**
   - Create a dedicated read-only vCenter user for the sync script
   - Use environment variables, never hardcode passwords
   - Rotate credentials regularly

2. **Dell Server Manager Credentials**
   - Use a dedicated service account (not your personal admin)
   - Store JWT token securely
   - Consider implementing token refresh in the script

3. **Network Security**
   - Run the script on a secure, managed server
   - Use HTTPS for all connections
   - Enable SSL verification if you have valid certificates

4. **Script Security**
   - Restrict file permissions: `chmod 700 vcenter-sync-script.py`
   - Store in a secure location
   - Review script before execution

## Advanced: Token Refresh

For long-running scheduled syncs, you can modify the script to automatically refresh JWT tokens by implementing a login function that calls the Supabase Auth API. Contact support for implementation details.

## Support

For issues:
1. Check the troubleshooting section above
2. Review script output for specific error messages
3. Check audit logs in Dell Server Manager UI
4. Verify all prerequisites are met

## Next Steps

After successful vCenter integration:
- Verify auto-linked servers in the Servers page
- Review cluster topology in vCenter page
- Proceed to Phase 3: Job orchestration for firmware updates
