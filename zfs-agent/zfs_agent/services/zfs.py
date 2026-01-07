"""
ZFS command wrapper service.

Executes ZFS commands and parses output.
"""

import subprocess
import shlex
import logging
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime

from zfs_agent.config import settings
from zfs_agent.models.pool import PoolInfo, DatasetInfo, SnapshotInfo, PoolStatus

logger = logging.getLogger(__name__)


class ZFSService:
    """Service for executing ZFS commands."""
    
    def __init__(self):
        self.zfs = settings.zfs_binary
        self.zpool = settings.zpool_binary
    
    def _run_command(
        self, 
        cmd: List[str], 
        timeout: int = 60,
        check: bool = True
    ) -> Tuple[int, str, str]:
        """Execute a command and return (exit_code, stdout, stderr)."""
        logger.debug(f"Running command: {' '.join(cmd)}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            if check and result.returncode != 0:
                logger.error(f"Command failed: {result.stderr}")
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            logger.error(f"Command timed out: {' '.join(cmd)}")
            return -1, "", "Command timed out"
        except Exception as e:
            logger.error(f"Command error: {e}")
            return -1, "", str(e)
    
    # =========================================================================
    # Pool Operations
    # =========================================================================
    
    def list_pools(self) -> List[PoolInfo]:
        """List all ZFS pools with their properties."""
        cmd = [
            self.zpool, "list", "-Hp",
            "-o", "name,size,alloc,free,fragmentation,capacity,health,altroot"
        ]
        code, stdout, stderr = self._run_command(cmd)
        
        if code != 0:
            logger.error(f"Failed to list pools: {stderr}")
            return []
        
        pools = []
        for line in stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 7:
                pools.append(PoolInfo(
                    name=parts[0],
                    size_bytes=int(parts[1]),
                    allocated_bytes=int(parts[2]),
                    free_bytes=int(parts[3]),
                    fragmentation_percent=int(parts[4].rstrip("%") or 0),
                    capacity_percent=int(parts[5].rstrip("%") or 0),
                    health=parts[6],
                    altroot=parts[7] if len(parts) > 7 and parts[7] != "-" else None
                ))
        
        return pools
    
    def get_pool_status(self, pool_name: str) -> Optional[PoolStatus]:
        """Get detailed status for a pool."""
        cmd = [self.zpool, "status", pool_name]
        code, stdout, stderr = self._run_command(cmd)
        
        if code != 0:
            logger.error(f"Failed to get pool status: {stderr}")
            return None
        
        # Parse zpool status output
        status = PoolStatus(name=pool_name, state="unknown")
        
        for line in stdout.split("\n"):
            line = line.strip()
            if line.startswith("state:"):
                status.state = line.split(":", 1)[1].strip()
            elif line.startswith("status:"):
                status.status = line.split(":", 1)[1].strip()
            elif line.startswith("action:"):
                status.action = line.split(":", 1)[1].strip()
            elif line.startswith("scan:"):
                status.scan = line.split(":", 1)[1].strip()
            elif line.startswith("errors:"):
                status.errors = line.split(":", 1)[1].strip()
        
        return status
    
    def create_pool(
        self, 
        pool_name: str, 
        devices: List[str],
        vdev_type: str = None,  # mirror, raidz, raidz2, etc.
        force: bool = False
    ) -> Tuple[bool, str]:
        """Create a new ZFS pool."""
        cmd = [self.zpool, "create"]
        
        if force:
            cmd.append("-f")
        
        cmd.append(pool_name)
        
        if vdev_type:
            cmd.append(vdev_type)
        
        cmd.extend(devices)
        
        code, stdout, stderr = self._run_command(cmd, timeout=120)
        
        if code == 0:
            return True, f"Pool {pool_name} created successfully"
        else:
            return False, stderr
    
    # =========================================================================
    # Dataset Operations
    # =========================================================================
    
    def list_datasets(self, pool: Optional[str] = None) -> List[DatasetInfo]:
        """List all datasets, optionally filtered by pool."""
        cmd = [
            self.zfs, "list", "-Hp",
            "-o", "name,used,avail,refer,mountpoint,compression,compressratio",
            "-t", "filesystem,volume"
        ]
        
        if pool:
            cmd.append(pool)
        
        code, stdout, stderr = self._run_command(cmd)
        
        if code != 0:
            logger.error(f"Failed to list datasets: {stderr}")
            return []
        
        datasets = []
        for line in stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 5:
                name = parts[0]
                pool_name = name.split("/")[0]
                datasets.append(DatasetInfo(
                    name=name,
                    pool=pool_name,
                    type="filesystem",
                    used_bytes=int(parts[1]),
                    available_bytes=int(parts[2]),
                    referenced_bytes=int(parts[3]),
                    mountpoint=parts[4] if parts[4] != "-" else None,
                    compression=parts[5] if len(parts) > 5 else "off",
                    compressratio=float(parts[6].rstrip("x")) if len(parts) > 6 else 1.0
                ))
        
        return datasets
    
    def create_dataset(
        self, 
        name: str,
        properties: Optional[Dict[str, str]] = None
    ) -> Tuple[bool, str]:
        """Create a new dataset."""
        cmd = [self.zfs, "create"]
        
        if properties:
            for key, value in properties.items():
                cmd.extend(["-o", f"{key}={value}"])
        
        cmd.append(name)
        
        code, stdout, stderr = self._run_command(cmd)
        
        if code == 0:
            return True, f"Dataset {name} created successfully"
        else:
            return False, stderr
    
    # =========================================================================
    # Snapshot Operations
    # =========================================================================
    
    def list_snapshots(self, dataset: Optional[str] = None) -> List[SnapshotInfo]:
        """List snapshots, optionally filtered by dataset."""
        cmd = [
            self.zfs, "list", "-Hp",
            "-o", "name,creation,used,refer",
            "-t", "snapshot",
            "-s", "creation"
        ]
        
        if dataset:
            cmd.extend(["-r", dataset])
        
        code, stdout, stderr = self._run_command(cmd)
        
        if code != 0:
            logger.error(f"Failed to list snapshots: {stderr}")
            return []
        
        snapshots = []
        for line in stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 4 and "@" in parts[0]:
                full_name = parts[0]
                dataset_name, snap_name = full_name.rsplit("@", 1)
                
                # Creation is Unix timestamp
                try:
                    creation = datetime.fromtimestamp(int(parts[1]))
                except:
                    creation = datetime.now()
                
                snapshots.append(SnapshotInfo(
                    name=full_name,
                    dataset=dataset_name,
                    snap_name=snap_name,
                    creation=creation,
                    used_bytes=int(parts[2]),
                    referenced_bytes=int(parts[3])
                ))
        
        return snapshots
    
    def create_snapshot(
        self, 
        dataset: str, 
        snap_name: Optional[str] = None,
        recursive: bool = False
    ) -> Tuple[bool, str, str]:
        """Create a snapshot. Returns (success, snapshot_name, message)."""
        if not snap_name:
            snap_name = datetime.now().strftime("auto_%Y%m%d_%H%M%S")
        
        full_name = f"{dataset}@{snap_name}"
        cmd = [self.zfs, "snapshot"]
        
        if recursive:
            cmd.append("-r")
        
        cmd.append(full_name)
        
        code, stdout, stderr = self._run_command(cmd)
        
        if code == 0:
            return True, full_name, f"Snapshot {full_name} created"
        else:
            return False, "", stderr
    
    def destroy_snapshot(
        self, 
        snapshot: str,
        recursive: bool = False
    ) -> Tuple[bool, str]:
        """Destroy a snapshot."""
        cmd = [self.zfs, "destroy"]
        
        if recursive:
            cmd.append("-r")
        
        cmd.append(snapshot)
        
        code, stdout, stderr = self._run_command(cmd)
        
        if code == 0:
            return True, f"Snapshot {snapshot} destroyed"
        else:
            return False, stderr
    
    # =========================================================================
    # Send/Receive Operations
    # =========================================================================
    
    def estimate_send_size(
        self, 
        snapshot: str,
        incremental_from: Optional[str] = None
    ) -> int:
        """Estimate size of a send stream in bytes."""
        cmd = [self.zfs, "send", "-nvP"]
        
        if incremental_from:
            cmd.extend(["-i", incremental_from])
        
        cmd.append(snapshot)
        
        code, stdout, stderr = self._run_command(cmd, timeout=300)
        
        if code != 0:
            return 0
        
        # Parse "size" line from output
        for line in stdout.split("\n"):
            if "size" in line.lower():
                parts = line.split()
                for i, part in enumerate(parts):
                    if part.lower() == "size":
                        try:
                            return int(parts[i + 1])
                        except:
                            pass
        
        return 0
    
    def get_common_snapshot(
        self, 
        local_dataset: str, 
        remote_snapshots: List[str]
    ) -> Optional[str]:
        """Find the most recent common snapshot between local and remote."""
        local_snaps = self.list_snapshots(local_dataset)
        local_snap_names = {s.snap_name for s in local_snaps}
        
        # Remote snapshots should be just the snap names
        remote_set = set(remote_snapshots)
        
        # Find common snapshots, sorted by creation (newest first)
        common = []
        for snap in reversed(local_snaps):
            if snap.snap_name in remote_set:
                common.append(snap)
        
        return common[0].name if common else None


# Singleton instance
zfs_service = ZFSService()
