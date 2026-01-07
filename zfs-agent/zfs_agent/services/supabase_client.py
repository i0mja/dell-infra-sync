"""
Supabase client for pushing metrics and events to the central database.
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from zfs_agent.config import settings

logger = logging.getLogger(__name__)

# Supabase client - initialized lazily
_supabase_client = None


def get_supabase_client():
    """Get or create Supabase client."""
    global _supabase_client
    
    if _supabase_client is None:
        if not settings.supabase_url or not settings.supabase_key:
            logger.warning("Supabase not configured - metrics will not be pushed")
            return None
        
        try:
            from supabase import create_client
            _supabase_client = create_client(settings.supabase_url, settings.supabase_key)
            logger.info("Supabase client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            return None
    
    return _supabase_client


class SupabaseService:
    """Service for interacting with Supabase."""
    
    def __init__(self):
        self.agent_id: Optional[str] = None
    
    def _get_client(self):
        """Get Supabase client, returning None if not available."""
        return get_supabase_client()
    
    async def send_heartbeat(
        self,
        hostname: str,
        agent_version: str,
        api_url: str,
        capabilities: Dict[str, Any],
        pool_name: Optional[str] = None,
        pool_size_bytes: Optional[int] = None,
        pool_free_bytes: Optional[int] = None,
        pool_health: Optional[str] = None
    ) -> Optional[str]:
        """Send heartbeat to Supabase, returns agent_id."""
        client = self._get_client()
        if not client:
            return None
        
        try:
            result = client.rpc("upsert_agent_heartbeat", {
                "p_hostname": hostname,
                "p_agent_version": agent_version,
                "p_api_url": api_url,
                "p_capabilities": capabilities,
                "p_pool_name": pool_name,
                "p_pool_size_bytes": pool_size_bytes,
                "p_pool_free_bytes": pool_free_bytes,
                "p_pool_health": pool_health
            }).execute()
            
            if result.data:
                self.agent_id = result.data
                logger.debug(f"Heartbeat sent, agent_id: {self.agent_id}")
                return self.agent_id
        except Exception as e:
            logger.error(f"Failed to send heartbeat: {e}")
        
        return None
    
    async def push_job(
        self,
        job_type: str,
        status: str,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        duration_seconds: Optional[int] = None,
        bytes_transferred: Optional[int] = None,
        details: Optional[Dict] = None,
        logs: Optional[List[str]] = None,
        error_message: Optional[str] = None
    ) -> Optional[str]:
        """Push a job record to Supabase."""
        client = self._get_client()
        if not client or not self.agent_id:
            return None
        
        try:
            result = client.table("agent_jobs").insert({
                "agent_id": self.agent_id,
                "job_type": job_type,
                "status": status,
                "started_at": started_at.isoformat() if started_at else None,
                "completed_at": completed_at.isoformat() if completed_at else None,
                "duration_seconds": duration_seconds,
                "bytes_transferred": bytes_transferred,
                "details": details or {},
                "logs": logs or [],
                "error_message": error_message
            }).execute()
            
            if result.data and len(result.data) > 0:
                return result.data[0].get("id")
        except Exception as e:
            logger.error(f"Failed to push job: {e}")
        
        return None
    
    async def push_event(
        self,
        event_type: str,
        severity: str,
        message: str,
        details: Optional[Dict] = None
    ) -> Optional[str]:
        """Push an event to Supabase."""
        client = self._get_client()
        if not client or not self.agent_id:
            return None
        
        try:
            result = client.table("agent_events").insert({
                "agent_id": self.agent_id,
                "event_type": event_type,
                "severity": severity,
                "message": message,
                "details": details
            }).execute()
            
            if result.data and len(result.data) > 0:
                return result.data[0].get("id")
        except Exception as e:
            logger.error(f"Failed to push event: {e}")
        
        return None
    
    async def update_agent_status(self, status: str) -> bool:
        """Update agent status in Supabase."""
        client = self._get_client()
        if not client or not self.agent_id:
            return False
        
        try:
            client.table("zfs_agents").update({
                "status": status,
                "last_seen_at": datetime.utcnow().isoformat()
            }).eq("id", self.agent_id).execute()
            return True
        except Exception as e:
            logger.error(f"Failed to update agent status: {e}")
            return False


# Singleton instance
supabase_service = SupabaseService()
