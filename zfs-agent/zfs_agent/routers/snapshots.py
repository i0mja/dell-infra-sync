"""
Snapshot management endpoints.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from zfs_agent.services.zfs import zfs_service
from zfs_agent.services.supabase_client import supabase_service
from zfs_agent.models.job import (
    CreateSnapshotRequest,
    CreateSnapshotResponse,
    DeleteSnapshotRequest,
    PruneRequest,
    PruneResponse
)

router = APIRouter(prefix="/v1/snapshots", tags=["snapshots"])


class SnapshotCreatedResponse(BaseModel):
    success: bool
    snapshot_name: str
    message: str


class SnapshotDeletedResponse(BaseModel):
    success: bool
    message: str


@router.post("/{dataset:path}/create", response_model=SnapshotCreatedResponse)
async def create_snapshot(
    dataset: str,
    name: Optional[str] = None,
    recursive: bool = False,
    background_tasks: BackgroundTasks = None
):
    """
    Create a new snapshot for a dataset.
    
    Args:
        dataset: Dataset name (e.g., tank/data)
        name: Optional snapshot name (auto-generated if not provided)
        recursive: Create recursive snapshots for child datasets
    """
    success, snapshot_name, message = zfs_service.create_snapshot(
        dataset, 
        snap_name=name,
        recursive=recursive
    )
    
    if not success:
        raise HTTPException(status_code=400, detail=message)
    
    # Push event to Supabase in background
    if background_tasks:
        background_tasks.add_task(
            supabase_service.push_event,
            event_type="snapshot_created",
            severity="info",
            message=f"Snapshot created: {snapshot_name}",
            details={"dataset": dataset, "snapshot": snapshot_name, "recursive": recursive}
        )
    
    return SnapshotCreatedResponse(
        success=True,
        snapshot_name=snapshot_name,
        message=message
    )


@router.delete("/{dataset:path}@{snap_name}")
async def delete_snapshot(
    dataset: str,
    snap_name: str,
    recursive: bool = False,
    background_tasks: BackgroundTasks = None
):
    """
    Delete a snapshot.
    
    Args:
        dataset: Dataset name
        snap_name: Snapshot name (after @)
        recursive: Delete child snapshots recursively
    """
    full_name = f"{dataset}@{snap_name}"
    success, message = zfs_service.destroy_snapshot(full_name, recursive=recursive)
    
    if not success:
        raise HTTPException(status_code=400, detail=message)
    
    return SnapshotDeletedResponse(success=True, message=message)


@router.post("/prune", response_model=PruneResponse)
async def prune_snapshots(
    request: PruneRequest,
    background_tasks: BackgroundTasks = None
):
    """
    Prune old snapshots based on retention policy.
    
    Uses sanoid-style retention:
    - keep_hourly: Keep this many hourly snapshots
    - keep_daily: Keep this many daily snapshots
    - keep_weekly: Keep this many weekly snapshots
    - keep_monthly: Keep this many monthly snapshots
    """
    # Get all snapshots for the dataset (or all datasets)
    snapshots = zfs_service.list_snapshots(request.dataset)
    
    if not snapshots:
        return PruneResponse(
            success=True,
            deleted_count=0,
            deleted_snapshots=[],
            kept_count=0
        )
    
    # Group snapshots by dataset
    datasets: dict = {}
    for snap in snapshots:
        if snap.dataset not in datasets:
            datasets[snap.dataset] = []
        datasets[snap.dataset].append(snap)
    
    deleted = []
    kept = 0
    
    for dataset, snaps in datasets.items():
        # Sort by creation time (newest first)
        snaps.sort(key=lambda s: s.creation, reverse=True)
        
        # Simple retention: keep N most recent
        # TODO: Implement proper hourly/daily/weekly/monthly buckets
        keep_count = max(
            request.keep_hourly,
            request.keep_daily,
            request.keep_weekly,
            request.keep_monthly
        )
        
        for i, snap in enumerate(snaps):
            if i < keep_count:
                kept += 1
            else:
                if not request.dry_run:
                    success, _ = zfs_service.destroy_snapshot(snap.name)
                    if success:
                        deleted.append(snap.name)
                else:
                    deleted.append(snap.name)  # Would delete
    
    # Push job record
    if background_tasks and not request.dry_run:
        background_tasks.add_task(
            supabase_service.push_job,
            job_type="prune",
            status="success",
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
            details={
                "dataset": request.dataset,
                "deleted_count": len(deleted),
                "kept_count": kept
            }
        )
    
    return PruneResponse(
        success=True,
        deleted_count=len(deleted),
        deleted_snapshots=deleted,
        kept_count=kept
    )
