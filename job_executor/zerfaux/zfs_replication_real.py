"""
ZFS Replication Module - Real Implementation

This module handles ZFS replication orchestration using SSH.
Replaces ZFSReplicationStub when ZERFAUX_USE_STUBS=false.

Uses paramiko for SSH to execute:
- zfs snapshot
- zfs send | zfs receive (or syncoid)
- zpool status checks

Uses pyVmomi for DR shell VM creation.
"""

import io
import ssl
import subprocess
import time
import logging
from datetime import datetime
from typing import Dict, List, Optional

try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False
    paramiko = None

try:
    from pyVim.connect import SmartConnect, Disconnect
    from pyVmomi import vim
    from pyVim.task import WaitForTask
    PYVMOMI_AVAILABLE = True
except ImportError:
    PYVMOMI_AVAILABLE = False
    vim = None

logger = logging.getLogger(__name__)


class ZFSReplicationReal:
    """
    Real implementation of ZFS replication orchestration.
    
    Uses SSH to execute ZFS commands on source and target storage systems.
    Uses pyVmomi for DR shell VM creation at the DR vCenter.
    Uses centralized SSHCredentialManager for credential lookup.
    """
    
    def __init__(self, executor=None):
        """
        Initialize the replication handler.
        
        Args:
            executor: Optional reference to JobExecutor for DB access
        """
        self.executor = executor
        self._ssh_manager = None
        
        if not PARAMIKO_AVAILABLE:
            logger.warning("paramiko not available - SSH operations will fail")
        if not PYVMOMI_AVAILABLE:
            logger.warning("pyVmomi not available - DR shell VM creation will fail")
    
    @property
    def ssh_manager(self):
        """Lazy-load centralized SSH credential manager."""
        if self._ssh_manager is None and self.executor:
            try:
                from job_executor.ssh_utils import SSHCredentialManager
                self._ssh_manager = SSHCredentialManager(self.executor)
            except ImportError:
                logger.warning("SSHCredentialManager not available")
        return self._ssh_manager
    
    def _get_ssh_credentials_for_target(self, target_id: str = None, 
                                         target: dict = None) -> dict:
        """
        Get SSH credentials using centralized lookup.
        
        Args:
            target_id: Replication target ID to lookup
            target: Pre-fetched target dict (optional, avoids DB lookup)
            
        Returns:
            Dict with hostname, port, username, key_data/password, or empty dict
        """
        if not self.ssh_manager:
            logger.warning("[SSH] No SSH manager available - executor not set")
            return {}
        
        # Fetch target if only ID provided
        if target_id and not target:
            target = self._get_replication_target_settings(target_id)
        
        if not target:
            logger.warning(f"[SSH] No target found for id={target_id}")
            return {}
        
        # Use centralized credential lookup
        creds = self.ssh_manager.get_credentials(target)
        
        if not creds:
            logger.error(
                f"[SSH] No credentials found for target {target.get('name', target_id)}. "
                f"Checked: target.ssh_key_encrypted, target.ssh_key_id, "
                f"hosting_vm templates, deployments, activity_settings. "
                f"Solution: Assign an SSH key to the target or run SSH Key Exchange."
            )
            return {}
        
        logger.info(f"[SSH] Credentials found via: {creds.get('key_source', 'unknown')}")
        return creds
    
    def _generate_snapshot_name(self, prefix: str = 'zerfaux') -> str:
        """Generate a ZFS snapshot name with timestamp"""
        timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
        return f"{prefix}-{timestamp}"
    
    def _get_ssh_client(self, hostname: str, port: int = 22, 
                        username: str = None, key_path: str = None,
                        key_data: str = None, password: str = None) -> Optional[object]:
        """
        Create SSH client connection.
        
        Args:
            hostname: Target hostname
            port: SSH port (default 22)
            username: SSH username
            key_path: Path to SSH private key file
            key_data: Raw SSH private key content (preferred over key_path)
            password: SSH password (fallback if no key)
            
        Returns:
            paramiko.SSHClient or None
        """
        if not PARAMIKO_AVAILABLE:
            logger.error("paramiko not installed")
            return None
        
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if key_data:
                # Load key from raw data using StringIO
                key_file = io.StringIO(key_data)
                pkey = None
                
                # Try different key types
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except Exception:
                        continue
                
                if pkey is None:
                    logger.error(f"Failed to parse SSH key data for {hostname}")
                    return None
                
                ssh.connect(
                    hostname, 
                    port=port, 
                    username=username, 
                    pkey=pkey,
                    timeout=30
                )
            elif key_path:
                ssh.connect(
                    hostname, 
                    port=port, 
                    username=username, 
                    key_filename=key_path,
                    timeout=30
                )
            else:
                ssh.connect(
                    hostname,
                    port=port,
                    username=username,
                    password=password,
                    timeout=30
                )
            
            logger.info(f"SSH connected to {hostname}")
            return ssh
            
        except Exception as e:
            logger.error(f"SSH connection failed to {hostname}: {e}")
            return None
    
    def _get_ssh_client_with_retry(self, hostname: str, port: int = 22,
                                    username: str = None, key_path: str = None,
                                    key_data: str = None, password: str = None,
                                    max_retries: int = 3, initial_delay: float = 5.0) -> Optional[object]:
        """
        SSH connection with retry logic for transient failures.
        
        Useful after reboots or network interruptions when SSH may not be
        immediately available.
        
        Args:
            hostname: Target hostname
            port: SSH port
            username: SSH username
            key_path: Path to SSH private key file
            key_data: Raw SSH private key content
            password: SSH password (fallback)
            max_retries: Maximum connection attempts (default 3)
            initial_delay: Initial delay between retries in seconds (default 5)
            
        Returns:
            paramiko.SSHClient or None
        """
        for attempt in range(max_retries):
            ssh = self._get_ssh_client(
                hostname, port, username,
                key_path=key_path, key_data=key_data, password=password
            )
            if ssh:
                if attempt > 0:
                    logger.info(f"SSH connected to {hostname} on attempt {attempt + 1}")
                return ssh
            
            if attempt < max_retries - 1:
                delay = initial_delay * (2 ** attempt)  # Exponential backoff: 5s, 10s, 20s
                logger.warning(f"SSH connection to {hostname} failed, retrying in {delay}s... (attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
        
        logger.error(f"SSH connection to {hostname} failed after {max_retries} attempts")
        return None
    
    def _exec_ssh_command(self, ssh, command: str, timeout: int = 300) -> Dict:
        """
        Execute SSH command and return result.
        
        Args:
            ssh: paramiko.SSHClient
            command: Command to execute
            timeout: Command timeout in seconds (default 300)
            
        Returns:
            Dict with stdout, stderr, exit_code
        """
        try:
            stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
            exit_code = stdout.channel.recv_exit_status()
            
            return {
                'stdout': stdout.read().decode('utf-8', errors='replace'),
                'stderr': stderr.read().decode('utf-8', errors='replace'),
                'exit_code': exit_code,
                'success': exit_code == 0
            }
        except Exception as e:
            return {
                'stdout': '',
                'stderr': str(e),
                'exit_code': -1,
                'success': False
            }
    
    def _get_replication_target_settings(self, target_id: str) -> Optional[Dict]:
        """Get replication target settings from database"""
        if not self.executor:
            return None
        
        try:
            import requests
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={'id': f'eq.{target_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                targets = response.json()
                return targets[0] if targets else None
        except Exception as e:
            logger.error(f"Failed to get replication target: {e}")
        
        return None
    
    def check_dataset_exists(self, dataset: str, ssh_hostname: str = None, 
                             ssh_username: str = 'root', ssh_port: int = 22,
                             ssh_key_data: str = None) -> bool:
        """
        Check if a ZFS dataset exists on a target host.
        
        Args:
            dataset: ZFS dataset path (e.g., 'tank/nfs/vm-name')
            ssh_hostname: Remote host (None for local)
            ssh_username: SSH username
            ssh_port: SSH port
            ssh_key_data: SSH private key data
            
        Returns:
            True if dataset exists, False otherwise
        """
        command = f"zfs list -H -o name {dataset}"
        
        if ssh_hostname:
            ssh = self._get_ssh_client(ssh_hostname, ssh_port, ssh_username, key_data=ssh_key_data)
            if not ssh:
                return False
            try:
                result = self._exec_ssh_command(ssh, command, timeout=30)
                return result.get('success', False) and result.get('exit_code', 1) == 0
            finally:
                ssh.close()
        else:
            import subprocess
            try:
                proc = subprocess.run(command.split(), capture_output=True, timeout=30)
                return proc.returncode == 0
            except:
                return False
    
    def check_target_health(self, target_hostname: str, zfs_pool: str,
                            ssh_username: str = None, ssh_port: int = 22,
                            ssh_key_path: str = None, ssh_key_data: str = None,
                            ssh_password: str = None, target_id: str = None) -> Dict:
        """
        Check health of replication target.
        
        Connects via SSH and runs zpool status to verify health.
        If no SSH credentials provided, attempts centralized lookup via target_id.
        
        Args:
            target_hostname: Target host address
            zfs_pool: ZFS pool name
            ssh_username: SSH username
            ssh_port: SSH port
            ssh_key_path: Path to SSH key file
            ssh_key_data: Raw SSH private key content
            ssh_password: SSH password (fallback)
            target_id: Replication target ID for auto credential lookup
            
        Returns:
            Dict with health check results
        """
        logger.info(f"Checking target health: {target_hostname}")
        
        # Auto-fetch credentials if not provided and target_id given
        if not ssh_key_data and not ssh_key_path and not ssh_password and target_id:
            logger.info(f"[check_target_health] No credentials provided, looking up via target_id={target_id}")
            creds = self._get_ssh_credentials_for_target(target_id)
            if creds:
                ssh_key_data = creds.get('key_data')
                ssh_key_path = creds.get('key_path')
                ssh_password = creds.get('password')
                ssh_username = creds.get('username', ssh_username)
                ssh_port = creds.get('port', ssh_port)
                # Use credential's resolved hostname if different (e.g., hosting VM IP)
                if creds.get('hostname') and creds.get('hostname') != target_hostname:
                    logger.info(f"[check_target_health] Using resolved hostname {creds['hostname']} instead of {target_hostname}")
                    target_hostname = creds['hostname']
        
        if not PARAMIKO_AVAILABLE:
            return {
                'success': False,
                'hostname': target_hostname,
                'zfs_pool': zfs_pool,
                'error': 'paramiko not installed',
                'message': 'SSH library not available'
            }
        
        ssh = self._get_ssh_client(target_hostname, ssh_port, ssh_username, 
                                   key_path=ssh_key_path, key_data=ssh_key_data,
                                   password=ssh_password)
        if not ssh:
            return {
                'success': False,
                'hostname': target_hostname,
                'zfs_pool': zfs_pool,
                'pool_health': 'UNKNOWN',
                'error': 'SSH connection failed',
                'message': f'Cannot connect to {target_hostname}'
            }
        
        try:
            # Check pool status
            status_result = self._exec_ssh_command(ssh, f'zpool status {zfs_pool}')
            
            pool_health = 'UNKNOWN'
            if status_result['success']:
                output = status_result['stdout']
                if 'ONLINE' in output:
                    pool_health = 'ONLINE'
                elif 'DEGRADED' in output:
                    pool_health = 'DEGRADED'
                elif 'FAULTED' in output:
                    pool_health = 'FAULTED'
            
            # Check free space
            space_result = self._exec_ssh_command(ssh, f'zfs list -H -o available {zfs_pool}')
            free_space_str = space_result['stdout'].strip() if space_result['success'] else '0'
            
            # Parse free space (e.g., "1.5T" -> 1500 GB)
            free_space_gb = self._parse_zfs_size(free_space_str)
            
            # Get total space
            total_result = self._exec_ssh_command(ssh, f'zfs get -H -o value quota {zfs_pool}')
            total_str = total_result['stdout'].strip() if total_result['success'] else '0'
            total_space_gb = self._parse_zfs_size(total_str) if total_str != 'none' else 0
            
            # Get last scrub time
            scrub_result = self._exec_ssh_command(ssh, f"zpool status {zfs_pool} | grep 'scan:'")
            last_scrub = scrub_result['stdout'].strip() if scrub_result['success'] else 'Unknown'
            
            return {
                'success': True,
                'hostname': target_hostname,
                'zfs_pool': zfs_pool,
                'pool_health': pool_health,
                'free_space_gb': free_space_gb,
                'total_space_gb': total_space_gb if total_space_gb > 0 else free_space_gb * 2,  # Estimate
                'last_scrub': last_scrub,
                'message': f'Pool {zfs_pool} is {pool_health}'
            }
            
        except Exception as e:
            logger.error(f"Health check error: {e}")
            return {
                'success': False,
                'hostname': target_hostname,
                'zfs_pool': zfs_pool,
                'error': str(e),
                'message': f'Health check failed: {e}'
            }
        finally:
            try:
                ssh.close()
            except:
                pass
    
    def _parse_zfs_size(self, size_str: str) -> int:
        """Parse ZFS size string (e.g., '1.5T', '500G') to GB"""
        try:
            size_str = size_str.strip().upper()
            if not size_str or size_str == '0' or size_str == 'NONE':
                return 0
            
            multipliers = {
                'T': 1024,
                'G': 1,
                'M': 0.001,
                'K': 0.000001
            }
            
            for suffix, mult in multipliers.items():
                if size_str.endswith(suffix):
                    return int(float(size_str[:-1]) * mult)
            
            return int(float(size_str))
        except:
            return 0
    
    def create_snapshot(self, dataset: str, snapshot_name: str = None,
                        ssh_hostname: str = None, ssh_username: str = None,
                        ssh_port: int = 22, ssh_key_path: str = None,
                        ssh_key_data: str = None) -> Dict:
        """
        Create a ZFS snapshot.
        
        Args:
            dataset: ZFS dataset path
            snapshot_name: Optional snapshot name
            ssh_hostname: Remote host (None for local)
            ssh_username: SSH username for remote
            ssh_port: SSH port
            ssh_key_path: Path to SSH key file
            ssh_key_data: Raw SSH private key content (preferred)
            
        Returns:
            Dict with snapshot result
        """
        snapshot_name = snapshot_name or self._generate_snapshot_name()
        full_snapshot = f"{dataset}@{snapshot_name}"
        
        logger.info(f"Creating snapshot: {full_snapshot}")
        
        command = f"zfs snapshot {full_snapshot}"
        
        if ssh_hostname:
            if not PARAMIKO_AVAILABLE:
                return {
                    'success': False,
                    'dataset': dataset,
                    'snapshot_name': snapshot_name,
                    'error': 'paramiko not installed'
                }
            
            ssh = self._get_ssh_client(ssh_hostname, ssh_port, ssh_username, 
                                       key_path=ssh_key_path, key_data=ssh_key_data)
            if not ssh:
                return {
                    'success': False,
                    'dataset': dataset,
                    'snapshot_name': snapshot_name,
                    'error': f'SSH connection failed to {ssh_hostname}'
                }
            
            try:
                result = self._exec_ssh_command(ssh, command)
            finally:
                ssh.close()
        else:
            # Local execution
            import subprocess
            try:
                proc = subprocess.run(
                    command.split(), 
                    capture_output=True, 
                    text=True,
                    timeout=60
                )
                result = {
                    'success': proc.returncode == 0,
                    'stdout': proc.stdout,
                    'stderr': proc.stderr,
                    'exit_code': proc.returncode
                }
            except Exception as e:
                result = {'success': False, 'stderr': str(e)}
        
        if result['success']:
            return {
                'success': True,
                'dataset': dataset,
                'snapshot_name': snapshot_name,
                'full_snapshot': full_snapshot,
                'created_at': datetime.utcnow().isoformat(),
                'message': f'Created snapshot {full_snapshot}'
            }
        else:
            return {
                'success': False,
                'dataset': dataset,
                'snapshot_name': snapshot_name,
                'error': result.get('stderr', 'Unknown error'),
                'message': f'Failed to create snapshot: {result.get("stderr")}'
            }
    
    def check_snapshot_exists(self, dataset: str, snapshot_name: str,
                              ssh_hostname: str = None, ssh_username: str = None,
                              ssh_port: int = 22, ssh_key_data: str = None) -> bool:
        """
        Check if a specific snapshot exists on a dataset (local or remote).
        
        Args:
            dataset: ZFS dataset path
            snapshot_name: Snapshot name (without @ prefix)
            ssh_hostname: Remote hostname (None for local)
            ssh_username: SSH username
            ssh_port: SSH port
            ssh_key_data: SSH private key data
            
        Returns:
            True if the snapshot exists, False otherwise
        """
        # Clean snapshot name (remove @ if present)
        if snapshot_name.startswith('@'):
            snapshot_name = snapshot_name[1:]
        
        full_snapshot = f"{dataset}@{snapshot_name}"
        command = f"zfs list -t snapshot -H -o name {full_snapshot} 2>/dev/null"
        
        logger.info(f"Checking if snapshot exists: {full_snapshot} on {ssh_hostname or 'localhost'}")
        
        if ssh_hostname:
            # Remote check via SSH
            ssh = self._get_ssh_client(ssh_hostname, ssh_port, ssh_username, key_data=ssh_key_data)
            if not ssh:
                logger.warning(f"Cannot connect to {ssh_hostname} to check snapshot")
                return False
            
            try:
                result = self._exec_ssh_command(ssh, command, timeout=30)
                exists = result.get('success', False) and full_snapshot in result.get('stdout', '')
                logger.info(f"Snapshot {full_snapshot} exists on {ssh_hostname}: {exists}")
                return exists
            finally:
                ssh.close()
        else:
            # Local check
            try:
                result = subprocess.run(
                    command.split(),
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                exists = result.returncode == 0 and full_snapshot in result.stdout
                logger.info(f"Snapshot {full_snapshot} exists locally: {exists}")
                return exists
            except Exception as e:
                logger.error(f"Error checking local snapshot: {e}")
                return False
    
    def replicate_dataset(self, source_dataset: str, source_snapshot: str,
                          target_host: str, target_dataset: str,
                          incremental_from: str = None,
                          ssh_username: str = None, ssh_port: int = 22,
                          target_ssh_key_data: str = None,
                          use_syncoid: bool = False,
                          source_host: str = None, source_ssh_username: str = None,
                          source_ssh_port: int = 22, source_ssh_key_data: str = None,
                          expected_bytes: int = 0) -> Dict:
        """
        Replicate a ZFS dataset to a remote target.
        
        Uses either native ZFS send/receive or syncoid.
        Can execute locally or remotely via SSH (for Windows Job Executors).
        
        Args:
            source_dataset: Source ZFS dataset
            source_snapshot: Snapshot to send
            target_host: Target hostname
            target_dataset: Target ZFS dataset
            incremental_from: Previous snapshot for incremental send
            ssh_username: SSH username for target
            ssh_port: SSH port for target
            use_syncoid: Whether to use syncoid instead of native ZFS
            source_host: Source ZFS server to execute command on (via SSH)
            source_ssh_username: SSH username for source server
            source_ssh_port: SSH port for source server
            source_ssh_key_data: SSH private key for source server
            
        Returns:
            Dict with replication result
        """
        logger.info(f"Replicating {source_dataset}@{source_snapshot} to {target_host}:{target_dataset}")
        start_time = time.time()
        
        # Check if destination dataset exists
        dest_exists = self.check_dataset_exists(
            target_dataset, 
            ssh_hostname=target_host,
            ssh_username=ssh_username or 'root',
            ssh_port=ssh_port,
            ssh_key_data=target_ssh_key_data  # Use Site B's key
        )
        
        # If incremental but destination doesn't exist, force full send
        if incremental_from and not dest_exists:
            logger.warning(f"Destination {target_dataset} doesn't exist on {target_host}, switching to full send")
            incremental_from = None  # Force full send
        
        # Calculate dynamic timeout based on expected transfer size
        # Small transfers (<1MB): 2 minutes max
        # Medium transfers (1MB-1GB): 10 minutes
        # Large transfers (>1GB): 1 hour
        if expected_bytes and expected_bytes < 1_000_000:  # < 1MB
            transfer_timeout = 120  # 2 minutes
        elif expected_bytes and expected_bytes < 1_000_000_000:  # < 1GB
            transfer_timeout = 600  # 10 minutes
        else:
            transfer_timeout = 3600  # 1 hour for large or unknown size
        
        logger.info(f"Transfer timeout set to {transfer_timeout}s for expected {expected_bytes} bytes")
        
        if use_syncoid:
            # Use syncoid for replication
            command = f"syncoid --no-privilege-elevation {source_dataset} {ssh_username}@{target_host}:{target_dataset}"
        else:
            # Use native ZFS send/receive
            if incremental_from:
                # Add -v for verbose output with byte counts
                send_cmd = f"zfs send -v -i @{incremental_from} {source_dataset}@{source_snapshot}"
                # Incremental: use -Fu (force rollback, no mount)
                recv_cmd = f"zfs receive -Fu {target_dataset}"
            else:
                # Add -v for verbose output with byte counts
                send_cmd = f"zfs send -v {source_dataset}@{source_snapshot}"
                # Full send - use -Fu to receive without mounting first (avoids "dataset is busy" from NFS)
                # Then explicitly mount afterward
                logger.info(f"Full send - using 'zfs receive -Fu' approach to bypass busy dataset (dest_exists={dest_exists})")
                recv_cmd = f"zfs receive -Fu {target_dataset} && (zfs mount {target_dataset} 2>/dev/null || true)"
            
            # Build the SSH command for target with StrictHostKeyChecking disabled
            ssh_opts = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes"
            if ssh_username:
                command = f"{send_cmd} | ssh {ssh_opts} -p {ssh_port} {ssh_username}@{target_host} '{recv_cmd}'"
            else:
                command = f"{send_cmd} | ssh {ssh_opts} -p {ssh_port} {target_host} '{recv_cmd}'"
        
        try:
            if source_host:
                # Execute ZFS send on the SOURCE server via SSH (for Windows Job Executors)
                logger.info(f"Executing ZFS send remotely on {source_host}")
                ssh = self._get_ssh_client(
                    source_host, 
                    source_ssh_port, 
                    source_ssh_username,
                    key_data=source_ssh_key_data
                )
                
                if not ssh:
                    return {
                        'success': False,
                        'source_dataset': source_dataset,
                        'error': f'Failed to connect to source host {source_host}',
                        'message': f'Cannot SSH to source ZFS server {source_host}'
                    }
                
                try:
                    result = self._exec_ssh_command(ssh, command, timeout=transfer_timeout)
                    elapsed = time.time() - start_time
                    
                    if result.get('success'):
                        bytes_transferred = self._parse_transfer_size(
                            result.get('stdout', '') + result.get('stderr', '')
                        )
                        
                        return {
                            'success': True,
                            'source_dataset': source_dataset,
                            'source_snapshot': source_snapshot,
                            'target_host': target_host,
                            'target_dataset': target_dataset,
                            'incremental': incremental_from is not None,
                            'incremental_from': incremental_from,
                            'bytes_transferred': bytes_transferred,
                            'transfer_rate_mbps': round(bytes_transferred / 1_000_000 / max(elapsed, 1), 2),
                            'started_at': datetime.fromtimestamp(start_time).isoformat(),
                            'completed_at': datetime.utcnow().isoformat(),
                            'elapsed_seconds': round(elapsed, 2),
                            'executed_on': source_host,
                            'message': f'Replicated {bytes_transferred / 1_000_000:.2f} MB in {elapsed:.2f}s'
                        }
                    else:
                        return {
                            'success': False,
                            'source_dataset': source_dataset,
                            'source_snapshot': source_snapshot,
                            'target_host': target_host,
                            'target_dataset': target_dataset,
                            'error': result.get('stderr', 'Unknown error'),
                            'executed_on': source_host,
                            'message': f'Replication failed: {result.get("stderr")}'
                        }
                finally:
                    ssh.close()
            else:
                # Local execution (when Job Executor runs directly on ZFS server)
                proc = subprocess.run(
                    command,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=transfer_timeout  # Dynamic timeout based on expected size
                )
                
                elapsed = time.time() - start_time
                
                if proc.returncode == 0:
                    bytes_transferred = self._parse_transfer_size(proc.stdout + proc.stderr)
                    
                    return {
                        'success': True,
                        'source_dataset': source_dataset,
                        'source_snapshot': source_snapshot,
                        'target_host': target_host,
                        'target_dataset': target_dataset,
                        'incremental': incremental_from is not None,
                        'incremental_from': incremental_from,
                        'bytes_transferred': bytes_transferred,
                        'transfer_rate_mbps': round(bytes_transferred / 1_000_000 / max(elapsed, 1), 2),
                        'started_at': datetime.fromtimestamp(start_time).isoformat(),
                        'completed_at': datetime.utcnow().isoformat(),
                        'elapsed_seconds': round(elapsed, 2),
                        'executed_on': 'local',
                        'message': f'Replicated {bytes_transferred / 1_000_000:.2f} MB in {elapsed:.2f}s'
                    }
                else:
                    return {
                        'success': False,
                        'source_dataset': source_dataset,
                        'source_snapshot': source_snapshot,
                        'target_host': target_host,
                        'target_dataset': target_dataset,
                        'error': proc.stderr,
                        'message': f'Replication failed: {proc.stderr}'
                    }
                    
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'source_dataset': source_dataset,
                'error': 'Timeout',
                'message': f'Replication timed out after {transfer_timeout}s (expected {expected_bytes} bytes)'
            }
        except Exception as e:
            return {
                'success': False,
                'source_dataset': source_dataset,
                'error': str(e),
                'message': f'Replication error: {e}'
            }
    
    def _parse_transfer_size(self, output: str) -> int:
        """
        Parse bytes transferred from zfs send -v output.
        
        zfs send -v outputs lines like:
        - "full send of pool/dataset@snap estimated size is 26.7G"
        - "incremental send of pool/dataset@snap estimated size is 1.2M"
        - "total estimated size is 26.7G"
        - At the end: "26.7G  pool/dataset@snap"
        
        Also handles raw byte counts and other formats.
        """
        import re
        
        if not output:
            return 0
        
        multipliers = {'T': 1024**4, 'G': 1024**3, 'M': 1024**2, 'K': 1024, 'B': 1, '': 1}
        
        # Patterns ordered by specificity
        patterns = [
            # zfs send -v output: "estimated size is 26.7G"
            r'estimated size is\s+(\d+\.?\d*)\s*([TGMKB])',
            # zfs send -v output: "total estimated size is 26.7G"
            r'total estimated size is\s+(\d+\.?\d*)\s*([TGMKB])',
            # zfs send -v final line: "26.7G  pool/dataset@snap"
            r'^(\d+\.?\d*)\s*([TGMKB])\s+\S+@\S+',
            # Generic: "sent 26.7G" or "26.7G bytes"
            r'sent\s+(\d+\.?\d*)\s*([TGMKB])',
            r'(\d+\.?\d*)\s*([TGMKB])B?\s*bytes?',
            # Raw byte count (no unit)
            r'size\s+is\s+(\d+)\s*$',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, output, re.IGNORECASE | re.MULTILINE)
            if match:
                size = float(match.group(1))
                unit = match.group(2).upper() if len(match.groups()) > 1 and match.group(2) else ''
                bytes_val = int(size * multipliers.get(unit, 1))
                if bytes_val > 0:
                    logger.debug(f"Parsed transfer size: {bytes_val} bytes (pattern: {pattern})")
                    return bytes_val
        
        # Try to find any large number that might be bytes
        numbers = re.findall(r'\b(\d{6,})\b', output)
        if numbers:
            # Return the largest number (likely total bytes)
            largest = max(int(n) for n in numbers)
            logger.debug(f"Parsed transfer size from raw number: {largest} bytes")
            return largest
        
        logger.warning(f"Could not parse transfer size from output: {output[:200]}...")
        return 0
    
    def get_snapshot_send_size(self, dataset: str, snapshot: str,
                               incremental_from: str = None,
                               ssh_hostname: str = None, ssh_username: str = None,
                               ssh_port: int = 22, ssh_key_data: str = None) -> Dict:
        """
        Get exact size that zfs send will transfer using -nP flags.
        Uses: zfs send -nP [-i @base] dataset@snapshot
        Outputs parseable size without actually sending.
        
        Args:
            dataset: ZFS dataset path
            snapshot: Snapshot name
            incremental_from: Previous snapshot for incremental send
            ssh_hostname: Remote host (None for local)
            ssh_username: SSH username
            ssh_port: SSH port
            ssh_key_data: SSH private key content
            
        Returns:
            Dict with bytes, success, and incremental flag
        """
        import re
        
        if incremental_from:
            cmd = f"zfs send -nP -i @{incremental_from} {dataset}@{snapshot}"
        else:
            cmd = f"zfs send -nP {dataset}@{snapshot}"
        
        logger.info(f"[get_snapshot_send_size] Getting size for {dataset}@{snapshot}")
        logger.info(f"[get_snapshot_send_size] Incremental from: {incremental_from}")
        logger.info(f"[get_snapshot_send_size] Running command: {cmd}")
        
        result = self._exec_command(cmd, ssh_hostname, ssh_username, ssh_port, ssh_key_data)
        
        logger.info(f"[get_snapshot_send_size] Command success: {result.get('success')}")
        logger.info(f"[get_snapshot_send_size] Stdout (first 500 chars): {result.get('stdout', '')[:500]}")
        logger.info(f"[get_snapshot_send_size] Stderr (first 500 chars): {result.get('stderr', '')[:500]}")
        
        if result.get('success'):
            stdout = result.get('stdout', '')
            
            # Try multiple parsing formats for different ZFS versions
            for line in stdout.splitlines():
                stripped = line.strip()
                
                # Format 1: OpenZFS 2.x tab-separated: "size\t11273642128"
                if stripped.startswith('size'):
                    parts = stripped.split()
                    if len(parts) >= 2:
                        try:
                            size_bytes = int(parts[-1])
                            logger.info(f"[get_snapshot_send_size] Parsed size (format 1 - tab): {size_bytes}")
                            return {
                                'success': True,
                                'bytes': size_bytes,
                                'incremental': incremental_from is not None,
                                'incremental_from': incremental_from
                            }
                        except ValueError:
                            logger.warning(f"[get_snapshot_send_size] Failed to parse as int: {parts[-1]}")
                
                # Format 2: "full\tdataset@snap\t123456789" - take last number
                if stripped.startswith('full') or stripped.startswith('incremental'):
                    parts = stripped.split()
                    if len(parts) >= 3:
                        try:
                            size_bytes = int(parts[-1])
                            logger.info(f"[get_snapshot_send_size] Parsed size (format 2 - full/incr): {size_bytes}")
                            return {
                                'success': True,
                                'bytes': size_bytes,
                                'incremental': incremental_from is not None,
                                'incremental_from': incremental_from
                            }
                        except ValueError:
                            pass
            
            # Format 3: Older ZFS: "estimated size is 123456789"
            match = re.search(r'estimated size[^0-9]*(\d+)', stdout, re.IGNORECASE)
            if match:
                size_bytes = int(match.group(1))
                logger.info(f"[get_snapshot_send_size] Parsed size (format 3 - estimated): {size_bytes}")
                return {
                    'success': True,
                    'bytes': size_bytes,
                    'incremental': incremental_from is not None,
                    'incremental_from': incremental_from
                }
            
            # Format 4: Just look for any large number in output (fallback)
            numbers = re.findall(r'\b(\d{6,})\b', stdout)
            if numbers:
                size_bytes = max(int(n) for n in numbers)
                logger.info(f"[get_snapshot_send_size] Parsed size (format 4 - fallback number): {size_bytes}")
                return {
                    'success': True,
                    'bytes': size_bytes,
                    'incremental': incremental_from is not None,
                    'incremental_from': incremental_from
                }
            
            logger.warning(f"[get_snapshot_send_size] Could not parse size from output")
        
        return {
            'success': False,
            'bytes': 0,
            'error': result.get('stderr', 'Unknown error')
        }
    
    def _exec_command(self, command: str, ssh_hostname: str = None,
                      ssh_username: str = None, ssh_port: int = 22,
                      ssh_key_data: str = None) -> Dict:
        """Execute command locally or via SSH"""
        if ssh_hostname:
            if not PARAMIKO_AVAILABLE:
                return {'success': False, 'stderr': 'paramiko not available'}
            
            ssh = self._get_ssh_client(ssh_hostname, ssh_port, ssh_username,
                                       key_data=ssh_key_data)
            if not ssh:
                return {'success': False, 'stderr': f'SSH connection failed to {ssh_hostname}'}
            
            try:
                return self._exec_ssh_command(ssh, command)
            finally:
                ssh.close()
        else:
            import subprocess
            try:
                proc = subprocess.run(
                    command, shell=True, capture_output=True, text=True, timeout=60
                )
                return {
                    'success': proc.returncode == 0,
                    'stdout': proc.stdout,
                    'stderr': proc.stderr,
                    'exit_code': proc.returncode
                }
            except Exception as e:
                return {'success': False, 'stderr': str(e)}
    
    def verify_snapshot_on_target(self, target_host: str, target_dataset: str,
                                   snapshot_name: str, expected_bytes: int = 0,
                                   ssh_username: str = None, ssh_port: int = 22,
                                   ssh_key_data: str = None) -> Dict:
        """
        Verify snapshot arrived on Site B by:
        1. Checking snapshot exists
        2. Comparing size (referenced bytes)
        
        Args:
            target_host: Site B hostname
            target_dataset: Target dataset path
            snapshot_name: Snapshot to verify
            expected_bytes: Expected size in bytes
            ssh_username: SSH username
            ssh_port: SSH port
            ssh_key_data: SSH key content
            
        Returns:
            Dict with verification result
        """
        logger.info(f"Verifying snapshot on Site B: {target_dataset}@{snapshot_name}")
        
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'verified': False, 'error': 'paramiko not available'}
        
        # Use retry logic for verification - Site B may be slow to respond after reboot or heavy I/O
        ssh = self._get_ssh_client_with_retry(
            target_host, ssh_port, ssh_username,
            key_data=ssh_key_data,
            max_retries=3,
            initial_delay=5.0
        )
        if not ssh:
            return {'success': False, 'verified': False, 'error': 'Cannot connect to Site B after retries'}
        
        try:
            # 1. Check snapshot exists
            exists_cmd = f"zfs list -t snapshot {target_dataset}@{snapshot_name}"
            exists_result = self._exec_ssh_command(ssh, exists_cmd)
            
            if not exists_result['success']:
                return {
                    'success': False,
                    'verified': False,
                    'snapshot_exists': False,
                    'error': f'Snapshot not found on Site B: {target_dataset}@{snapshot_name}'
                }
            
            # 2. Get snapshot size on target
            size_cmd = f"zfs list -Hp -o referenced {target_dataset}@{snapshot_name}"
            size_result = self._exec_ssh_command(ssh, size_cmd)
            
            target_bytes = 0
            if size_result['success']:
                try:
                    target_bytes = int(size_result['stdout'].strip())
                except ValueError:
                    pass
            
            # 3. Compare sizes (allow 5% tolerance for metadata)
            size_match = True
            if expected_bytes > 0:
                size_match = abs(target_bytes - expected_bytes) < (expected_bytes * 0.05)
            
            return {
                'success': True,
                'verified': True,
                'snapshot_exists': True,
                'target_bytes': target_bytes,
                'expected_bytes': expected_bytes,
                'size_match': size_match,
                'target_dataset': target_dataset,
                'snapshot_name': snapshot_name,
                'message': f'Verified {target_dataset}@{snapshot_name} on Site B ({target_bytes} bytes)'
            }
            
        except Exception as e:
            logger.error(f"Site B verification error: {e}")
            return {
                'success': False,
                'verified': False,
                'error': str(e)
            }
        finally:
            try:
                ssh.close()
            except:
                pass
    
    def list_snapshots(self, dataset: str, target_host: str = None,
                       ssh_username: str = None, ssh_port: int = 22) -> List[Dict]:
        """
        List ZFS snapshots for a dataset.
        
        Args:
            dataset: ZFS dataset path
            target_host: Optional remote host
            ssh_username: SSH username
            ssh_port: SSH port
            
        Returns:
            List of snapshot dicts
        """
        logger.info(f"Listing snapshots for: {dataset}")
        
        command = f"zfs list -t snapshot -H -o name,creation,used,referenced {dataset}"
        
        if target_host:
            if not PARAMIKO_AVAILABLE:
                return []
            
            ssh = self._get_ssh_client(target_host, ssh_port, ssh_username)
            if not ssh:
                return []
            
            try:
                result = self._exec_ssh_command(ssh, command)
            finally:
                ssh.close()
        else:
            import subprocess
            try:
                proc = subprocess.run(command.split(), capture_output=True, text=True, timeout=60)
                result = {
                    'success': proc.returncode == 0,
                    'stdout': proc.stdout,
                    'stderr': proc.stderr
                }
            except:
                return []
        
        if not result['success']:
            return []
        
        snapshots = []
        for line in result['stdout'].strip().split('\n'):
            if not line:
                continue
            
            parts = line.split('\t')
            if len(parts) >= 4:
                full_name = parts[0]
                name = full_name.split('@')[-1] if '@' in full_name else full_name
                
                snapshots.append({
                    'name': name,
                    'full_name': full_name,
                    'created_at': parts[1],
                    'used_bytes': self._parse_zfs_size(parts[2]) * 1024**3,
                    'referenced_bytes': self._parse_zfs_size(parts[3]) * 1024**3
                })
        
        return snapshots
    
    def delete_snapshot(self, dataset: str, snapshot_name: str,
                        target_host: str = None, ssh_username: str = None,
                        ssh_port: int = 22) -> Dict:
        """
        Delete a ZFS snapshot.
        
        Args:
            dataset: ZFS dataset path
            snapshot_name: Snapshot name to delete
            target_host: Optional remote host
            ssh_username: SSH username
            ssh_port: SSH port
            
        Returns:
            Dict with deletion result
        """
        full_snapshot = f"{dataset}@{snapshot_name}"
        logger.info(f"Deleting snapshot: {full_snapshot}")
        
        command = f"zfs destroy {full_snapshot}"
        
        if target_host:
            if not PARAMIKO_AVAILABLE:
                return {'success': False, 'error': 'paramiko not installed'}
            
            ssh = self._get_ssh_client(target_host, ssh_port, ssh_username)
            if not ssh:
                return {'success': False, 'error': 'SSH connection failed'}
            
            try:
                result = self._exec_ssh_command(ssh, command)
            finally:
                ssh.close()
        else:
            import subprocess
            try:
                proc = subprocess.run(command.split(), capture_output=True, text=True, timeout=60)
                result = {
                    'success': proc.returncode == 0,
                    'stderr': proc.stderr
                }
            except Exception as e:
                result = {'success': False, 'stderr': str(e)}
        
        if result['success']:
            return {
                'success': True,
                'dataset': dataset,
                'snapshot_name': snapshot_name,
                'deleted_at': datetime.utcnow().isoformat(),
                'message': f'Deleted snapshot {full_snapshot}'
            }
        else:
            return {
                'success': False,
                'dataset': dataset,
                'snapshot_name': snapshot_name,
                'error': result.get('stderr'),
                'message': f'Failed to delete snapshot: {result.get("stderr")}'
            }
    
    def find_common_snapshot(self, source_dataset: str, target_dataset: str,
                             source_host: str = None, source_username: str = 'root', source_port: int = 22,
                             target_host: str = None, target_username: str = 'root', target_port: int = 22,
                             source_key_data: str = None, target_key_data: str = None) -> Optional[str]:
        """
        Find the most recent snapshot that exists on both source and target.
        
        This allows incremental recovery when the last-used snapshot is missing,
        by finding a common earlier snapshot to use as the incremental base.
        
        Args:
            source_dataset: ZFS dataset on source
            target_dataset: ZFS dataset on target
            source_host: Source SSH host
            source_username: Source SSH username
            source_port: Source SSH port
            target_host: Target SSH host
            target_username: Target SSH username
            target_port: Target SSH port
            source_key_data: Source SSH key data
            target_key_data: Target SSH key data
            
        Returns:
            Snapshot name if common snapshot found, None otherwise
        """
        logger.info(f"Finding common snapshot between {source_dataset} and {target_dataset}")
        
        # Get snapshots from source
        source_snapshots = self.list_snapshots_with_key(
            source_dataset, source_host, source_username, source_port, source_key_data
        )
        
        # Get snapshots from target
        target_snapshots = self.list_snapshots_with_key(
            target_dataset, target_host, target_username, target_port, target_key_data
        )
        
        source_names = {s['name'] for s in source_snapshots}
        target_names = {s['name'] for s in target_snapshots}
        
        common = source_names & target_names
        
        if not common:
            logger.info(f"No common snapshots found between source and target")
            return None
        
        # Return most recent common snapshot (zerfaux snapshots sort by timestamp in name)
        sorted_common = sorted(common, reverse=True)
        found = sorted_common[0] if sorted_common else None
        
        if found:
            logger.info(f"Found common snapshot: @{found}")
        
        return found
    
    def list_snapshots_with_key(self, dataset: str, target_host: str = None,
                                 ssh_username: str = 'root', ssh_port: int = 22,
                                 ssh_key_data: str = None) -> List[Dict]:
        """
        List ZFS snapshots with SSH key support.
        
        Extended version of list_snapshots that accepts key_data for authentication.
        """
        logger.info(f"Listing snapshots for: {dataset} on {target_host or 'localhost'}")
        
        command = f"zfs list -t snapshot -H -o name,creation,used,referenced {dataset}"
        
        if target_host:
            if not PARAMIKO_AVAILABLE:
                return []
            
            ssh = self._get_ssh_client(target_host, ssh_port, ssh_username, key_data=ssh_key_data)
            if not ssh:
                logger.warning(f"SSH connection failed to {target_host}")
                return []
            
            try:
                result = self._exec_ssh_command(ssh, command, timeout=60)
            finally:
                ssh.close()
        else:
            import subprocess
            try:
                proc = subprocess.run(command.split(), capture_output=True, text=True, timeout=60)
                result = {
                    'success': proc.returncode == 0,
                    'stdout': proc.stdout,
                    'stderr': proc.stderr
                }
            except Exception as e:
                logger.error(f"Local snapshot list failed: {e}")
                return []
        
        if not result.get('success'):
            logger.warning(f"Snapshot list failed: {result.get('stderr', 'Unknown error')}")
            return []
        
        snapshots = []
        for line in result.get('stdout', '').strip().split('\n'):
            if not line:
                continue
            
            parts = line.split('\t')
            if len(parts) >= 4:
                full_name = parts[0]
                name = full_name.split('@')[-1] if '@' in full_name else full_name
                
                snapshots.append({
                    'name': name,
                    'full_name': full_name,
                    'created_at': parts[1],
                    'used_bytes': self._parse_zfs_size(parts[2]) * 1024**3,
                    'referenced_bytes': self._parse_zfs_size(parts[3]) * 1024**3
                })
        
        return snapshots
    
    def delete_all_snapshots(self, dataset: str, target_host: str = None,
                             ssh_username: str = 'root', ssh_port: int = 22,
                             ssh_key_data: str = None) -> Dict:
        """
        Delete all snapshots for a dataset to prepare for full send.
        
        When no common snapshot exists between source and target, the target's
        orphaned snapshots must be deleted before ZFS can receive a full stream.
        
        Args:
            dataset: ZFS dataset path
            target_host: Target SSH host
            ssh_username: SSH username
            ssh_port: SSH port
            ssh_key_data: SSH private key data
            
        Returns:
            Dict with: success, deleted count, errors list
        """
        logger.info(f"Deleting all snapshots for: {dataset} on {target_host or 'localhost'}")
        
        snapshots = self.list_snapshots_with_key(
            dataset, target_host, ssh_username, ssh_port, ssh_key_data
        )
        
        if not snapshots:
            logger.info(f"No snapshots to delete for {dataset}")
            return {'success': True, 'deleted': 0, 'errors': []}
        
        deleted = 0
        errors = []
        
        # Connect once and delete all snapshots
        if target_host:
            if not PARAMIKO_AVAILABLE:
                return {'success': False, 'deleted': 0, 'errors': ['paramiko not installed']}
            
            ssh = self._get_ssh_client(target_host, ssh_port, ssh_username, key_data=ssh_key_data)
            if not ssh:
                return {'success': False, 'deleted': 0, 'errors': ['SSH connection failed']}
            
            try:
                for snap in snapshots:
                    full_snapshot = f"{dataset}@{snap['name']}"
                    command = f"zfs destroy {full_snapshot}"
                    result = self._exec_ssh_command(ssh, command, timeout=60)
                    
                    if result.get('success'):
                        deleted += 1
                        logger.info(f"Deleted snapshot: {full_snapshot}")
                    else:
                        error_msg = f"{snap['name']}: {result.get('stderr', 'Unknown error')}"
                        errors.append(error_msg)
                        logger.warning(f"Failed to delete {full_snapshot}: {result.get('stderr')}")
            finally:
                ssh.close()
        else:
            import subprocess
            for snap in snapshots:
                full_snapshot = f"{dataset}@{snap['name']}"
                try:
                    proc = subprocess.run(
                        ['zfs', 'destroy', full_snapshot],
                        capture_output=True, text=True, timeout=60
                    )
                    if proc.returncode == 0:
                        deleted += 1
                    else:
                        errors.append(f"{snap['name']}: {proc.stderr}")
                except Exception as e:
                    errors.append(f"{snap['name']}: {str(e)}")
        
        logger.info(f"Deleted {deleted}/{len(snapshots)} snapshots, {len(errors)} errors")
        
        return {
            'success': len(errors) == 0,
            'deleted': deleted,
            'total': len(snapshots),
            'errors': errors
        }
    
    def _get_vcenter_settings(self, vcenter_id: str) -> Optional[Dict]:
        """Get vCenter settings from database"""
        if not self.executor:
            return None
        
        try:
            import requests
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters",
                params={'id': f'eq.{vcenter_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                settings = response.json()
                return settings[0] if settings else None
        except Exception as e:
            logger.error(f"Failed to get vCenter settings: {e}")
        
        return None
    
    def _decrypt_password(self, encrypted: str) -> Optional[str]:
        """Decrypt password using executor's credentials mixin"""
        if not encrypted:
            return None
        
        if self.executor and hasattr(self.executor, 'decrypt_password'):
            return self.executor.decrypt_password(encrypted)
        
        # If not encrypted or no executor, return as-is
        return encrypted
    
    def _connect_vcenter(self, host: str, username: str, password: str,
                         port: int = 443, verify_ssl: bool = False) -> Optional[object]:
        """Connect to vCenter using pyVmomi"""
        if not PYVMOMI_AVAILABLE:
            return None
        
        try:
            ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            if not verify_ssl:
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            
            si = SmartConnect(
                host=host,
                user=username,
                pwd=password,
                port=port,
                sslContext=ssl_context,
                disableSslCertValidation=not verify_ssl
            )
            return si
        except Exception as e:
            logger.error(f"Failed to connect to vCenter: {e}")
            return None
    
    def unregister_conflicting_vms(self, content, datastore_name: str, 
                                    source_vm_name: str, dr_shell_name: str) -> tuple:
        """
        Find and unregister any VMs that reference files in the target folder.
        This prevents file locking conflicts during test failover when the replicated
        source VM's .vmx file may be registered and holding locks on VMDKs.
        
        Args:
            content: vCenter content object
            datastore_name: Name of the datastore containing replicated files
            source_vm_name: Name of the source VM (folder name on datastore)
            dr_shell_name: Name of the DR Shell VM being created
            
        Returns:
            Tuple of (can_proceed: bool, messages: list)
        """
        if not PYVMOMI_AVAILABLE:
            return (True, ["pyVmomi not available - skipping conflict check"])
        
        messages = []
        folder_pattern = f"[{datastore_name}] {source_vm_name}/"
        messages.append(f"Checking for conflicting VMs in: {folder_pattern}")
        
        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        
        conflicting_vms = []
        try:
            for vm in container.view:
                try:
                    # Check VM's configuration file path
                    if vm.config and vm.config.files:
                        vm_path = vm.config.files.vmPathName or ""
                        if folder_pattern in vm_path:
                            conflicting_vms.append(vm)
                            continue
                    
                    # Check all disk backing file paths
                    if vm.config and vm.config.hardware:
                        for device in vm.config.hardware.device:
                            if isinstance(device, vim.vm.device.VirtualDisk):
                                backing = device.backing
                                if hasattr(backing, 'fileName') and backing.fileName:
                                    if folder_pattern in backing.fileName:
                                        conflicting_vms.append(vm)
                                        break
                except Exception:
                    continue  # Skip VMs we can't inspect
        finally:
            container.Destroy()
        
        if not conflicting_vms:
            messages.append("No conflicting VMs found")
            return (True, messages)
        
        messages.append(f"Found {len(conflicting_vms)} conflicting VM(s)")
        
        for vm in conflicting_vms:
            vm_name = vm.name
            power_state = vm.runtime.powerState
            is_dr_shell = vm_name == dr_shell_name or vm_name.endswith('-DR')
            
            messages.append(f"Conflicting VM: {vm_name} (state: {power_state}, is_dr_shell: {is_dr_shell})")
            
            if power_state == vim.VirtualMachine.PowerState.poweredOn:
                if is_dr_shell:
                    # Active test in progress - cannot proceed
                    messages.append(f"ERROR: Active DR Shell VM {vm_name} is powered on - test failover in progress")
                    return (False, messages)
                else:
                    # Source VM copy is powered on at DR site - unusual but warn and continue
                    messages.append(f"WARNING: Source VM {vm_name} is powered on at DR site - cannot unregister")
                    continue
            
            # VM is powered off - safe to unregister to release file locks
            try:
                vm.UnregisterVM()
                if is_dr_shell:
                    messages.append(f"Unregistered existing DR Shell VM: {vm_name}")
                else:
                    messages.append(f"Unregistered source VM copy: {vm_name} to release file locks")
            except Exception as e:
                messages.append(f"Failed to unregister {vm_name}: {e}")
        
        return (True, messages)
    
    def create_dr_shell_vm(self, dr_vcenter_id: str, vm_name: str,
                           target_datastore: str, cpu_count: int,
                           memory_mb: int, disk_paths: List[str],
                           guest_id: str = 'otherGuest64',
                           firmware: str = 'bios') -> Dict:
        """
        Create a shell VM at DR site with replicated disks attached.
        
        Uses pyVmomi to create a VM with the specified configuration
        and attach existing replicated VMDKs.
        
        Args:
            dr_vcenter_id: UUID of DR vCenter
            vm_name: Name for the shell VM
            target_datastore: Datastore containing replicated disks
            cpu_count: Number of CPUs
            memory_mb: Memory in MB
            disk_paths: List of VMDK paths to attach
            guest_id: vSphere guestId (e.g., 'rhel7_64Guest') - defaults to 'otherGuest64'
            firmware: VM firmware type ('bios' or 'efi') - defaults to 'bios'
            
        Returns:
            Dict with VM creation result
        """
        logger.info(f"Creating DR shell VM: {vm_name} with guest_id: {guest_id}, firmware: {firmware}")
        start_time = time.time()
        
        if not PYVMOMI_AVAILABLE:
            return {
                'success': False,
                'vm_name': vm_name,
                'error': 'pyVmomi not installed',
                'message': 'pyVmomi library not available'
            }
        
        settings = self._get_vcenter_settings(dr_vcenter_id)
        if not settings:
            return {
                'success': False,
                'vm_name': vm_name,
                'error': 'DR vCenter settings not found',
                'message': f'vCenter {dr_vcenter_id} not found'
            }
        
        # Decrypt the password from password_encrypted column
        password = self._decrypt_password(settings.get('password_encrypted'))
        if not password:
            return {
                'success': False,
                'vm_name': vm_name,
                'error': 'Password decryption failed',
                'message': 'Failed to decrypt vCenter password'
            }
        
        si = self._connect_vcenter(
            settings['host'],
            settings['username'],
            password,
            settings.get('port', 443),
            settings.get('verify_ssl', False)
        )
        
        if not si:
            return {
                'success': False,
                'vm_name': vm_name,
                'error': 'DR vCenter connection failed',
                'message': 'Failed to connect to DR vCenter'
            }
        
        try:
            content = si.RetrieveContent()
            
            # Find datacenter
            datacenter = None
            for dc in content.rootFolder.childEntity:
                if isinstance(dc, vim.Datacenter):
                    datacenter = dc
                    break
            
            if not datacenter:
                return {
                    'success': False,
                    'vm_name': vm_name,
                    'error': 'No datacenter found',
                    'message': 'No datacenter found in DR vCenter'
                }
            
            vm_folder = datacenter.vmFolder
            
            # Find resource pool
            resource_pool = None
            for entity in datacenter.hostFolder.childEntity:
                if isinstance(entity, vim.ClusterComputeResource):
                    resource_pool = entity.resourcePool
                    break
                elif isinstance(entity, vim.ComputeResource):
                    resource_pool = entity.resourcePool
                    break
            
            if not resource_pool:
                return {
                    'success': False,
                    'vm_name': vm_name,
                    'error': 'No resource pool found',
                    'message': 'No resource pool found in DR vCenter'
                }
            
            # Find target datastore
            ds_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            
            target_ds = None
            for ds in ds_container.view:
                if ds.name == target_datastore:
                    target_ds = ds
                    break
            
            ds_container.Destroy()
            
            if not target_ds:
                return {
                    'success': False,
                    'vm_name': vm_name,
                    'error': f'Datastore {target_datastore} not found',
                    'message': f'Datastore {target_datastore} not found in DR vCenter'
                }
            
            # Build VM ConfigSpec
            vm_path = f"[{target_datastore}] {vm_name}"
            
            vm_config = vim.vm.ConfigSpec(
                name=vm_name,
                numCPUs=cpu_count,
                memoryMB=memory_mb,
                guestId=guest_id,  # Phase 10: Use source VM's guest ID
                firmware=firmware,  # Phase 11: Use source VM's firmware (bios/efi)
                files=vim.vm.FileInfo(vmPathName=vm_path)
            )
            
            # Add SCSI controller
            # Use negative key for new devices - vSphere will auto-assign
            scsi_controller_key = -100
            scsi_ctr = vim.vm.device.VirtualDeviceSpec()
            scsi_ctr.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
            scsi_ctr.device = vim.vm.device.VirtualLsiLogicController()
            scsi_ctr.device.key = scsi_controller_key
            scsi_ctr.device.busNumber = 0
            scsi_ctr.device.sharedBus = vim.vm.device.VirtualSCSIController.Sharing.noSharing
            vm_config.deviceChange.append(scsi_ctr)
            
            # Add existing disks with detailed logging
            logger.info(f"Attaching {len(disk_paths)} validated disk(s) to VM {vm_name}")
            for i, disk_path in enumerate(disk_paths):
                # Calculate unit number, skipping 7 (reserved for SCSI controller)
                unit_number = i if i < 7 else i + 1
                
                # Log the exact path being used
                logger.info(f"Disk {i}: unit={unit_number}, path='{disk_path}'")
                
                disk_spec = vim.vm.device.VirtualDeviceSpec()
                disk_spec.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
                disk_spec.device = vim.vm.device.VirtualDisk()
                disk_spec.device.key = -101 - i  # Negative keys for new devices
                disk_spec.device.controllerKey = scsi_controller_key
                disk_spec.device.unitNumber = unit_number
                disk_spec.device.backing = vim.vm.device.VirtualDisk.FlatVer2BackingInfo()
                disk_spec.device.backing.fileName = disk_path
                disk_spec.device.backing.diskMode = 'persistent'
                disk_spec.device.backing.datastore = target_ds
                vm_config.deviceChange.append(disk_spec)
            
            # Create VM
            logger.info(f"Creating VM {vm_name} with {cpu_count} CPUs, {memory_mb}MB RAM, {len(disk_paths)} disks")
            task = vm_folder.CreateVM_Task(config=vm_config, pool=resource_pool)
            
            WaitForTask(task)
            
            elapsed = time.time() - start_time
            
            if task.info.state == vim.TaskInfo.State.success:
                vm_moref = str(task.info.result._moId) if task.info.result else 'unknown'
                
                logger.info(f"DR shell VM {vm_name} created successfully in {elapsed:.2f}s")
                return {
                    'success': True,
                    'vm_name': vm_name,
                    'vm_moref': vm_moref,
                    'datastore': target_datastore,
                    'cpu_count': cpu_count,
                    'memory_mb': memory_mb,
                    'disks_attached': len(disk_paths),
                    'elapsed_seconds': round(elapsed, 2),
                    'created_at': datetime.utcnow().isoformat(),
                    'message': f'Created shell VM {vm_name} with {len(disk_paths)} disks'
                }
            else:
                error_msg = str(task.info.error) if task.info.error else 'Unknown error'
                logger.error(f"VM creation failed: {error_msg}")
                return {
                    'success': False,
                    'vm_name': vm_name,
                    'error': error_msg,
                    'message': f'VM creation failed: {error_msg}'
                }
                
        except Exception as e:
            logger.error(f"Error creating DR shell VM: {e}")
            return {
                'success': False,
                'vm_name': vm_name,
                'error': str(e),
                'message': f'Error creating DR shell VM: {e}'
            }
        finally:
            try:
                Disconnect(si)
            except:
                pass
