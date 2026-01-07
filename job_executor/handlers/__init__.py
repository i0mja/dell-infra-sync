"""Job handlers for Dell Server Manager Job Executor"""

from .idm import IDMHandler
from .console import ConsoleHandler
from .datastore import DatastoreHandler
from .media_upload import MediaUploadHandler
from .virtual_media import VirtualMediaHandler
from .power import PowerHandler
from .boot import BootHandler
from .discovery import DiscoveryHandler
from .firmware import FirmwareHandler
from .cluster import ClusterHandler
from .esxi_handlers import ESXiHandler
from .vcenter_handlers import VCenterHandlers
from .network import NetworkHandler
from .zfs_target import ZfsTargetHandler
from .replication import ReplicationHandler
from .sla_monitoring import SLAMonitoringHandler
from .failover import FailoverHandler
from .agent_target import AgentTargetHandler

__all__ = [
    'IDMHandler',
    'ConsoleHandler', 
    'DatastoreHandler',
    'MediaUploadHandler',
    'VirtualMediaHandler',
    'PowerHandler',
    'BootHandler',
    'DiscoveryHandler',
    'FirmwareHandler',
    'ClusterHandler',
    'ESXiHandler',
    'VCenterHandlers',
    'NetworkHandler',
    'ZfsTargetHandler',
    'ReplicationHandler',
    'SLAMonitoringHandler',
    'FailoverHandler',
    'AgentTargetHandler'
]
