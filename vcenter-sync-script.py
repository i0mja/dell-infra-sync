#!/usr/bin/env python3
"""
vCenter Sync Script for Dell Server Manager
============================================

This script runs on your local network to fetch ESXi host data from vCenter
and syncs it to the Dell Server Manager cloud application.

Requirements:
- Python 3.7+
- pip install requests pyvmomi

Usage:
1. Configure the settings below
2. Run: python vcenter-sync-script.py
3. Optionally schedule via cron for automatic syncing

Security Notes:
- Store vCenter credentials securely (use environment variables)
- The script only needs read-only access to vCenter
- JWT token is obtained via your Dell Server Manager login
"""

import ssl
import requests
import sys
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit
import json
import getpass
import os

# ============================================================================
# CONFIGURATION - Update these settings
# ============================================================================

# Your Dell Server Manager URL (deployed app)
DSM_URL = "https://your-app.lovable.app"  # Change this to your actual URL

# vCenter connection settings
VCENTER_HOST = "vcenter.example.com"  # Your vCenter hostname/IP
VCENTER_USER = os.getenv("VCENTER_USER", "administrator@vsphere.local")
VCENTER_PASSWORD = os.getenv("VCENTER_PASSWORD", "")  # Set via env var or prompt

# Authentication for Dell Server Manager
DSM_EMAIL = os.getenv("DSM_EMAIL", "")  # Your admin/operator account
DSM_PASSWORD = os.getenv("DSM_PASSWORD", "")  # Set via env var or prompt

# SSL Settings
VERIFY_SSL = False  # Set to True if you have valid certs

# ============================================================================
# No need to modify below this line
# ============================================================================

class VCenterSync:
    def __init__(self):
        self.vcenter_conn = None
        self.jwt_token = None
        
    def authenticate_dsm(self):
        """Authenticate with Dell Server Manager and get JWT token"""
        print("Authenticating with Dell Server Manager...")
        
        email = DSM_EMAIL or input("Dell Server Manager Email: ")
        password = DSM_PASSWORD or getpass.getpass("Dell Server Manager Password: ")
        
        # Get the Supabase URL and key from the DSM instance
        # These are public values exposed by the app
        login_url = f"{DSM_URL}/auth/v1/token?grant_type=password"
        
        # Note: In production, you'd get these from the DSM API
        # For now, user needs to get their JWT from browser localStorage after login
        print("\n" + "="*70)
        print("AUTHENTICATION SETUP REQUIRED")
        print("="*70)
        print("\nTo get your authentication token:")
        print(f"1. Open {DSM_URL} in your browser")
        print("2. Sign in with your credentials")
        print("3. Open browser DevTools (F12)")
        print("4. Go to Console tab")
        print("5. Run: localStorage.getItem('sb-{project-id}-auth-token')")
        print("6. Copy the 'access_token' value")
        print("\nPaste your JWT token below:")
        print("="*70 + "\n")
        
        self.jwt_token = input("JWT Token: ").strip()
        
        if not self.jwt_token:
            raise ValueError("JWT token is required")
            
        print("✓ Authentication configured\n")
        return True
        
    def connect_vcenter(self):
        """Connect to vCenter server"""
        print(f"Connecting to vCenter: {VCENTER_HOST}...")
        
        password = VCENTER_PASSWORD or getpass.getpass(f"vCenter Password for {VCENTER_USER}: ")
        
        # Disable SSL verification if needed (for self-signed certs)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        if not VERIFY_SSL:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        
        try:
            self.vcenter_conn = SmartConnect(
                host=VCENTER_HOST,
                user=VCENTER_USER,
                pwd=password,
                sslContext=context
            )
            atexit.register(Disconnect, self.vcenter_conn)
            print(f"✓ Connected to vCenter: {VCENTER_HOST}\n")
            return True
        except Exception as e:
            print(f"✗ Failed to connect to vCenter: {e}")
            return False
            
    def get_esxi_hosts(self):
        """Fetch all ESXi hosts from vCenter"""
        print("Fetching ESXi hosts from vCenter...")
        
        content = self.vcenter_conn.RetrieveContent()
        container = content.rootFolder
        view_type = [vim.HostSystem]
        recursive = True
        
        container_view = content.viewManager.CreateContainerView(
            container, view_type, recursive
        )
        
        hosts = []
        for host_obj in container_view.view:
            try:
                # Get cluster name
                cluster_name = None
                if host_obj.parent and isinstance(host_obj.parent, vim.ClusterComputeResource):
                    cluster_name = host_obj.parent.name
                
                # Get serial number from hardware
                serial_number = None
                if host_obj.hardware and host_obj.hardware.systemInfo:
                    serial_number = host_obj.hardware.systemInfo.serialNumber
                
                # Get maintenance mode status
                maintenance_mode = host_obj.runtime.inMaintenanceMode if host_obj.runtime else False
                
                # Get connection status
                status = "unknown"
                if host_obj.runtime:
                    conn_state = str(host_obj.runtime.connectionState)
                    status = conn_state.lower()
                
                # Get ESXi version
                esxi_version = None
                if host_obj.config and host_obj.config.product:
                    esxi_version = f"{host_obj.config.product.version} {host_obj.config.product.build}"
                
                host_data = {
                    "name": host_obj.name,
                    "cluster": cluster_name,
                    "vcenter_id": host_obj._moId,  # Managed Object ID
                    "serial_number": serial_number,
                    "esxi_version": esxi_version,
                    "status": status,
                    "maintenance_mode": maintenance_mode,
                }
                
                hosts.append(host_data)
                print(f"  ✓ {host_obj.name} ({cluster_name or 'No Cluster'})")
                
            except Exception as e:
                print(f"  ✗ Error processing host {host_obj.name}: {e}")
                
        container_view.Destroy()
        print(f"\n✓ Found {len(hosts)} ESXi hosts\n")
        return hosts
        
    def sync_to_cloud(self, hosts):
        """Send host data to Dell Server Manager cloud"""
        print(f"Syncing {len(hosts)} hosts to Dell Server Manager cloud...")
        
        url = f"{DSM_URL}/functions/v1/vcenter-sync"
        headers = {
            "Authorization": f"Bearer {self.jwt_token}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "hosts": hosts
        }
        
        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                print("\n" + "="*70)
                print("SYNC COMPLETED SUCCESSFULLY")
                print("="*70)
                print(f"Total hosts: {result['summary']['total']}")
                print(f"New hosts: {result['summary']['new']}")
                print(f"Updated hosts: {result['summary']['updated']}")
                print(f"Auto-linked servers: {result['summary']['auto_linked']}")
                if result['summary']['errors'] > 0:
                    print(f"Errors: {result['summary']['errors']}")
                    if 'errors' in result:
                        for error in result['errors']:
                            print(f"  - {error}")
                print("="*70 + "\n")
                return True
            else:
                print(f"\n✗ Sync failed: HTTP {response.status_code}")
                print(f"Response: {response.text}\n")
                return False
                
        except Exception as e:
            print(f"\n✗ Error syncing to cloud: {e}\n")
            return False
            
    def run(self):
        """Main execution flow"""
        print("\n" + "="*70)
        print("Dell Server Manager - vCenter Sync Script")
        print("="*70 + "\n")
        
        try:
            # Step 1: Authenticate with DSM
            if not self.authenticate_dsm():
                return False
                
            # Step 2: Connect to vCenter
            if not self.connect_vcenter():
                return False
                
            # Step 3: Fetch ESXi hosts
            hosts = self.get_esxi_hosts()
            if not hosts:
                print("No hosts found in vCenter")
                return False
                
            # Step 4: Sync to cloud
            if not self.sync_to_cloud(hosts):
                return False
                
            print("✓ All operations completed successfully!")
            return True
            
        except KeyboardInterrupt:
            print("\n\n✗ Operation cancelled by user")
            return False
        except Exception as e:
            print(f"\n✗ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            return False

def main():
    sync = VCenterSync()
    success = sync.run()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
