"""
Configuration for ZFS Agent.

Reads from environment variables with sensible defaults.
"""

import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # Agent identity
    agent_name: str = os.getenv("ZFS_AGENT_NAME", "zfs-agent")
    hostname: str = os.getenv("HOSTNAME", "localhost")
    
    # API server
    api_host: str = os.getenv("ZFS_AGENT_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("ZFS_AGENT_PORT", "8000"))
    
    # SSL configuration
    ssl_enabled: bool = os.getenv("ZFS_AGENT_SSL_ENABLED", "true").lower() == "true"
    ssl_cert_path: str = os.getenv("ZFS_AGENT_SSL_CERT", "/etc/zfs-agent/ssl/server.crt")
    ssl_key_path: str = os.getenv("ZFS_AGENT_SSL_KEY", "/etc/zfs-agent/ssl/server.key")
    
    # Authentication
    jwt_secret: str = os.getenv("ZFS_AGENT_JWT_SECRET", "")
    jwt_algorithm: str = "HS256"
    
    # Supabase connection for pushing metrics
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    
    # ZFS configuration
    default_pool: str = os.getenv("ZFS_DEFAULT_POOL", "tank")
    zfs_binary: str = os.getenv("ZFS_BINARY", "/usr/sbin/zfs")
    zpool_binary: str = os.getenv("ZPOOL_BINARY", "/usr/sbin/zpool")
    
    # Syncoid/Sanoid
    syncoid_binary: str = os.getenv("SYNCOID_BINARY", "/usr/sbin/syncoid")
    sanoid_binary: str = os.getenv("SANOID_BINARY", "/usr/sbin/sanoid")
    
    # NFS
    exportfs_binary: str = os.getenv("EXPORTFS_BINARY", "/usr/sbin/exportfs")
    
    # Heartbeat
    heartbeat_interval_seconds: int = int(os.getenv("HEARTBEAT_INTERVAL", "60"))
    
    # Logging
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    
    class Config:
        env_prefix = "ZFS_AGENT_"


settings = Settings()
