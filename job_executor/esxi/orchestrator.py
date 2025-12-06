"""
ESXi Upgrade Orchestrator
Coordinates vCenter maintenance mode + SSH upgrade + verification workflow
"""
from typing import Dict, Optional, Callable
from .ssh_client import EsxiSshClient

class EsxiOrchestrator:
    """
    Orchestrates the complete ESXi upgrade workflow including:
    - vCenter maintenance mode management
    - SSH-based upgrade execution
    - Version verification
    - Error handling and cleanup
    """
    
    def __init__(
        self,
        enter_maintenance_fn: Optional[Callable] = None,
        exit_maintenance_fn: Optional[Callable] = None,
        logger: Optional[Callable] = None
    ):
        """
        Initialize orchestrator
        
        Args:
            enter_maintenance_fn: Function to enter vCenter maintenance mode
            exit_maintenance_fn: Function to exit vCenter maintenance mode
            logger: Logging function (defaults to print)
        """
        self.enter_maintenance_fn = enter_maintenance_fn
        self.exit_maintenance_fn = exit_maintenance_fn
        self.log = logger or print
    
    def upgrade_host(
        self,
        host_name: str,
        host_ip: str,
        ssh_username: str,
        ssh_password: str,
        bundle_path: str,
        profile_name: str,
        vcenter_host_id: Optional[str] = None,
        dry_run: bool = False
    ) -> Dict:
        """
        Execute complete ESXi upgrade workflow for a single host
        
        Workflow steps:
        1. Connect via SSH and get current ESXi version
        2. Enter vCenter maintenance mode (if vcenter_host_id provided)
        3. Apply ESXi upgrade via SSH esxcli command
        4. Reboot host
        5. Wait for host to reconnect
        6. Verify new version
        7. Exit maintenance mode
        
        Args:
            host_name: Hostname for display purposes
            host_ip: ESXi management IP address
            ssh_username: SSH username (usually 'root')
            ssh_password: SSH password
            bundle_path: Path to upgrade bundle on datastore (e.g., /vmfs/volumes/ds1/ESXi-8.0U3.zip)
            profile_name: Profile name to install (e.g., ESXi-8.0U3-24022510-standard)
            vcenter_host_id: Optional vCenter host ID for maintenance mode
            dry_run: If True, only validate connectivity and show what would be done
            
        Returns:
            Dict with success status, version changes, and step-by-step details
        """
        result = {
            'success': False,
            'host_name': host_name,
            'host_ip': host_ip,
            'steps_completed': [],
            'version_before': None,
            'version_after': None,
            'dry_run': dry_run,
            'ssh_output': [],
            'coredump_status': {
                'before': None,
                'after': None,
                'auto_fixed': False
            }
        }
        
        ssh_client = None
        maintenance_entered = False
        
        try:
            # Step 1: Connect to ESXi via SSH and get current version
            self.log(f"[ESXi Orchestrator] Connecting to {host_name} ({host_ip}) via SSH...")
            ssh_client = EsxiSshClient(host_ip, ssh_username, ssh_password, timeout=30)
            
            if not ssh_client.connect():
                result['error'] = 'Failed to establish SSH connection to ESXi host'
                return result
            
            result['steps_completed'].append('ssh_connect')
            self.log(f"[ESXi Orchestrator] SSH connection established")
            
            # Get current version
            version_info = ssh_client.get_esxi_version()
            if not version_info.get('success'):
                result['error'] = f"Failed to get ESXi version: {version_info.get('error')}"
                return result
            
            result['version_before'] = version_info.get('full_string')
            result['steps_completed'].append('get_version')
            self.log(f"[ESXi Orchestrator] Current version: {result['version_before']}")
            
            # Step 1b: Pre-flight coredump check
            self.log(f"[ESXi Orchestrator] Checking coredump configuration...")
            coredump_check = ssh_client.check_coredump_config()
            result['coredump_status']['before'] = coredump_check
            
            if coredump_check.get('success'):
                if coredump_check.get('configured'):
                    self.log(f"[ESXi Orchestrator] ✓ Coredump is configured")
                    result['steps_completed'].append('coredump_check_passed')
                else:
                    self.log(f"[ESXi Orchestrator] ⚠ Warning: {coredump_check.get('warning')}")
                    # Don't fail - just warn and continue
                    result['warnings'] = result.get('warnings', [])
                    result['warnings'].append(coredump_check.get('warning'))
            else:
                self.log(f"[ESXi Orchestrator] ⚠ Could not check coredump status: {coredump_check.get('error')}")
            
            # DRY RUN: Stop here if dry run mode
            if dry_run:
                self.log(f"[ESXi Orchestrator] DRY RUN - Would upgrade to profile: {profile_name}")
                
                # Verify bundle exists and list profiles
                profiles_info = ssh_client.list_profiles_in_bundle(bundle_path)
                
                result['success'] = True
                result['dry_run_details'] = {
                    'bundle_path': bundle_path,
                    'profile_name': profile_name,
                    'profiles_available': profiles_info.get('profiles', []) if profiles_info.get('success') else None,
                    'profiles_error': profiles_info.get('error') if not profiles_info.get('success') else None
                }
                return result
            
            # Step 2: Enter vCenter maintenance mode (if configured)
            if vcenter_host_id and self.enter_maintenance_fn:
                self.log(f"[ESXi Orchestrator] Entering vCenter maintenance mode...")
                try:
                    maint_result = self.enter_maintenance_fn(vcenter_host_id)
                    
                    if not maint_result.get('success'):
                        result['error'] = f"Failed to enter maintenance mode: {maint_result.get('error', 'Unknown error')}"
                        result['maintenance_error'] = maint_result
                        return result
                    
                    maintenance_entered = True
                    result['steps_completed'].append('enter_maintenance')
                    self.log(f"[ESXi Orchestrator] Maintenance mode entered successfully")
                    
                except Exception as e:
                    result['error'] = f"Exception entering maintenance mode: {str(e)}"
                    return result
            else:
                self.log(f"[ESXi Orchestrator] Skipping maintenance mode (vCenter not linked)")
            
            # Step 3: Apply ESXi upgrade via SSH
            self.log(f"[ESXi Orchestrator] Applying ESXi upgrade from {bundle_path}...")
            self.log(f"[ESXi Orchestrator] Profile: {profile_name}")
            
            upgrade_result = ssh_client.upgrade_from_bundle(bundle_path, profile_name)
            result['ssh_output'].append({
                'command': 'upgrade',
                'stdout': upgrade_result.get('stdout', ''),
                'stderr': upgrade_result.get('stderr', ''),
                'exit_code': upgrade_result.get('exit_code')
            })
            
            if not upgrade_result.get('success'):
                result['error'] = f"ESXi upgrade command failed: {upgrade_result.get('stderr', 'Unknown error')}"
                result['upgrade_output'] = upgrade_result
                return result
            
            result['steps_completed'].append('apply_upgrade')
            self.log(f"[ESXi Orchestrator] Upgrade applied successfully, reboot required")
            
            # Step 4: Reboot host
            self.log(f"[ESXi Orchestrator] Rebooting ESXi host...")
            reboot_result = ssh_client.reboot()
            
            if not reboot_result.get('success'):
                result['error'] = f"Failed to reboot host: {reboot_result.get('error')}"
                return result
            
            result['steps_completed'].append('reboot_initiated')
            self.log(f"[ESXi Orchestrator] Reboot command sent")
            
            # Step 5: Wait for host to reconnect (typically 2-5 minutes)
            self.log(f"[ESXi Orchestrator] Waiting for host to reconnect (this may take 5-10 minutes)...")
            reconnect_result = ssh_client.wait_for_reconnect(timeout=600, check_interval=15)
            
            if not reconnect_result.get('success'):
                result['error'] = f"Host did not reconnect after reboot: {reconnect_result.get('error')}"
                result['warning'] = 'Host may still be rebooting. Check vCenter for status.'
                return result
            
            result['version_after'] = reconnect_result.get('version_after')
            result['reconnect_time'] = reconnect_result.get('reconnect_time')
            result['steps_completed'].append('reconnect_verified')
            self.log(f"[ESXi Orchestrator] Host reconnected after {result['reconnect_time']}s")
            self.log(f"[ESXi Orchestrator] New version: {result['version_after']}")
            
            # Step 5b: Post-upgrade coredump verification and auto-recovery
            self.log(f"[ESXi Orchestrator] Verifying coredump configuration after upgrade...")
            post_coredump = ssh_client.check_coredump_config()
            result['coredump_status']['after'] = post_coredump
            
            if post_coredump.get('success') and not post_coredump.get('configured'):
                self.log(f"[ESXi Orchestrator] ⚠ Coredump not configured after upgrade - attempting auto-recovery...")
                
                # Attempt to auto-configure coredump
                fix_result = ssh_client.configure_coredump()
                
                if fix_result.get('success'):
                    result['coredump_status']['auto_fixed'] = True
                    result['coredump_status']['after'] = fix_result.get('details')
                    result['steps_completed'].append('coredump_auto_fixed')
                    self.log(f"[ESXi Orchestrator] ✓ Coredump auto-configured successfully")
                else:
                    self.log(f"[ESXi Orchestrator] ⚠ Failed to auto-configure coredump: {fix_result.get('error')}")
                    result['warnings'] = result.get('warnings', [])
                    result['warnings'].append(f"Coredump auto-recovery failed: {fix_result.get('error')}. Manual configuration required.")
            elif post_coredump.get('configured'):
                self.log(f"[ESXi Orchestrator] ✓ Coredump configuration preserved after upgrade")
                result['steps_completed'].append('coredump_verified')
            
            # Step 6: Exit maintenance mode
            if maintenance_entered and self.exit_maintenance_fn:
                self.log(f"[ESXi Orchestrator] Exiting vCenter maintenance mode...")
                try:
                    exit_result = self.exit_maintenance_fn(vcenter_host_id)
                    
                    if exit_result.get('success'):
                        result['steps_completed'].append('exit_maintenance')
                        self.log(f"[ESXi Orchestrator] Maintenance mode exited successfully")
                    else:
                        self.log(f"[ESXi Orchestrator] Warning: Failed to exit maintenance mode automatically")
                        result['warning'] = f"Host upgraded successfully but failed to exit maintenance mode: {exit_result.get('error')}"
                        
                except Exception as e:
                    self.log(f"[ESXi Orchestrator] Warning: Exception exiting maintenance mode: {e}")
                    result['warning'] = f"Host upgraded successfully but failed to exit maintenance mode: {str(e)}"
            
            # Success!
            result['success'] = True
            self.log(f"[ESXi Orchestrator] ✓ Upgrade complete for {host_name}")
            self.log(f"[ESXi Orchestrator]   Before: {result['version_before']}")
            self.log(f"[ESXi Orchestrator]   After:  {result['version_after']}")
            if result['coredump_status'].get('auto_fixed'):
                self.log(f"[ESXi Orchestrator]   Coredump: Auto-recovered")
            
            return result
            
        except Exception as e:
            result['error'] = f"Unexpected error during upgrade: {str(e)}"
            self.log(f"[ESXi Orchestrator] ERROR: {str(e)}")
            
            # Attempt cleanup: exit maintenance mode on any failure
            if maintenance_entered and self.exit_maintenance_fn:
                try:
                    self.log(f"[ESXi Orchestrator] Attempting to exit maintenance mode after error...")
                    self.exit_maintenance_fn(vcenter_host_id)
                except Exception as cleanup_error:
                    self.log(f"[ESXi Orchestrator] Failed to exit maintenance mode during cleanup: {cleanup_error}")
            
            return result
            
        finally:
            # Always disconnect SSH client
            if ssh_client:
                ssh_client.disconnect()
