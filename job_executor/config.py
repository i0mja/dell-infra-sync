import os

# Dell Server Manager URL / Supabase URL
# Check SUPABASE_URL first (used by manage-job-executor.sh), then DSM_URL for backwards compatibility
DSM_URL = os.getenv("SUPABASE_URL") or os.getenv("DSM_URL", "http://127.0.0.1:54321")

# Supabase Service Role Key (for update-job endpoint)
# This is a SECRET - do not commit to version control!
# Check SUPABASE_SERVICE_ROLE_KEY first (used by manage-job-executor.sh), then SERVICE_ROLE_KEY
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SERVICE_ROLE_KEY", "")

# API Server Configuration (for instant operations)
API_SERVER_PORT = int(os.getenv("API_SERVER_PORT", "8081"))
API_SERVER_ENABLED = os.getenv("API_SERVER_ENABLED", "true").lower() == "true"

# API Server SSL Configuration (required for remote HTTPS browser access)
API_SERVER_SSL_ENABLED = os.getenv("API_SERVER_SSL_ENABLED", "false").lower() == "true"
API_SERVER_SSL_CERT = os.getenv("API_SERVER_SSL_CERT", "/etc/idrac-manager/ssl/server.crt")
API_SERVER_SSL_KEY = os.getenv("API_SERVER_SSL_KEY", "/etc/idrac-manager/ssl/server.key")

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

# PropertyCollector sync feature flags
ENABLE_DEEP_RELATIONSHIPS = os.getenv("ENABLE_DEEP_RELATIONSHIPS", "false").lower() == "true"

# Media Server Configuration (for virtual media and firmware)
ISO_DIRECTORY = os.getenv("ISO_DIRECTORY", "/var/lib/idrac-manager/isos")
FIRMWARE_DIRECTORY = os.getenv("FIRMWARE_DIRECTORY", "/var/lib/idrac-manager/firmware")
MEDIA_SERVER_PORT = int(os.getenv("MEDIA_SERVER_PORT", "8888"))
MEDIA_SERVER_ENABLED = os.getenv("MEDIA_SERVER_ENABLED", "true").lower() == "true"
ISO_MAX_STORAGE_GB = int(os.getenv("ISO_MAX_STORAGE_GB", "100"))
FIRMWARE_MAX_STORAGE_GB = int(os.getenv("FIRMWARE_MAX_STORAGE_GB", "200"))

# ZFS NFS Export Options
# CRITICAL: 'nohide' is required for ZFS child datasets (VM folders) to be visible via NFS
# Without 'nohide', ESXi cannot see files in child datasets even with crossmnt enabled
ZFS_NFS_SHARE_OPTIONS = "rw,no_root_squash,async,no_subtree_check,crossmnt,nohide"
