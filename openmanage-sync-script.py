#!/usr/bin/env python3
"""
Dell OpenManage Enterprise Sync Script
Syncs Dell servers from OpenManage Enterprise to Dell Server Manager Cloud

This script connects to an on-premise Dell OpenManage Enterprise (OME) server,
retrieves all managed Dell servers, and syncs them to the Dell Server Manager
cloud application via an edge function.

Requirements:
    - Python 3.7+
    - requests library: pip install requests

Configuration:
    Set the following environment variables or edit the configuration section:
    - OME_HOST: OpenManage Enterprise hostname/IP
    - OME_PORT: HTTPS port (default: 443)
    - OME_USERNAME: OME admin username
    - OME_PASSWORD: OME admin password
    - OME_VERIFY_SSL: Verify SSL certificates (True/False)
    - DSM_URL: Dell Server Manager application URL
    - DSM_JWT_TOKEN: JWT token for authentication

Usage:
    python openmanage-sync-script.py

Scheduling:
    Linux/Mac (cron):
        0 2 * * * /usr/bin/python3 /path/to/openmanage-sync-script.py >> /var/log/ome-sync.log 2>&1
    
    Windows (Task Scheduler):
        Create a scheduled task to run this script daily
"""

import os
import sys
import json
import requests
import urllib3
from datetime import datetime

# Suppress SSL warnings if verify_ssl is disabled
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================================================
# CONFIGURATION
# ============================================================================

# Dell OpenManage Enterprise Settings
OME_HOST = os.getenv("OME_HOST", "openmanage.example.com")
OME_PORT = int(os.getenv("OME_PORT", "443"))
OME_USERNAME = os.getenv("OME_USERNAME", "admin")
OME_PASSWORD = os.getenv("OME_PASSWORD", "")
OME_VERIFY_SSL = os.getenv("OME_VERIFY_SSL", "true").lower() == "true"

# Dell Server Manager Settings
DSM_EDGE_FUNCTION_URL = os.getenv(
    'DSM_EDGE_FUNCTION_URL',
    'https://ylwkczjqvymshktuuqkx.supabase.co/functions/v1/openmanage-sync'
)
DSM_API_TOKEN = os.getenv('DSM_API_TOKEN', '')

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def log(message):
    """Print timestamped log message"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}")


def extract_value(data, *keys, default=None):
    """Safely extract nested dictionary values"""
    for key in keys:
        if isinstance(data, dict):
            data = data.get(key, {})
        else:
            return default
    return data if data != {} else default


# ============================================================================
# OPENMANAGE SYNC CLASS
# ============================================================================

class OpenManageSync:
    def __init__(self):
        self.session = requests.Session()
        self.ome_auth_token = None
        self.ome_base_url = f"https://{OME_HOST}:{OME_PORT}"
        
        # Validate configuration
        if not OME_PASSWORD:
            raise ValueError("OME_PASSWORD environment variable must be set")
        if not DSM_API_TOKEN:
            raise ValueError("DSM_API_TOKEN environment variable must be set")

    def authenticate_ome(self):
        """Authenticate with OpenManage Enterprise and get x-auth-token"""
        log("Authenticating with OpenManage Enterprise...")
        
        url = f"{self.ome_base_url}/api/SessionService/Sessions"
        payload = {
            "UserName": OME_USERNAME,
            "Password": OME_PASSWORD,
            "SessionType": "API"
        }
        
        try:
            response = self.session.post(
                url,
                json=payload,
                verify=OME_VERIFY_SSL,
                timeout=30
            )
            response.raise_for_status()
            
            # Get auth token from response headers
            self.ome_auth_token = response.headers.get("x-auth-token")
            if not self.ome_auth_token:
                raise ValueError("Failed to get x-auth-token from response headers")
            
            log("Successfully authenticated with OpenManage Enterprise")
            return True
            
        except requests.exceptions.RequestException as e:
            log(f"ERROR: Failed to authenticate with OME: {e}")
            return False

    def get_devices(self):
        """Fetch all devices from OpenManage Enterprise"""
        log("Fetching devices from OpenManage Enterprise...")
        
        url = f"{self.ome_base_url}/api/DeviceService/Devices"
        headers = {
            "x-auth-token": self.ome_auth_token,
            "Content-Type": "application/json"
        }
        
        try:
            response = self.session.get(
                url,
                headers=headers,
                verify=OME_VERIFY_SSL,
                timeout=60
            )
            response.raise_for_status()
            
            data = response.json()
            devices = data.get("value", [])
            
            log(f"Retrieved {len(devices)} devices from OpenManage Enterprise")
            return devices
            
        except requests.exceptions.RequestException as e:
            log(f"ERROR: Failed to fetch devices from OME: {e}")
            return []

    def process_device(self, device):
        """Extract relevant information from OME device object"""
        try:
            # Extract basic information
            device_id = str(device.get("Id", ""))
            service_tag = device.get("DeviceServiceTag", "")
            model = device.get("Model", "")
            device_name = device.get("DeviceName", "")
            
            # Extract IP address from DeviceManagement array
            ip_address = ""
            device_mgmt = device.get("DeviceManagement", [])
            if device_mgmt and len(device_mgmt) > 0:
                ip_address = device_mgmt[0].get("NetworkAddress", "")
            
            # Extract firmware and version information
            bios_version = None
            idrac_firmware = None
            
            # Device capabilities contain firmware information
            capabilities = device.get("DeviceCapabilities", [])
            for cap in capabilities:
                cap_type = cap.get("CapabilityType", {}).get("Name", "")
                if "BIOS" in cap_type:
                    bios_version = cap.get("Version", None)
                elif "iDRAC" in cap_type or "Lifecycle" in cap_type:
                    idrac_firmware = cap.get("Version", None)
            
            # Extract hardware specs
            # These are typically in the device details, may need additional API call
            # For now, set as None - can be enhanced with additional API calls
            cpu_count = None
            memory_gb = None
            
            # Try to get CPU and memory from device summary
            if "Processors" in device:
                cpu_count = len(device.get("Processors", []))
            if "Memory" in device:
                memory_gb = device.get("Memory", {}).get("TotalSystemMemoryGiB", None)
            
            return {
                "device_id": device_id,
                "service_tag": service_tag,
                "model": model,
                "hostname": device_name if device_name else None,
                "ip_address": ip_address,
                "bios_version": bios_version,
                "idrac_firmware": idrac_firmware,
                "cpu_count": cpu_count,
                "memory_gb": memory_gb,
            }
            
        except Exception as e:
            log(f"ERROR: Failed to process device: {e}")
            return None

    def sync_to_cloud(self, devices):
        """Send device data to Dell Server Manager edge function"""
        log(f"Syncing {len(devices)} devices to cloud...")
        
        url = DSM_EDGE_FUNCTION_URL
        headers = {
            "X-API-Token": DSM_API_TOKEN,
            "Content-Type": "application/json"
        }
        
        payload = {
            "devices": devices,
            "manual": True
        }
        
        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                timeout=120
            )
            response.raise_for_status()
            
            result = response.json()
            
            if result.get("success"):
                summary = result.get("summary", {})
                log(f"✓ Sync completed successfully!")
                log(f"  Total devices: {summary.get('total', 0)}")
                log(f"  New servers: {summary.get('new', 0)}")
                log(f"  Updated servers: {summary.get('updated', 0)}")
                log(f"  Auto-linked: {summary.get('auto_linked', 0)}")
                log(f"  Errors: {summary.get('errors', 0)}")
                
                errors = result.get("errors", [])
                if errors:
                    log("Errors encountered:")
                    for error in errors:
                        log(f"  - {error}")
                
                return True
            else:
                log(f"ERROR: Sync failed: {result.get('error', 'Unknown error')}")
                return False
                
        except requests.exceptions.RequestException as e:
            log(f"ERROR: Failed to sync to cloud: {e}")
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_detail = e.response.json()
                    log(f"Error details: {json.dumps(error_detail, indent=2)}")
                except:
                    log(f"Response text: {e.response.text}")
            return False

    def run(self):
        """Main execution flow"""
        log("=" * 60)
        log("Starting Dell OpenManage Enterprise Sync")
        log("=" * 60)
        log(f"OME Host: {OME_HOST}:{OME_PORT}")
        log(f"DSM Edge Function: {DSM_EDGE_FUNCTION_URL}")
        log(f"Verify SSL: {OME_VERIFY_SSL}")
        log("")
        
        # Step 1: Authenticate with OME
        if not self.authenticate_ome():
            log("FAILED: Could not authenticate with OpenManage Enterprise")
            return False
        
        # Step 2: Get all devices
        devices = self.get_devices()
        if not devices:
            log("WARNING: No devices found in OpenManage Enterprise")
            return False
        
        # Step 3: Process devices
        log("Processing device information...")
        processed_devices = []
        for device in devices:
            processed = self.process_device(device)
            if processed and processed.get("service_tag"):
                processed_devices.append(processed)
        
        log(f"Processed {len(processed_devices)} devices successfully")
        
        if not processed_devices:
            log("WARNING: No valid devices to sync")
            return False
        
        # Step 4: Sync to cloud
        success = self.sync_to_cloud(processed_devices)
        
        log("")
        log("=" * 60)
        if success:
            log("Sync completed successfully!")
        else:
            log("Sync completed with errors")
        log("=" * 60)
        
        return success


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    try:
        sync = OpenManageSync()
        success = sync.run()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        log("\nSync interrupted by user")
        sys.exit(130)
    except Exception as e:
        log(f"FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
