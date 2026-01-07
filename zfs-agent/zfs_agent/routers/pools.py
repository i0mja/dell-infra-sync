"""
Pool and dataset endpoints.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from zfs_agent.services.zfs import zfs_service
from zfs_agent.models.pool import (
    PoolInfo, 
    DatasetInfo, 
    SnapshotInfo,
    PoolListResponse,
    DatasetListResponse,
    SnapshotListResponse,
    PoolStatus
)

router = APIRouter(prefix="/v1", tags=["inventory"])


@router.get("/pools", response_model=PoolListResponse)
async def list_pools():
    """
    List all ZFS pools.
    
    Returns information about all pools including size, health, and capacity.
    """
    pools = zfs_service.list_pools()
    return PoolListResponse(pools=pools, count=len(pools))


@router.get("/pools/{pool_name}", response_model=PoolInfo)
async def get_pool(pool_name: str):
    """
    Get information about a specific pool.
    """
    pools = zfs_service.list_pools()
    for pool in pools:
        if pool.name == pool_name:
            return pool
    
    raise HTTPException(status_code=404, detail=f"Pool '{pool_name}' not found")


@router.get("/pools/{pool_name}/status", response_model=PoolStatus)
async def get_pool_status(pool_name: str):
    """
    Get detailed status of a pool including vdev information.
    """
    status = zfs_service.get_pool_status(pool_name)
    if not status:
        raise HTTPException(status_code=404, detail=f"Pool '{pool_name}' not found")
    return status


@router.get("/datasets", response_model=DatasetListResponse)
async def list_datasets(
    pool: Optional[str] = Query(None, description="Filter by pool name")
):
    """
    List all datasets, optionally filtered by pool.
    """
    datasets = zfs_service.list_datasets(pool)
    return DatasetListResponse(datasets=datasets, count=len(datasets))


@router.get("/datasets/{dataset:path}", response_model=DatasetInfo)
async def get_dataset(dataset: str):
    """
    Get information about a specific dataset.
    
    Use URL encoding for dataset paths with slashes (e.g., tank%2Fdata).
    """
    datasets = zfs_service.list_datasets()
    for ds in datasets:
        if ds.name == dataset:
            return ds
    
    raise HTTPException(status_code=404, detail=f"Dataset '{dataset}' not found")


@router.get("/snapshots", response_model=SnapshotListResponse)
async def list_snapshots(
    dataset: Optional[str] = Query(None, description="Filter by dataset name")
):
    """
    List all snapshots, optionally filtered by dataset.
    """
    snapshots = zfs_service.list_snapshots(dataset)
    return SnapshotListResponse(snapshots=snapshots, count=len(snapshots))
