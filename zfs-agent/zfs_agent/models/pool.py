"""
Pydantic models for ZFS pools and datasets.
"""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class PoolInfo(BaseModel):
    """ZFS pool information."""
    name: str
    size_bytes: int
    allocated_bytes: int
    free_bytes: int
    fragmentation_percent: int
    capacity_percent: int
    health: str  # ONLINE, DEGRADED, FAULTED, OFFLINE, UNAVAIL
    altroot: Optional[str] = None


class DatasetInfo(BaseModel):
    """ZFS dataset information."""
    name: str
    pool: str
    type: str  # filesystem, volume, snapshot
    used_bytes: int
    available_bytes: int
    referenced_bytes: int
    mountpoint: Optional[str] = None
    compression: str = "off"
    compressratio: float = 1.0


class SnapshotInfo(BaseModel):
    """ZFS snapshot information."""
    name: str  # Full name: pool/dataset@snapname
    dataset: str
    snap_name: str
    creation: datetime
    used_bytes: int
    referenced_bytes: int


class PoolStatus(BaseModel):
    """Detailed pool status including vdevs."""
    name: str
    state: str
    status: Optional[str] = None
    action: Optional[str] = None
    scan: Optional[str] = None
    config: Optional[str] = None
    errors: Optional[str] = None


class PoolListResponse(BaseModel):
    """Response for pool listing."""
    pools: List[PoolInfo]
    count: int


class DatasetListResponse(BaseModel):
    """Response for dataset listing."""
    datasets: List[DatasetInfo]
    count: int


class SnapshotListResponse(BaseModel):
    """Response for snapshot listing."""
    snapshots: List[SnapshotInfo]
    count: int
