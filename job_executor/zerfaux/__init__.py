"""
Zerfaux - ZFS-backed DR Orchestration for VMware vSphere

This module provides disaster recovery orchestration using ZFS replication.
It operates fully offline/air-gapped with local Supabase.

Modules:
- vcenter_inventory: Sync VM inventory from vCenter (stub now, real pyVmomi later)
- zfs_replication: ZFS replication orchestration (stub now, real syncoid later)
- api_router: HTTP API endpoints for /api/replication/*
"""

from .vcenter_inventory import VCenterInventoryStub
from .zfs_replication import ZFSReplicationStub
from .api_router import ZerfauxAPIRouter

__all__ = [
    'VCenterInventoryStub',
    'ZFSReplicationStub',
    'ZerfauxAPIRouter'
]
