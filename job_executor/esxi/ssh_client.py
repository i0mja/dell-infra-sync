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
