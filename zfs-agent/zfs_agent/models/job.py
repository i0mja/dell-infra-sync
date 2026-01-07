"""
Pydantic models for agent jobs.
"""

from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
from enum import Enum


class JobType(str, Enum):
    SNAPSHOT = "snapshot"
    REPLICATION = "replication"
    EXPORT = "export"
    REPAIR = "repair"
    PRUNE = "prune"
    POOL_INIT = "pool_init"
    HEALTH_CHECK = "health_check"


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentJob(BaseModel):
    """Agent job record."""
    id: str
    job_type: JobType
    status: JobStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    bytes_transferred: Optional[int] = None
    details: dict = {}
    logs: List[str] = []
    error_message: Optional[str] = None
    created_at: datetime


class JobCreateRequest(BaseModel):
    """Request to create a new job."""
    job_type: JobType
    details: dict = {}


class JobListResponse(BaseModel):
    """Response for job listing."""
    jobs: List[AgentJob]
    count: int


class CreateSnapshotRequest(BaseModel):
    """Request to create a snapshot."""
    dataset: str
    name: Optional[str] = None  # Auto-generated if not provided
    recursive: bool = False


class CreateSnapshotResponse(BaseModel):
    """Response for snapshot creation."""
    success: bool
    snapshot_name: str
    message: str
    job_id: Optional[str] = None


class DeleteSnapshotRequest(BaseModel):
    """Request to delete a snapshot."""
    snapshot: str  # Full name: pool/dataset@snapname
    recursive: bool = False


class PruneRequest(BaseModel):
    """Request to prune old snapshots."""
    dataset: Optional[str] = None  # All datasets if None
    keep_hourly: int = 24
    keep_daily: int = 30
    keep_weekly: int = 4
    keep_monthly: int = 12
    dry_run: bool = False


class PruneResponse(BaseModel):
    """Response for prune operation."""
    success: bool
    deleted_count: int
    deleted_snapshots: List[str]
    kept_count: int
    job_id: Optional[str] = None


class ReplicationRunRequest(BaseModel):
    """Request to run replication for a pair."""
    pair_id: str
    force_full: bool = False  # Force full send instead of incremental


class ReplicationStatus(BaseModel):
    """Status of a replication pair."""
    pair_id: str
    source_dataset: str
    target_host: str
    target_dataset: str
    last_sync_at: Optional[datetime] = None
    last_sync_snapshot: Optional[str] = None
    bytes_transferred: Optional[int] = None
    status: str  # idle, syncing, error
    error_message: Optional[str] = None


class RepairRequest(BaseModel):
    """Request to repair a replication pair."""
    pair_id: str
    action: str = "auto"  # auto, reseed, clear_holds, find_common


class RepairResponse(BaseModel):
    """Response for repair operation."""
    success: bool
    action_taken: str
    message: str
    job_id: Optional[str] = None
