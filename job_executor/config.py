import os

# Dell Server Manager URL
DSM_URL = os.getenv("DSM_URL", "http://127.0.0.1:54321")  # Defaults to local Supabase

# Supabase Service Role Key (for update-job endpoint)
# This is a SECRET - do not commit to version control!
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY", "")  # Set via env var

# vCenter connection (for maintenance mode operations)
VCENTER_HOST = os.getenv("VCENTER_HOST", "vcenter.example.com")
VCENTER_USER = os.getenv("VCENTER_USER", "administrator@vsphere.local")
VCENTER_PASSWORD = os.getenv("VCENTER_PASSWORD", "")

# iDRAC default credentials (for discovery and firmware updates)
IDRAC_DEFAULT_USER = os.getenv("IDRAC_USER", "root")
IDRAC_DEFAULT_PASSWORD = os.getenv("IDRAC_PASSWORD", "calvin")

# Firmware repository URL (HTTP server hosting Dell Update Packages)
FIRMWARE_REPO_URL = os.getenv("FIRMWARE_REPO_URL", "http://firmware.example.com/dell")

# Polling interval (seconds)
POLL_INTERVAL = 10  # Check for new jobs every 10 seconds

# Firmware update settings
FIRMWARE_UPDATE_TIMEOUT = 1800  # 30 minutes max for firmware download/apply
SYSTEM_REBOOT_WAIT = 120  # Wait 2 minutes for system to reboot
SYSTEM_ONLINE_CHECK_ATTEMPTS = 24  # Try for 4 minutes (24 * 10s)

# SSL verification
VERIFY_SSL = False

# Optional Supabase URL override for backup storage
SUPABASE_URL = os.getenv("SUPABASE_URL", DSM_URL)

# ISO Server Configuration (for virtual media local uploads)
ISO_DIRECTORY = os.getenv("ISO_DIRECTORY", "/var/lib/idrac-manager/isos")
ISO_SERVER_PORT = int(os.getenv("ISO_SERVER_PORT", "8888"))
ISO_SERVER_ENABLED = os.getenv("ISO_SERVER_ENABLED", "true").lower() == "true"
ISO_MAX_STORAGE_GB = int(os.getenv("ISO_MAX_STORAGE_GB", "100"))
