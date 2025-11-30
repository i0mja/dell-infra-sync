#!/usr/bin/env python3
"""
Job Executor for Dell Server Manager
=====================================

This script runs on your local network to execute jobs created in the
Dell Server Manager cloud application. It performs operations that require
access to your private network (iDRAC, vCenter).

Requirements:
- Python 3.7+
- pip install requests pyVmomi

Usage:
1. Configure the settings below
2. Run: python job-executor.py
3. Script will poll for pending jobs and execute them

Jobs Supported:
- Firmware updates (via iDRAC Redfish API)
- IP discovery scans (find iDRAC endpoints)
- vCenter maintenance mode orchestration
"""

import ssl
import logging
import requests
import sys
import time
import ipaddress
import hashlib
import concurrent.futures
from typing import List, Dict, Optional
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit
import json
import os
from pathlib import Path
from datetime import datetime
from idrac_throttler import IdracThrottler

# Ensure the supporting job_executor package is discoverable when this script is
# executed directly by external tools that only know about job-executor.py.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


def _require_support_package():
    """Fail fast with a helpful message if helper modules are missing."""

    package_dir = SCRIPT_DIR / "job_executor"
    required_files = [
        package_dir / "config.py",
        package_dir / "connectivity.py",
        package_dir / "scp.py",
        package_dir / "utils.py",
    ]

    missing = [path.name for path in required_files if not path.exists()]
    if missing:
        formatted = ", ".join(missing)
        sys.stderr.write(
            "job-executor.py depends on the bundled job_executor helpers but "
            f"the following files are missing: {formatted}\n"
        )
        sys.stderr.write(
            "Place the job_executor folder next to job-executor.py so the app "
            "can continue calling this entrypoint without modification.\n"
        )
        raise SystemExit(1)


_require_support_package()

from job_executor.config import (
    DSM_URL,
    FIRMWARE_REPO_URL,
    FIRMWARE_UPDATE_TIMEOUT,
    IDRAC_DEFAULT_PASSWORD,
    IDRAC_DEFAULT_USER,
    POLL_INTERVAL,
    SERVICE_ROLE_KEY,
    SUPABASE_URL,
    SYSTEM_ONLINE_CHECK_ATTEMPTS,
    SYSTEM_REBOOT_WAIT,
    VCENTER_HOST,
    VCENTER_PASSWORD,
    VCENTER_USER,
    VERIFY_SSL,
    ISO_DIRECTORY,
    FIRMWARE_DIRECTORY,
    MEDIA_SERVER_PORT,
    MEDIA_SERVER_ENABLED,
)
from job_executor.connectivity import ConnectivityMixin
from job_executor.scp import ScpMixin
from job_executor.mixins.database import DatabaseMixin
from job_executor.mixins.credentials import CredentialsMixin
from job_executor.mixins.vcenter_ops import VCenterMixin
from job_executor.utils import UNICODE_FALLBACKS, _normalize_unicode, _safe_json_parse, _safe_to_stdout
from job_executor.dell_redfish.adapter import DellRedfishAdapter
from job_executor.handlers import (
    IDMHandler, ConsoleHandler, DatastoreHandler, MediaUploadHandler,
    VirtualMediaHandler, PowerHandler, BootHandler, DiscoveryHandler,
    FirmwareHandler, ClusterHandler, ESXiHandler, VCenterHandlers
)

# Import IDM/FreeIPA authentication (conditional)
try:
    from job_executor.ldap_auth import FreeIPAAuthenticator, LDAP3_AVAILABLE
except ImportError:
    LDAP3_AVAILABLE = False
    FreeIPAAuthenticator = None

# Job types that should bypass the normal queue for instant execution
INSTANT_JOB_TYPES = ['console_launch', 'browse_datastore', 'connectivity_test', 'power_control', 'idm_authenticate', 'idm_test_connection']
from job_executor.dell_redfish.operations import DellOperations
from job_executor.esxi.orchestrator import EsxiOrchestrator
from job_executor.media_server import MediaServer

# Best-effort: prefer UTF-8 output if available, but never crash if not
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# UNICODE_FALLBACKS imported from job_executor.utils

# ============================================================================
# Job Executor Class
# ============================================================================

class JobExecutor(DatabaseMixin, CredentialsMixin, VCenterMixin, ScpMixin, ConnectivityMixin, IdracMixin):
    def __init__(self):
        self.vcenter_conn = None
        self.running = True
        self.encryption_key = None  # Will be fetched on first use
        self.throttler = None  # Will be initialized on first use
        self.activity_settings = {}  # Cache settings
        self.last_settings_fetch = 0  # Timestamp for cache invalidation
        self.dell_operations = None  # Will be initialized on first use
        self._dell_logger = None
        self.media_server = None  # Media HTTP server (ISOs + firmware)
        
        # Initialize job handlers
        self.idm_handler = IDMHandler(self)
        self.console_handler = ConsoleHandler(self)
        self.datastore_handler = DatastoreHandler(self)
        self.media_handler = MediaUploadHandler(self)
        self.virtual_media_handler = VirtualMediaHandler(self)
        self.power_handler = PowerHandler(self)
        self.boot_handler = BootHandler(self)
        self.discovery_handler = DiscoveryHandler(self)
        self.firmware_handler = FirmwareHandler(self)
        self.cluster_handler = ClusterHandler(self)
        self.esxi_handler = ESXiHandler(self)
        self.vcenter_handler = VCenterHandlers(self)

    def _validate_service_role_key(self):
        """Ensure SERVICE_ROLE_KEY is present before making Supabase requests"""
        if not SERVICE_ROLE_KEY or not SERVICE_ROLE_KEY.strip():
            self.log("ERROR: SERVICE_ROLE_KEY not set!", "ERROR")
            self.log("Set via: export SERVICE_ROLE_KEY='your-key-here'", "ERROR")
            self.log("Get your key from Lovable Cloud -> Settings", "ERROR")
            raise SystemExit(1)

    def _handle_supabase_auth_error(self, response, context: str):
        """Raise with helpful log message on Supabase authorization failures"""
        if response.status_code in (401, 403):
            self.log(
                f"Authorization failed while {context} (HTTP {response.status_code}). "
                "Verify SERVICE_ROLE_KEY and DSM_URL before retrying.",
                "ERROR",
            )
            raise PermissionError(f"Supabase authorization failed during {context}")

    def safe_json_parse(self, response):
        """Instance method wrapper for _safe_json_parse"""
        return _safe_json_parse(response)
        
    def log(self, message: str, level: str = "INFO"):
        """Log with timestamp"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        msg = _safe_to_stdout(_normalize_unicode(message))
        line = f"[{timestamp}] [{level}] {msg}"
        print(_safe_to_stdout(line))
    
    def fetch_activity_settings(self, force: bool = False) -> Dict:
        """Fetch activity settings from database with caching"""
        current_time = time.time()
        
        # Use cache if less than 30 seconds old and not forced
        if not force and self.activity_settings and (current_time - self.last_settings_fetch < 30):
            return self.activity_settings
        
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/activity_settings",
                headers=headers,
                params={'select': '*'},
                verify=VERIFY_SSL,
                timeout=10
            )

            self._handle_supabase_auth_error(response, "fetching activity settings")

            if response.status_code == 200:
                settings_list = _safe_json_parse(response)
                if settings_list and len(settings_list) > 0:
                    self.activity_settings = settings_list[0]
                    self.last_settings_fetch = current_time
                    return self.activity_settings
            
            # Return defaults if fetch fails
            return {
                'pause_idrac_operations': False,
                'discovery_max_threads': 5,
                'idrac_request_delay_ms': 500,
                'idrac_max_concurrent': 4,
                'encryption_key': self.encryption_key
            }
        except Exception as e:
            self.log(f"Error fetching activity settings: {e}", "WARN")
            # Return safe defaults
            return {
                'pause_idrac_operations': False,
                'discovery_max_threads': 5,
                'idrac_request_delay_ms': 500,
                'idrac_max_concurrent': 4
            }
    
    def _get_dell_operations(self) -> DellOperations:
        """
        Get or create Dell operations instance with current throttler and logging.
        
        Returns:
            DellOperations: Configured Dell operations instance
        """
        if self.dell_operations is None:
            # Ensure throttler is initialized
            if self.throttler is None:
                self.initialize_throttler()

            # Create adapter with our throttler and Supabase logging
            adapter = DellRedfishAdapter(
                throttler=self.throttler,
                logger=self._get_dell_logger(),
                log_command_fn=self._log_dell_redfish_command,
                verify_ssl=VERIFY_SSL,
            )

            # Create operations instance
            self.dell_operations = DellOperations(adapter)
            self.log("Dell Redfish operations initialized", "INFO")

        return self.dell_operations

    def _get_dell_logger(self) -> logging.Logger:
        """Lazily configure a logger for Dell Redfish operations."""
        if self._dell_logger is None:
            logger = logging.getLogger("dell_redfish_adapter")
            if not logger.handlers:
                handler = logging.StreamHandler()
                formatter = logging.Formatter(
                    fmt="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S",
                )
                handler.setFormatter(formatter)
                logger.addHandler(handler)
            logger.setLevel(logging.INFO)
            self._dell_logger = logger
        return self._dell_logger

    def _log_dell_redfish_command(self, log_entry: Dict):
        """Adapt DellRedfishAdapter log entries to the standard iDRAC logger."""
        self.log_idrac_command(
            server_id=log_entry.get("server_id"),
            job_id=log_entry.get("job_id"),
            task_id=None,
            command_type=log_entry.get("command_type"),
            endpoint=log_entry.get("endpoint"),
            full_url=log_entry.get("full_url"),
            request_headers=None,
            request_body=log_entry.get("request_body"),
            status_code=log_entry.get("status_code"),
            response_time_ms=log_entry.get("response_time_ms", 0),
            response_body=log_entry.get("response_body"),
            success=log_entry.get("success", False),
            error_message=log_entry.get("error_message"),
            operation_type=log_entry.get("operation_type", "idrac_api"),
        )
    
    def initialize_throttler(self):
        """Initialize or update the iDRAC throttler with current settings"""
        try:
            settings = self.fetch_activity_settings()
            
            max_concurrent = settings.get('idrac_max_concurrent', 4)
            request_delay_ms = settings.get('idrac_request_delay_ms', 500)
            
            if self.throttler is None:
                self.throttler = IdracThrottler(
                    max_concurrent=max_concurrent,
                    request_delay_ms=request_delay_ms
                )
                self.log(f"Throttler initialized: max_concurrent={max_concurrent}, delay={request_delay_ms}ms")
            else:
                self.throttler.update_settings(
                    max_concurrent=max_concurrent,
                    request_delay_ms=request_delay_ms
                )
                self.log(f"Throttler settings updated: max_concurrent={max_concurrent}, delay={request_delay_ms}ms")
        except Exception as e:
            self.log(f"Error initializing throttler: {e}", "ERROR")
            # Create throttler with safe defaults
            if self.throttler is None:
                self.throttler = IdracThrottler(max_concurrent=4, request_delay_ms=500)
                self.log("Throttler initialized with safe defaults")
    
    def check_idrac_pause(self) -> bool:
        """Check if iDRAC operations are paused. Returns True if paused."""
        try:
            settings = self.fetch_activity_settings(force=True)  # Force fresh fetch
            is_paused = settings.get('pause_idrac_operations', False)
            
            if is_paused:
                self.log("⚠️  iDRAC operations are PAUSED via activity settings", "WARN")
                self.log("All iDRAC jobs will be skipped until pause is disabled", "WARN")
            
            return is_paused
        except Exception as e:
            self.log(f"Error checking pause status: {e}", "ERROR")
            return False  # Default to not paused on error
    
    def get_idm_settings(self) -> Optional[Dict]:
        """Fetch IDM/FreeIPA settings from database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            response = requests.get(
                f"{DSM_URL}/rest/v1/idm_settings",
                headers=headers,
                params={'select': '*', 'limit': '1'},
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                settings = _safe_json_parse(response)
                if settings and len(settings) > 0:
                    return settings[0]
            return None
        except Exception as e:
            self.log(f"Error fetching IDM settings: {e}", "ERROR")
            return None
    
    def decrypt_bind_password(self, encrypted_password: str) -> Optional[str]:
        """Decrypt the FreeIPA bind password using encryption key."""
        if not encrypted_password:
            return None
        return self.decrypt_password(encrypted_password)
    
    def create_freeipa_authenticator(self, settings: Dict) -> Optional['FreeIPAAuthenticator']:
        """Create FreeIPAAuthenticator from IDM settings."""
        if not LDAP3_AVAILABLE:
            self.log("ldap3 library not installed - IDM features unavailable", "ERROR")
            self.log("Install with: pip install ldap3>=2.9.1", "ERROR")
            return None
        
        try:
            # Write CA certificate to temp file if provided
            ca_cert_path = None
            if settings.get('ca_certificate'):
                import tempfile
                fd, ca_cert_path = tempfile.mkstemp(suffix='.pem')
                with os.fdopen(fd, 'w') as f:
                    f.write(settings['ca_certificate'])
            
            return FreeIPAAuthenticator(
                server_host=settings['server_host'],
                base_dn=settings['base_dn'],
                user_search_base=settings.get('user_search_base', 'cn=users,cn=accounts'),
                group_search_base=settings.get('group_search_base', 'cn=groups,cn=accounts'),
                use_ldaps=settings.get('use_ldaps', True),
                ldaps_port=settings.get('ldaps_port', 636),
                ldap_port=settings.get('server_port', 389),
                verify_certificate=settings.get('verify_certificate', True),
                ca_certificate=ca_cert_path,
                connection_timeout=settings.get('connection_timeout_seconds', 10),
            )
        except Exception as e:
            self.log(f"Failed to create FreeIPA authenticator: {e}", "ERROR")
            return None
    
    def log_idrac_command(
        self,
        server_id: Optional[str],
        job_id: Optional[str],
        task_id: Optional[str],
        command_type: str,
        endpoint: str,
        full_url: str,
        request_headers: Optional[dict],
        request_body: Optional[dict],
        status_code: Optional[int],
        response_time_ms: int,
        response_body: Optional[dict],
        success: bool,
        error_message: Optional[str] = None,
        operation_type: str = 'idrac_api'
    ):
        """Log iDRAC command to activity monitor"""
        try:
            # Redact sensitive data from headers
            headers_safe = None
            if request_headers:
                headers_safe = {**request_headers}
                if 'Authorization' in headers_safe:
                    headers_safe['Authorization'] = '[REDACTED]'
                if 'authorization' in headers_safe:
                    headers_safe['authorization'] = '[REDACTED]'
            
            # Redact passwords from request body
            body_safe = None
            if request_body:
                body_safe = json.loads(json.dumps(request_body))
                if isinstance(body_safe, dict) and 'Password' in body_safe:
                    body_safe['Password'] = '[REDACTED]'
            
            # Truncate large payloads
            max_request_kb = 100
            max_response_kb = 100
            
            if body_safe:
                body_size_kb = len(json.dumps(body_safe)) / 1024
                if body_size_kb > max_request_kb:
                    body_safe = {
                        '_truncated': True,
                        '_original_size_kb': int(body_size_kb),
                        '_limit_kb': max_request_kb
                    }
            
            response_safe = response_body
            if response_safe:
                response_size_kb = len(json.dumps(response_safe)) / 1024
                if response_size_kb > max_response_kb:
                    response_safe = {
                        '_truncated': True,
                        '_original_size_kb': int(response_size_kb),
                        '_limit_kb': max_response_kb
                    }
            
            log_entry = {
                'server_id': server_id,
                'job_id': job_id,
                'task_id': task_id,
                'command_type': command_type,
                'endpoint': endpoint,
                'full_url': full_url,
                'request_headers': headers_safe,
                'request_body': body_safe,
                'status_code': status_code,
                'response_time_ms': response_time_ms,
                'response_body': response_safe,
                'success': success,
                'error_message': error_message,
                'initiated_by': None,
                'source': 'job_executor',
                'operation_type': operation_type
            }
            
            # Insert via Supabase REST API
            response = requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                json=log_entry,
                verify=VERIFY_SSL,
                timeout=5
            )

            self._handle_supabase_auth_error(response, "logging iDRAC command")

            if response.status_code not in [200, 201]:
                self.log(f"Failed to log iDRAC command: {response.status_code}", "DEBUG")

        except Exception as e:
            # Don't let logging failures break job execution
            self.log(f"Logging exception: {e}", "DEBUG")

    # VCenter operations moved to VCenterMixin
    # (log_vcenter_activity, connect_vcenter, check_vcenter_connection,
    #  sync_vcenter_clusters, sync_vcenter_vms, _upsert_vm_batch,
    #  sync_vcenter_datastores, sync_vcenter_alarms, enter_vcenter_maintenance_mode,
    #  exit_vcenter_maintenance_mode, wait_for_vcenter_host_connected,
    #  auto_link_vcenter, get_vcenter_host, get_vcenter_settings)

    # Credential resolution methods moved to CredentialsMixin
    # (get_encryption_key, decrypt_password, ip_in_range, get_credential_sets,
    #  get_credential_sets_for_ip, get_esxi_credentials_for_host,
    #  resolve_credentials_for_server, get_server_credentials, get_credentials_for_server)
        except Exception as e:
            self.log(f"Error resolving credentials for server {server_id}: {str(e)}", "ERROR")
            return (None, None)

    # get_pending_jobs moved to DatabaseMixin
    # get_job_tasks moved to DatabaseMixin

    def update_job_status(self, job_id: str, status: str, **kwargs):
        """Update job status in the cloud"""
        try:
            url = f"{DSM_URL}/functions/v1/update-job"
            payload = {
                "job": {
                    "job_id": job_id,
                    "status": status,
                    **kwargs
                }
            }

            response = requests.post(url, json=payload, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "updating job status")
            if response.status_code != 200:
                self.log(f"Error updating job: {response.text}", "ERROR")
        except Exception as e:
            self.log(f"Error updating job status: {e}", "ERROR")

    def update_task_status(self, task_id: str, status: str, log: str = None, progress: int = None, **kwargs):
        """Update task status in the cloud"""
        try:
            url = f"{DSM_URL}/functions/v1/update-job"
            payload = {
                "task": {
                    "task_id": task_id,
                    "status": status,
                    "log": log,
                    **kwargs
                }
            }
            
            if progress is not None:
                payload["task"]["progress"] = progress

            response = requests.post(url, json=payload, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "updating task status")
            if response.status_code != 200:
                self.log(f"Error updating task: {response.text}", "ERROR")
        except Exception as e:
            self.log(f"Error updating task status: {e}", "ERROR")

    # safe_json_parse moved to DatabaseMixin
    # Duplicate get_job_tasks removed

    # All iDRAC and server info methods moved to IdracMixin:
    # - get_comprehensive_server_info
    # - _fetch_health_status
    # - _parse_health_from_response
    # - _fetch_initial_event_logs
    # - _store_event_logs
    # - _fetch_bios_attributes
    # - _fetch_storage_drives
    # - _sync_server_drives
    # - _execute_inline_scp_export
    # - test_idrac_connection
    # - refresh_existing_servers
    # - _quick_port_check
    # - _detect_idrac
    # - discover_single_ip
    # - insert_discovered_server
    # - insert_auth_failed_server
    # - _create_server_audit_entry
    # - _create_automatic_scp_backup

    # execute_discovery_scan moved to DiscoveryHandler

    # connect_vcenter moved to VCenterMixin
    # check_vcenter_connection moved to VCenterMixin

    # All execute_* methods have been moved to their respective handler classes:
    # - execute_vcenter_sync -> VCenterHandlers
    # - execute_firmware_update -> FirmwareHandler
    # - execute_full_server_update -> FirmwareHandler
    # - execute_test_credentials -> DiscoveryHandler
    # - execute_power_action -> PowerHandler
    # - execute_health_check -> DiscoveryHandler
    # - execute_fetch_event_logs -> DiscoveryHandler
    # - execute_boot_configuration -> BootHandler
    # - execute_virtual_media_mount -> VirtualMediaHandler
    # - execute_virtual_media_unmount -> VirtualMediaHandler
    # - execute_bios_config_read -> BootHandler
    # - execute_openmanage_sync -> VCenterHandlers
    # - execute_bios_config_write -> BootHandler
    # - execute_prepare_host_for_update -> ClusterHandler
    # - execute_verify_host_after_update -> ClusterHandler
    # - execute_rolling_cluster_update -> ClusterHandler
    # - execute_idm_authenticate -> IDMHandler
    # - execute_idm_test_connection -> IDMHandler
    # - execute_idm_sync_users -> IDMHandler
    # - execute_console_launch -> ConsoleHandler
    # - execute_iso_upload -> MediaUploadHandler
    # - execute_scan_local_isos -> MediaUploadHandler
    # - execute_register_iso_url -> MediaUploadHandler
    # - execute_cluster_safety_check -> ClusterHandler
    # - execute_server_group_safety_check -> ClusterHandler
    # - execute_esxi_upgrade -> ESXiHandler
    # - execute_esxi_then_firmware -> ESXiHandler
    # - execute_firmware_then_esxi -> ESXiHandler
    # - execute_esxi_preflight_check -> ESXiHandler
    # - execute_browse_datastore -> DatastoreHandler
    # - execute_firmware_upload -> MediaUploadHandler
    # - execute_catalog_sync -> MediaUploadHandler
    # - execute_vcenter_connectivity_test -> VCenterHandlers

    def execute_job(self, job: Dict):
        """Execute a job based on its type"""
        job_type = job['job_type']
        
        # Initialize throttler if not already done
        if self.throttler is None:
            self.initialize_throttler()
        
        # Check if iDRAC operations are paused for iDRAC-related job types
        idrac_job_types = [
            'discovery_scan', 'firmware_update', 'full_server_update', 
            'test_credentials', 'power_action', 'health_check', 
            'fetch_event_logs', 'boot_configuration', 'virtual_media_mount',
            'virtual_media_unmount', 'scp_export', 'scp_import',
            'bios_config_read', 'bios_config_write',
            'prepare_host_for_update', 'verify_host_after_update', 'rolling_cluster_update',
            'esxi_upgrade', 'esxi_then_firmware', 'firmware_then_esxi'
        ]
        
        if job_type in idrac_job_types and self.check_idrac_pause():
            self.log(f"Skipping {job_type} job {job['id']} - iDRAC operations are paused", "WARN")
            self.update_job_status(
                job['id'],
                'cancelled',
                completed_at=datetime.now().isoformat(),
                details={"message": "Job cancelled - iDRAC operations paused via activity settings"}
            )
            return
        
        # Dispatch to handler
        handler_map = {
            'discovery_scan': self.discovery_handler.execute_discovery_scan,
            'firmware_update': self.firmware_handler.execute_firmware_update,
            'full_server_update': self.firmware_handler.execute_full_server_update,
            'test_credentials': self.discovery_handler.execute_test_credentials,
            'power_action': self.power_handler.execute_power_action,
            'health_check': self.discovery_handler.execute_health_check,
            'fetch_event_logs': self.discovery_handler.execute_fetch_event_logs,
            'boot_configuration': self.boot_handler.execute_boot_configuration,
            'virtual_media_mount': self.virtual_media_handler.execute_virtual_media_mount,
            'virtual_media_unmount': self.virtual_media_handler.execute_virtual_media_unmount,
            'scp_export': self.execute_scp_export,
            'scp_import': self.execute_scp_import,
            'bios_config_read': self.boot_handler.execute_bios_config_read,
            'bios_config_write': self.boot_handler.execute_bios_config_write,
            'vcenter_sync': self.vcenter_handler.execute_vcenter_sync,
            'vcenter_connectivity_test': self.vcenter_handler.execute_vcenter_connectivity_test,
            'openmanage_sync': self.vcenter_handler.execute_openmanage_sync,
            'cluster_safety_check': self.cluster_handler.execute_cluster_safety_check,
            'server_group_safety_check': self.cluster_handler.execute_server_group_safety_check,
            'prepare_host_for_update': self.cluster_handler.execute_prepare_host_for_update,
            'verify_host_after_update': self.cluster_handler.execute_verify_host_after_update,
            'rolling_cluster_update': self.cluster_handler.execute_rolling_cluster_update,
            'iso_upload': self.media_handler.execute_iso_upload,
            'scan_local_isos': self.media_handler.execute_scan_local_isos,
            'register_iso_url': self.media_handler.execute_register_iso_url,
            'firmware_upload': self.media_handler.execute_firmware_upload,
            'catalog_sync': self.media_handler.execute_catalog_sync,
            'console_launch': self.console_handler.execute_console_launch,
            'esxi_upgrade': self.esxi_handler.execute_esxi_upgrade,
            'esxi_then_firmware': self.esxi_handler.execute_esxi_then_firmware,
            'firmware_then_esxi': self.esxi_handler.execute_firmware_then_esxi,
            'browse_datastore': self.datastore_handler.execute_browse_datastore,
            'esxi_preflight_check': self.esxi_handler.execute_esxi_preflight_check,
            'idm_authenticate': self.idm_handler.execute_idm_authenticate,
            'idm_test_connection': self.idm_handler.execute_idm_test_connection,
            'idm_sync_users': self.idm_handler.execute_idm_sync_users,
        }
        
        handler = handler_map.get(job_type)
        if handler:
            handler(job)
        else:
            self.log(f"Unknown job type: {job_type}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": f"Unsupported job type: {job_type}"}
            )
    
    # SCP operations implemented in ScpMixin

    # Connectivity tests implemented in ConnectivityMixin

    # Connectivity test job implemented in ConnectivityMixin





    def run(self):
        """Main execution loop"""
        self.log("="*70)
        self.log("Dell Server Manager - Job Executor")
        self.log("="*70)
        self.log(f"DSM_URL: {DSM_URL}")
        self.log(f"Polling interval: {POLL_INTERVAL} seconds")
        self.log(f"SSL Verification: {VERIFY_SSL}")
        self.log("="*70)

        self._validate_service_role_key()

        self.log("[OK] Configuration validated", "INFO")
        
        # Initialize throttler and display configuration
        try:
            self.initialize_throttler()
            self.log("=" * 70)
            self.log("iDRAC THROTTLER CONFIGURATION")
            self.log("=" * 70)
            self.log(f"  Max Concurrent Requests: {self.throttler.max_concurrent}")
            self.log(f"  Request Delay (per IP): {self.throttler.request_delay_ms}ms")
            self.log(f"  Discovery Max Threads: {self.activity_settings.get('discovery_max_threads', 5)}")
            self.log(f"  Circuit Breaker Threshold: {self.throttler.circuit_breaker_threshold} failures")
            self.log(f"  Circuit Breaker Timeout: {self.throttler.circuit_breaker_timeout}s")
            self.log(f"  Operations Paused: {self.activity_settings.get('pause_idrac_operations', False)}")
            self.log("=" * 70)
        except Exception as e:
            self.log(f"Warning: Could not initialize throttler: {e}", "WARN")
        
        self.log("Job executor started. Polling for jobs...")
        
        # Start media server if enabled (serves ISOs + firmware DUPs)
        if MEDIA_SERVER_ENABLED:
            try:
                self.media_server = MediaServer(ISO_DIRECTORY, FIRMWARE_DIRECTORY, MEDIA_SERVER_PORT)
                self.media_server.start()
                self.log("="*70)
                self.log(f"MEDIA SERVER STARTED: http://{self.get_local_ip()}:{MEDIA_SERVER_PORT}")
                self.log(f"ISO Directory: {ISO_DIRECTORY}")
                self.log(f"Firmware Directory: {FIRMWARE_DIRECTORY}")
                self.log("="*70)
            except Exception as e:
                self.log(f"Warning: Could not start media server: {e}", "WARN")
        
        try:
            while self.running:
                try:
                    # FAST-TRACK: Process instant jobs immediately (console, datastore browsing, etc.)
                    instant_jobs = self.get_pending_jobs(instant_only=True)
                    if instant_jobs:
                        self.log(f"[FAST-TRACK] Found {len(instant_jobs)} instant job(s)")
                        for job in instant_jobs:
                            self.log(f"[FAST-TRACK] Executing instant job {job['id']} ({job['job_type']})")
                            self.execute_job(job)
                    
                    # Regular jobs - process one at a time to avoid overwhelming the system
                    regular_jobs = self.get_pending_jobs(exclude_instant=True)
                    if regular_jobs:
                        job = regular_jobs[0]  # Process one regular job per cycle
                        self.log(f"Executing job {job['id']} ({job['job_type']})")
                        self.execute_job(job)
                    
                    # Wait before next poll
                    time.sleep(POLL_INTERVAL)
                    
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    self.log(f"Error in main loop: {e}", "ERROR")
                    time.sleep(POLL_INTERVAL)
                    
        except KeyboardInterrupt:
            self.log("\nShutting down job executor...")
            self.running = False

def main():
    executor = JobExecutor()
    executor.run()

if __name__ == "__main__":
    main()
