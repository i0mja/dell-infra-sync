"""
ESXi SSH Client using Paramiko
Provides SSH access to ESXi hosts for version checking and upgrades
"""
import paramiko
import time
from typing import Optional, Tuple, Dict

class EsxiSshClient:
    """SSH client for ESXi host operations"""
    
    def __init__(self, host: str, username: str = 'root', password: str = '', timeout: int = 30):
        """
        Initialize ESXi SSH client
        
        Args:
            host: ESXi management IP address
            username: SSH username (default: root)
            password: SSH password
            timeout: Connection timeout in seconds
        """
        self.host = host
        self.username = username
        self.password = password
        self.timeout = timeout
        self.client: Optional[paramiko.SSHClient] = None
    
    def connect(self) -> bool:
        """
        Establish SSH connection to ESXi host
        
        Returns:
            True if connection successful, False otherwise
        """
        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            self.client.connect(
                hostname=self.host,
                username=self.username,
                password=self.password,
                timeout=self.timeout,
                allow_agent=False,
                look_for_keys=False
            )
            return True
        except Exception as e:
            print(f"[ESXi SSH] Connection failed to {self.host}: {e}")
            return False
    
    def disconnect(self):
        """Close SSH connection"""
        if self.client:
            self.client.close()
            self.client = None
    
    def execute_command(self, command: str, timeout: int = 300) -> Tuple[int, str, str]:
        """
        Execute command on ESXi host
        
        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds
            
        Returns:
            Tuple of (exit_code, stdout, stderr)
        """
        if not self.client:
            raise ConnectionError("Not connected to ESXi host")
        
        stdin, stdout, stderr = self.client.exec_command(command, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode('utf-8'), stderr.read().decode('utf-8')
    
    def get_esxi_version(self) -> Dict:
        """
        Get current ESXi version using 'vmware -v'
        
        Returns:
            Dict with success status, version, build, and full string
        """
        try:
            exit_code, stdout, stderr = self.execute_command('vmware -v')
            if exit_code == 0:
                # Parse "VMware ESXi 8.0.2 build-22380479"
                parts = stdout.strip().split()
                return {
                    'success': True,
                    'version': parts[2] if len(parts) > 2 else 'Unknown',
                    'build': parts[4] if len(parts) > 4 else 'Unknown',
                    'full_string': stdout.strip()
                }
            return {'success': False, 'error': stderr or 'Failed to get version'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def list_profiles_in_bundle(self, bundle_path: str) -> Dict:
        """
        List available upgrade profiles in a bundle
        
        Args:
            bundle_path: Path to ESXi upgrade bundle (e.g., /vmfs/volumes/datastore/bundle.zip)
            
        Returns:
            Dict with success status and list of profile names
        """
        try:
            cmd = f'esxcli software sources profile list -d {bundle_path}'
            exit_code, stdout, stderr = self.execute_command(cmd, timeout=120)
            
            if exit_code == 0:
                profiles = []
                lines = stdout.strip().split('\n')
                # Skip header lines (usually first 2 lines)
                for line in lines[2:]:
                    if line.strip():
                        # Profile name is first column
                        profile_name = line.split()[0]
                        profiles.append(profile_name)
                return {'success': True, 'profiles': profiles, 'output': stdout}
            
            return {'success': False, 'error': stderr or 'Failed to list profiles'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def upgrade_from_bundle(self, bundle_path: str, profile_name: str) -> Dict:
        """
        Apply ESXi upgrade from bundle using esxcli
        
        Args:
            bundle_path: Path to ESXi upgrade bundle
            profile_name: Profile name to install (from list_profiles_in_bundle)
            
        Returns:
            Dict with success status, output, and version information
        """
        try:
            # Get current version before upgrade
            version_before = self.get_esxi_version()
            
            # Run the upgrade command (can take 10-30 minutes)
            cmd = f'esxcli software profile update -d {bundle_path} -p {profile_name}'
            exit_code, stdout, stderr = self.execute_command(cmd, timeout=1800)  # 30 min timeout
            
            return {
                'success': exit_code == 0,
                'exit_code': exit_code,
                'stdout': stdout,
                'stderr': stderr,
                'version_before': version_before.get('full_string', 'Unknown')
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def reboot(self) -> Dict:
        """
        Reboot the ESXi host
        
        Returns:
            Dict with success status and message
        """
        try:
            exit_code, stdout, stderr = self.execute_command('reboot', timeout=30)
            return {'success': True, 'message': 'Reboot command sent'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def wait_for_reconnect(self, timeout: int = 600, check_interval: int = 15) -> Dict:
        """
        Wait for ESXi host to come back online after reboot
        
        Args:
            timeout: Maximum time to wait in seconds (default: 10 minutes)
            check_interval: Seconds between connection attempts
            
        Returns:
            Dict with success status, reconnect time, and new version
        """
        start_time = time.time()
        self.disconnect()
        
        print(f"[ESXi SSH] Waiting for {self.host} to reconnect (timeout: {timeout}s)...")
        
        while time.time() - start_time < timeout:
            time.sleep(check_interval)
            
            if self.connect():
                # Host is back online, get new version
                version = self.get_esxi_version()
                reconnect_time = int(time.time() - start_time)
                
                print(f"[ESXi SSH] Host reconnected after {reconnect_time}s")
                
                return {
                    'success': True,
                    'reconnect_time': reconnect_time,
                    'version_after': version.get('full_string', 'Unknown')
                }
        
        return {
            'success': False,
            'error': f'Host did not reconnect within {timeout}s'
        }
    
    def check_coredump_config(self) -> Dict:
        """
        Check if coredump target is configured on ESXi host
        
        Returns:
            Dict with success status, configured flag, and details
        """
        try:
            # Check coredump file configuration
            exit_code, stdout, stderr = self.execute_command('esxcli system coredump file list')
            
            # Parse output - look for an active coredump file
            has_active_coredump = False
            coredump_path = None
            coredump_size = None
            
            if exit_code == 0:
                lines = stdout.strip().split('\n')
                for line in lines:
                    if 'Active:' in line and 'true' in line.lower():
                        has_active_coredump = True
                    if '/vmfs/volumes/' in line:
                        parts = line.split()
                        if len(parts) >= 1:
                            coredump_path = parts[0]
                    # Also check for configured coredump
                    if line.strip() and not line.startswith('-') and 'Path' not in line:
                        # Parse table format: Path  Size  Active  Configured
                        parts = line.split()
                        if len(parts) >= 4:
                            coredump_path = parts[0]
                            coredump_size = parts[1] if len(parts) > 1 else None
                            has_active_coredump = 'true' in parts[2].lower() if len(parts) > 2 else False
            
            # Also check network coredump as fallback
            exit_code2, stdout2, stderr2 = self.execute_command('esxcli system coredump network get')
            network_coredump_enabled = False
            if exit_code2 == 0 and 'Enabled: true' in stdout2:
                network_coredump_enabled = True
            
            configured = has_active_coredump or network_coredump_enabled
            
            return {
                'success': True,
                'configured': configured,
                'file_coredump': {
                    'active': has_active_coredump,
                    'path': coredump_path,
                    'size': coredump_size
                },
                'network_coredump': {
                    'enabled': network_coredump_enabled
                },
                'raw_output': stdout,
                'warning': None if configured else 'No coredump target has been configured. Host core dumps cannot be saved.'
            }
        except Exception as e:
            return {'success': False, 'error': str(e), 'configured': False}
    
    def configure_coredump(self, force: bool = False) -> Dict:
        """
        Configure coredump file on ESXi host
        Creates and activates a coredump file if none exists
        
        Args:
            force: If True, reconfigure even if already configured
            
        Returns:
            Dict with success status and details
        """
        try:
            # First check current status
            current = self.check_coredump_config()
            
            if current.get('configured') and not force:
                return {
                    'success': True,
                    'message': 'Coredump already configured',
                    'already_configured': True,
                    'details': current
                }
            
            # Create coredump file (auto-sizes based on available space)
            self.execute_command('esxcli system coredump file remove -f', timeout=30)  # Remove any existing unconfigured file
            
            exit_code, stdout, stderr = self.execute_command(
                'esxcli system coredump file add -e true',
                timeout=60
            )
            
            if exit_code != 0:
                # Try alternative: set existing file active
                exit_code2, stdout2, stderr2 = self.execute_command(
                    'esxcli system coredump file set -s true',
                    timeout=30
                )
                if exit_code2 != 0:
                    return {
                        'success': False,
                        'error': f'Failed to configure coredump: {stderr or stderr2}',
                        'stdout': stdout or stdout2
                    }
            
            # Verify configuration
            verify = self.check_coredump_config()
            
            return {
                'success': verify.get('configured', False),
                'message': 'Coredump configured successfully' if verify.get('configured') else 'Coredump configuration may have failed',
                'already_configured': False,
                'details': verify
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
