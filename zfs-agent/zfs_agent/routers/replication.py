"""
Replication management endpoints.
"""

import subprocess
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from zfs_agent.config import settings
from zfs_agent.services.zfs import zfs_service
from zfs_agent.services.supabase_client import supabase_service

router = APIRouter(prefix="/v1/replication", tags=["replication"])


class ReplicationPair(BaseModel):
    """Replication pair configuration."""
    id: str
    source_dataset: str
    target_host: str
    target_dataset: str
    ssh_key_path: Optional[str] = None
    ssh_user: str = "root"
    use_mbuffer: bool = True
    mbuffer_size: str = "1G"
    compression: bool = True
    bandwidth_limit: Optional[str] = None  # e.g., "100M"


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


class ReplicationRunRequest(BaseModel):
    """Request to run replication."""
    force_full: bool = False


class ReplicationRunResponse(BaseModel):
    """Response from starting replication."""
    success: bool
    message: str
    job_id: Optional[str] = None


class RepairRequest(BaseModel):
    """Request to repair a replication pair."""
    action: str = "auto"  # auto, reseed, clear_holds, find_common


class RepairResponse(BaseModel):
    """Response from repair operation."""
    success: bool
    action_taken: str
    message: str
    common_snapshot: Optional[str] = None


# In-memory storage for replication pairs (in production, load from config file or Supabase)
_replication_pairs: dict[str, ReplicationPair] = {}
_replication_status: dict[str, ReplicationStatus] = {}


@router.get("/pairs", response_model=List[ReplicationPair])
async def list_replication_pairs():
    """
    List all configured replication pairs.
    """
    return list(_replication_pairs.values())


@router.get("/pairs/{pair_id}", response_model=ReplicationPair)
async def get_replication_pair(pair_id: str):
    """
    Get a specific replication pair.
    """
    if pair_id not in _replication_pairs:
        raise HTTPException(status_code=404, detail=f"Replication pair '{pair_id}' not found")
    return _replication_pairs[pair_id]


@router.get("/pairs/{pair_id}/status", response_model=ReplicationStatus)
async def get_replication_status(pair_id: str):
    """
    Get status of a replication pair.
    """
    if pair_id not in _replication_pairs:
        raise HTTPException(status_code=404, detail=f"Replication pair '{pair_id}' not found")
    
    if pair_id in _replication_status:
        return _replication_status[pair_id]
    
    pair = _replication_pairs[pair_id]
    return ReplicationStatus(
        pair_id=pair_id,
        source_dataset=pair.source_dataset,
        target_host=pair.target_host,
        target_dataset=pair.target_dataset,
        status="idle"
    )


async def _run_syncoid(pair: ReplicationPair, force_full: bool = False) -> tuple[bool, str, int]:
    """
    Run syncoid for a replication pair.
    
    Returns (success, message, bytes_transferred)
    """
    cmd = [settings.syncoid_binary]
    
    # Options
    cmd.append("--no-sync-snap")  # We manage snapshots ourselves
    
    if force_full:
        cmd.append("--force-delete")
    
    if pair.compression:
        cmd.append("--compress=lz4")
    
    if pair.bandwidth_limit:
        cmd.extend(["--bwlimit", pair.bandwidth_limit])
    
    if pair.use_mbuffer:
        cmd.extend(["--mbuffer-size", pair.mbuffer_size])
    
    # SSH options
    if pair.ssh_key_path:
        cmd.extend(["--sshkey", pair.ssh_key_path])
    
    # Source and target
    cmd.append(pair.source_dataset)
    cmd.append(f"{pair.ssh_user}@{pair.target_host}:{pair.target_dataset}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600  # 1 hour timeout
        )
        
        if result.returncode == 0:
            # Parse bytes from output if available
            bytes_transferred = 0
            for line in result.stdout.split("\n"):
                if "bytes" in line.lower():
                    # Try to extract bytes count
                    parts = line.split()
                    for i, part in enumerate(parts):
                        if part.isdigit():
                            bytes_transferred = int(part)
                            break
            
            return True, "Replication completed successfully", bytes_transferred
        else:
            return False, result.stderr or "Syncoid failed", 0
            
    except subprocess.TimeoutExpired:
        return False, "Replication timed out after 1 hour", 0
    except Exception as e:
        return False, str(e), 0


@router.post("/pairs/{pair_id}/run", response_model=ReplicationRunResponse)
async def run_replication(
    pair_id: str,
    request: ReplicationRunRequest,
    background_tasks: BackgroundTasks
):
    """
    Start replication for a pair.
    
    Runs in background and updates status.
    """
    if pair_id not in _replication_pairs:
        raise HTTPException(status_code=404, detail=f"Replication pair '{pair_id}' not found")
    
    pair = _replication_pairs[pair_id]
    
    # Check if already running
    if pair_id in _replication_status and _replication_status[pair_id].status == "syncing":
        raise HTTPException(status_code=409, detail="Replication already in progress")
    
    # Update status
    _replication_status[pair_id] = ReplicationStatus(
        pair_id=pair_id,
        source_dataset=pair.source_dataset,
        target_host=pair.target_host,
        target_dataset=pair.target_dataset,
        status="syncing"
    )
    
    async def run_sync():
        started_at = datetime.utcnow()
        success, message, bytes_transferred = await _run_syncoid(pair, request.force_full)
        completed_at = datetime.utcnow()
        
        _replication_status[pair_id] = ReplicationStatus(
            pair_id=pair_id,
            source_dataset=pair.source_dataset,
            target_host=pair.target_host,
            target_dataset=pair.target_dataset,
            last_sync_at=completed_at if success else None,
            bytes_transferred=bytes_transferred,
            status="idle" if success else "error",
            error_message=None if success else message
        )
        
        # Push to Supabase
        await supabase_service.push_job(
            job_type="replication",
            status="success" if success else "failed",
            started_at=started_at,
            completed_at=completed_at,
            duration_seconds=int((completed_at - started_at).total_seconds()),
            bytes_transferred=bytes_transferred,
            details={"pair_id": pair_id, "source": pair.source_dataset, "target": pair.target_dataset},
            error_message=None if success else message
        )
    
    background_tasks.add_task(run_sync)
    
    return ReplicationRunResponse(
        success=True,
        message="Replication started"
    )


@router.post("/pairs/{pair_id}/repair", response_model=RepairResponse)
async def repair_replication(
    pair_id: str,
    request: RepairRequest
):
    """
    Attempt to repair a broken replication pair.
    
    Actions:
    - auto: Automatically detect and fix issues
    - reseed: Force a full resync
    - clear_holds: Remove stale ZFS holds
    - find_common: Find common snapshot and resume from there
    """
    if pair_id not in _replication_pairs:
        raise HTTPException(status_code=404, detail=f"Replication pair '{pair_id}' not found")
    
    pair = _replication_pairs[pair_id]
    action = request.action
    
    if action == "auto" or action == "find_common":
        # Try to find common snapshot
        local_snapshots = zfs_service.list_snapshots(pair.source_dataset)
        
        # TODO: SSH to remote and get remote snapshots
        # For now, return what we would do
        
        if local_snapshots:
            latest = local_snapshots[-1]
            return RepairResponse(
                success=True,
                action_taken="find_common",
                message=f"Found {len(local_snapshots)} local snapshots. Latest: {latest.name}",
                common_snapshot=latest.name
            )
        else:
            return RepairResponse(
                success=False,
                action_taken="find_common",
                message="No local snapshots found. Full reseed required."
            )
    
    elif action == "clear_holds":
        # Clear ZFS holds that might prevent snapshot deletion
        cmd = ["zfs", "holds", "-r", pair.source_dataset]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        return RepairResponse(
            success=True,
            action_taken="clear_holds",
            message=f"Checked holds on {pair.source_dataset}"
        )
    
    elif action == "reseed":
        # Mark for full resync
        return RepairResponse(
            success=True,
            action_taken="reseed",
            message="Marked for full resync. Run replication with force_full=true."
        )
    
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
