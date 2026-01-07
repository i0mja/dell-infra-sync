"""
Health and capabilities endpoints.
"""

import os
import time
from datetime import datetime
from typing import Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from zfs_agent import __version__
from zfs_agent.config import settings
from zfs_agent.services.zfs import zfs_service

router = APIRouter(tags=["health"])

# Track startup time
_startup_time = time.time()


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    uptime_seconds: int
    version: str
    hostname: str
    pool_status: Dict[str, Any]


class CapabilitiesResponse(BaseModel):
    """Agent capabilities response."""
    features: list[str]
    zfs_version: str
    syncoid_available: bool
    sanoid_available: bool
    mbuffer_available: bool
    api_version: str


def _get_zfs_version() -> str:
    """Get ZFS version."""
    import subprocess
    try:
        result = subprocess.run(
            [settings.zfs_binary, "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return result.stdout.strip().split("\n")[0]
    except:
        pass
    return "unknown"


def _check_binary(path: str) -> bool:
    """Check if a binary exists and is executable."""
    return os.path.isfile(path) and os.access(path, os.X_OK)


@router.get("/v1/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint.
    
    Returns agent health status including uptime and pool status.
    """
    uptime = int(time.time() - _startup_time)
    
    # Get pool status
    pools = zfs_service.list_pools()
    pool_status = {}
    
    if pools:
        primary_pool = pools[0]
        pool_status = {
            "name": primary_pool.name,
            "health": primary_pool.health,
            "capacity_percent": primary_pool.capacity_percent,
            "free_bytes": primary_pool.free_bytes
        }
    
    status = "healthy"
    if not pools:
        status = "no_pools"
    elif pools[0].health != "ONLINE":
        status = "degraded"
    elif pools[0].capacity_percent > 90:
        status = "warning"
    
    return HealthResponse(
        status=status,
        uptime_seconds=uptime,
        version=__version__,
        hostname=settings.hostname,
        pool_status=pool_status
    )


@router.get("/v1/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities():
    """
    Get agent capabilities.
    
    Returns information about available features and tools.
    """
    features = ["snapshots", "datasets", "nfs"]
    
    syncoid_available = _check_binary(settings.syncoid_binary)
    sanoid_available = _check_binary(settings.sanoid_binary)
    
    # Check for mbuffer
    mbuffer_available = _check_binary("/usr/bin/mbuffer")
    
    if syncoid_available:
        features.append("replication")
    if sanoid_available:
        features.append("sanoid_policies")
    if mbuffer_available:
        features.append("mbuffer")
    
    return CapabilitiesResponse(
        features=features,
        zfs_version=_get_zfs_version(),
        syncoid_available=syncoid_available,
        sanoid_available=sanoid_available,
        mbuffer_available=mbuffer_available,
        api_version="v1"
    )
