"""
Zerfaux - ZFS-backed DR Orchestration for VMware vSphere

This module provides disaster recovery orchestration using ZFS replication.
It operates fully offline/air-gapped with local Supabase.

Modules:
- vcenter_inventory_real: VM relocation (Storage vMotion) via pyVmomi
- zfs_replication_real: ZFS replication and DR shell VM creation
- api_router: HTTP API endpoints for /api/replication/*

Note: vCenter connections and VM inventory sync are handled by the existing
vCenter integration (useVCenters, useVCenterData, vcenter_sync jobs).
"""

from .vcenter_inventory_real import VCenterInventoryReal as VCenterInventory
from .zfs_replication_real import ZFSReplicationReal as ZFSReplication
from .api_router import ZerfauxAPIRouter

__all__ = [
    'VCenterInventory',
    'ZFSReplication',
    'ZerfauxAPIRouter'
]
