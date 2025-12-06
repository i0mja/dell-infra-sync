"""
Zerfaux - ZFS-backed DR Orchestration for VMware vSphere

This module provides disaster recovery orchestration using ZFS replication.
It operates fully offline/air-gapped with local Supabase.

Modules:
- vcenter_inventory: Sync VM inventory from vCenter (stub or real pyVmomi)
- zfs_replication: ZFS replication orchestration (stub or real SSH/ZFS)
- api_router: HTTP API endpoints for /api/replication/*

Configuration:
- Set ZERFAUX_USE_STUBS=false to enable real vCenter/ZFS operations
- Default is stub mode for offline testing
"""

import os

# Configuration flag to switch between stub and real implementations
# Set to False (or env ZERFAUX_USE_STUBS=false) when real vCenter/ZFS infrastructure is available
USE_ZERFAUX_STUBS = os.getenv("ZERFAUX_USE_STUBS", "true").lower() == "true"

# Conditional imports based on configuration
if USE_ZERFAUX_STUBS:
    from .vcenter_inventory import VCenterInventoryStub as VCenterInventory
    from .zfs_replication import ZFSReplicationStub as ZFSReplication
else:
    from .vcenter_inventory_real import VCenterInventoryReal as VCenterInventory
    from .zfs_replication_real import ZFSReplicationReal as ZFSReplication

from .api_router import ZerfauxAPIRouter

__all__ = [
    'USE_ZERFAUX_STUBS',
    'VCenterInventory',
    'ZFSReplication',
    'ZerfauxAPIRouter',
    # Legacy exports for backwards compatibility
    'VCenterInventoryStub',
    'ZFSReplicationStub'
]

# Always export stubs for direct access if needed
from .vcenter_inventory import VCenterInventoryStub
from .zfs_replication import ZFSReplicationStub
